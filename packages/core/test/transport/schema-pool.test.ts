// CSR-WO-1005c: a validation is timed only against a ready worker. A worker replaced after a timeout
// starts and is re-primed with every schema before it is offered a job, so a call made straight
// after the timeout is validated and answered, at any deadline; and a pool that cannot produce a
// ready worker refuses as a timeout does, never answering without validation.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ValidationPool, ValidationTimeout } from "../../src/transport/schema-pool.ts";
import { costlyArguments } from "../fixtures/tools.ts";
import { modern, start } from "./helpers.ts";

const SILENT = new URL("../fixtures/silent-worker.ts", import.meta.url);
const SCHEMA = { type: "object", properties: { t: { type: "string" } }, unevaluatedProperties: false };

void describe("CSR-WO-1005c the validation deadline starts when a worker is ready", () => {
  void it("at a 40 ms deadline, a call straight after a timeout is validated and answered, 3 of 3", async () => {
    const s = await start({ limits: { validationTimeoutMs: 40 } });
    try {
      // One answered call first, so the first timeout below is a validation's, not the fresh server's priming.
      assert.equal((await modern(s.t, "tools/call", { name: "echo", arguments: { text: "first" } })).status, 200);
      for (let round = 1; round <= 3; round++) {
        assert.equal((await modern(s.t, "tools/call", { name: "costly_schema", arguments: costlyArguments() })).status, 400, `round ${String(round)}: the costly call times out`);
        const t0 = Date.now();
        const after = await modern(s.t, "tools/call", { name: "echo", arguments: { text: "after" } });
        console.log(`READY-AFTER-TIMEOUT deadline=40ms round=${String(round)} status=${String(after.status)} in ${String(Date.now() - t0)} ms`);
        assert.equal(after.status, 200, `round ${String(round)}: the call after the timeout answered ${String(after.status)} (last audits ${s.audits.slice(-3).join(",")})`);
      }
    } finally {
      await s.close();
    }
  });

  void it("a worker that never becomes ready is replaced and audited, and the queued call is still validated and answered", async () => {
    const events: string[] = [];
    let spawns = 0;
    const real = new URL("../../src/transport/schema-worker.ts", import.meta.url);
    const pool = new ValidationPool({ workers: 1, timeoutMs: 2_000, readyTimeoutMs: 300, workerUrl: () => (spawns++ === 0 ? SILENT : real), onEvent: (e) => events.push(e) });
    try {
      const validate = pool.compile(SCHEMA);
      const t0 = Date.now();
      const valid = await validate({ t: "x" });
      const ms = Date.now() - t0;
      console.log(`NOT-READY replaced after ${String(ms)} ms; valid=${JSON.stringify(valid)}; events=${events.join(",")}`);
      assert.equal(valid, true);
      assert.deepEqual(events, ["validation-worker-not-ready"]);
      assert.ok(ms < 2 * 300 + 2_000, `answered at ${String(ms)} ms, past twice the readiness bound plus the deadline`);
    } finally {
      await pool.close();
    }
  });

  void it("a pool whose workers never become ready refuses the call as a timeout, never as valid", async () => {
    const pool = new ValidationPool({ workers: 1, timeoutMs: 2_000, readyTimeoutMs: 200, workerUrl: () => SILENT });
    try {
      const validate = pool.compile(SCHEMA);
      await assert.rejects(Promise.resolve(validate({ t: "x" })), ValidationTimeout);
    } finally {
      await pool.close();
    }
  });

  void it("a schema registered later on a ready worker that then hangs: the slot is replaced, audited, and the call answered", async () => {
    const events: string[] = [];
    let spawns = 0;
    const real = new URL("../../src/transport/schema-worker.ts", import.meta.url);
    const once = new URL("../fixtures/ack-once-worker.ts", import.meta.url);
    const pool = new ValidationPool({ workers: 1, timeoutMs: 2_000, readyTimeoutMs: 300, workerUrl: () => (spawns++ === 0 ? once : real), onEvent: (e) => events.push(e) });
    try {
      pool.compile(SCHEMA);
      await new Promise((r) => setTimeout(r, 100)); // the first worker acknowledges SCHEMA and is ready
      const late = pool.compile({ type: "object", properties: { n: { type: "integer" } }, unevaluatedProperties: false });
      const outcome = await Promise.resolve(late({ n: 1 })).catch((err: unknown) => String(err));
      assert.equal(outcome, true, `the late schema's call answered ${JSON.stringify(outcome)}`);
      assert.deepEqual(events, ["validation-worker-not-ready"]);
    } finally {
      await pool.close();
    }
  });

  void it("a ready worker that exits without an error is replaced, and the call is answered, not timed out", async () => {
    let spawns = 0;
    const real = new URL("../../src/transport/schema-worker.ts", import.meta.url);
    const exits = new URL("../fixtures/exit-worker.ts", import.meta.url);
    const pool = new ValidationPool({ workers: 1, timeoutMs: 5_000, workerUrl: () => (spawns++ === 0 ? exits : real) });
    try {
      const validate = pool.compile(SCHEMA);
      const t0 = Date.now();
      await assert.rejects(Promise.resolve(validate({ t: "x" })), /validation worker exited/);
      assert.ok(Date.now() - t0 < 5_000, "the job was answered when the worker exited, not at its deadline");
      assert.equal(await validate({ t: "y" }), true, "the replacement validates");
    } finally {
      await pool.close();
    }
  });
});

