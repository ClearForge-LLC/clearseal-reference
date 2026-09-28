// CSR-WO-2007 §1.3, §1.4: the tripwire's rules (tripwire/RULES.md), on a fake monotonic clock. What
// counts on the wire (TW-1) and that it changes no answer (TW-6) are in test/transport/tripwire.test.ts.

import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, it } from "node:test";

import { checkTripwire, DEFAULT_TRIPWIRE, Tripwire, TripwireConfigError, tripwireFromEnv, type TripwireSettings } from "../../src/tripwire/tripwire.ts";

function fakeClock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

/** A tripwire on a fake clock, and the bursts it reported. */
function rig(settings: Partial<TripwireSettings> = {}): { tw: Tripwire; clock: ReturnType<typeof fakeClock>; bursts: string[] } {
  const clock = fakeClock();
  const bursts: string[] = [];
  const tw = new Tripwire({ threshold: 5, windowSeconds: 10, quietSeconds: 30, maxPrincipals: 100, ...settings }, clock.now, (p, count, windowS) => bursts.push(`${p} ${String(count)} in ${String(windowS)} s`));
  return { tw, clock, bursts };
}

const read = (tw: Tripwire, principal: string, times: number, clock?: ReturnType<typeof fakeClock>, gapMs = 0): void => {
  for (let i = 0; i < times; i++) {
    tw.observe(principal);
    if (clock !== undefined) clock.advance(gapMs);
  }
};

void describe("CSR-WO-2007 tripwire: bursts", () => {
  void it("TW-2: the threshold's reads inside one window write exactly one burst, naming the principal", () => {
    const { tw, bursts } = rig();
    read(tw, "alice", 4);
    assert.deepEqual(bursts, [], "one under the threshold");
    read(tw, "alice", 1);
    assert.deepEqual(bursts, ["alice 5 in 10 s"]);
  });

  void it("TW-3: continued reading inside one burst writes no further row", () => {
    const { tw, clock, bursts } = rig();
    read(tw, "alice", 30, clock, 1_000);
    assert.deepEqual(bursts, ["alice 5 in 10 s"], "thirty reads a second apart: one burst, one row");
  });

  void it("TW-4: after the quiet period it re-arms from zero: a second burst writes a second row, one read does not", () => {
    const { tw, clock, bursts } = rig();
    read(tw, "alice", 5);
    clock.advance(30_000);
    read(tw, "alice", 1);
    assert.deepEqual(bursts, ["alice 5 in 10 s"], "one read after the quiet is not a burst: the count started again");
    read(tw, "alice", 3);
    assert.equal(bursts.length, 1);
    read(tw, "alice", 1);
    assert.deepEqual(bursts, ["alice 5 in 10 s", "alice 5 in 10 s"], "the second burst's fifth read");
  });

  void it("TW-4: re-arming starts the count from zero even when the window is longer than the quiet period", () => {
    // A window longer than the quiet period: bob's armed entry, read once and not yet idle past the
    // window, sits ahead of alice's, so the idle sweep stops at it and alice's fired entry is re-armed in
    // place. Her last burst's reads are still inside the 60 s window; only the reset keeps them from
    // counting toward a second burst.
    const { tw, clock, bursts } = rig({ windowSeconds: 60, quietSeconds: 30 });
    tw.observe("bob");
    clock.advance(1);
    read(tw, "alice", 5);
    assert.deepEqual(bursts, ["alice 5 in 60 s"]);
    clock.advance(30_000);
    tw.observe("alice");
    assert.deepEqual(bursts, ["alice 5 in 60 s"], "one read after the quiet period is not a second burst");
    assert.equal(tw.size, 2, "bob's entry held, so alice's was re-armed in place rather than dropped");
  });

  void it("TW-4: a pause shorter than the quiet period does not end the burst", () => {
    const { tw, clock, bursts } = rig();
    read(tw, "alice", 5);
    clock.advance(29_999);
    read(tw, "alice", 5);
    assert.equal(bursts.length, 1);
  });

  void it("TW-5: reads spread wider than the window do not fire", () => {
    const { tw, clock, bursts } = rig();
    read(tw, "alice", 50, clock, 2_501);
    assert.deepEqual(bursts, [], "a read every 2.501 s: any five span 10.004 s, never inside ten seconds");
    read(tw, "bob", 5, clock, 2_500);
    assert.deepEqual(bursts, ["bob 5 in 10 s"], "five reads 2.5 s apart span exactly 10 s: inside the window");
  });

  void it("bursts are per principal", () => {
    const { tw, bursts } = rig();
    for (let i = 0; i < 4; i++) for (const p of ["alice", "bob", "carol"]) tw.observe(p);
    assert.deepEqual(bursts, [], "twelve reads, but four each");
    tw.observe("bob");
    assert.deepEqual(bursts, ["bob 5 in 10 s"]);
  });

  void it("TW-7: time is the injected clock, never the wall clock", async () => {
    const { tw, bursts } = rig({ threshold: 3, windowSeconds: 1 });
    tw.observe("alice");
    await sleep(600);
    tw.observe("alice");
    await sleep(600);
    tw.observe("alice");
    assert.deepEqual(bursts, ["alice 3 in 1 s"], "1.2 s of real time passed, none on the tripwire's clock: all three are in one window");
  });
});

