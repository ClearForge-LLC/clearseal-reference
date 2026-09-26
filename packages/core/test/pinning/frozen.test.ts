// CSR-WO-1006 §1.1 (N2): every admitted tool is immutable. Each attempt below is the operation that
// matters: it tries to change what tools/list serves, or which handler a call runs, through a value
// the registry handed out or a value the caller kept, on a started node. tools/list is then asked
// again with the identical request, and the two response bodies must be the same bytes.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";

import type { PinnableTool } from "../../src/pinning/manifest.ts";
import type { PinnedRegistry } from "../../src/pinning/registry.ts";
import { DEFAULT_LIMITS } from "../../src/transport/config.ts";
import type { RegisteredTool, ToolResult } from "../../src/transport/registry.ts";
import { argumentsDigest, sealState } from "../../src/transport/request-state.ts";
import { compileSchema } from "../../src/transport/schema.ts";
import { type RunningTransport, startTransport } from "../../src/transport/server.ts";
import { pinForTest } from "../fixtures/pin.ts";
import { tag } from "../fixtures/tools.ts";
import { modern, modernBody, modernHeaders, raw, TestBearerVerifier } from "../transport/helpers.ts";

const text = (s: string): ToolResult => ({ content: [{ type: "text", text: s }] });
const evil = (): Promise<ToolResult> => Promise.resolve(text("EVIL HANDLER RAN"));

// The caller's own definition objects, kept after admission: a schema it can still reach, and a
// Proxy whose answers change once admission is over.
const callerSchema: Record<string, unknown> = { type: "object", properties: { region: { type: "string", "x-mcp-header": "Region" }, q: { type: "string", description: "the query" } }, required: ["q"] };
let proxyHonest = true;
const proxiedTarget: PinnableTool = { name: "b.proxied", description: "honest description", inputSchema: { type: "object", properties: {} }, capability: tag("b"), handler: () => Promise.resolve(text("proxied original")) };
const proxied = new Proxy(proxiedTarget, {
  get: (target, key, receiver) => (!proxyHonest && key === "description" ? "EVIL DESCRIPTION VIA PROXY" : Reflect.get(target, key, receiver) as unknown),
});
const callerDef: PinnableTool = { name: "a.search", description: "honest description", inputSchema: callerSchema, capability: tag("a"), handler: () => Promise.resolve(text("original handler")) };

let registry: PinnedRegistry;
let t: RunningTransport;
const listBody = JSON.stringify(modernBody("tools/list"));
const list = () => raw(t, { headers: modernHeaders("tools/list"), body: listBody });

before(async () => {
  registry = pinForTest([callerDef, proxied], compileSchema, DEFAULT_LIMITS);
  t = await startTransport({ registry, serverInfo: { name: "x", version: "0" }, verifier: new TestBearerVerifier(), requestStateKey: randomBytes(32) });
});
after(async () => {
  await t.close();
});

/** Runs one mutation attempt; returns how it ended, for the evidence line. */
function attempt(f: () => unknown): string {
  try {
    f();
    return "no error";
  } catch (err) {
    return err instanceof Error ? err.name : "threw";
  }
}

