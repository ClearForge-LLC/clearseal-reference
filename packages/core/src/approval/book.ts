// The approval book (CSR-WO-2001 §1.1, §1.6; approval/RULES.md APR-2…APR-6, APR-8, APR-11, APR-12,
// APR-15). Every request, decision, grant and redemption lives here, on an injected monotonic clock,
// in a bounded table. It knows nothing of HTTP: the gate (the call side) and the listener (the
// decision side) both go through it, and it writes every step to the audit through `onEvent`.

import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** Why a call's approval did not grant (APR-2…APR-4, APR-11, APR-12). */
export type CallRefusal = "pending" | "declined" | "expired" | "used" | "wrong-principal" | "wrong-tool" | "wrong-arguments" | "unknown" | "too-many";

/** Why a decision was refused (APR-4…APR-6, APR-8). */
export type DecisionRefusal = "unknown" | "expired" | "declined" | "decided" | "self-approval" | "human-required" | "wrong-code" | "link-used" | "link-expired" | "link-burned";

export type Decision = "approve" | "decline";

/** A call, as the book binds it (APR-2). */
export interface Call {
  readonly principal: string;
  readonly tool: string;
  /** The canonical argument digest the grant binds to. */
  readonly digest: string;
  /** The keyed digest the audit carries instead (APR-15). */
  readonly auditDigest: string;
  /** True when the approval discharges Rule-of-Two, so only a human may decide it (APR-6). */
  readonly humanOnly: boolean;
  /** The arguments, for the approver to read on the approval listener only. */
  readonly argumentsJson: string;
}

/** What only the notifier receives (APR-10). */
export interface Secret {
  readonly linkToken: string;
  readonly code: string;
}

/** A request as an approver sees it on the approval listener. Never carries the link or the code. */
export interface Described {
  readonly requestId: string;
  readonly tool: string;
  readonly requester: string;
  readonly arguments: string;
  readonly humanOnly: boolean;
  readonly expiresInSeconds: number;
}

type State = "pending" | "approved" | "declined" | "redeemed" | "expired";

interface Entry {
  readonly id: string;
  readonly call: Call;
  readonly secret: Secret;
  readonly createdAt: number;
  state: State;
  /** When the current phase ends: the request's lifetime while pending, the grant's once approved. */
  deadline: number;
  approver?: string;
  wrongCodes: number;
  linkUsed: boolean;
}

export interface BookOptions {
  readonly requestTtlMs: number;
  readonly grantTtlMs: number;
  readonly maxPending: number;
  readonly maxPendingPerPrincipal: number;
  /** A monotonic clock in milliseconds. */
  readonly clock: () => number;
  /** Every step, for the audit. `principal` is the requester's when known. */
  readonly onEvent: (event: string, fields: Record<string, string | number>) => void;
  /** Ids, link tokens and codes; random by default, deterministic for the test backend. */
  readonly secrets?: { id(): string; linkToken(): string; code(): string };
}

/** Wrong codes a link survives (APR-8); the next burns it. */
export const MAX_WRONG_CODES = 5;

