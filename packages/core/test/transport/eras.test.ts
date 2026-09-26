// The served revisions, measured (WO §1.13, §3.5); the legacy exchange (§1.7, §3.4); /health and
// the RFC 9728 document (§1.12); the refuse-all default (§1.11); no SDK in any package's source or runtime dependencies (§1.15).

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { LEGACY_PATH_REVIEW_BY } from "../../src/transport/config.ts";
import { BEARER, legacyHeaders, modern, modernBody, modernHeaders, raw, start, type Started } from "./helpers.ts";

void describe("served revisions and the legacy era", () => {
  let s: Started;
  before(async () => {
    s = await start();
  });
  after(async () => {
    await s.close();
  });

  void it("WO §1.13 VR-1 DS-2: server/discover answers supportedVersions = the architecture's set", async () => {
    const r = await modern(s.t, "server/discover");
    console.log(`DISCOVER ${r.text}`);
    assert.equal(r.status, 200);
    const result = (r.json as { result: Record<string, unknown> }).result;
    assert.deepEqual(result["supportedVersions"], ["2026-07-28", "2025-11-25"]);
    assert.equal(result["resultType"], "complete");
    assert.deepEqual(result["capabilities"], { tools: {} });
    assert.equal(result["cacheScope"], "public");
    assert.ok(typeof result["ttlMs"] === "number" && result["ttlMs"] >= 0);
    assert.deepEqual(result["_meta"], { "io.modelcontextprotocol/serverInfo": { name: "@clearseal/core", version: "0.0.0" } });
  });

  void it("WO §1.12 /health: bearer-free, the version and the served revisions, nothing else", async () => {
    const r = await raw(s.t, { method: "GET", path: "/health" });
    console.log(`HEALTH ${r.text}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { status: "ok", version: "0.0.0", protocolVersions: ["2026-07-28", "2025-11-25"] });
  });

  void it("AU-1 the protected-resource metadata document is bearer-free", async () => {
    const r = await raw(s.t, { method: "GET", path: "/.well-known/oauth-protected-resource/mcp" });
    assert.equal(r.status, 200);
    assert.equal((r.json as { resource: string }).resource, s.t.url);
  });

  void it("WO §3.4 LG-1 D-2 legacy initialize: no session header; notifications/initialized 202; legacy tools/list; GET still 405", async () => {
    const init = await raw(s.t, {
      headers: legacyHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "legacy-client", version: "1.0.0" } } }),
    });
    console.log(`LEGACY initialize ${String(init.status)} session=${String(init.headers["mcp-session-id"] ?? "none")} ${init.text}`);
    assert.equal(init.status, 200);
    assert.equal(init.headers["mcp-session-id"], undefined);
    const result = (init.json as { result: Record<string, unknown> }).result;
    assert.equal(result["protocolVersion"], "2025-11-25");
    assert.deepEqual(result["serverInfo"], { name: "@clearseal/core", version: "0.0.0" });

    const initialized = await raw(s.t, { headers: legacyHeaders({ "mcp-protocol-version": "2025-11-25" }), body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    console.log(`LEGACY notifications/initialized ${String(initialized.status)} body=${JSON.stringify(initialized.text)}`);
    assert.equal(initialized.status, 202);
    assert.equal(initialized.text, "");

    const list = await raw(s.t, { headers: legacyHeaders({ "mcp-protocol-version": "2025-11-25" }), body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) });
    console.log(`LEGACY tools/list ${String(list.status)} session=${String(list.headers["mcp-session-id"] ?? "none")} tools=${String((list.json as { result: { tools: unknown[] } }).result.tools.length)}`);
    assert.equal(list.status, 200);
    const listResult = (list.json as { result: Record<string, unknown> }).result;
    assert.ok(Array.isArray(listResult["tools"]));
    assert.equal(listResult["resultType"], undefined, "the legacy shape carries no resultType");

    const call = await raw(s.t, { headers: legacyHeaders({ "mcp-protocol-version": "2025-11-25" }), body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "legacy" } } }) });
    assert.equal(call.status, 200);
    assert.deepEqual((call.json as { result: unknown }).result, { content: [{ type: "text", text: "legacy" }] });

    const get = await raw(s.t, { method: "GET", headers: { authorization: `Bearer ${BEARER}`, accept: "text/event-stream", "mcp-protocol-version": "2025-11-25" } });
    console.log(`LEGACY GET ${String(get.status)} Allow=${String(get.headers.allow)}`);
    assert.equal(get.status, 405);
  });

  void it("LG-6 ping is served on the legacy era and is 404 on the modern era (no ping in 2026-07-28)", async () => {
    const legacy = await raw(s.t, { headers: legacyHeaders({ "mcp-protocol-version": "2025-11-25" }), body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "ping" }) });
    assert.deepEqual((legacy.json as { result: unknown }).result, {});
    const modernPing = await modern(s.t, "ping");
    assert.equal(modernPing.status, 404);
  });

  void it("VR-5 initialize under the modern header is 404 -32601 (removed in 2026-07-28)", async () => {
    const r = await raw(s.t, { headers: modernHeaders("initialize"), body: JSON.stringify(modernBody("initialize", { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "x", version: "1" } })) });
    assert.equal(r.status, 404);
    assert.equal((r.json as { error: { code: number } }).error.code, -32601);
  });

  void it("SH-16 subscriptions/listen → 404 -32601 (not implemented)", async () => {
    const r = await modern(s.t, "subscriptions/listen");
    assert.equal(r.status, 404);
  });

  void it("VR-8 the legacy path is reviewed before its date: this test fails from LEGACY_PATH_REVIEW_BY", () => {
    assert.ok(Date.now() < Date.parse(`${LEGACY_PATH_REVIEW_BY}T00:00:00Z`), `the legacy (2025-11-25) path was due for review on ${LEGACY_PATH_REVIEW_BY}: remove it or move the date with a ruling`);
  });
});

void describe("WO §1.11: the shipped verifier refuses everything", () => {
  let s: Started;
  before(async () => {
    s = await start({ verifier: null });
  });
  after(async () => {
    await s.close();
  });

  void it("AU-2 with the default RefuseAllVerifier, even a valid bearer and request get 401 and a challenge", async () => {
    const r = await modern(s.t, "server/discover");
    console.log(`REFUSEALL ${String(r.status)} ${String(r.headers["www-authenticate"])}`);
    assert.equal(r.status, 401);
    assert.match(String(r.headers["www-authenticate"]), /resource_metadata="/);
  });

  void it("/health and the metadata document stay reachable", async () => {
    assert.equal((await raw(s.t, { method: "GET", path: "/health" })).status, 200);
    assert.equal((await raw(s.t, { method: "GET", path: "/.well-known/oauth-protected-resource" })).status, 200);
  });
});

void describe("WO §1.15: no SDK import in any package's source, and no runtime dependency on it", () => {
  // CSR-WO-1005b §1.5 admits the official SDK as a test-only dev dependency of @clearseal/core, so
  // that its client can be measured against the transport. Everything else stands: no file under
  // packages/ names it except that one test and this one, and no package depends on it at runtime.
  const SDK = "@modelcontextprotocol/sdk";
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const allowedTests = [join(root, "core", "test", "transport", "eras.test.ts"), join(root, "core", "test", "sdk-client", "sdk-client.test.ts")];
  const manifestsNaming: string[] = [];
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist") continue;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|mts|cts|tsx|js|mjs|cjs|jsx|json)$/.test(entry) && readFileSync(p, "utf8").includes(SDK)) {
        if (entry === "package.json") manifestsNaming.push(p);
        else if (!allowedTests.includes(p)) offenders.push(p);
      }
    }
  };
  walk(root);

  void it("no file under packages/ imports it, except the SDK-client test", () => {
    assert.deepEqual(offenders, []);
  });

  void it("no package depends on it at runtime: the one manifest naming it is core's, as an exact devDependency", () => {
    assert.deepEqual(manifestsNaming, [join(root, "core", "package.json")]);
    const pkg = JSON.parse(readFileSync(join(root, "core", "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    for (const field of ["dependencies", "peerDependencies", "optionalDependencies", "bundleDependencies", "bundledDependencies"]) assert.equal(pkg[field]?.[SDK], undefined, field);
    assert.match(pkg["devDependencies"]?.[SDK] ?? "", /^\d+\.\d+\.\d+$/, "pinned exactly");
  });
});
