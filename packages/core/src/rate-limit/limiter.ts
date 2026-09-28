// The per-principal rate limit (CSR-WO-2007 §1.1, §1.2; rate-limit/RULES.md). A token bucket per
// verified principal, on an injected monotonic clock, with a bounded table. The transport calls
// `take` once per authenticated request, before it takes a capacity slot or reads the body; a refusal
// is its `429`.

/** The operator's settings (RL-9), read in the snapshot (`node/settings.ts`). */
export interface RateLimitSettings {
  /** Tokens a bucket holds when full: the most requests a principal can make at once. */
  readonly burst: number;
  /** Tokens added per minute, continuously, up to `burst`. */
  readonly refillPerMinute: number;
  /** The most buckets held at once (RL-7, RL-8). */
  readonly maxPrincipals: number;
}

/** The defaults, and why each: rate-limit/RULES.md *Settings and defaults*. */
export const DEFAULT_RATE_LIMIT: Readonly<RateLimitSettings> = Object.freeze({ burst: 1_500, refillPerMinute: 600, maxPrincipals: 10_000 });

/** Each setting's variable, and its ceiling. */
const VARIABLES: Readonly<Record<keyof RateLimitSettings, { name: string; max: number }>> = Object.freeze({
  burst: { name: "RATE_LIMIT_BURST", max: 1_000_000 },
  refillPerMinute: { name: "RATE_LIMIT_REFILL_PER_MINUTE", max: 6_000_000 },
  maxPrincipals: { name: "RATE_LIMIT_MAX_PRINCIPALS", max: 1_000_000 },
});

/** A rate-limit setting that refuses start (N4), naming the variable. */
export class RateLimitConfigError extends Error {
  override name = "RateLimitConfigError";
}

/** A whole number from 1 to `max`, written as plain digits; the reason if not. */
function wholeNumber(value: unknown, max: number): string | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 1 && value <= max ? undefined : `must be a whole number from 1 to ${String(max)}`;
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return `must be a whole number from 1 to ${String(max)}`;
  return Number(value) <= max ? undefined : `must be at most ${String(max)}`;
}

/** Checks a complete set of settings (RL-9); throws naming the first bad one. */
export function checkRateLimit(settings: RateLimitSettings): Readonly<RateLimitSettings> {
  for (const key of Object.keys(VARIABLES) as (keyof RateLimitSettings)[]) {
    const { name, max } = VARIABLES[key];
    const problem = wholeNumber(settings[key], max);
    if (problem !== undefined) throw new RateLimitConfigError(`${name} ${problem}`);
  }
  return Object.freeze({ burst: settings.burst, refillPerMinute: settings.refillPerMinute, maxPrincipals: settings.maxPrincipals });
}

/**
 * The settings from an environment (the snapshot's frozen copy: there is no `process.env` default, so
 * this is never a second read of the environment). An unset or empty variable takes its default; any
 * other value must be a whole number from 1 to its ceiling, or start is refused.
 */
export function rateLimitFromEnv(env: Readonly<Record<string, string | undefined>>): Readonly<RateLimitSettings> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(VARIABLES) as (keyof RateLimitSettings)[]) {
    const { name, max } = VARIABLES[key];
    const raw = env[name];
    if (raw === undefined || raw === "") {
      out[key] = DEFAULT_RATE_LIMIT[key];
      continue;
    }
    const problem = wholeNumber(raw, max);
    if (problem !== undefined) throw new RateLimitConfigError(`${name} ${problem} (got ${JSON.stringify(raw.slice(0, 32))})`);
    out[key] = Number(raw);
  }
  return checkRateLimit(out as unknown as RateLimitSettings);
}

/** What `take` decided. `untracked` is true when the table was full and the principal has no bucket. */
export type Take = { ok: true; untracked: boolean } | { ok: false; retryAfterS: number };

/** Floating-point slack: a bucket a hair under a whole token because of rounding holds that token, so a
 *  principal that waited its Retry-After is served (RL-3). */
const EPSILON = 1e-9;

interface Bucket {
  tokens: number;
  /** The clock reading `tokens` was computed at. */
  at: number;
}

/**
 * The limiter. `clock` is a monotonic clock in milliseconds (the transport's is `performance.now`);
 * the wall clock is never read (RL-6). A clock that steps back is treated as not having moved.
 */
export class RateLimiter {
  readonly #settings: Readonly<RateLimitSettings>;
  readonly #clock: () => number;
  /** In least-recently-used order: a bucket is moved to the end each time it is used. */
  readonly #buckets = new Map<string, Bucket>();
  readonly #perMs: number;

  constructor(settings: RateLimitSettings, clock: () => number) {
    this.#settings = checkRateLimit(settings);
    this.#clock = clock;
    this.#perMs = this.#settings.refillPerMinute / 60_000;
  }

  /** Buckets held now (for tests and health). */
  get size(): number {
    return this.#buckets.size;
  }

  /** The tokens a bucket holds at `now`. */
  #level(b: Bucket, now: number): number {
    return Math.min(this.#settings.burst, b.tokens + Math.max(0, now - b.at) * this.#perMs);
  }

  /** RL-7: drops, from the least recently used end, every bucket that has refilled to full by `now`. */
  #trim(now: number): void {
    for (const [principal, b] of this.#buckets) {
      if (this.#level(b, now) < this.#settings.burst - EPSILON) break;
      this.#buckets.delete(principal);
    }
  }

  /** RL-7, at the cap: drops every full bucket, wherever it is in the order. */
  #sweep(now: number): void {
    for (const [principal, b] of this.#buckets) if (this.#level(b, now) >= this.#settings.burst - EPSILON) this.#buckets.delete(principal);
  }

  /**
   * Takes one token for `principal` (RL-1…RL-5). A refused request takes nothing, so `retryAfterS` is
   * the truth: after that long, the principal is served (RL-3, RL-4).
   */
  take(principal: string): Take {
    const now = this.#clock();
    this.#trim(now);
    let bucket = this.#buckets.get(principal);
    let untracked = false;
    if (bucket === undefined) {
      if (this.#buckets.size >= this.#settings.maxPrincipals) this.#sweep(now);
      // RL-8: at the cap, the newcomer is served untracked; no tracked bucket is evicted.
      if (this.#buckets.size >= this.#settings.maxPrincipals) untracked = true;
      else bucket = { tokens: this.#settings.burst, at: now };
    } else {
      this.#buckets.delete(principal);
    }
    if (bucket === undefined) return { ok: true, untracked };
    bucket.tokens = this.#level(bucket, now);
    bucket.at = Math.max(bucket.at, now);
    this.#buckets.set(principal, bucket);
    if (bucket.tokens >= 1 - EPSILON) {
      bucket.tokens -= 1;
      return { ok: true, untracked };
    }
    // RL-4: whole seconds, rounded up, at least 1.
    const waitMs = Math.max(0, 1 - bucket.tokens) / this.#perMs;
    return { ok: false, retryAfterS: Math.max(1, Math.ceil(waitMs / 1000)) };
  }
}
