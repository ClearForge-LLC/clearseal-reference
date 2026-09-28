// CSR-WO-2007 §1.1, §1.2, §1.4: the rate limiter's rules (rate-limit/RULES.md), on a fake monotonic
// clock. The transport-level cases (the 429 itself, per principal on the wire, what counts) are in
// test/transport/rate-limit.test.ts.

import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, it } from "node:test";

import { checkRateLimit, DEFAULT_RATE_LIMIT, RateLimitConfigError, rateLimitFromEnv, RateLimiter } from "../../src/rate-limit/limiter.ts";

/** A clock that moves only when the test moves it. */
function fakeClock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

const outcome = (r: ReturnType<RateLimiter["take"]>): string => (r.ok ? `ok${r.untracked ? " untracked" : ""}` : `refused ${String(r.retryAfterS)} s`);

void describe("CSR-WO-2007 rate limit: the bucket", () => {
  void it("RL-2: buckets are per principal: A drained is refused while B is served", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ burst: 2, refillPerMinute: 60, maxPrincipals: 10 }, clock.now);
    assert.deepEqual([limiter.take("alice"), limiter.take("alice"), limiter.take("alice")].map(outcome), ["ok", "ok", "refused 1 s"]);
    assert.equal(outcome(limiter.take("bob")), "ok");
    assert.equal(outcome(limiter.take("alice")), "refused 1 s", "B's request gave A nothing");
  });

  void it("RL-3: a bucket refills with the clock, and after its Retry-After the refused principal is served", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ burst: 3, refillPerMinute: 30, maxPrincipals: 10 }, clock.now);
    for (let i = 0; i < 3; i++) assert.equal(outcome(limiter.take("alice")), "ok");
    const refused = limiter.take("alice");
    assert.equal(outcome(refused), "refused 2 s", "30 a minute: one token every 2 s");
    clock.advance(1_999);
    assert.equal(outcome(limiter.take("alice")), "refused 1 s", "not yet");
    clock.advance(1);
    assert.equal(outcome(limiter.take("alice")), "ok", "served after exactly Retry-After");
    clock.advance(60_000);
    assert.deepEqual([limiter.take("alice"), limiter.take("alice"), limiter.take("alice"), limiter.take("alice")].map(outcome), ["ok", "ok", "ok", "refused 2 s"], "refilled to burst, never past it");
  });

  void it("RL-4: Retry-After is whole seconds, rounded up, at least 1", () => {
    const tenPerSecond = new RateLimiter({ burst: 1, refillPerMinute: 600, maxPrincipals: 10 }, fakeClock().now);
    tenPerSecond.take("a");
    assert.equal(outcome(tenPerSecond.take("a")), "refused 1 s", "a wait of 0.1 s is 1, never 0");
    const clock = fakeClock();
    const slow = new RateLimiter({ burst: 1, refillPerMinute: 24, maxPrincipals: 10 }, clock.now);
    slow.take("a");
    assert.equal(outcome(slow.take("a")), "refused 3 s", "a wait of 2.5 s is 3");
    clock.advance(1_000);
    assert.equal(outcome(slow.take("a")), "refused 2 s", "1.5 s left is 2");
  });

  void it("RL-6: time is the injected clock, never the wall clock", async () => {
    const frozen = fakeClock();
    // Refills a token every 0.6 ms of whatever clock it reads.
    const limiter = new RateLimiter({ burst: 1, refillPerMinute: 100_000, maxPrincipals: 10 }, frozen.now);
    assert.equal(outcome(limiter.take("a")), "ok");
    await sleep(30);
    assert.equal(outcome(limiter.take("a")), "refused 1 s", "30 ms of real time refilled nothing: the limiter reads only its clock");
    frozen.advance(1);
    assert.equal(outcome(limiter.take("a")), "ok");
  });
});

