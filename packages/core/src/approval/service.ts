// The approval backend (CSR-WO-2001 §1.2, §1.5; approval/RULES.md). The call side (`gate`, used by
// dispatch) and the decision side (the approval listener, `listen`) over one book. Two backends: the
// listener backend a node runs, and a deterministic test backend with no listener, decided in-process.

import { ApprovalBook, type Call, type CallRefusal, type Secret } from "./book.ts";
import { MemoryNotifier, type Notifier, NotifyError } from "./notifier.ts";
import type { ApprovalSettings } from "./settings.ts";
import type { Verifier } from "../transport/verifier.ts";

/** What a call's approval came to (APR-1…APR-3, APR-13). */
export type GateOutcome = { kind: "granted"; requestId: string; approver: string } | { kind: "pending"; requestId: string; retryAfterSeconds: number } | { kind: "refused"; reason: CallRefusal; requestId?: string };

/** The retry hint on a pending answer, in seconds. */
export const RETRY_HINT_SECONDS = 5;

/** A request id as the book issues one: what the gate accepts from a caller's `_meta`. */
const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;

export interface ApprovalServiceOptions {
  readonly settings: Readonly<ApprovalSettings>;
  readonly notifier: Notifier;
  /** A monotonic clock in milliseconds. */
  readonly clock: () => number;
  /** The node's audit seam. */
  readonly audit: (event: string, fields: Record<string, string | number>) => void;
  /** The delegated approvers' verifier, for the approval audience; absent: no delegated approvers. */
  readonly delegatedVerifier?: Verifier;
  /** Deterministic secrets (the test backend). */
  readonly secrets?: ConstructorParameters<typeof ApprovalBook>[0]["secrets"];
  /** False for the test backend: decisions are made in-process, never on a listener. */
  readonly listens: boolean;
}

export class ApprovalService {
  readonly book: ApprovalBook;
  readonly settings: Readonly<ApprovalSettings>;
  readonly delegatedVerifier: Verifier | undefined;
  readonly listens: boolean;
  readonly #notifier: Notifier;
  readonly #audit: ApprovalServiceOptions["audit"];
  /** The base of every link, fixed once the listener is bound (or the configured public URL). */
  #base: string;

  constructor(o: ApprovalServiceOptions) {
    this.settings = o.settings;
    this.#notifier = o.notifier;
    this.#audit = o.audit;
    this.delegatedVerifier = o.delegatedVerifier;
    this.listens = o.listens;
    this.#base = o.settings.publicUrl !== "" ? o.settings.publicUrl : "http://approval.invalid";
    this.book = new ApprovalBook({
      requestTtlMs: o.settings.requestTtlSeconds * 1000,
      grantTtlMs: o.settings.grantTtlSeconds * 1000,
      maxPending: o.settings.maxPending,
      maxPendingPerPrincipal: o.settings.maxPendingPerPrincipal,
      clock: o.clock,
      onEvent: o.audit,
      ...(o.secrets === undefined ? {} : { secrets: o.secrets }),
    });
  }

  /** Set by the listener once bound, when no public URL is configured. */
  setBase(base: string): void {
    if (this.settings.publicUrl === "") this.#base = base;
  }

  /** The link a notifier delivers. */
  linkFor(secret: Secret): string {
    return `${this.#base}/approval/link/${secret.linkToken}`;
  }

  /** APR-10: the link and the code go to the notifier, and nowhere else; delivery is not awaited. */
  #notify(id: string, call: Call, secret: Secret): void {
    const n = { requestId: id, tool: call.tool, requester: call.principal, link: this.linkFor(secret), code: secret.code, humanOnly: call.humanOnly, expiresInSeconds: this.settings.requestTtlSeconds };
    let sent: Promise<void>;
    try {
      sent = this.#notifier.notify(n);
    } catch (err) {
      sent = Promise.reject(err instanceof Error ? err : new Error("notify"));
    }
    sent.then(
      () => {
        this.#audit("approval-notified", { principal: call.principal, request: id, tool: call.tool });
      },
      (err: unknown) => {
        this.#audit("approval-notify-failed", { principal: call.principal, request: id, tool: call.tool, reason: err instanceof NotifyError ? err.message : "error" });
      },
    );
  }

  /**
   * The call side (APR-1…APR-3, APR-11, APR-13). With a request id, redeem it; without, open (or find)
   * the request, notify, and wait up to the bounded wait for a decision.
   */
  async gate(call: Call, requestId: string | undefined, signal?: AbortSignal): Promise<GateOutcome> {
    if (requestId !== undefined) {
      const r = this.book.redeem(REQUEST_ID.test(requestId) ? requestId : "", call);
      return r.kind === "granted" ? { kind: "granted", requestId, approver: r.approver } : { kind: "refused", reason: r.reason, requestId };
    }
    const o = this.book.open(call);
    if (o.kind === "refused") return { kind: "refused", reason: o.reason };
    if (o.secret !== undefined) this.#notify(o.id, call, o.secret);
    else this.#audit("approval-refused", { principal: call.principal, request: o.id, tool: call.tool, kind: "pending" });
    const waitMs = this.settings.waitSeconds * 1000;
    if (waitMs > 0 && this.book.stateOf(o.id) === "pending") {
      await this.book.waitFor(o.id, waitMs, signal);
      if (this.book.stateOf(o.id) === "approved" && signal?.aborted !== true) {
        const r = this.book.redeem(o.id, call);
        if (r.kind === "granted") return { kind: "granted", requestId: o.id, approver: r.approver };
        return { kind: "refused", reason: r.reason, requestId: o.id };
      }
      const state = this.book.stateOf(o.id);
      if (state === "declined") return { kind: "refused", reason: "declined", requestId: o.id };
    }
    return { kind: "pending", requestId: o.id, retryAfterSeconds: RETRY_HINT_SECONDS };
  }
}

/**
 * The deterministic test backend (§1.5): request ids `req-1`, `req-2`…, link tokens `link-1`…, codes
 * `CODE0001`…, a memory notifier, and no listener: tests decide through the book.
 */
export function testApprovalBackend(settings: Readonly<ApprovalSettings>, clock: () => number, audit: ApprovalServiceOptions["audit"], delegatedVerifier?: Verifier): { service: ApprovalService; notifier: MemoryNotifier } {
  let n = 0;
  let l = 0;
  let c = 0;
  const notifier = new MemoryNotifier();
  const service = new ApprovalService({
    settings,
    notifier,
    clock,
    audit,
    listens: false,
    ...(delegatedVerifier === undefined ? {} : { delegatedVerifier }),
    secrets: { id: () => `req-${String(++n)}`, linkToken: () => `link-${String(++l)}`, code: () => `CODE${String(++c).padStart(4, "0")}` },
  });
  return { service, notifier };
}