/** The code's alphabet: no 0/O or 1/I/L to confuse a person reading it off a phone. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;

const RANDOM_SECRETS = {
  id: (): string => randomBytes(12).toString("hex"),
  linkToken: (): string => randomBytes(32).toString("base64url"),
  code: (): string => Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)] ?? "2").join(""),
};

/** Equal, compared in constant time for equal lengths. */
function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export class ApprovalBook {
  readonly #o: BookOptions;
  readonly #secrets: NonNullable<BookOptions["secrets"]>;
  readonly #entries = new Map<string, Entry>();
  readonly #byLink = new Map<string, string>();
  readonly #waiters = new Map<string, Set<() => void>>();

  constructor(options: BookOptions) {
    this.#o = options;
    this.#secrets = options.secrets ?? RANDOM_SECRETS;
  }

  /** Records held now (for tests and health). */
  get size(): number {
    return this.#entries.size;
  }

  #event(event: string, e: Entry, fields: Record<string, string | number> = {}): void {
    this.#o.onEvent(event, { principal: e.call.principal, request: e.id, tool: e.call.tool, ...fields });
  }

  /** APR-12: phases end on time, and a record goes once neither its request nor its grant can matter. */
  #sweep(now: number): void {
    for (const [id, e] of this.#entries) {
      if ((e.state === "pending" || e.state === "approved") && now >= e.deadline) {
        const phase = e.state === "pending" ? "request" : "grant";
        e.state = "expired";
        this.#event("approval-expired", e, { phase });
        this.#wake(id);
      }
      if (now >= e.createdAt + this.#o.requestTtlMs + this.#o.grantTtlMs) {
        this.#entries.delete(id);
        this.#byLink.delete(e.secret.linkToken);
      }
    }
  }

  #wake(id: string): void {
    for (const w of this.#waiters.get(id) ?? []) w();
    this.#waiters.delete(id);
  }

  /**
   * Opens (or finds) the request for a call with no request id (APR-1, APR-11). A new request comes back
   * with its secret, for the notifier; a repeat of a pending one comes back without, and notifies nothing.
   */
  open(call: Call): { kind: "pending"; id: string; secret?: Secret } | { kind: "refused"; reason: "too-many" } {
    const now = this.#o.clock();
    this.#sweep(now);
    let mine = 0;
    for (const e of this.#entries.values()) {
      if (e.state !== "pending" || e.call.principal !== call.principal) continue;
      if (e.call.tool === call.tool && e.call.digest === call.digest) return { kind: "pending", id: e.id };
      mine++;
    }
    // APR-11, APR-12: bounded per principal and in all; the refusal notifies nobody.
    if (mine >= this.#o.maxPendingPerPrincipal || this.#entries.size >= this.#o.maxPending) {
      this.#o.onEvent("approval-refused", { principal: call.principal, tool: call.tool, kind: "too-many" });
      return { kind: "refused", reason: "too-many" };
    }
    const e: Entry = { id: this.#secrets.id(), call, secret: { linkToken: this.#secrets.linkToken(), code: this.#secrets.code() }, createdAt: now, state: "pending", deadline: now + this.#o.requestTtlMs, wrongCodes: 0, linkUsed: false };
    this.#entries.set(e.id, e);
    this.#byLink.set(e.secret.linkToken, e.id);
    this.#event("approval-requested", e, { args: call.auditDigest, human: call.humanOnly ? "required" : "any" });
    return { kind: "pending", id: e.id, secret: e.secret };
  }

  /**
   * Redeems a grant for a call that carries its request id (APR-2, APR-3). Only the requesting
   * principal, the same tool and the same arguments redeem it, once, before it expires; nothing that
   * refuses consumes it.
   */
  redeem(id: string, call: Call): { kind: "granted"; approver: string } | { kind: "refused"; reason: CallRefusal } {
    const now = this.#o.clock();
    this.#sweep(now);
    const e = this.#entries.get(id);
    const refuse = (reason: CallRefusal): { kind: "refused"; reason: CallRefusal } => {
      this.#o.onEvent("approval-refused", { principal: call.principal, tool: call.tool, kind: reason, ...(e === undefined ? {} : { request: e.id }) });
      return { kind: "refused", reason };
    };
    if (e === undefined) return refuse("unknown");
    if (!same(e.call.principal, call.principal)) return refuse("wrong-principal");
    if (e.call.tool !== call.tool) return refuse("wrong-tool");
    if (!same(e.call.digest, call.digest)) return refuse("wrong-arguments");
    if (e.state === "expired") return refuse("expired");
    if (e.state === "pending") return refuse("pending");
    if (e.state === "declined") return refuse("declined");
    if (e.state === "redeemed") return refuse("used");
    e.state = "redeemed";
    const approver = e.approver ?? "";
    // B2: the approver is recorded on every redemption.
    this.#event("approval-redeemed", e, { approver, args: call.auditDigest });
    return { kind: "granted", approver };
  }

  /** The request's state, for the bounded wait. */
  stateOf(id: string): State | undefined {
    this.#sweep(this.#o.clock());
    return this.#entries.get(id)?.state;
  }

  /** Resolves when the request is decided or expires, or after `ms`, or when `signal` aborts. */
  waitFor(id: string, ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      let set = this.#waiters.get(id);
      if (set === undefined) {
        set = new Set();
        this.#waiters.set(id, set);
      }
      const done = (): void => {
        clearTimeout(timer);
        this.#waiters.get(id)?.delete(done);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      set.add(done);
      signal?.addEventListener("abort", done, { once: true });
    });
  }

  /** A decision on `e` by `approver` (APR-4…APR-6). */
  #decide(e: Entry, approver: string, decision: Decision, via: "human" | "delegated"): { kind: "decided" } | { kind: "refused"; reason: DecisionRefusal } {
    const refuse = (reason: DecisionRefusal): { kind: "refused"; reason: DecisionRefusal } => {
      this.#event("approval-decision-refused", e, { kind: reason, approver, via });
      return { kind: "refused", reason };
    };
    if (e.state === "expired") return refuse("expired");
    // C1: the approver is never the requester.
    if (same(approver, e.call.principal)) return refuse("self-approval");
    // The architect's ruling on the standard §3: Rule-of-Two is discharged by a human only.
    if (via === "delegated" && e.call.humanOnly) return refuse("human-required");
    // B1: a decline is terminal.
    if (e.state === "declined") return refuse("declined");
    if (e.state !== "pending") return refuse("decided");
    e.approver = approver;
    if (decision === "approve") {
      e.state = "approved";
      e.deadline = this.#o.clock() + this.#o.grantTtlMs;
      this.#event("approval-approved", e, { approver, via });
    } else {
      e.state = "declined";
      this.#event("approval-declined", e, { approver, via });
    }
    this.#wake(e.id);
    return { kind: "decided" };
  }

  /** A decision attempt with no valid approver token (APR-9): audited, decides nothing. */
  decisionUnauthenticated(): void {
    this.#o.onEvent("approval-decision-refused", { principal: "unauthenticated", kind: "unauthenticated", via: "delegated" });
  }

  /** A delegated approver's decision (APR-5, APR-6, APR-9: `approver` is its verified `sub`). */
  decideDelegated(id: string, approver: string, decision: Decision): { kind: "decided" } | { kind: "refused"; reason: DecisionRefusal } {
    this.#sweep(this.#o.clock());
    const e = this.#entries.get(id);
    if (e === undefined) {
      this.#o.onEvent("approval-decision-refused", { principal: "unauthenticated", kind: "unknown", approver, via: "delegated" });
      return { kind: "refused", reason: "unknown" };
    }
    return this.#decide(e, approver, decision, "delegated");
  }

  /** The request behind a link, for an approver to read (APR-8: reading does not decide). */
  describeLink(linkToken: string): Described | { kind: "refused"; reason: DecisionRefusal } {
    const e = this.#linkEntry(linkToken);
    if ("kind" in e) return e;
    return this.#describe(e);
  }

  /** The request behind an id, for a delegated approver to read. */
  describe(id: string): Described | undefined {
    this.#sweep(this.#o.clock());
    const e = this.#entries.get(id);
    return e === undefined ? undefined : this.#describe(e);
  }

  #describe(e: Entry): Described {
    return Object.freeze({ requestId: e.id, tool: e.call.tool, requester: e.call.principal, arguments: e.call.argumentsJson, humanOnly: e.call.humanOnly, expiresInSeconds: Math.max(0, Math.ceil((e.deadline - this.#o.clock()) / 1000)) });
  }

  #linkEntry(linkToken: string): Entry | { kind: "refused"; reason: DecisionRefusal } {
    this.#sweep(this.#o.clock());
    const id = this.#byLink.get(linkToken);
    const e = id === undefined ? undefined : this.#entries.get(id);
    if (e === undefined) return { kind: "refused", reason: "unknown" };
    if (e.wrongCodes >= MAX_WRONG_CODES) return { kind: "refused", reason: "link-burned" };
    if (e.linkUsed || (e.state !== "pending" && e.state !== "expired")) return { kind: "refused", reason: "link-used" };
    if (e.state === "expired") return { kind: "refused", reason: "link-expired" };
    return e;
  }

  /** A human's decision through the confirm-URL (APR-5, APR-8): the link and the code, both. */
  decideByLink(linkToken: string, code: string, decision: Decision, humanApprover: string): { kind: "decided" } | { kind: "refused"; reason: DecisionRefusal } {
    const e = this.#linkEntry(linkToken);
    if ("kind" in e) {
      const id = this.#byLink.get(linkToken);
      const known = id === undefined ? undefined : this.#entries.get(id);
      if (known === undefined) this.#o.onEvent("approval-decision-refused", { principal: "unauthenticated", kind: e.reason, via: "human" });
      else this.#event("approval-decision-refused", known, { kind: e.reason, approver: humanApprover, via: "human" });
      return e;
    }
    if (!same(code.toUpperCase(), e.secret.code)) {
      e.wrongCodes++;
      this.#event("approval-decision-refused", e, { kind: "wrong-code", approver: humanApprover, via: "human" });
      return { kind: "refused", reason: "wrong-code" };
    }
    const result = this.#decide(e, humanApprover, decision, "human");
    // The link is spent by a decision, and by nothing else: a refused decision (self-approval) spends it
    // too, so a link is never tried twice.
    e.linkUsed = true;
    return result;
  }
}
