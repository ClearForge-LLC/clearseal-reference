// CSR-WO-1006a: a handler has no `this`, and the running config is frozen (-1006 adversarial A5, A7).
// Each attempt is the operation that matters: the handler tries the -1006 A5 route (build a cage from
// its own RegisteredTool and open through it, a reach dispatch never sees), and the starter tries the
// A7 route (set a running limit, then make a real call).

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { ContainmentRefusal } from "../../src/containment/cage.ts";
import type { PinnableTool } from "../../src/pinning/manifest.ts";
import { ConfigError, DEFAULT_CONFIG, DEFAULT_LIMITS, type Limits, resolveConfig, SUPPORTED_VERSIONS } from "../../src/transport/config.ts";
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

void describe("CSR-WO-1006a adversarial pass: the routes past the first cut", () => {
  void it("H6: a handler's ctx.cage is a facade; its constructor builds no cage, and a reach through it is still dispatch's, refused and audited", async () => {
    const base = mkdtempSync(join(tmpdir(), "clearseal-1006a-"));
    const inside = join(base, "inside");
    mkdirSync(inside);
    writeFileSync(join(base, "secret.txt"), "SECRET-OUTSIDE-DOMAIN");
    const outside = join(base, "secret.txt").replaceAll("\\", "/");
    const insidePosix = inside.replaceAll("\\", "/").replace(/^[A-Za-z]:/, "");
    const ctorRoute: PinnableTool = { name: "ctor.route", description: "tries the cage constructor", inputSchema: { type: "object" }, capability: tag("ctor", { containment_domain: [`fs:${insidePosix}`] }), handler: async (_a, ctx) => {
      const rows: string[] = [];
      for (const [label, C] of [["ctx.cage.constructor", (ctx.cage as unknown as { constructor: new (...a: unknown[]) => unknown }).constructor], ["Object.getPrototypeOf(ctx.cage).constructor", (Object.getPrototypeOf(ctx.cage) as { constructor: new (...a: unknown[]) => unknown }).constructor]] as const) {
        try {
          const built = new C({ entries: [], fs: ["/"], hosts: [], services: [] }) as { open(p: string, m: string): Promise<{ readFile(e: string): Promise<string> }> };
          rows.push(`${label}: ${await (await built.open(outside, "r")).readFile("utf8")}`);
        } catch (err) {
          rows.push(`${label}: ${err instanceof Error ? err.name : "threw"}`);
        }
      }
      return text(rows.join("; "));
    } };
    const reacher: PinnableTool = { name: "ctx.reach", description: "reaches outside through ctx.cage", inputSchema: { type: "object" }, capability: tag("reach", { containment_domain: [`fs:${insidePosix}`] }), handler: async (_a, ctx) => {
      await ctx.cage.open(outside, "r");
      return text("opened");
    } };
    const lines: string[] = [];
    const node = await startTransport({ registry: pinForTest([ctorRoute, reacher], compileSchema, DEFAULT_LIMITS), serverInfo: { name: "x", version: "0" }, verifier: new TestBearerVerifier(), requestStateKey: randomBytes(32), audit: (e, f) => lines.push(`${e} ${JSON.stringify(f)}`) });
    try {
      const r = await modern(node, "tools/call", { name: "ctor.route", arguments: {} });
      assert.equal(r.status, 200, r.text);
      assert.doesNotMatch(r.text, /SECRET/);
      assert.match(r.text, /ctx\.cage\.constructor: TypeError; Object\.getPrototypeOf\(ctx\.cage\)\.constructor: TypeError/);
      const reach = await modern(node, "tools/call", { name: "ctx.reach", arguments: {} });
      assert.equal(reach.status, 500, reach.text);
      assert.equal(lines.filter((l) => l.startsWith('containment-refused {"tool":"ctx.reach"')).length, 1, "a reach through the facade is dispatch's: refused and audited");
      console.log(`1006a H6: tools/call ctor.route → ${String(r.status)} ${/ctx\.cage\.constructor[^"]*/.exec(r.text)?.[0] ?? ""}; ctx.reach through the facade → ${String(reach.status)}, containment-refused lines 1`);
    } finally {
      await node.close();
      rmSync(base, { recursive: true, force: true });
    }
  });

  void it("C5: a non-string value in the config is a snapshot, frozen; a caller mutating its own value changes nothing served, and a function value refuses the start", async () => {
    const instructions = ["orig"];
    const node = await startTransport({ registry: pinForTest([echo], compileSchema, DEFAULT_LIMITS), serverInfo: { name: "x", version: "0" }, verifier: new TestBearerVerifier(), requestStateKey: randomBytes(32), config: { instructions: instructions as unknown as string } });
    try {
      const before = await modern(node, "server/discover", {});
      instructions.push("CHANGED-AFTER-START");
      const after = await modern(node, "server/discover", {});
      assert.deepEqual((after.json as { result: unknown }).result, (before.json as { result: unknown }).result);
      assert.doesNotMatch(after.text, /CHANGED/);
    } finally {
      await node.close();
    }
    assert.throws(() => resolveConfig({ resourceUrl: { toJSON: () => "https://evil.example.invalid/" } as unknown as string }), ConfigError);
    console.log("1006a C5: instructions array pushed after start → server/discover unchanged; a resourceUrl with a toJSON function → ConfigError at start");
  });

  void it("C6, C2, C1b: SUPPORTED_VERSIONS, DEFAULT_LIMITS, DEFAULT_CONFIG and the running transport object are frozen; a modern call still succeeds", async () => {
    const rows: string[] = [];
    const tryIt = (label: string, f: () => unknown): void => {
      let outcome = "no error";
      try {
        f();
      } catch (err) {
        outcome = err instanceof Error ? err.name : "threw";
      }
      rows.push(`${label}: ${outcome}`);
      assert.equal(outcome, "TypeError", label);
    };
    tryIt("SUPPORTED_VERSIONS.length = 0", () => ((SUPPORTED_VERSIONS as string[]).length = 0));
    tryIt("SUPPORTED_VERSIONS.push('2099-01-01')", () => (SUPPORTED_VERSIONS as string[]).push("2099-01-01"));
    tryIt("DEFAULT_LIMITS.maxBodyBytes = 10", () => ((DEFAULT_LIMITS as Limits).maxBodyBytes = 10));
    tryIt("DEFAULT_CONFIG.allowedHosts.push(…)", () => (DEFAULT_CONFIG.allowedHosts as string[]).push("evil.example"));
    tryIt("DEFAULT_CONFIG.instructions = …", () => ((DEFAULT_CONFIG as { instructions: string }).instructions = "INJECTED"));
    tryIt("running transport: t.config = …", () => ((t as unknown as Record<string, unknown>)["config"] = { limits: { maxInFlight: 0 } }));
    const r = await modern(t, "tools/call", { name: "echo", arguments: {} });
    assert.equal(r.status, 200, r.text);
    console.log(`${rows.map((x) => `1006a C6/C2/C1b ${x}`).join("\n")}\n1006a C6/C2/C1b then a modern tools/call echo → ${String(r.status)}`);
  });
});
