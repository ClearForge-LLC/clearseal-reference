// The cost the validation-deadline tests rely on (CSR-WO-0002b §1.3). `costly_schema` exists to
// be slower than a deadline: adversarial F2 abandons it at 300 ms, era-status refuses it on the fast
// server, corrections closes the transport while it is in flight. Each of those passes only while
// the validation really is slow, and z-schema 12.7.0 made the previous fixture take about 20 ms.
//
// z-schema validates a schema's first call by building a full report, and later calls through a
// fast path that builds none; the first is far slower. A deadline test is the first call in a fresh
// worker today, but a worker that has validated the schema once takes the fast path, so the fast
// path is the cost that must outlast the deadline. This test warms the validator with one item, then
// validates the deadline tests' input with no deadline, on the main thread, and logs how long it
// takes, so every runner's log carries the margin. It fails when the margin is gone, naming the
// cause, instead of leaving the deadline tests to fail on a 200 that looks like a broken control.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { DEFAULT_LIMITS } from "../../src/transport/config.ts";
import { prepareTool } from "../../src/transport/registry.ts";
import { compileSchema } from "../../src/transport/schema.ts";
import { fixtureTools } from "../fixtures/tools.ts";

/** The shortest deadline any test drives this fixture against. */
const DEADLINE_MS = 300;
/** How many deadlines the warm validation must last: the margin for a faster runner. */
const MARGIN = 3;

void describe("costly_schema outlasts the validation deadlines that use it", () => {
  void it(`the deadline tests' input is valid, and validating it on a warm validator takes over ${String(MARGIN)} × ${String(DEADLINE_MS)} ms`, () => {
    const definition = fixtureTools().find((t) => t.name === "costly_schema");
    assert.ok(definition !== undefined);
    const { validate } = prepareTool(definition, compileSchema, DEFAULT_LIMITS);
    assert.ok(validate({ tags: [{ k: 0 }] }) === true, "the one-item warm-up is valid");
    const tags = Array.from({ length: 20_000 }, (_, i) => ({ k: i }));
    const t0 = performance.now();
    const valid = validate({ tags }) === true;
    const ms = Math.round(performance.now() - t0);
    const zschema = (JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../node_modules/z-schema/package.json"), "utf8")) as { version: string }).version;
    console.log(`COSTLY-SCHEMA warm=${String(ms)}ms valid=${String(valid)} z-schema=${zschema} platform=${process.platform}`);
    // Valid, so a 400 from the deadline tests can only be the deadline: invalid arguments answer 400 -32602 too.
    assert.ok(valid);
    assert.ok(ms > MARGIN * DEADLINE_MS, `costly_schema validated in ${String(ms)} ms on a warm z-schema ${zschema}: the deadline tests can no longer drive the deadline; give the fixture a cost this validator cannot shortcut`);
  });
});
