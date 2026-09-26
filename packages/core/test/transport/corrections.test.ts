// CSR-WO-1005a: the two repairs from -0101's findings, each with its measurement.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_LIMITS } from "../../src/transport/config.ts";
import { PlaceholderRegistry } from "../../src/transport/registry.ts";
import { ValidationPool } from "../../src/transport/schema-pool.ts";
import { startTransport } from "../../src/transport/server.ts";
import { legacyHeaders, modern, raw, start } from "./helpers.ts";

const resources = (): string[] => process.getActiveResourcesInfo().filter((r) => r !== "Timeout" && r !== "TTYWrap").sort();

void describe("WO §1.1 the validation pool closes with the server", () => {
  void it("after close(), the process's active handles return to the baseline within two seconds", async () => {
    const baseline = resources();
    const pool = new ValidationPool({ workers: 2, timeoutMs: DEFAULT_LIMITS.validationTimeoutMs });
    const registry = new PlaceholderRegistry(pool.compile, DEFAULT_LIMITS);
    registry.register({ name: "echo", inputSchema: { type: "object", properties: { t: { type: "string" } } }, handler: (a) => Promise.resolve({ content: [{ type: "text", text: String(a["t"]) }] }) });
    const t = await startTransport({ registry, serverInfo: { name: "x", version: "0" }, validationPool: pool, verifier: { verify: () => Promise.resolve({ ok: true, principal: { id: "p" } }) } });
    const r = await raw(t, {
      headers: { accept: "application/json", "content-type": "application/json", "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "echo", connection: "close" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: { t: "hi" }, _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } } }),
    });
    assert.equal(r.status, 200, r.text);
    const open = resources();
    const t0 = Date.now();
    await t.close();
    let now = resources();
    while (JSON.stringify(now) !== JSON.stringify(baseline) && Date.now() - t0 < 2000) {
      await new Promise((res) => setTimeout(res, 20));
      now = resources();
    }
    const ms = Date.now() - t0;
    console.log(`HANDLES baseline=${JSON.stringify(baseline)} (${String(baseline.length)})  while serving=${JSON.stringify(open)} (${String(open.length)})  after close()=${JSON.stringify(now)} (${String(now.length)}) in ${String(ms)} ms`);
    assert.ok(open.length > baseline.length, "the server and its pool hold handles while running");
    assert.deepEqual(now, baseline, "handles return to the baseline");
    assert.ok(ms <= 2000);
  });

  void it("a transport refused at configuration closes the pool it was handed (1005a adversarial F2)", async () => {
    const baseline = resources();
    const pool = new ValidationPool({ workers: 1, timeoutMs: 1000 });
    const registry = new PlaceholderRegistry(pool.compile, DEFAULT_LIMITS);
    await assert.rejects(startTransport({ registry, serverInfo: { name: "x", version: "0" }, validationPool: pool, config: { limits: { maxInFlight: 0 } } }), /maxInFlight/);
    assert.deepEqual(resources(), baseline, "no worker port left behind");
  });

  void it("WO §5.1 closing while a validation is in flight: the request fails cleanly and close() still resolves", async () => {
    const s = await start({ limits: { validationTimeoutMs: 10_000 } });
    const tags = Array.from({ length: 20_000 }, (_, i) => ({ k: i }));
    const call = modern(s.t, "tools/call", { name: "costly_schema", arguments: { tags } }).then(
      (r) => r.status,
      () => "connection closed",
    );
    await new Promise((r) => setTimeout(r, 150));
    const t0 = Date.now();
    await s.close();
    const outcome = await call;
    console.log(`CLOSE-IN-FLIGHT close() resolved in ${String(Date.now() - t0)} ms; the in-flight request: ${String(outcome)}`);
    assert.ok(outcome === 500 || outcome === "connection closed", String(outcome));
    assert.ok(Date.now() - t0 < 2000);
  });
});

void describe("WO §1.2 an input_required result on the legacy era is refused cleanly, never a 500", () => {
  void it("LG-8 ST-2 legacy tools/call to an MRTR tool → 200 (the legacy era's convention, CSR-WO-1005b), application/json, -32601, and the tool is logged at the seam", async () => {
    const s = await start();
    try {
      const r = await raw(s.t, { headers: legacyHeaders({ "mcp-protocol-version": "2025-11-25" }), body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "ask", arguments: {} } }) });
      console.log(`LEGACY-MRTR status=${String(r.status)} type=${String(r.headers["content-type"])} body=${r.text}`);
      assert.equal(r.status, 200);
      assert.equal(r.headers["content-type"], "application/json");
      const err = (r.json as { id: number; error: { code: number; message: string; data: unknown } });
      assert.equal(err.id, 7);
      assert.equal(err.error.code, -32601);
      assert.match(err.error.message, /2025-11-25 cannot carry; use 2026-07-28/);
      assert.deepEqual(err.error.data, { requires: "2026-07-28" });
      assert.ok(s.audits.includes("legacy-input-required"));
    } finally {
      await s.close();
    }
  });

  void it("LG-8 a state-only input_required (no inputRequests) on the legacy era is refused the same way (1005a adversarial F1)", async () => {
    const s = await start();
    try {
      for (const [name, args] of [["ask_other", {}], ["approve_target", { target: "file-a" }]] as const) {
        const r = await raw(s.t, { headers: legacyHeaders({ "mcp-protocol-version": "2025-11-25" }), body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } }) });
        assert.equal(r.status, 200, `${name}: ${r.text}`);
        assert.equal((r.json as { error: { code: number } }).error.code, -32601);
        assert.ok(!r.text.includes("requestState"), "no sealed state reaches a legacy client");
      }
    } finally {
      await s.close();
    }
  });

  void it("WO §5.2 an oversized input_required on the legacy era: the era refusal wins, and nothing of the result is sent", async () => {
    const s = await start();
    try {
      const r = await raw(s.t, { headers: legacyHeaders({ "mcp-protocol-version": "2025-11-25" }), body: JSON.stringify({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "ask_big", arguments: {} } }) });
      assert.equal(r.status, 200);
      assert.equal((r.json as { error: { code: number } }).error.code, -32601);
      assert.ok(r.text.length < 500, `body ${String(r.text.length)} bytes`);
    } finally {
      await s.close();
    }
  });
});
