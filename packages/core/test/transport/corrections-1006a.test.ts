// CSR-WO-1006a: a handler has no `this`, and the running config is frozen (-1006 adversarial A5, A7).
// Each attempt is the operation that matters: the handler tries the -1006 A5 route (build a cage from
// its own RegisteredTool and open through it, a reach dispatch never sees), and the starter tries the
// A7 route (set a running limit, then make a real call).

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { ContainmentRefusal } from "../../src/containment/cage.ts";
import type { PinnableTool } from "../../src/pinning/manifest.ts";
import { DEFAULT_LIMITS, type Limits } from "../../src/transport/config.ts";
import type { RegisteredTool, ToolResult } from "../../src/transport/registry.ts";
import { compileSchema } from "../../src/transport/schema.ts";
import { type RunningTransport, startTransport } from "../../src/transport/server.ts";
import { pinForTest } from "../fixtures/pin.ts";
import { tag } from "../fixtures/tools.ts";
import { modern, TestBearerVerifier } from "./helpers.ts";

const text = (s: string): ToolResult => ({ content: [{ type: "text", text: s }] });

/** A `function` handler, so `this` is whatever dispatch binds. It reports what `this` was and what
 *  came of trying to open a file through a cage built from it. */
async function thisProbe(this: unknown): Promise<ToolResult> {
  const seen = this === undefined ? "undefined" : typeof this;
  let hidden: string;
  try {
    const cage = (this as RegisteredTool).newCage?.();
    if (cage === undefined) throw new TypeError("no newCage");
    await cage.open("/etc/hostname", "r");
    hidden = "opened";
  } catch (err) {
    hidden = err instanceof ContainmentRefusal ? "refused through a cage dispatch does not own" : err instanceof Error ? err.name : "threw";
  }
  return text(`this=${seen}; hidden cage: ${hidden}`);
}

const probe: PinnableTool = { name: "this.probe", description: "reports its this", inputSchema: { type: "object" }, capability: tag("this"), handler: thisProbe };
const echo: PinnableTool = { name: "echo", description: "echoes", inputSchema: { type: "object" }, capability: tag("echo"), handler: () => Promise.resolve(text("echo ran")) };

const audits: string[] = [];
const callerConfig = { limits: { maxInFlight: 4 }, allowedHosts: [] as string[] };
let t: RunningTransport;
before(async () => {
  t = await startTransport({ registry: pinForTest([probe, echo], compileSchema, DEFAULT_LIMITS), serverInfo: { name: "x", version: "0" }, verifier: new TestBearerVerifier(), requestStateKey: randomBytes(32), config: callerConfig, audit: (e, f) => audits.push(`${e} ${JSON.stringify(f)}`) });
});
after(async () => {
  await t.close();
});

void describe("CSR-WO-1006a §1.1: a handler is called with no this (-1006 A5)", () => {
  void it("a handler that reads this gets undefined, and its attempt to build a cage from this throws before any reach", async () => {
    const r = await modern(t, "tools/call", { name: "this.probe", arguments: {} });
    assert.equal(r.status, 200, r.text);
    assert.match(r.text, /this=undefined; hidden cage: TypeError/);
    assert.equal(audits.filter((a) => a.startsWith("containment-refused")).length, 0, "no reach happened, so none to record");
    console.log(`1006a A5: tools/call this.probe → ${String(r.status)} ${/this=[^"]*/.exec(r.text)?.[0] ?? r.text}`);
  });
});

void describe("CSR-WO-1006a §1.2: the running config is deeply frozen (-1006 A7)", () => {
  void it("setting any running limit, or any list, after start fails where it is tried and changes nothing a call sees", async () => {
    const before = JSON.stringify(t.config);
    const rows: string[] = [];
    const attempt = (label: string, f: () => unknown): void => {
      let outcome = "no error";
      try {
        f();
      } catch (err) {
        outcome = err instanceof Error ? err.name : "threw";
      }
      rows.push(`${label}: ${outcome}`);
      assert.equal(outcome, "TypeError", label);
    };
    for (const name of Object.keys(t.config.limits) as (keyof Limits)[]) attempt(`config.limits.${name} = 0`, () => ((t.config.limits as unknown as Record<string, number>)[name] = 0));
    attempt("config.limits = { maxInFlight: 0 }", () => ((t.config as unknown as Record<string, unknown>)["limits"] = { ...t.config.limits, maxInFlight: 0 }));
    attempt("Object.defineProperty(config.limits, maxInFlight)", () => Object.defineProperty(t.config.limits, "maxInFlight", { value: 0 }));
    attempt("config.allowedHosts.push(…)", () => (t.config.allowedHosts as string[]).push("evil.example.invalid"));
    attempt("config.endpointPath = …", () => ((t.config as unknown as Record<string, unknown>)["endpointPath"] = "/elsewhere"));
    // The starter's own config object, kept after start, is a separate copy.
    callerConfig.limits.maxInFlight = 0;
    callerConfig.allowedHosts.push("evil.example.invalid");
    rows.push("the caller's own config: limits.maxInFlight = 0 and allowedHosts.push(…) succeed on the caller's object");
    assert.equal(JSON.stringify(t.config), before, "the running config is unchanged");
    const calls = await Promise.all(Array.from({ length: 4 }, () => modern(t, "tools/call", { name: "echo", arguments: {} })));
    for (const c of calls) assert.equal(c.status, 200, c.text);
    assert.ok(Object.isFrozen(t.config) && Object.isFrozen(t.config.limits) && Object.isFrozen(t.config.allowedHosts) && Object.isFrozen(t.config.allowedOrigins) && Object.isFrozen(t.config.authorizationServers));
    console.log(`1006a A7 mutation attempts after start:\n${rows.map((r) => `1006a A7 ${r}`).join("\n")}\n1006a A7 then 4 concurrent tools/call echo → ${JSON.stringify(calls.map((c) => c.status))} (the -1006 route, maxInFlight = 0, answered 503); running config unchanged: true`);
  });
});
