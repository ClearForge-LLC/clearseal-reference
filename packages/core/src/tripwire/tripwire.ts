// The read-burst tripwire (CSR-WO-2007 §1.3; tripwire/RULES.md). Per verified principal, it counts
// `tools/call`s that name an admitted `read_only` tool, and when one principal's count within a sliding
// window reaches the threshold it reports exactly one burst, then stays quiet until that principal has
// made no counted call for the quiet period. It decides nothing a call depends on: the transport calls
// `observe` synchronously and catches anything it throws (TW-6).

/** The operator's settings (TW-10), read in the snapshot (`node/settings.ts`). */
export interface TripwireSettings {
  /** Counted calls within one window that make a burst. */
  readonly threshold: number;
  /** The sliding window, in seconds. */
  readonly windowSeconds: number;
  /** Seconds without a counted call that end a burst and re-arm the tripwire. */
  readonly quietSeconds: number;
  /** The most principals tracked at once (TW-8, TW-9). */
  readonly maxPrincipals: number;
}

/** The defaults, and why each: tripwire/RULES.md *Settings and defaults*. */
export const DEFAULT_TRIPWIRE: Readonly<TripwireSettings> = Object.freeze({ threshold: 200, windowSeconds: 60, quietSeconds: 300, maxPrincipals: 1_000 });

const VARIABLES: Readonly<Record<keyof TripwireSettings, { name: string; max: number }>> = Object.freeze({
  threshold: { name: "TRIPWIRE_THRESHOLD", max: 10_000 },
  windowSeconds: { name: "TRIPWIRE_WINDOW_SECONDS", max: 86_400 },
  quietSeconds: { name: "TRIPWIRE_QUIET_SECONDS", max: 86_400 },
  maxPrincipals: { name: "TRIPWIRE_MAX_PRINCIPALS", max: 100_000 },
});

/** The most timestamps held in all (TW-10): threshold × maxPrincipals, about 40 MB at the ceiling. */
export const MAX_TRIPWIRE_TIMESTAMPS = 5_000_000;

/** A tripwire setting that refuses start (N4), naming the variable. */
export class TripwireConfigError extends Error {
  override name = "TripwireConfigError";
}

function wholeNumber(value: unknown, max: number): string | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 1 && value <= max ? undefined : `must be a whole number from 1 to ${String(max)}`;
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return `must be a whole number from 1 to ${String(max)}`;
  return Number(value) <= max ? undefined : `must be at most ${String(max)}`;
}

/** Checks a complete set of settings (TW-10); throws naming the first bad one. */
export function checkTripwire(settings: TripwireSettings): Readonly<TripwireSettings> {
  for (const key of Object.keys(VARIABLES) as (keyof TripwireSettings)[]) {
    const { name, max } = VARIABLES[key];
    const problem = wholeNumber(settings[key], max);
    if (problem !== undefined) throw new TripwireConfigError(`${name} ${problem}`);
  }
  if (settings.threshold * settings.maxPrincipals > MAX_TRIPWIRE_TIMESTAMPS) {
    throw new TripwireConfigError(`TRIPWIRE_THRESHOLD × TRIPWIRE_MAX_PRINCIPALS must be at most ${String(MAX_TRIPWIRE_TIMESTAMPS)}: each tracked principal holds up to TRIPWIRE_THRESHOLD timestamps`);
  }
  return Object.freeze({ threshold: settings.threshold, windowSeconds: settings.windowSeconds, quietSeconds: settings.quietSeconds, maxPrincipals: settings.maxPrincipals });
}

/**
 * The settings from an environment (the snapshot's frozen copy; no `process.env` default). An unset or
 * empty variable takes its default; any other value must be a whole number from 1 to its ceiling.
 */
export function tripwireFromEnv(env: Readonly<Record<string, string | undefined>>): Readonly<TripwireSettings> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(VARIABLES) as (keyof TripwireSettings)[]) {
    const { name, max } = VARIABLES[key];
    const raw = env[name];
    if (raw === undefined || raw === "") {
      out[key] = DEFAULT_TRIPWIRE[key];
      continue;
    }
    const problem = wholeNumber(raw, max);
    if (problem !== undefined) throw new TripwireConfigError(`${name} ${problem} (got ${JSON.stringify(raw.slice(0, 32))})`);
    out[key] = Number(raw);
  }
  return checkTripwire(out as unknown as TripwireSettings);
}

