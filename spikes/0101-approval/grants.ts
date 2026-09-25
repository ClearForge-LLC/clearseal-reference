// CSR-WO-0101 spike: the out-of-band grant store. It holds one-time codes, each bound to (principal,
// tool, canonical argument digest, nonce, expiry), per architecture §5 *Approval binding*. It has
// two separate events: the grant is issued (the code goes out of band, to the server log for the
// spike, with no notifier), then redeemed (single use, refused once used or expired). Not the
// ApprovalBackend (-2001); a spike device only.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Crockford base32 without I, L, O, U: a code an operator can read aloud and retype. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export interface Grant {
  code: string;
  principal: string;
  tool: string;
  argsDigest: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

export type Redemption = { ok: true; grant: Grant } | { ok: false; reason: "unknown-or-used" | "expired" | "bound-elsewhere" };

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function argsDigest(args: unknown): string {
  return createHash("sha256").update(canonicalJson(args)).digest("base64url");
}

function newCode(): string {
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += ALPHABET[b & 31];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/** A presented code in canonical form, or undefined when it is not a code at all: ASCII only (no
 *  case folding of non-ASCII look-alikes), upper-cased, with the Crockford aliases O→0 and I/L→1. */
export function canonicalCode(presented: string): string | undefined {
  if (!/^[0-9A-Za-z]{5}-[0-9A-Za-z]{5}$/.test(presented)) return undefined;
  return presented.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
}

export class GrantStore {
  readonly #grants = new Map<string, Grant>();
  /** Codes that expired, kept for a while with no authority at all, so that a late redemption is
   *  reported as "expired" rather than "unknown" (the sweep would otherwise erase the reason). */
  readonly #expired = new Map<string, number>();
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #sweeper: NodeJS.Timeout;

  constructor(ttlMs: number, now: () => number = Date.now, sweepEveryMs = 1_000) {
    this.#ttlMs = ttlMs;
    this.#now = now;
    // Expired grants are deleted, not just ignored: none survives its expiry (WO §5.4).
    this.#sweeper = setInterval(() => {
      this.sweep();
    }, sweepEveryMs);
    this.#sweeper.unref();
  }

  issue(principal: string, tool: string, args: unknown): Grant {
    const issuedAt = this.#now();
    const grant: Grant = { code: newCode(), principal, tool, argsDigest: argsDigest(args), nonce: randomBytes(12).toString("base64url"), issuedAt, expiresAt: issuedAt + this.#ttlMs };
    this.#grants.set(grant.code, grant);
    return grant;
  }

  /** Single use: a code is removed on its first redemption attempt that matches the binding,
   *  whatever the outcome afterwards. A code presented for another principal, tool or arguments is
   *  refused and burnt too, so a leaked code cannot be retried against the right call. */
  redeem(code: string, principal: string, tool: string, args: unknown): Redemption {
    const canonical = canonicalCode(code);
    if (canonical === undefined) return { ok: false, reason: "unknown-or-used" };
    this.sweep();
    const grant = this.#find(canonical);
    if (grant === undefined) {
      if (this.#expired.delete(canonical)) return { ok: false, reason: "expired" };
      return { ok: false, reason: "unknown-or-used" };
    }
    this.#grants.delete(grant.code);
    if (this.#now() >= grant.expiresAt) return { ok: false, reason: "expired" };
    if (grant.principal !== principal || grant.tool !== tool || grant.argsDigest !== argsDigest(args)) return { ok: false, reason: "bound-elsewhere" };
    return { ok: true, grant };
  }

  sweep(): number {
    const now = this.#now();
    let removed = 0;
    for (const [code, g] of this.#grants) {
      if (now >= g.expiresAt) {
        this.#grants.delete(code);
        this.#expired.set(code, now + 10 * this.#ttlMs);
        removed++;
      }
    }
    for (const [code, until] of this.#expired) if (now >= until) this.#expired.delete(code);
    return removed;
  }

  size(): number {
    return this.#grants.size;
  }

  close(): void {
    clearInterval(this.#sweeper);
  }

  /** Constant-time comparison against every live code (the set is tiny in a spike). */
  #find(code: string): Grant | undefined {
    const wanted = Buffer.from(code);
    for (const g of this.#grants.values()) {
      const have = Buffer.from(g.code);
      if (have.length === wanted.length && timingSafeEqual(have, wanted)) return g;
    }
    return undefined;
  }
}
