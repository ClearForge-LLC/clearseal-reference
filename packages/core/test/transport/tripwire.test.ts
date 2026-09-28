// CSR-WO-2007 §1.3, §3.2: the tripwire on the wire (tripwire/RULES.md). Each documented case is a real
// request to a running transport, on the fake monotonic clock the tripwire reads.

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { answer, as, call, rig } from "./principals.ts";

const SETTINGS = { threshold: 5, windowSeconds: 10, quietSeconds: 30, maxPrincipals: 100 };
const pastes: string[] = [];
after(() => {
  console.log(pastes.join("\n"));
});

void describe("CSR-WO-2007 tripwire: one loud row per burst, and no call changed", () => {
  void it("TW-2, TW-6: a burst of read_only calls by A → exactly one tripwire-read-burst row, and every call answered as by a transport whose tripwire does not fire", async () => {
    const firing = await rig({ tripwire: SETTINGS });
    const quiet = await rig({ tripwire: { ...SETTINGS, threshold: 10_000 } });
    try {
      const withRow: string[] = [];
      const without: string[] = [];
      for (let i = 0; i < 12; i++) {
        withRow.push(answer(await call(firing.t, "alice", "read", `n${String(i)}`)));
        without.push(answer(await call(quiet.t, "alice", "read", `n${String(i)}`)));
      }
      assert.deepEqual(firing.of("tripwire-read-burst"), [{ principal: "alice", count: 5, windowS: 10 }], "exactly one row, naming A");
      assert.deepEqual(quiet.of("tripwire-read-burst"), []);
      assert.deepEqual(withRow, without, "every answer the same, status, headers and body, whether the tripwire fired or not");
      assert.ok(withRow.every((a) => a.startsWith('{"status":200')));
      pastes.push(`TRIPWIRE a burst of 12 read_only calls by A: rows ${JSON.stringify(firing.rows.filter((r) => r.event === "tripwire-read-burst"))}; 12 of 12 answers identical to a transport whose tripwire did not fire`);
    } finally {
      await firing.close();
      await quiet.close();
    }
  });

  void it("TW-3, TW-4: continued reading inside one burst writes no further row; after the quiet period a second burst writes a second row", async () => {
    const r = await rig({ tripwire: SETTINGS });
    try {
      for (let i = 0; i < 25; i++) {
        await call(r.t, "alice", "read", String(i));
        r.clock.advance(1_000);
      }
      assert.equal(r.of("tripwire-read-burst").length, 1, "25 reads a second apart are one burst");
      r.clock.advance(30_000);
      for (let i = 0; i < 5; i++) await call(r.t, "alice", "read", String(i));
      assert.equal(r.of("tripwire-read-burst").length, 2, "after 30 s of quiet, a second burst");
      pastes.push(`TRIPWIRE 25 reads inside one burst → 1 row; 30 s quiet, then 5 reads → ${String(r.of("tripwire-read-burst").length)} rows in all`);
    } finally {
      await r.close();
    }
  });

  void it("TW-1: calls to a non-read_only tool, to unknown tools and other methods do not count", async () => {
    const r = await rig({ tripwire: SETTINGS });
    try {
      for (let i = 0; i < 20; i++) {
        assert.equal((await call(r.t, "alice", "write", String(i))).status, 200);
        await call(r.t, "alice", "nope", String(i));
        await as(r.t, "alice", "tools/list");
      }
      assert.deepEqual(r.of("tripwire-read-burst"), [], "sixty calls, none to a read_only tool");
      for (let i = 0; i < 4; i++) await call(r.t, "alice", "read", String(i));
      assert.deepEqual(r.of("tripwire-read-burst"), [], "four reads: nothing before them was counted");
      await call(r.t, "alice", "read", "4");
      assert.equal(r.of("tripwire-read-burst").length, 1);
      pastes.push("TRIPWIRE 20 state_change calls, 20 unknown tools, 20 tools/list → 0 rows; then 5 read_only calls → 1 row");
    } finally {
      await r.close();
    }
  });

  void it("TW-1: a read_only call refused for its arguments still counts", async () => {
    const r = await rig({ tripwire: SETTINGS });
    try {
      for (let i = 0; i < 5; i++) assert.equal((await as(r.t, "alice", "tools/call", { name: "read", arguments: { n: i } })).status, 400);
      assert.equal(r.of("tripwire-read-burst").length, 1, "five refused reads are a sweep too");
    } finally {
      await r.close();
    }
  });

  void it("TW-6: an audit sink that throws on the tripwire's row changes no answer", async () => {
    const r = await rig({
      tripwire: SETTINGS,
      audit: (event) => {
        if (event === "tripwire-read-burst") throw new Error("the sink is down");
      },
    });
    try {
      const answers: number[] = [];
      for (let i = 0; i < 8; i++) answers.push((await call(r.t, "alice", "read", String(i))).status);
      assert.deepEqual(answers, [200, 200, 200, 200, 200, 200, 200, 200], "the fifth call, whose row threw, was answered like the rest");
    } finally {
      await r.close();
    }
  });

  void it("one principal-state-full row per episode for the tripwire too", async () => {
    const r = await rig({ tripwire: { ...SETTINGS, maxPrincipals: 2 } });
    try {
      for (const p of ["alice", "bob", "fresh0", "fresh1"]) await call(r.t, p, "read", "1");
      assert.equal(r.of("principal-state-full").length, 1);
      r.clock.advance(10_001);
      for (const p of ["carol", "dave", "fresh2"]) await call(r.t, p, "read", "1");
      assert.deepEqual(r.of("principal-state-full").map((f) => `${String(f["principal"])} ${String(f["control"])}`), ["fresh0 tripwire", "fresh2 tripwire"]);
    } finally {
      await r.close();
    }
  });

  void it("state caps: filling the tripwire with principals neither silences nor re-fires a principal already in a burst", async () => {
    const r = await rig({ tripwire: { ...SETTINGS, maxPrincipals: 3 } });
    try {
      for (const p of ["alice", "bob", "carol"]) for (let i = 0; i < 5; i++) await call(r.t, p, "read", String(i));
      assert.equal(r.of("tripwire-read-burst").length, 3);
      const fresh: number[] = [];
      for (let i = 0; i < 40; i++) fresh.push((await call(r.t, `fresh${String(i)}`, "read", "1")).status);
      assert.ok(fresh.every((s) => s === 200), "every fresh principal is served");
      for (const p of ["alice", "bob", "carol"]) for (let i = 0; i < 10; i++) await call(r.t, p, "read", String(i));
      assert.equal(r.of("tripwire-read-burst").length, 3, "no principal in a burst was evicted and fired again");
      assert.deepEqual(r.of("principal-state-full"), [{ principal: "fresh0", control: "tripwire", cap: 3 }]);
      pastes.push(`TRIPWIRE caps: 3 principals in a burst fill the table; 40 fresh principals → all 200; the 3 read on → still 3 rows; ${String(r.of("principal-state-full").length)} principal-state-full row`);
    } finally {
      await r.close();
    }
  });
});
