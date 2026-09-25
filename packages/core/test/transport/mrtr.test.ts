// MRTR carriage (WO §1.9; SPEC-MAP MR-*, BI-9): input_required passes through; requestState is
// sealed and opened only by the core, bound to principal, method, tool and expiry.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { openState, REQUEST_STATE_KEY_ENV, requestStateKeyFromEnv, RequestStateKeyError, sealState } from "../../src/transport/request-state.ts";
import { Refusal } from "../../src/transport/jsonrpc.ts";
import { modern, type Reply, start, type Started } from "./helpers.ts";

const CAPS = { "io.modelcontextprotocol/clientCapabilities": { elicitation: {} } };
const result = (r: Reply): Record<string, unknown> => (r.json as { result: Record<string, unknown> }).result;
const code = (r: Reply): unknown => (r.json as { error?: { code: number } }).error?.code;

void describe("MRTR round trip over the transport", () => {
  let s: Started;
  before(async () => {
    s = await start();
  });
  after(async () => {
    await s.close();
  });

  void it("MR-3 MR-4 input_required passes through with a sealed state; the retry reaches the handler with the opened state and the responses", async () => {
    const first = await modern(s.t, "tools/call", { name: "ask", arguments: {} }, { meta: CAPS });
    assert.equal(first.status, 200, first.text);
    const r1 = result(first);
    assert.equal(r1["resultType"], "input_required");
    assert.ok(typeof r1["requestState"] === "string");
    assert.ok(!String(r1["requestState"]).includes("step"), "the state is sealed, not plain JSON");
    const second = await modern(s.t, "tools/call", { name: "ask", arguments: {}, requestState: r1["requestState"], inputResponses: { who: { action: "accept", content: { name: "Ada" } } } }, { meta: CAPS });
    assert.equal(second.status, 200, second.text);
    const text = ((result(second)["content"] as { text: string }[])[0] as { text: string }).text;
    assert.equal(text, 'state {"step":1,"tool":"ask"} responses {"who":{"action":"accept","content":{"name":"Ada"}}}');
    assert.equal(result(second)["resultType"], "complete");
  });

  void it("MR-5 WO §5.6 a state captured from one tool's call is refused on another tool", async () => {
    const other = result(await modern(s.t, "tools/call", { name: "ask_other", arguments: {} }, { meta: CAPS }));
    const replay = await modern(s.t, "tools/call", { name: "ask", arguments: {}, requestState: other["requestState"] }, { meta: CAPS });
    assert.equal(replay.status, 400);
    assert.equal(code(replay), -32602);
    assert.match(replay.text, /different request/);
  });

  void it("MR-8 BI-9 an input request for a capability the client did not declare → 400 -32021 with requiredCapabilities", async () => {
    const r = await modern(s.t, "tools/call", { name: "needs_sampling", arguments: {} }, { meta: CAPS });
    assert.equal(r.status, 400);
    assert.equal(code(r), -32021);
    assert.deepEqual((r.json as { error: { data: unknown } }).error.data, { requiredCapabilities: { sampling: {} } });
  });

  void it("MR-9 inputResponses that are not an object of objects → 400 -32602", async () => {
    const r = await modern(s.t, "tools/call", { name: "ask", arguments: {}, inputResponses: { who: "yes" } }, { meta: CAPS });
    assert.equal(code(r), -32602);
  });
});

void describe("MR-4 with no key configured, request state fails closed both ways", () => {
  let s: Started;
  before(async () => {
    s = await start({ key: null });
  });
  after(async () => {
    await s.close();
  });

  void it("a handler that asks to seal state gets 500 -32603, not an unsealed state", async () => {
    const r = await modern(s.t, "tools/call", { name: "ask", arguments: {} }, { meta: CAPS });
    assert.equal(r.status, 500);
    assert.equal(code(r), -32603);
  });

  void it("any requestState a client sends is refused", async () => {
    const r = await modern(s.t, "tools/call", { name: "ask", arguments: {}, requestState: "e30.AAAA" }, { meta: CAPS });
    assert.equal(code(r), -32602);
  });
});

void describe("MR-5 the sealed binding, unit level", () => {
  const key = randomBytes(32);
  const binding = { principal: "p1", method: "tools/call", tool: "ask" };
  const refusedWith = (fn: () => unknown, why: RegExp): void => {
    assert.throws(fn, (e: unknown) => e instanceof Refusal && e.code === -32602 && why.test(e.message));
  };

  void it("round trip", () => {
    assert.deepEqual(openState(key, sealState(key, binding, { a: 1 }, 1000, 60_000), binding, 2000), { a: 1 });
  });
  void it("another principal is refused", () => {
    refusedWith(() => openState(key, sealState(key, binding, 1, 1000, 60_000), { ...binding, principal: "p2" }, 2000), /different request/);
  });
  void it("after the expiry is refused", () => {
    refusedWith(() => openState(key, sealState(key, binding, 1, 1000, 60_000), binding, 61_000), /expired/);
  });
  void it("sealed under another key is refused", () => {
    refusedWith(() => openState(randomBytes(32), sealState(key, binding, 1, 1000, 60_000), binding, 2000), /integrity/);
  });
  void it("a truncated tag, extra segments, and non-base64url are refused", () => {
    const token = sealState(key, binding, 1, 1000, 60_000);
    refusedWith(() => openState(key, token.slice(0, -4), binding, 2000), /integrity/);
    refusedWith(() => openState(key, `${token}.x`, binding, 2000), /malformed/);
    refusedWith(() => openState(key, token.replace(".", ".+"), binding, 2000), /malformed/);
  });
  void it("the key is named in env, never valued; a short key refuses to start", () => {
    assert.equal(REQUEST_STATE_KEY_ENV, "CLEARSEAL_REQUEST_STATE_KEY");
    assert.equal(requestStateKeyFromEnv({}), undefined);
    assert.throws(() => requestStateKeyFromEnv({ [REQUEST_STATE_KEY_ENV]: "short" }), RequestStateKeyError);
    assert.equal(requestStateKeyFromEnv({ [REQUEST_STATE_KEY_ENV]: "k".repeat(32) })?.length, 32);
  });
});