/** One principal's recent counted calls: the last `threshold` timestamps, in a ring. */
interface Entry {
  readonly times: Float64Array;
  /** The next slot to write. */
  next: number;
  /** Timestamps written since the entry was (re-)armed, capped at the ring's length. */
  filled: number;
  /** False from a burst until the quiet period has passed (TW-3). */
  armed: boolean;
  last: number;
}

/** A burst, as reported: the principal, the count within the window, and the window in seconds. */
export type OnBurst = (principal: string, count: number, windowSeconds: number) => void;

/**
 * The tripwire. `clock` is a monotonic clock in milliseconds; the wall clock is never read (TW-7).
 * `onBurst` is called once per burst (TW-2, TW-3).
 */
export class Tripwire {
  readonly #settings: Readonly<TripwireSettings>;
  readonly #clock: () => number;
  readonly #onBurst: OnBurst;
  readonly #windowMs: number;
  readonly #quietMs: number;
  /** In least-recently-used order: an entry is moved to the end each time it counts a call. */
  readonly #entries = new Map<string, Entry>();

  constructor(settings: TripwireSettings, clock: () => number, onBurst: OnBurst) {
    this.#settings = checkTripwire(settings);
    this.#clock = clock;
    this.#onBurst = onBurst;
    this.#windowMs = this.#settings.windowSeconds * 1000;
    this.#quietMs = this.#settings.quietSeconds * 1000;
  }

  /** Principals tracked now (for tests and health). */
  get size(): number {
    return this.#entries.size;
  }

  /** TW-8: an entry that can no longer affect a decision. An armed one idle past the window holds no
   *  timestamp inside it; a fired one idle past the quiet period re-arms empty on its next call. Either
   *  way it decides exactly as no entry does. */
  #spent(e: Entry, now: number): boolean {
    const idle = now - e.last;
    return e.armed ? idle > this.#windowMs : idle >= this.#quietMs;
  }

  #trim(now: number): void {
    for (const [principal, e] of this.#entries) {
      if (!this.#spent(e, now)) break;
      this.#entries.delete(principal);
    }
  }

  #sweep(now: number): void {
    for (const [principal, e] of this.#entries) if (this.#spent(e, now)) this.#entries.delete(principal);
  }

  /**
   * Counts one call by `principal` to an admitted `read_only` tool. Returns true when the table was
   * full and the principal was not counted (TW-9), so the caller can say so once.
   */
  observe(principal: string): boolean {
    const now = this.#clock();
    this.#trim(now);
    let e = this.#entries.get(principal);
    if (e === undefined) {
      if (this.#entries.size >= this.#settings.maxPrincipals) this.#sweep(now);
      // TW-9: at the cap, the newcomer is not counted; no entry is evicted.
      if (this.#entries.size >= this.#settings.maxPrincipals) return true;
      e = { times: new Float64Array(this.#settings.threshold), next: 0, filled: 0, armed: true, last: now };
    } else {
      this.#entries.delete(principal);
      // TW-4: after the quiet period the burst is over; the count starts again from zero.
      if (!e.armed && now - e.last >= this.#quietMs) {
        e.armed = true;
        e.filled = 0;
        e.next = 0;
      }
    }
    this.#entries.set(principal, e);
    e.times[e.next] = now;
    e.next = (e.next + 1) % e.times.length;
    e.filled = Math.min(e.filled + 1, e.times.length);
    e.last = Math.max(e.last, now);
    // TW-2, TW-5: the oldest of the last `threshold` calls is inside the window, so `threshold` calls are.
    if (e.armed && e.filled === e.times.length && now - (e.times[e.next] ?? now) <= this.#windowMs) {
      // TW-3: disarmed until the quiet period has passed.
      e.armed = false;
      this.#onBurst(principal, this.#settings.threshold, this.#settings.windowSeconds);
    }
    return false;
  }
}
