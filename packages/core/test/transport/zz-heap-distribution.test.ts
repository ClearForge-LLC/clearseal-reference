// TEMPORARY (CSR-WO-2008d): the statelessness test's measurement, repeated, so one CI run gives each
// runner's honest distribution. Removed before the pull request is parked.
import assert from "node:assert/strict";
import { it } from "node:test";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { modern, start } from "./helpers.ts";

const WARM_REQUESTS = 1_000;
const MEASURED_REQUESTS = 4_000;
function collector(): () => void {
  setFlagsFromString("--expose-gc");
  const gc: unknown = runInNewContext("gc");
  assert.equal(typeof gc, "function");
  return gc as () => void;
}

void it("heap distribution probe", async () => {
  for (let run = 1; run <= (process.env["CI"] === "true" ? 10 : 1); run++) {
      const s = await start({ rateLimit: { burst: WARM_REQUESTS + MEASURED_REQUESTS + 100, refillPerMinute: 600, maxPrincipals: 10 } });
      try {
        const once = collector();
        // Three passes: one leaves the heap in a state the next would still change (measured).
        const gc = (): void => {
          once();
          once();
          once();
        };
        for (let i = 0; i < WARM_REQUESTS; i++) await modern(s.t, "tools/call", { name: "echo", arguments: { text: "warm" } });
        s.audits.length = 0;
        s.lines.length = 0;
        gc();
        const before = process.memoryUsage().heapUsed;
        for (let i = 0; i < MEASURED_REQUESTS; i++) {
          const r = await modern(s.t, "tools/call", { name: "echo", arguments: { text: `n${String(i)}` } }, { headers: { "mcp-session-id": `s${String(i)}` } });
          assert.equal(r.status, 200);
          assert.equal(r.headers["mcp-session-id"], undefined);
          if (i % 2_000 === 1_999) {
            // Halfway and at the end: the helper's lines cleared, and a collection between the halves,
            // which keeps the reading inside about ±30 KiB where one pass over all 4,000 spreads ±130 KiB.
            s.audits.length = 0;
            s.lines.length = 0;
            gc();
          }
        }
        gc();
        const growth = process.memoryUsage().heapUsed - before;
        console.log(`HEAPDIST run=${String(run)} ${String(MEASURED_REQUESTS)} sequential requests after ${String(WARM_REQUESTS)} warm: heap growth ${String(Math.round(growth / 1024))} KiB (${(growth / MEASURED_REQUESTS).toFixed(1)} B per request), in-flight after ${String(s.t.inFlight())}`);

      } finally {
        await s.close();
      }
  }
});