void describe("CSR-WO-2007 tripwire: bounded memory", () => {
  void it("TW-8: an entry that can no longer affect a decision is dropped", () => {
    const { tw, clock } = rig();
    for (let i = 0; i < 40; i++) tw.observe(`p${String(i)}`);
    assert.equal(tw.size, 40);
    clock.advance(10_000);
    tw.observe("x");
    assert.equal(tw.size, 41, "still inside the window: every entry may yet decide");
    clock.advance(1);
    tw.observe("y");
    assert.equal(tw.size, 2, "the forty armed entries idle past the window are gone; x and y remain");
  });

  void it("TW-8: a fired entry is held through its quiet period, then dropped", () => {
    const { tw, clock, bursts } = rig();
    read(tw, "alice", 5);
    assert.equal(bursts.length, 1);
    clock.advance(29_999);
    tw.observe("bob");
    assert.equal(tw.size, 2, "alice's burst is not over: dropping her would let it write a second row");
    clock.advance(1);
    tw.observe("carol");
    assert.equal(tw.size, 2, "alice's quiet period has passed: her entry is gone; bob's and carol's remain");
  });

  void it("TW-9: at the cap a newcomer is not counted, and no fired entry is evicted, so no burst writes twice", () => {
    const { tw, clock, bursts } = rig({ maxPrincipals: 3 });
    for (const p of ["alice", "bob", "carol"]) read(tw, p, 5);
    assert.equal(bursts.length, 3);
    const untracked = Array.from({ length: 500 }, (_, i) => tw.observe(`fresh${String(i)}`));
    assert.ok(untracked.every((u) => u), "every newcomer reported as not counted");
    read(tw, "fresh0", 50);
    for (const p of ["alice", "bob", "carol"]) read(tw, p, 20, clock, 100);
    assert.equal(bursts.length, 3, "no fired principal was evicted and re-armed, and no newcomer was counted");
    assert.equal(tw.size, 3);
  });
});

void describe("CSR-WO-2007 tripwire: the sweep (review F1)", () => {
  void it("TW-8: at the cap, a spent entry behind a live one is swept, and the newcomer is counted", () => {
    const { tw, clock, bursts } = rig({ maxPrincipals: 2 });
    // alice fires first, so she is ahead in the order and live through her 30 s quiet period; bob reads
    // once, later, and is spent 10 s after. At 11.5 s, bob is spent and alice is not.
    read(tw, "alice", 5);
    clock.advance(1_000);
    tw.observe("bob");
    clock.advance(10_500);
    read(tw, "carol", 5);
    assert.deepEqual(bursts, ["alice 5 in 10 s", "carol 5 in 10 s"], "carol was counted: the sweep dropped bob's spent entry, which the idle trim could not reach behind alice's");
    assert.equal(tw.size, 2);
  });
});

void describe("CSR-WO-2007 tripwire: settings (TW-10)", () => {
  void it("unset or empty variables take the defaults", () => {
    assert.deepEqual(tripwireFromEnv({}), DEFAULT_TRIPWIRE);
    assert.deepEqual(tripwireFromEnv({ TRIPWIRE_THRESHOLD: "7", TRIPWIRE_WINDOW_SECONDS: "8", TRIPWIRE_QUIET_SECONDS: "9", TRIPWIRE_MAX_PRINCIPALS: "10" }), { threshold: 7, windowSeconds: 8, quietSeconds: 9, maxPrincipals: 10 });
  });

  const bad: [string, string, RegExp][] = [];
  for (const name of ["TRIPWIRE_THRESHOLD", "TRIPWIRE_WINDOW_SECONDS", "TRIPWIRE_QUIET_SECONDS", "TRIPWIRE_MAX_PRINCIPALS"]) {
    for (const value of ["0", "-1", "1.5", "x", "05"]) bad.push([name, value, new RegExp(`^${name} must be a whole number from 1 to`)]);
    bad.push([name, "99999999", new RegExp(`^${name} must be at most`)]);
  }
  for (const [name, value, message] of bad) {
    void it(`${name}=${JSON.stringify(value)} refuses start, naming the variable`, () => {
      assert.throws(() => tripwireFromEnv({ [name]: value }), (err: unknown) => err instanceof TripwireConfigError && message.test(err.message));
    });
  }

  void it("threshold × principals over the memory bound refuses start, naming both", () => {
    assert.throws(() => tripwireFromEnv({ TRIPWIRE_THRESHOLD: "10000", TRIPWIRE_MAX_PRINCIPALS: "1000" }), /TRIPWIRE_THRESHOLD × TRIPWIRE_MAX_PRINCIPALS must be at most 5000000/);
    assert.throws(() => checkTripwire({ threshold: 1, windowSeconds: 0, quietSeconds: 1, maxPrincipals: 1 }), /TRIPWIRE_WINDOW_SECONDS must be a whole number/);
  });
});