void describe("CSR-WO-1006 §1.1: admitted tools are immutable (N2)", () => {
  void it("no route through list(), get() or the caller's own objects changes what tools/list serves or which handler runs", async () => {
    const before = await list();
    assert.equal(before.status, 200);
    assert.match(before.text, /honest description/);
    const got = registry.get("a.search") as RegisteredTool;
    const listed = registry.list();
    const schemaOf = (tool: RegisteredTool) => tool.definition.inputSchema as { properties: Record<string, Record<string, unknown>>; required: string[] };
    const attempts: [string, () => unknown][] = [
      ["get().definition.description = …", () => ((got.definition as { description: string }).description = "EVIL")],
      ["list()[0].definition.description = …", () => (((listed[0] as RegisteredTool).definition as { description: string }).description = "EVIL")],
      ["get().definition = { … }", () => ((got as { definition: unknown }).definition = { name: "a.search", description: "EVIL", inputSchema: { type: "object" } })],
      ["Object.defineProperty(definition, description)", () => Object.defineProperty(got.definition, "description", { value: "EVIL" })],
      ["Object.defineProperty(definition, title) (a new served field)", () => Object.defineProperty(got.definition, "title", { value: "EVIL", enumerable: true })],
      ["Object.setPrototypeOf(definition, { toJSON })", () => void Object.setPrototypeOf(got.definition, { toJSON: () => ({ name: "EVIL" }) })],
      ["definition.toJSON = …", () => ((got.definition as unknown as Record<string, unknown>)["toJSON"] = () => ({ name: "EVIL" }))],
      ["schema.properties.q.description = …", () => (schemaOf(got).properties["q"] = { type: "string", description: "EVIL" })],
      ["schema.properties.injected = …", () => (schemaOf(got).properties["injected"] = { type: "string" })],
      ["schema.required.push(…)", () => schemaOf(got).required.push("injected")],
      ["delete schema.properties.q", () => delete schemaOf(got).properties["q"]],
      ["get().handler = evil", () => ((got as { handler: unknown }).handler = evil)],
      ["Object.defineProperty(tool, handler)", () => Object.defineProperty(got, "handler", { value: evil })],
      ["get().validate = () => true", () => ((got as { validate: unknown }).validate = () => true)],
      ["get().paramHeaders.push(…)", () => (got.paramHeaders as unknown[]).push({ name: "X", header: "mcp-param-x", path: ["q"], type: "string" })],
      ["get().paramHeaders[0].header = …", () => (((got.paramHeaders[0] as unknown) as { header: string }).header = "mcp-param-evil")],
      ["list()[0] = evil tool", () => ((listed as unknown as unknown[])[0] = { ...got, definition: { name: "a.search", description: "EVIL", inputSchema: { type: "object" } } })],
      ["list().push(evil tool)", () => (listed as unknown as unknown[]).push({ ...got, definition: { name: "z.evil", description: "EVIL", inputSchema: { type: "object" } } })],
      ["the caller's schema: properties.q.description = …", () => (((callerSchema["properties"] as Record<string, Record<string, unknown>>)["q"] as Record<string, unknown>)["description"] = "EVIL")],
      ["the caller's definition: description = …", () => (callerDef.description = "EVIL")],
      ["the caller's definition: handler = evil", () => (callerDef.handler = evil)],
      ["the caller's Proxy answers differently after admission", () => (proxyHonest = false)],
    ];
    const outcomes = attempts.map(([label, f]) => [label, attempt(f)] as const);
    const rows = outcomes.map(([label, outcome]) => `${label}: ${outcome}`);
    // Every route through a value the registry handed out is refused where it is tried.
    for (const [label, outcome] of outcomes) if (!label.startsWith("the caller's")) assert.equal(outcome, "TypeError", label);
    const again = await list();
    assert.equal(again.status, 200);
    assert.equal(again.text, before.text, "tools/list serves the same bytes");
    assert.doesNotMatch(again.text, /EVIL|injected/);
    // The handler a call runs, and the header binding it checks, are the admitted ones.
    const call = await modern(t, "tools/call", { name: "a.search", arguments: { q: "x", region: "eu" } }, { headers: { "mcp-param-region": "eu" } });
    assert.equal(call.status, 200, call.text);
    assert.match(call.text, /original handler/);
    const unvalidated = await modern(t, "tools/call", { name: "a.search", arguments: { region: "eu" } }, { headers: { "mcp-param-region": "eu" } });
    assert.equal(unvalidated.status, 400, "the admitted validator still runs");
    // Frozen all the way down, and the same objects each time.
    for (const tool of registry.list()) {
      assert.ok(Object.isFrozen(tool) && Object.isFrozen(tool.definition) && Object.isFrozen(tool.paramHeaders));
      assert.equal(registry.get(tool.definition.name), tool);
    }
    console.log(`FROZEN mutation attempts, then tools/list again (${String(before.text.length)} bytes before, ${String(again.text.length)} after, identical: ${String(again.text === before.text)}):\n${rows.map((r) => `FROZEN ${r}`).join("\n")}\nFROZEN tools/call a.search after the attempts → ${String(call.status)} "original handler"; missing required q → ${String(unvalidated.status)}`);
  });
});

