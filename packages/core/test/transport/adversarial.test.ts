// Regressions for the CSR-WO-1005 adversarial pass (WO §5). Each test names its finding.

import assert from "node:assert/strict";
import { connect } from "node:net";
import { describe, it } from "node:test";

import { DEFAULT_LIMITS } from "../../src/transport/config.ts";
import { RegistrationError, type Tool } from "../../src/transport/registry.ts";
import { pinForTest } from "../fixtures/pin.ts";
import { compileSchema } from "../../src/transport/schema.ts";
import { startTransport } from "../../src/transport/server.ts";
import type { Verdict, Verifier } from "../../src/transport/verifier.ts";
import { held, legacyHeaders, modern, modernBody, modernHeaders, raw, type Reply, start } from "./helpers.ts";

const code = (r: Reply): unknown => (r.json as { error?: { code: number } } | undefined)?.error?.code;
/** Writes raw bytes and returns the response head, for requests http.request refuses to send. */
function rawSocket(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = connect(port, "127.0.0.1", () => sock.end(text));
    let out = "";
    sock.on("data", (d: Buffer) => (out += d.toString("latin1")));
    sock.on("close", () => resolve(out));
    sock.on("error", reject);
  });
}
const waitFor = async (cond: () => boolean): Promise<void> => {
  while (!cond()) await new Promise((r) => setTimeout(r, 5));
};

void describe("F1 F3 F5 the in-flight cap: taken after auth, held until the handler settles", () => {
  void it("F1 an unauthenticated request never takes a slot: with the cap full, it still gets 401, not 503", async () => {
    const s = await start({ limits: { maxInFlight: 1 } });
    try {
      const holding = modern(s.t, "tools/call", { name: "hold", arguments: {} });
      await waitFor(() => held.gates.length === 1);
      const headers = modernHeaders("server/discover");
      delete headers["authorization"];
      const r = await raw(s.t, { headers, body: JSON.stringify(modernBody("server/discover")) });
      assert.equal(r.status, 401);
      assert.equal((await modern(s.t, "server/discover")).status, 503, "an authenticated request is capped");
      for (const g of held.gates.splice(0)) g.open();
      assert.equal((await holding).status, 200);
    } finally {
      await s.close();
    }
  });

  void it("F1 pipelined unauthenticated requests on one socket that never reads take no slots", async () => {
    const s = await start({ limits: { maxInFlight: 2 } });
    const sock = connect(s.t.port, "127.0.0.1");
    try {
      const one = `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${String(s.t.port)}\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}`;
      sock.write(one.repeat(60_000));
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(s.t.inFlight(), 0);
      assert.equal((await modern(s.t, "server/discover")).status, 200);
    } finally {
      sock.destroy();
      await s.close();
    }
  });

  void it("F3 a handler that times out and ignores its signal keeps its slot until it settles", async () => {
    const s = await start({ limits: { maxInFlight: 1, handlerTimeoutMs: 100 } });
    try {
      const r = await modern(s.t, "tools/call", { name: "hold", arguments: {} });
      assert.equal(r.status, 500);
      assert.equal((await modern(s.t, "server/discover")).status, 503, "the abandoned handler still counts");
      for (const g of held.gates.splice(0)) g.open();
      await waitFor(() => s.t.inFlight() === 0);
      assert.equal((await modern(s.t, "server/discover")).status, 200);
    } finally {
      await s.close();
    }
  });

  void it("F5 a verifier that never answers → 503 Retry-After within verifierTimeoutMs, and no slot kept", async () => {
    const hang: Verifier = { verify: () => new Promise<Verdict>(() => undefined) };
    const s = await start({ verifier: hang, limits: { verifierTimeoutMs: 150, maxInFlight: 1 } });
    try {
      const t0 = Date.now();
      const r = await modern(s.t, "server/discover");
      assert.equal(r.status, 503);
      assert.equal(r.headers["retry-after"], "1");
      assert.ok(Date.now() - t0 < 2000);
      assert.equal(s.t.inFlight(), 0);
    } finally {
      await s.close();
    }
  });
});

