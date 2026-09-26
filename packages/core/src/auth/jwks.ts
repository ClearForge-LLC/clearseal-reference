// The JWKS client (CSR-WO-1003 §1.3; CHECKS.md J1–J6). HTTPS only, a size and key-count cap, a
// 3 s deadline on the whole fetch, no redirects. The key set is cached for a TTL; an unknown kid triggers one refetch
// per TTL window; a fetch failure serves a valid cache and otherwise refuses. Every default that
// would fail open in a library is an explicit rule here.

import { request } from "node:https";

import type { Jwk } from "./jws.ts";
import { JsonParseError, parseJsonStrict } from "../transport/json.ts";

export const JWKS_MAX_BYTES = 64 * 1024;
export const JWKS_MAX_KEYS = 32;
export const JWKS_TIMEOUT_MS = 3_000;
/** After a failed fetch, no other fetch for this long: a failing issuer is not hammered at the rate
 *  unauthenticated clients choose (adversarial A2). */
export const JWKS_FAILURE_COOLDOWN_MS = 10_000;
/** AUTH_JWKS_TTL_S bounds, in seconds. */
export const JWKS_TTL_MIN_S = 30;
export const JWKS_TTL_MAX_S = 86_400;

/** Strict UTF-8 for the key-set body: an invalid byte fails the fetch, never becomes U+FFFD. */
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export class JwksConfigError extends Error {
  override name = "JwksConfigError";
}

export interface JwksOptions {
  url: string;
  ttlMs: number;
  /** Extra trust for this client only (a private CA, or a test's self-signed issuer); never a
   *  process-wide TLS switch. */
  ca?: string;
  now?: () => number;
}

/** Every key served under the kid, in the order served: RFC 7517 lets one kid name keys of
 *  different types, and the verifier tries the ones that fit the token's alg. */
export type KeyLookup =
  | { ok: true; jwks: readonly Jwk[] }
  | { ok: false; reason: "unknown-kid" }
  /** The key set cannot be had now; `retryAfterMs` is what remains of the failure cooldown. */
  | { ok: false; reason: "jwks-unavailable"; retryAfterMs: number };

/** GET over HTTPS, capped, with a deadline on the whole exchange (not only on idle time, which a
 *  server dripping one byte a second would never trip); resolves the body text or rejects. */
function fetchText(url: URL, ca: string | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      req.destroy(new Error("deadline"));
    }, JWKS_TIMEOUT_MS);
    const done = (): void => {
      clearTimeout(deadline);
    };
    const req = request(url, { method: "GET", headers: { accept: "application/json" }, ...(ca === undefined ? {} : { ca }) }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`status ${String(res.statusCode)}`));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > JWKS_MAX_BYTES) {
          req.destroy(new Error("over the size cap"));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => {
        done();
        try {
          resolve(STRICT_UTF8.decode(Buffer.concat(chunks)));
        } catch {
          reject(new Error("the key set is not UTF-8"));
        }
      });
      res.on("error", (err) => {
        done();
        reject(err);
      });
    });
    req.on("error", (err) => {
      done();
      reject(err);
    });
    req.end();
  });
}

export class JwksClient {
  readonly #url: URL;
  readonly #ttlMs: number;
  readonly #ca: string | undefined;
  readonly #now: () => number;
  #keys: ReadonlyMap<string, readonly Jwk[]> | undefined;
  #fetchedAt = Number.NEGATIVE_INFINITY;
  #failedAt = Number.NEGATIVE_INFINITY;
  /** Fetches that succeeded: how a caller tells whether its refresh landed. */
  #landed = 0;
  #lastUnknownRefetch = Number.NEGATIVE_INFINITY;
  #inflight: Promise<void> | undefined;
  /** How many fetches were made, for tests and the operator. */
  fetches = 0;