void describe("CSR-WO-2007 rate limit: bounded memory", () => {
  void it("RL-7: a bucket that has refilled to full is dropped, since it decides as no bucket does", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ burst: 2, refillPerMinute: 60, maxPrincipals: 100 }, clock.now);
    for (let i = 0; i < 20; i++) limiter.take(`p${String(i)}`);
    assert.equal(limiter.size, 20);
    clock.advance(999);
    limiter.take("late");
    assert.equal(limiter.size, 21, "not yet full: every bucket is still needed");
    clock.advance(1);
    limiter.take("later");
    assert.equal(limiter.size, 2, "the twenty full buckets are gone; only the two still refilling are held");
  });

  void it("RL-8: at the cap a fresh principal is served untracked, and no limited principal's budget resets", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ burst: 1, refillPerMinute: 1, maxPrincipals: 3 }, clock.now);
    for (const p of ["alice", "bob", "carol"]) limiter.take(p);
    for (const p of ["alice", "bob", "carol"]) assert.equal(outcome(limiter.take(p)), "refused 60 s", `${p} is limited`);
    const newcomers = Array.from({ length: 500 }, (_, i) => limiter.take(`fresh${String(i)}`));
    assert.ok(newcomers.every((r) => r.ok && r.untracked), "every fresh principal is served, untracked");
    for (const p of ["alice", "bob", "carol"]) assert.equal(outcome(limiter.take(p)), "refused 60 s", `${p} is still limited: nothing evicted its bucket`);
    assert.equal(limiter.size, 3);
    clock.advance(60_000);
    assert.equal(outcome(limiter.take("dave")), "ok", "once the limited buckets refill, a newcomer is tracked again");
    assert.equal(limiter.size, 1);
  });
});

void describe("CSR-WO-2007 rate limit: the sweep, and a clock that steps back (review F1, F5)", () => {
  void it("RL-7: at the cap, a full bucket behind one still refilling is swept, and the newcomer is tracked", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ burst: 2, refillPerMinute: 60, maxPrincipals: 2 }, clock.now);
    // x drains its bucket first, so it is ahead in the order and full only after 2 s; y takes one
    // token later and is full after 1 s. At 1.6 s, y is full and x is not.
    limiter.take("x");
    limiter.take("x");
    clock.advance(500);
    limiter.take("y");
    clock.advance(1_100);
    const z = limiter.take("z");
    assert.equal(outcome(z), "ok", "z is served");
    assert.equal(z.ok && z.untracked, false, "and tracked: the sweep dropped y's full bucket, which the idle trim could not reach behind x's");
    assert.equal(outcome(limiter.take("z")), "ok");
    assert.equal(outcome(limiter.take("z")), "refused 1 s", "z has a budget of its own, so it is limited");
  });

  void it("a clock that steps back is treated as not having moved: no token is refilled twice", () => {
    let t = 10_000;
    const limiter = new RateLimiter({ burst: 1, refillPerMinute: 60, maxPrincipals: 10 }, () => t);
    assert.equal(outcome(limiter.take("a")), "ok");
    t = 5_000;
    assert.equal(outcome(limiter.take("a")), "refused 1 s", "stepping back refills nothing");
    t = 10_500;
    assert.equal(outcome(limiter.take("a")), "refused 1 s", "half a second after the last real reading is half a token, not five and a half");
  });
});

void describe("CSR-WO-2007 rate limit: settings (RL-9)", () => {
  void it("unset or empty variables take the defaults", () => {
    assert.deepEqual(rateLimitFromEnv({}), DEFAULT_RATE_LIMIT);
    assert.deepEqual(rateLimitFromEnv({ RATE_LIMIT_BURST: "" }), DEFAULT_RATE_LIMIT);
    assert.deepEqual(rateLimitFromEnv({ RATE_LIMIT_BURST: "5", RATE_LIMIT_REFILL_PER_MINUTE: "6", RATE_LIMIT_MAX_PRINCIPALS: "7" }), { burst: 5, refillPerMinute: 6, maxPrincipals: 7 });
  });

  const bad: [string, string, RegExp][] = [];
  for (const name of ["RATE_LIMIT_BURST", "RATE_LIMIT_REFILL_PER_MINUTE", "RATE_LIMIT_MAX_PRINCIPALS"]) {
    for (const value of ["0", "-1", "1.5", "x", " 5", "05", "1e3"]) bad.push([name, value, new RegExp(`^${name} must be a whole number from 1 to`)]);
    bad.push([name, "99999999", new RegExp(`^${name} must be at most`)]);
  }
  for (const [name, value, message] of bad) {
    void it(`${name}=${JSON.stringify(value)} refuses start, naming the variable`, () => {
      assert.throws(() => rateLimitFromEnv({ [name]: value }), (err: unknown) => err instanceof RateLimitConfigError && message.test(err.message));
    });
  }

  void it("a direct caller's settings are checked too", () => {
    assert.throws(() => checkRateLimit({ burst: 0, refillPerMinute: 1, maxPrincipals: 1 }), /RATE_LIMIT_BURST must be a whole number/);
    assert.throws(() => new RateLimiter({ burst: 1, refillPerMinute: 1, maxPrincipals: Number.NaN }, () => 0), /RATE_LIMIT_MAX_PRINCIPALS must be a whole number/);
  });
});