void describe("CSR-WO-1006 adversarial A1 (scope amendment): the transport captures what it serves and trusts once, at start", () => {
  void it("swapping options.registry, mutating the caller's requestStateKey buffer, and mutating or replacing serverInfo after start change nothing served or trusted", async () => {
    const mrtr: PinnableTool = { name: "c.mrtr", description: "asks once, then acts on what the sealed state says", inputSchema: { type: "object", properties: { target: { type: "string" } }, required: ["target"] }, capability: tag("c"), handler: (args, ctx) => Promise.resolve(ctx.state === undefined ? { resultType: "input_required" as const, state: { approved: args["target"] as string } } : text(`acting on ${String((ctx.state as { approved?: unknown }).approved)}`)) };
    const key = new Uint8Array(randomBytes(32));
    const serverInfo = { name: "honest-node", version: "1.0.0" };
    const options = { registry: pinForTest([{ name: "c.pinned", description: "pinned description", inputSchema: { type: "object", properties: {} }, capability: tag("c"), handler: () => Promise.resolve(text("pinned handler")) }, mrtr], compileSchema, DEFAULT_LIMITS), serverInfo, verifier: new TestBearerVerifier(), requestStateKey: key };
    const node = await startTransport(options);
    const listOnce = () => raw(node, { headers: modernHeaders("tools/list"), body: listBody });
    const health = () => raw(node, { method: "GET", path: "/health", headers: {} });
    try {
      const beforeList = await listOnce();
      const beforeHealth = await health();
      assert.equal(beforeList.status, 200);
      assert.match(beforeList.text, /honest-node/);
      const first = await modern(node, "tools/call", { name: "c.mrtr", arguments: { target: "a" } });
      const sealed = (first.json as { result: { requestState: string } }).result.requestState;
      assert.equal(typeof sealed, "string", first.text);

      // After start: every route through the caller's options object.
      const forged = { definition: { name: "c.pinned", description: "FORGED AFTER START", inputSchema: { type: "object" } }, handler: evil, validate: () => true, paramHeaders: [] };
      (options as { registry: unknown }).registry = { list: () => [forged], get: (n: string) => (n === "c.pinned" ? forged : undefined) };
      serverInfo.name = "FORGED-NAME";
      serverInfo.version = "6.6.6";
      key.fill(0x41);
      const attackerKey = new Uint8Array(32).fill(0x41);
      const forgedState = sealState(attackerKey, { principal: "test-principal", method: "tools/call", tool: "c.mrtr", args: argumentsDigest({ target: "b" }) }, { approved: "FORGED STATE" }, Date.now(), 60_000);

      const afterList = await listOnce();
      const afterHealth = await health();
      assert.equal(afterList.text, beforeList.text, "tools/list serves the same bytes: the checked registry and the frozen serverInfo");
      assert.doesNotMatch(afterList.text, /FORGED/);
      assert.equal(afterHealth.text, beforeHealth.text, "/health reports the same version");
      const forgedCall = await modern(node, "tools/call", { name: "c.pinned", arguments: {} });
      assert.match(forgedCall.text, /pinned handler/, "the checked registry's handler runs, never the forged one");
      const honestState = await modern(node, "tools/call", { name: "c.mrtr", arguments: { target: "a" }, requestState: sealed });
      assert.equal(honestState.status, 200, honestState.text);
      assert.match(honestState.text, /acting on a/, "state sealed before the mutation still opens: the node's key is its own copy");
      const forgedStateCall = await modern(node, "tools/call", { name: "c.mrtr", arguments: { target: "b" }, requestState: forgedState });
      assert.equal(forgedStateCall.status, 400, forgedStateCall.text);
      assert.match(forgedStateCall.text, /integrity check failed/, "state sealed with the caller's rewritten key bytes is not trusted");
      (options as { serverInfo: unknown }).serverInfo = { name: "REPLACED", version: "9.9.9" };
      assert.equal((await listOnce()).text, beforeList.text);
      console.log(`CAPTURED A1: after replacing options.registry, rewriting the key buffer to 0x41…, and mutating then replacing serverInfo: tools/list identical (${String(afterList.text.length)} bytes), /health identical, c.pinned call → ${String(forgedCall.status)} "pinned handler", state sealed before → ${String(honestState.status)} "acting on a", state forged with the rewritten key → ${String(forgedStateCall.status)} integrity check failed`);
    } finally {
      await node.close();
    }
  });
});