  constructor(options: JwksOptions) {
    let url: URL;
    try {
      url = new URL(options.url);
    } catch {
      throw new JwksConfigError("AUTH_JWKS_URL is not a URL");
    }
    if (url.protocol !== "https:") throw new JwksConfigError("AUTH_JWKS_URL must be https:");
    if (!Number.isFinite(options.ttlMs) || options.ttlMs < JWKS_TTL_MIN_S * 1000 || options.ttlMs > JWKS_TTL_MAX_S * 1000) {
      throw new JwksConfigError(`AUTH_JWKS_TTL_S must be ${String(JWKS_TTL_MIN_S)} to ${String(JWKS_TTL_MAX_S)}`);
    }
    this.#url = url;
    this.#ttlMs = options.ttlMs;
    this.#ca = options.ca;
    this.#now = options.now ?? Date.now;
  }

  /** Time since `t` is inside the TTL. A clock stepped backwards gives a negative span, which is
   *  outside it: a step back never extends the cache or holds the refetch window shut. */
  #within(t: number, span = this.#ttlMs): boolean {
    const elapsed = this.#now() - t;
    return elapsed >= 0 && elapsed < span;
  }

  #valid(): boolean {
    return this.#keys !== undefined && this.#within(this.#fetchedAt);
  }

  /** What remains of the cooldown after the last failure; the whole cooldown when none is running. */
  #cooldownLeft(): number {
    const left = JWKS_FAILURE_COOLDOWN_MS - (this.#now() - this.#failedAt);
    return this.#within(this.#failedAt, JWKS_FAILURE_COOLDOWN_MS) ? left : JWKS_FAILURE_COOLDOWN_MS;
  }

  /** One fetch at a time, and none inside the cooldown after a failure; a failure leaves the cache
   *  as it was. */
  #refresh(): Promise<void> {
    if (this.#inflight === undefined && this.#within(this.#failedAt, JWKS_FAILURE_COOLDOWN_MS)) return Promise.resolve();
    this.#inflight ??= (async () => {
      try {
        this.fetches++;
        const text = await fetchText(this.#url, this.#ca);
        const doc = parseJsonStrict(text, 16) as { keys?: unknown };
        if (typeof doc !== "object" || doc === null || !Array.isArray(doc.keys) || doc.keys.length > JWKS_MAX_KEYS) throw new Error("not a key set within the caps");
        const keys = new Map<string, Jwk[]>();
        for (const k of doc.keys as unknown[]) {
          if (typeof k !== "object" || k === null || Array.isArray(k)) continue;
          const kid = (k as Jwk).kid;
          if (typeof kid !== "string") continue;
          const same = keys.get(kid);
          if (same === undefined) keys.set(kid, [k as Jwk]);
          else same.push(k as Jwk);
        }
        this.#keys = keys;
        this.#fetchedAt = this.#now();
        this.#landed++;
      } catch (err) {
        if (!(err instanceof Error) && !(err instanceof JsonParseError)) throw err;
        // A failure is not fatal here; the caller decides from what the cache holds.
        this.#failedAt = this.#now();
      } finally {
        this.#inflight = undefined;
      }
    })();
    return this.#inflight;
  }

  /** The key for a kid, by the J2–J4 rules. */
  async key(kid: string): Promise<KeyLookup> {
    if (!this.#valid()) await this.#refresh();
    if (!this.#valid()) return { ok: false, reason: "jwks-unavailable", retryAfterMs: this.#cooldownLeft() };
    // Map.get, never an object lookup: a kid of __proto__ or constructor names nothing.
    let jwks = this.#keys?.get(kid);
    if (jwks === undefined && !this.#within(this.#lastUnknownRefetch)) {
      const previous = this.#lastUnknownRefetch;
      const landedBefore = this.#landed;
      this.#lastUnknownRefetch = this.#now();
      await this.#refresh();
      // The refetch did not land (the issuer is down, or inside the cooldown): the kid may be a
      // genuine new key, so this is an outage, not a verdict on the token, and the window is not
      // spent on a fetch that never happened (adversarial A1).
      if (this.#landed === landedBefore) {
        this.#lastUnknownRefetch = previous;
        return { ok: false, reason: "jwks-unavailable", retryAfterMs: this.#cooldownLeft() };
      }
      jwks = this.#valid() ? this.#keys?.get(kid) : undefined;
    }
    return jwks === undefined ? { ok: false, reason: "unknown-kid" } : { ok: true, jwks };
  }
}