void describe("F4 nothing dispatches without a principal, whatever the verifier returns", () => {
  const verdicts: [string, unknown][] = [
    ["ok: true without a principal", { ok: true }],
    ["ok: true with an empty principal id", { ok: true, principal: { id: "" } }],
    ["ok: 'yes' (truthy, not true)", { ok: "yes", principal: { id: "p" } }],
  ];
  for (const [label, verdict] of verdicts) {
    void it(label, async () => {
      const s = await start({ verifier: { verify: () => Promise.resolve(verdict as Verdict) } });
      try {
        const r = await modern(s.t, "tools/list");
        assert.ok(r.status === 401 || r.status === 500, `${String(r.status)} ${r.text}`);
        assert.ok(!r.text.includes('"tools"'));
      } finally {
        await s.close();
      }
    });
  }
});

void describe("F2 validation runs off the event loop under a deadline", () => {
  void it("a quadratic validation is abandoned at validationTimeoutMs with 400 -32602, and /health answers meanwhile", async () => {
    const s = await start({ limits: { validationTimeoutMs: 300 } });
    try {
      const tags = Array.from({ length: 20_000 }, (_, i) => ({ k: i }));
      const t0 = Date.now();
      const call = modern(s.t, "tools/call", { name: "costly_schema", arguments: { tags } });
      await new Promise((r) => setTimeout(r, 50));
      const h0 = Date.now();
      assert.equal((await raw(s.t, { method: "GET", path: "/health" })).status, 200);
      const healthMs = Date.now() - h0;
      const r = await call;
      const callMs = Date.now() - t0;
      console.log(`VALIDATION-DEADLINE status=${String(r.status)} code=${String(code(r))} call=${String(callMs)}ms health=${String(healthMs)}ms`);
      assert.equal(r.status, 400);
      assert.equal(code(r), -32602);
      assert.ok(healthMs < 200, `health took ${String(healthMs)} ms`);
      assert.ok(s.audits.includes("validation-timeout"));
      assert.equal((await modern(s.t, "tools/call", { name: "echo", arguments: { text: "after" } })).status, 200, "the replaced worker validates");
    } finally {
      await s.close();
    }
  });
});

void describe("F6 the schema walk is keyword-aware", () => {
  const reg = (schema: Record<string, unknown>): void => {
    const tool: Tool = { name: "t", inputSchema: schema, handler: () => Promise.resolve({ content: [] }) };
    pinForTest([tool], compileSchema, DEFAULT_LIMITS);
  };
  void it("an external $ref hidden under a property named const or default is refused", () => {
    assert.throws(() => {
      reg({ type: "object", properties: { const: { $ref: "https://example.com/x" } } });
    }, RegistrationError);
    assert.throws(() => {
      reg({ type: "object", properties: { default: { $ref: "https://example.com/x" } } });
    }, RegistrationError);
  });
  void it("properties named $ref, $schema and $dynamicRef, and a $defs entry named $ref, are names, not keywords", () => {
    reg({ type: "object", properties: { $ref: { type: "string" }, $schema: { type: "string" }, $dynamicRef: { type: "string" } }, $defs: { $ref: { type: "string" } } });
  });
  void it("subschemas under a property named examples still count against maxSchemaNodes", () => {
    assert.throws(() => {
      reg({ type: "object", properties: { examples: { anyOf: Array.from({ length: 2001 }, () => ({ type: "object" })) } } });
    }, /subschemas/);
  });
});

