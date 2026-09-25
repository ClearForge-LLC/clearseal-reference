// WO §3.3: every refusal case, with its exact status, content type and JSON-RPC code. Each test
// logs one `REFUSAL` line; FEEDBACK's table is pasted from those lines.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { BEARER, held, JSON_TYPE, legacyHeaders, modern, modernBody, modernHeaders, raw, type Reply, shape, start, type Started } from "./helpers.ts";

function expectRefusal(label: string, r: Reply, status: number, code: number | undefined): void {
  const s = shape(r);
  console.log(`REFUSAL ${JSON.stringify({ case: label, status: s.status, type: s.type ?? null, code: s.code ?? null })}`);
  assert.equal(s.status, status, `${label}: status (${r.text})`);
  if (code === undefined) {
    assert.equal(r.text, "", `${label}: no body`);
  } else {
    assert.equal(s.type, JSON_TYPE, `${label}: content type`);
    assert.equal(s.code, code, `${label}: code (${r.text})`);
  }
}

void describe("WO §3.3 refusals", () => {
  let s: Started;
  before(async () => {
    s = await start({ limits: { handlerTimeoutMs: 300, maxInFlight: 2, maxResultBytes: 4096 } });
  });
  after(async () => {
    await s.close();
  });

  void it("SH-2 SH-3 forged Origin → 403, JSON-RPC error without id", async () => {
    const r = await raw(s.t, { headers: modernHeaders("server/discover", undefined, { origin: "http://evil.example" }), body: JSON.stringify(modernBody("server/discover")) });
    expectRefusal("forged Origin", r, 403, -32600);
    assert.equal(Object.hasOwn(r.json as object, "id"), false);
  });

  void it("SH-4 foreign Host → 403", async () => {
    const r = await raw(s.t, { headers: modernHeaders("server/discover", undefined, { host: "evil.example" }), body: JSON.stringify(modernBody("server/discover")) });
    expectRefusal("foreign Host", r, 403, -32600);
  });

  void it("SH-20 SH-23 missing MCP-Protocol-Version → 400 -32020", async () => {
    const headers = modernHeaders("server/discover");
    delete headers["mcp-protocol-version"];
    const r = await raw(s.t, { headers, body: JSON.stringify(modernBody("server/discover")) });
    expectRefusal("missing version header", r, 400, -32020);
  });

  void it("SH-21 version header does not match _meta → 400 -32020", async () => {
    const r = await raw(s.t, { headers: modernHeaders("server/discover"), body: JSON.stringify(modernBody("server/discover", {}, { "io.modelcontextprotocol/protocolVersion": "2025-11-25" })) });
    expectRefusal("header/body mismatch on version", r, 400, -32020);
  });

  void it("SH-24 Mcp-Method does not match method → 400 -32020", async () => {
    const r = await raw(s.t, { headers: modernHeaders("tools/list"), body: JSON.stringify(modernBody("server/discover")) });
    expectRefusal("header/body mismatch on method", r, 400, -32020);
  });

  void it("SH-24 Mcp-Name does not match params.name (plain) → 400 -32020", async () => {
    const r = await modern(s.t, "tools/call", { name: "echo", arguments: { text: "hi" } }, { name: "big" });
    expectRefusal("header/body mismatch on name (plain)", r, 400, -32020);
  });

  void it("SH-31 Mcp-Name does not match params.name (Base64 sentinel) → 400 -32020", async () => {
    const r = await modern(s.t, "tools/call", { name: "echo", arguments: { text: "hi" } }, { name: `=?base64?${Buffer.from("big").toString("base64")}?=` });
    expectRefusal("header/body mismatch on name (Base64)", r, 400, -32020);
  });

  void it("SH-31 Mcp-Name Base64-encoded for a plain name is decoded and accepted", async () => {
    const r = await modern(s.t, "tools/call", { name: "echo", arguments: { text: "hi" } }, { name: `=?base64?${Buffer.from("echo").toString("base64")}?=` });
    assert.equal(r.status, 200, r.text);
  });

  void it("SH-31 sentinel markers in the wrong case are not a sentinel → 400 -32020", async () => {
    const r = await modern(s.t, "tools/call", { name: "echo", arguments: { text: "hi" } }, { name: `=?BASE64?${Buffer.from("echo").toString("base64")}?=` });
    expectRefusal("sentinel in wrong case", r, 400, -32020);
  });

  void it("SH-22 VR-1 unsupported version → 400 -32022 listing supported and requested", async () => {
    const r = await raw(s.t, { headers: modernHeaders("server/discover", undefined, { "mcp-protocol-version": "1900-01-01" }), body: JSON.stringify(modernBody("server/discover", {}, { "io.modelcontextprotocol/protocolVersion": "1900-01-01" })) });
    expectRefusal("unsupported version", r, 400, -32022);
    assert.deepEqual((r.json as { error: { data: unknown } }).error.data, { supported: ["2026-07-28", "2025-11-25"], requested: "1900-01-01" });
  });

  void it("SH-9 batch body → 400 -32600", async () => {
    const r = await raw(s.t, { headers: modernHeaders("server/discover"), body: JSON.stringify([modernBody("server/discover")]) });
    expectRefusal("batch body", r, 400, -32600);
    assert.match(r.text, /Batch requests are not supported/);
  });

  void it("SH-9 response-shaped body → 400 -32600", async () => {
    const r = await raw(s.t, { headers: modernHeaders("server/discover"), body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }) });
    expectRefusal("response-shaped body", r, 400, -32600);
    assert.match(r.text, /A JSON-RPC response is not accepted/);
  });

  void it("malformed JSON → 400 -32700", async () => {
    const r = await raw(s.t, { headers: modernHeaders("server/discover"), body: '{"jsonrpc":"2.0",' });
    expectRefusal("malformed JSON", r, 400, -32700);
  });

  void it("duplicate key → 400 -32700 (refused at parse)", async () => {
    const r = await raw(s.t, { headers: modernHeaders("server/discover"), body: '{"jsonrpc":"2.0","id":1,"method":"server/discover","method":"tools/list"}' });
    expectRefusal("duplicate key", r, 400, -32700);
  });

  void it("oversize body → 413 -32600", async () => {
    const small = await start({ limits: { maxBodyBytes: 256 } });
    try {
      const r = await raw(small.t, { headers: modernHeaders("server/discover"), body: JSON.stringify(modernBody("server/discover", { pad: "x".repeat(300) })) });
      expectRefusal("oversize body", r, 413, -32600);
    } finally {
      await small.close();
    }
  });

  void it("over-depth body → 400 -32600", async () => {
    const r = await raw(s.t, { headers: modernHeaders("server/discover"), body: JSON.stringify(modernBody("server/discover", { deep: JSON.parse("[".repeat(70) + "]".repeat(70)) as unknown })) });
    expectRefusal("over-depth body", r, 400, -32600);
  });

  void it("SH-19 unknown method → 404 -32601", async () => {
    const r = await modern(s.t, "no/such-method");
    expectRefusal("unknown method", r, 404, -32601);
  });

  void it("SH-11 SH-13 unknown notification → 400, error without id", async () => {
    const r = await raw(s.t, { headers: modernHeaders("notifications/whatever"), body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/whatever" }) });
    expectRefusal("unknown notification", r, 400, -32601);
    assert.equal(Object.hasOwn(r.json as object, "id"), false);
  });

  void it("SH-42 GET → 405 Allow: POST", async () => {
    const r = await raw(s.t, { method: "GET", headers: { authorization: `Bearer ${BEARER}`, accept: "text/event-stream" } });
    expectRefusal("GET", r, 405, undefined);
    assert.equal(r.headers.allow, "POST");
  });

  void it("SH-42 DELETE → 405 Allow: POST", async () => {
    const r = await raw(s.t, { method: "DELETE", headers: { authorization: `Bearer ${BEARER}`, "mcp-session-id": "abc" } });
    expectRefusal("DELETE", r, 405, undefined);
    assert.equal(r.headers.allow, "POST");
  });

  void it("SH-43 Mcp-Session-Id present → ignored, never echoed", async () => {
    const r = await modern(s.t, "server/discover", {}, { headers: { "mcp-session-id": "session-from-client" } });
    console.log(`REFUSAL ${JSON.stringify({ case: "session header present (ignored)", status: r.status, type: r.headers["content-type"] ?? null, code: null, sessionHeaderInResponse: r.headers["mcp-session-id"] ?? null })}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers["mcp-session-id"], undefined);
  });

  void it("SH-44 Last-Event-ID present → ignored", async () => {
    const r = await modern(s.t, "server/discover", {}, { headers: { "last-event-id": "42" } });
    console.log(`REFUSAL ${JSON.stringify({ case: "Last-Event-ID present (ignored)", status: r.status, type: r.headers["content-type"] ?? null, code: null })}`);
    assert.equal(r.status, 200);
  });

  void it("TL-10 D-7 extra request property against a tool schema → 400 -32602", async () => {
    const r = await modern(s.t, "tools/call", { name: "echo", arguments: { text: "hi", extra: true } });
    expectRefusal("extra property vs tool schema", r, 400, -32602);
  });

  void it("oversize result → 500 -32603, result not sent", async () => {
    const r = await modern(s.t, "tools/call", { name: "big", arguments: { size: 5000 } });
    expectRefusal("oversize result", r, 500, -32603);
    assert.ok(!r.text.includes("xxxx"));
  });

  void it("handler timeout → 500 -32603 and an audit event", async () => {
    const r = await modern(s.t, "tools/call", { name: "slow", arguments: {} });
    expectRefusal("handler timeout", r, 500, -32603);
    assert.ok(s.audits.includes("handler-timeout"));
  });

  void it("concurrency overflow → 503 with Retry-After; the held calls complete", async () => {
    const first = modern(s.t, "tools/call", { name: "hold", arguments: {} });
    const second = modern(s.t, "tools/call", { name: "hold", arguments: {} });
    while (held.gates.length < 2) await new Promise((r) => setTimeout(r, 5));
    const r = await modern(s.t, "server/discover");
    expectRefusal("concurrency overflow", r, 503, -32603);
    assert.equal(r.headers["retry-after"], "1");
    for (const g of held.gates.splice(0)) g.open();
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 200);
  });

  void it("MR-4 tampered requestState → 400 -32602", async () => {
    const first = await modern(s.t, "tools/call", { name: "ask", arguments: {} }, { meta: { "io.modelcontextprotocol/clientCapabilities": { elicitation: {} } } });
    const state = (first.json as { result: { requestState: string } }).result.requestState;
    const [payload = "", tag = ""] = state.split(".");
    const tampered = `${Buffer.from(Buffer.from(payload, "base64url").toString("utf8").replace('"step":1', '"step":2')).toString("base64url")}.${tag}`;
    const r = await modern(s.t, "tools/call", { name: "ask", arguments: {}, requestState: tampered, inputResponses: { who: { action: "accept", content: { name: "x" } } } }, { meta: { "io.modelcontextprotocol/clientCapabilities": { elicitation: {} } } });
    expectRefusal("tampered requestState", r, 400, -32602);
  });

  void it("AU-2 missing bearer → 401 with a resource_metadata challenge", async () => {
    const headers = modernHeaders("server/discover");
    delete headers["authorization"];
    const r = await raw(s.t, { headers, body: JSON.stringify(modernBody("server/discover")) });
    expectRefusal("missing bearer", r, 401, -32600);
    assert.match(String(r.headers["www-authenticate"]), /^Bearer resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource\/mcp"$/);
  });

  void it("AU-2 wrong bearer → 401 with error=invalid_token", async () => {
    const r = await raw(s.t, { headers: modernHeaders("server/discover", undefined, { authorization: "Bearer wrong" }), body: JSON.stringify(modernBody("server/discover")) });
    expectRefusal("wrong bearer", r, 401, -32600);
    assert.match(String(r.headers["www-authenticate"]), /error="invalid_token"$/);
  });

  void it("BI-8 missing _meta protocol fields → 400 -32602", async () => {
    const r = await raw(s.t, { headers: modernHeaders("server/discover"), body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "server/discover", params: {} }) });
    expectRefusal("missing _meta", r, 400, -32602);
  });

  void it("WO §5.2 _meta at the top level instead of under params → refused, never read", async () => {
    const r = await raw(s.t, { headers: modernHeaders("server/discover"), body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "server/discover", _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } }) });
    expectRefusal("_meta at top level", r, 400, -32600);
  });

  void it("SH-7 Accept without application/json → 406", async () => {
    const r = await raw(s.t, { headers: modernHeaders("server/discover", undefined, { accept: "text/event-stream" }), body: JSON.stringify(modernBody("server/discover")) });
    expectRefusal("Accept lacks application/json", r, 406, -32600);
  });

  void it("legacy request after initialize without the header → 400 -32020", async () => {
    const r = await raw(s.t, { headers: legacyHeaders(), body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }) });
    expectRefusal("legacy request without header", r, 400, -32020);
  });
});
