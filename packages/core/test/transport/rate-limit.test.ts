// CSR-WO-2007 §1.1, §1.2, §3.2: the rate limit on the wire (rate-limit/RULES.md). Each documented
// case is a real request to a running transport, on the fake monotonic clock the limiter reads.

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { legacyHeaders, raw } from "./helpers.ts";
import { answer, as, call, rig } from "./principals.ts";

const pastes: string[] = [];
after(() => {
  console.log(pastes.join("\n"));
});

void describe("CSR-WO-2007 rate limit: over budget is 429, and nobody else is touched", () => {
  void it("RL-1, RL-2: A over budget → 429, Retry-After, a JSON-RPC error and one rate-limited row; B at the same moment → served", async () => {
    const r = await rig({ rateLimit: { burst: 2, refillPerMinute: 60, maxPrincipals: 100 } });
    try {
      for (let i = 0; i < 2; i++) assert.equal((await call(r.t, "alice", "read", `a${String(i)}`)).status, 200);
      const refused = await call(r.t, "alice", "read", "a2");
      assert.equal(refused.status, 429);
      assert.equal(refused.headers["retry-after"], "1");
      assert.equal(refused.headers["content-type"], "application/json");
      assert.deepEqual(refused.json, { jsonrpc: "2.0", error: { code: -32600, message: "Too Many Requests: this principal is over its request budget; retry after 1 s", data: { retryAfterS: 1 } } });
      const bob = await call(r.t, "bob", "read", "b0");
      assert.equal(bob.status, 200, "B, at the same moment on the same clock, is served");
      assert.deepEqual(r.of("rate-limited"), [{ principal: "alice", retryAfterS: 1 }], "exactly one row, naming A");
      assert.deepEqual(r.of("http-refused"), [], "the refusal wrote its own row, not a second one");
      pastes.push(`RATE A over budget: ${String(refused.status)} Retry-After: ${String(refused.headers["retry-after"])} ${refused.text}`);
      pastes.push(`RATE A's row: rate-limited ${JSON.stringify(r.of("rate-limited")[0])}`);
      pastes.push(`RATE B at the same moment: ${String(bob.status)} ${JSON.stringify((bob.json as { result?: unknown }).result)}`);
    } finally {
      await r.close();
    }
  });

  void it("RL-3: A's budget refills with the clock, and after its Retry-After A is served again", async () => {
    const r = await rig({ rateLimit: { burst: 1, refillPerMinute: 20, maxPrincipals: 100 } });
    try {
      assert.equal((await call(r.t, "alice", "read", "1")).status, 200);
      const refused = await call(r.t, "alice", "read", "2");
      assert.equal(refused.status, 429);
      assert.equal(refused.headers["retry-after"], "3", "20 a minute: a token every 3 s");
      r.clock.advance(2_999);
      assert.equal((await call(r.t, "alice", "read", "3")).status, 429, "not before its Retry-After");
      r.clock.advance(1);
      const served = await call(r.t, "alice", "read", "4");
      assert.equal(served.status, 200);
      pastes.push(`RATE A refused (Retry-After ${String(refused.headers["retry-after"])}), the clock advanced 3 s, A served: ${String(served.status)}`);
    } finally {
      await r.close();
    }
  });

  void it("RL-5: every authenticated request takes a token, whatever it is and before the body is read; an unauthenticated one takes none", async () => {
    const r = await rig({ rateLimit: { burst: 3, refillPerMinute: 1, maxPrincipals: 100 } });
    try {
      // Refused by auth first: none of these touches alice's budget.
      for (let i = 0; i < 10; i++) {
        const unauth = await raw(r.t, { headers: { ...legacyHeaders(), authorization: "Bearer not-a-principal" }, body: "{}" });
        assert.equal(unauth.status, 401);
      }
      const statuses = [
        (await as(r.t, "alice", "tools/list")).status,
        (await as(r.t, "alice", "tools/list", {}, { body: "{not json" })).status,
        (await as(r.t, "alice", "tools/list", {}, { headers: { "content-type": "text/plain" } })).status,
      ];
      assert.deepEqual(statuses, [200, 400, 415], "a list, a malformed body and a wrong Content-Type each took a token");
      const huge = await as(r.t, "alice", "tools/list", {}, { body: "x".repeat(2 * 1024 * 1024) });
      assert.equal(huge.status, 429, "over budget, a 2 MiB body is refused 429, not read and refused 413");
      assert.deepEqual(r.of("rate-limited").map((f) => f["principal"]), ["alice"]);
      pastes.push(`RATE what counts: ten 401s took nothing; a 200, a 400 and a 415 took three tokens; then a 2 MiB body → ${String(huge.status)}, unread`);
    } finally {
      await r.close();
    }
  });

  void it("the 429 is an HTTP-level refusal: the same status, headers and body on the legacy era", async () => {
    const r = await rig({ rateLimit: { burst: 1, refillPerMinute: 60, maxPrincipals: 100 } });
    try {
      assert.equal((await call(r.t, "alice", "read", "1")).status, 200);
      const legacy = await raw(r.t, { headers: { ...legacyHeaders(), authorization: "Bearer as:alice", "mcp-protocol-version": "2025-11-25" }, body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list", params: {} }) });
      const modern = await call(r.t, "alice", "read", "2");
      assert.equal(answer(legacy), answer(modern));
      assert.equal(legacy.status, 429);
    } finally {
      await r.close();
    }
  });

  void it("RL-6: without an injected clock the transport's default is monotonic, never the wall clock", async () => {
    const { startTransport } = await import("../../src/transport/server.ts");
    const { pinForTest } = await import("../fixtures/pin.ts");
    const { compileSchema } = await import("../../src/transport/schema.ts");
    const { DEFAULT_LIMITS } = await import("../../src/transport/config.ts");
    const { PrincipalVerifier, readTool, writeTool } = await import("./principals.ts");
    // A wall clock this test controls, installed before the transport starts, so a limiter that kept a
    // reference to Date.now and one that calls it afresh would both read it.
    const realNow = Date.now;
    let offset = 0;
    Date.now = () => realNow() + offset;
    try {
      const t = await startTransport({ registry: pinForTest([readTool, writeTool], compileSchema, DEFAULT_LIMITS), serverInfo: { name: "@clearseal/core", version: "0.0.0" }, verifier: new PrincipalVerifier(), rateLimit: { burst: 1, refillPerMinute: 1, maxPrincipals: 10 }, audit: () => undefined });
      try {
        assert.equal((await call(t, "alice", "read", "1")).status, 200);
        // The wall clock jumps a day ahead; a limiter on it would have refilled.
        offset = 86_400_000;
        assert.equal((await call(t, "alice", "read", "2")).status, 429, "a day on the wall clock refilled nothing");
      } finally {
        await t.close();
      }
    } finally {
      Date.now = realNow;
    }
  });

  void it("one principal-state-full row per episode: a second episode, after the table has had room, writes a second", async () => {
    const r = await rig({ rateLimit: { burst: 1, refillPerMinute: 60, maxPrincipals: 2 } });
    try {
      for (const p of ["alice", "bob"]) await call(r.t, p, "read", "1");
      await call(r.t, "fresh0", "read", "1");
      await call(r.t, "fresh1", "read", "1");
      assert.equal(r.of("principal-state-full").length, 1, "one episode, one row");
      r.clock.advance(1_000);
      await call(r.t, "carol", "read", "1");
      await call(r.t, "dave", "read", "1");
      await call(r.t, "fresh2", "read", "1");
      assert.deepEqual(r.of("principal-state-full").map((f) => f["principal"]), ["fresh0", "fresh2"], "the table had room (carol was tracked), so filling it again is a second episode");
    } finally {
      await r.close();
    }
  });

  void it("state caps: filling the limiter with principals neither refuses a fresh honest principal nor resets a limited one", async () => {
    const r = await rig({ rateLimit: { burst: 1, refillPerMinute: 1, maxPrincipals: 3 } });
    try {
      for (const p of ["alice", "bob", "carol"]) assert.equal((await call(r.t, p, "read", "1")).status, 200);
      for (const p of ["alice", "bob", "carol"]) assert.equal((await call(r.t, p, "read", "2")).status, 429, `${p} is limited`);
      const fresh: number[] = [];
      for (let i = 0; i < 40; i++) fresh.push((await call(r.t, `fresh${String(i)}`, "read", "1")).status);
      assert.ok(fresh.every((s) => s === 200), `every fresh principal is served: ${fresh.join(",")}`);
      for (const p of ["alice", "bob", "carol"]) assert.equal((await call(r.t, p, "read", "3")).status, 429, `${p} is still limited`);
      assert.deepEqual(r.of("principal-state-full"), [{ principal: "fresh0", control: "rate-limit", cap: 3 }], "one row for the episode, naming the first principal served untracked");
      pastes.push(`RATE caps: 3 limited principals fill the table; 40 fresh principals → all 200; the 3 → still 429; ${String(r.of("principal-state-full").length)} principal-state-full row`);
    } finally {
      await r.close();
    }
  });
});