void describe("F7 F8 F9 F10 F11 F12 F13 F14 F16 F17", () => {
  void it("F7 a requestState issued for one set of arguments is refused on another", async () => {
    const s = await start();
    try {
      const first = await modern(s.t, "tools/call", { name: "approve_target", arguments: { target: "file-a" } });
      const state = (first.json as { result: { requestState: string } }).result.requestState;
      const same = await modern(s.t, "tools/call", { name: "approve_target", arguments: { target: "file-a" }, requestState: state });
      assert.equal(same.status, 200, same.text);
      const swapped = await modern(s.t, "tools/call", { name: "approve_target", arguments: { target: "file-b" }, requestState: state });
      assert.equal(code(swapped), -32602);
      assert.match(swapped.text, /different request/);
    } finally {
      await s.close();
    }
  });

  void it("F8 legacy: a mismatched Mcp-Param-* header is refused; a notification with a mismatched Mcp-Method is refused", async () => {
    const s = await start();
    try {
      const call = await raw(s.t, { headers: legacyHeaders({ "mcp-protocol-version": "2025-11-25", "mcp-param-region": "eu" }), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "region_query", arguments: { query: "q", region: "us" } } }) });
      assert.equal(code(call), -32020);
      const note = await raw(s.t, { headers: legacyHeaders({ "mcp-protocol-version": "2025-11-25", "mcp-method": "tools/call" }), body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
      assert.equal(note.status, 400);
      const noteMeta = await raw(s.t, { headers: legacyHeaders({ "mcp-protocol-version": "2025-11-25" }), body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } }) });
      assert.equal(noteMeta.status, 400);
    } finally {
      await s.close();
    }
  });

  void it("F9 F10 F11 duplicate Host → 400; absolute-form target → 400; duplicate Authorization → 400; duplicate Content-Type → 415; Content-Encoding → 415; TE other than chunked → 400", async () => {
    const s = await start();
    try {
      const body = JSON.stringify(modernBody("server/discover"));
      const host = `127.0.0.1:${String(s.t.port)}`;
      assert.match(await rawSocket(s.t.port, `POST /mcp HTTP/1.1\r\nHost: ${host}\r\nHost: evil.example\r\nContent-Type: application/json\r\nContent-Length: ${String(body.length)}\r\n\r\n${body}`), /^HTTP\/1\.1 400 /);
      assert.equal((await raw(s.t, { path: `http://evil.example/mcp`, headers: modernHeaders("server/discover"), body })).status, 400);
      const auth = String(modernHeaders("server/discover")["authorization"]);
      assert.equal((await raw(s.t, { headers: { ...modernHeaders("server/discover"), authorization: [auth, "Bearer other"] }, body })).status, 400);
      assert.equal((await raw(s.t, { headers: { ...modernHeaders("server/discover"), "content-type": ["application/json", "text/plain"] }, body })).status, 415);
      assert.equal((await raw(s.t, { headers: { ...modernHeaders("server/discover"), "content-encoding": "gzip" }, body })).status, 415);
      assert.equal((await raw(s.t, { headers: { ...modernHeaders("server/discover"), "transfer-encoding": "gzip, chunked" }, body, chunked: true })).status, 400);
    } finally {
      await s.close();
    }
  });

  void it("F12 whatever a handler throws becomes 500 -32603 with a fixed message", async () => {
    const s = await start();
    try {
      const r = await modern(s.t, "tools/call", { name: "throws_refusal", arguments: {} });
      assert.equal(r.status, 500);
      assert.equal(code(r), -32603);
      assert.ok(r.text.length < 300, `body length ${String(r.text.length)}`);
    } finally {
      await s.close();
    }
  });

  void it("F13 an unsupported version header that is not version-shaped is not echoed", async () => {
    const s = await start();
    try {
      const secretShaped = `sk-${"A".repeat(40)}`;
      const r = await raw(s.t, { headers: modernHeaders("server/discover", undefined, { "mcp-protocol-version": secretShaped }), body: JSON.stringify(modernBody("server/discover")) });
      assert.equal(code(r), -32022);
      assert.ok(!r.text.includes(secretShaped));
    } finally {
      await s.close();
    }
  });

  void it("F14 F16 F17 a non-canonical path is 404; /health refuses a foreign Origin; a quoted charset is accepted", async () => {
    const s = await start();
    try {
      const body = JSON.stringify(modernBody("server/discover"));
      assert.equal((await raw(s.t, { path: "/x/../mcp", headers: modernHeaders("server/discover"), body })).status, 404);
      assert.equal((await raw(s.t, { method: "GET", path: "/health", headers: { origin: "http://evil.example" } })).status, 403);
      assert.equal((await raw(s.t, { headers: { ...modernHeaders("server/discover"), "content-type": 'application/json; charset="utf-8"' }, body })).status, 200);
    } finally {
      await s.close();
    }
  });
});

void describe("the transport can run with no pool at all (the synchronous compiler), for unit use", () => {
  void it("starts and validates", async () => {
    const registry = pinForTest([{ name: "e", inputSchema: { type: "object", properties: { a: { type: "string" } } }, handler: () => Promise.resolve({ content: [] }) }], compileSchema, DEFAULT_LIMITS);
    const t = await startTransport({ registry, serverInfo: { name: "x", version: "0" }, verifier: { verify: () => Promise.resolve({ ok: true, principal: { id: "p" } }) } });
    try {
      const r = await raw(t, { headers: modernHeaders("tools/call", "e"), body: JSON.stringify(modernBody("tools/call", { name: "e", arguments: { a: 1 } })) });
      assert.equal(code(r), -32602);
    } finally {
      await t.close();
    }
  });
});
