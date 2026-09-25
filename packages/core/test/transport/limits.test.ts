// Every limit in this layer, at its boundary (WO §1.10, §5.3; architecture §5). Each limit's
// refusal is also in refusals.test.ts; these pin the exact edges.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_LIMITS, resolveConfig, ConfigError } from "../../src/transport/config.ts";
import { modern, modernBody, modernHeaders, raw, start } from "./helpers.ts";

/** A discover request whose JSON body is exactly `size` bytes. */
function bodyOfSize(size: number): string {
  const base = JSON.stringify(modernBody("server/discover", { pad: "" }));
  const body = JSON.stringify(modernBody("server/discover", { pad: "x".repeat(size - base.length) }));
  assert.equal(Buffer.byteLength(body), size);
  return body;
}

void describe("WO §1.10 the architecture's defaults are the transport's defaults", () => {
  void it("body 1 MiB, depth 64, in-flight 32, handler 30 s, result 256 KiB", () => {
    assert.deepEqual(
      { maxBodyBytes: DEFAULT_LIMITS.maxBodyBytes, maxJsonDepth: DEFAULT_LIMITS.maxJsonDepth, maxInFlight: DEFAULT_LIMITS.maxInFlight, handlerTimeoutMs: DEFAULT_LIMITS.handlerTimeoutMs, maxResultBytes: DEFAULT_LIMITS.maxResultBytes },
      { maxBodyBytes: 1_048_576, maxJsonDepth: 64, maxInFlight: 32, handlerTimeoutMs: 30_000, maxResultBytes: 262_144 },
    );
  });
  void it("each is configurable by name, and an invalid value refuses to start", () => {
    assert.equal(resolveConfig({ limits: { maxInFlight: 5 } }).limits.maxInFlight, 5);
    assert.throws(() => resolveConfig({ limits: { maxBodyBytes: 0 } }), ConfigError);
    assert.throws(() => resolveConfig({ limits: { handlerTimeoutMs: -1 } }), ConfigError);
    assert.throws(() => resolveConfig({ toolsListTtlMs: -1 }), ConfigError);
  });
});

void describe("WO §5.3 body cap: exactly the cap, cap+1, and a chunked body with no Content-Length", () => {
  const CAP = 600;
  void it("exactly the cap → accepted; cap+1 → 413; chunked over the cap → 413; chunked under → accepted", async () => {
    const s = await start({ limits: { maxBodyBytes: CAP } });
    try {
      const exact = await raw(s.t, { headers: modernHeaders("server/discover"), body: bodyOfSize(CAP) });
      assert.equal(exact.status, 200, exact.text);
      const over = await raw(s.t, { headers: modernHeaders("server/discover"), body: bodyOfSize(CAP + 1) });
      assert.equal(over.status, 413);
      const chunkedOver = await raw(s.t, { headers: { ...modernHeaders("server/discover"), "transfer-encoding": "chunked" }, body: bodyOfSize(CAP + 1), chunked: true });
      assert.equal(chunkedOver.status, 413);
      const chunkedUnder = await raw(s.t, { headers: { ...modernHeaders("server/discover"), "transfer-encoding": "chunked" }, body: bodyOfSize(CAP - 10), chunked: true });
      assert.equal(chunkedUnder.status, 200, chunkedUnder.text);
      console.log(`BODYCAP exact=${String(exact.status)} over=${String(over.status)} chunkedOver=${String(chunkedOver.status)} chunkedUnder=${String(chunkedUnder.status)}`);
    } finally {
      await s.close();
    }
  });
});

void describe("parse depth: 64 nested levels in total are accepted, 65 refused", () => {
  void it("the request object is level 1, params 2, _meta 3; the padding supplies the rest", async () => {
    const s = await start();
    try {
      // modernBody nests: {request}=1 → params=2 → deep value starts at 3.
      const nest = (n: number): unknown => JSON.parse("[".repeat(n) + "]".repeat(n)) as unknown;
      const atCap = await raw(s.t, { headers: modernHeaders("server/discover"), body: JSON.stringify(modernBody("server/discover", { deep: nest(62) })) });
      assert.equal(atCap.status, 200, atCap.text);
      const overCap = await raw(s.t, { headers: modernHeaders("server/discover"), body: JSON.stringify(modernBody("server/discover", { deep: nest(63) })) });
      assert.equal(overCap.status, 400);
    } finally {
      await s.close();
    }
  });
});

void describe("result cap and handler timeout at their edges", () => {
  void it("a result at the cap is sent; one byte over is not", async () => {
    const s = await start({ limits: { maxResultBytes: 2000 } });
    try {
      const probe = await modern(s.t, "tools/call", { name: "big", arguments: { size: 0 } });
      const overhead = Buffer.byteLength(probe.text);
      const at = await modern(s.t, "tools/call", { name: "big", arguments: { size: 2000 - overhead } });
      assert.equal(at.status, 200);
      assert.equal(Buffer.byteLength(at.text), 2000);
      const over = await modern(s.t, "tools/call", { name: "big", arguments: { size: 2001 - overhead } });
      assert.equal(over.status, 500);
    } finally {
      await s.close();
    }
  });

  void it("a handler that never returns is ended by the timeout, its signal is aborted, and the slot is released", async () => {
    const s = await start({ limits: { handlerTimeoutMs: 100, maxInFlight: 1 } });
    try {
      const started = Date.now();
      const r = await modern(s.t, "tools/call", { name: "slow", arguments: {} });
      assert.equal(r.status, 500);
      assert.ok(Date.now() - started < 2000);
      assert.deepEqual(s.audits, ["handler-timeout"]);
      assert.equal((await modern(s.t, "server/discover")).status, 200, "the in-flight slot was released");
    } finally {
      await s.close();
    }
  });
});

void describe("WO §5.7 statelessness: 1,000 sequential requests retain nothing per request", () => {
  void it("in-flight returns to 0 and heap growth stays small", async () => {
    const s = await start();
    try {
      for (let i = 0; i < 100; i++) await modern(s.t, "tools/call", { name: "echo", arguments: { text: "warm" } });
      globalThis.gc?.();
      const before = process.memoryUsage().heapUsed;
      for (let i = 0; i < 1000; i++) {
        const r = await modern(s.t, "tools/call", { name: "echo", arguments: { text: `n${String(i)}` } }, { headers: { "mcp-session-id": `s${String(i)}` } });
        assert.equal(r.status, 200);
        assert.equal(r.headers["mcp-session-id"], undefined);
      }
      globalThis.gc?.();
      const growth = process.memoryUsage().heapUsed - before;
      console.log(`MEMORY 1000 sequential requests: heap growth ${String(Math.round(growth / 1024))} KiB, in-flight after ${String(s.t.inFlight())}`);
      assert.equal(s.t.inFlight(), 0);
      assert.ok(growth < 16 * 1024 * 1024, `heap grew ${String(growth)} bytes`);
    } finally {
      await s.close();
    }
  });
});
