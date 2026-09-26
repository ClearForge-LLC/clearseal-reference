// CSR-WO-1005b §3.3: every error the transport can produce × era × HTTP status, measured. Each row
// sends the same fault once per era and asserts the status and the JSON-RPC code; the table is
// printed at the end (FEEDBACK pastes it). The rule it pins (SPEC-MAP ST-1…ST-4):
//   - a JSON-RPC error that answers a well-formed legacy-era (2025-11-25) request → 200, error
//     object unchanged;
//   - HTTP-level refusals (Host/Origin, auth, method, media types, framing, body, the version and
//     mirrored-header gates, capacity) → the same 4xx/5xx in both eras;
//   - the modern era (2026-07-28) keeps each refusal's own status.
// A row with no legacy (or modern) cell is a fault that cannot be expressed on that era.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, describe, it } from "node:test";

import { DEFAULT_LIMITS, type Limits } from "../../src/transport/config.ts";
import type { Tool, ToolResult } from "../../src/transport/registry.ts";
import { pinForTest } from "../fixtures/pin.ts";
import { ValidationPool } from "../../src/transport/schema-pool.ts";
import { startTransport, type RunningTransport } from "../../src/transport/server.ts";
import type { Verifier } from "../../src/transport/verifier.ts";
import { BEARER, fixtureTools, held, legacyHeaders, modernHeaders, PV, raw, TestBearerVerifier, type Reply } from "./helpers.ts";

type EraName = "modern" | "legacy";
interface Req {
  method?: string;
  path?: string;
  headers: Record<string, string | string[]>;
  body?: string | Buffer;
  chunked?: boolean;
}
/** status, and the JSON-RPC code (null: no body). */
type Expect = [number, number | null];
type ServerKey = "main" | "fast" | "small" | "noKey" | "slowVerifier" | "badVerifier" | "capacity";
interface Case {
  error: string;
  server?: ServerKey;
  modern: Expect | null;
  legacy: Expect | null;
  build: (era: EraName) => Req;
}

const ID = 41;

/** Tools whose results the result-mapping path must refuse; registered only here. */
const badResults = (r: unknown): Tool["handler"] => () => Promise.resolve(r as ToolResult);
const extraTools: Tool[] = [
  { name: "returns_nothing", description: "Resolves to no result.", inputSchema: { type: "object" }, handler: badResults(undefined) },
  { name: "returns_task", description: "An unknown resultType.", inputSchema: { type: "object" }, handler: badResults({ resultType: "task", taskId: "t" }) },
  { name: "returns_no_content", description: "A complete result without content.", inputSchema: { type: "object" }, handler: badResults({}) },
  { name: "bad_input_kind", description: "An input request of no known kind.", inputSchema: { type: "object" }, handler: badResults({ resultType: "input_required", inputRequests: { x: { method: "no/such-request" } } }) },
  { name: "empty_input", description: "input_required with nothing in it.", inputSchema: { type: "object" }, handler: badResults({ resultType: "input_required" }) },
  { name: "returns_bigint", description: "A result JSON cannot serialize.", inputSchema: { type: "object" }, handler: badResults({ content: [], structuredContent: { n: 1n } }) },
];

interface Server {
  t: RunningTransport;
  close: () => Promise<void>;
}

async function startServer(key: ServerKey): Promise<Server> {
  const limitsFor: Record<ServerKey, Partial<Limits>> = {
    main: {},
    fast: { handlerTimeoutMs: 100, validationTimeoutMs: 300 },
    small: { maxBodyBytes: 256 },
    noKey: {},
    slowVerifier: { verifierTimeoutMs: 50 },
    badVerifier: {},
    capacity: { maxInFlight: 1 },
  };
  const verifierFor: Partial<Record<ServerKey, Verifier>> = {
    slowVerifier: { verify: () => new Promise(() => undefined) },
    badVerifier: { verify: () => Promise.resolve({ ok: true, principal: { id: "" } }) },
  };
  const limits = { ...DEFAULT_LIMITS, ...limitsFor[key] };
  const pool = new ValidationPool({ workers: limits.validationWorkers, timeoutMs: limits.validationTimeoutMs });
  const registry = pinForTest([...fixtureTools(), ...extraTools], pool.compile, limits);
  const t = await startTransport({
    registry,
    serverInfo: { name: "@clearseal/core", version: "0.0.0" },
    config: { limits },
    verifier: verifierFor[key] ?? new TestBearerVerifier(),
    ...(key === "noKey" ? {} : { requestStateKey: randomBytes(32) }),
    validationPool: pool,
  });
  return { t, close: () => t.close() };
}

const VERSION: Record<EraName, string> = { modern: "2026-07-28", legacy: "2025-11-25" };

/** A well-formed request on the given era, as a conforming client of that era sends it. */
function rpc(era: EraName, method: string, params: Record<string, unknown> = {}, o: { headers?: Record<string, string>; meta?: Record<string, unknown> | "omit"; id?: unknown } = {}): Req {
  const name = typeof params["name"] === "string" ? params["name"] : undefined;
  const headers = era === "modern" ? { ...modernHeaders(method, name), ...o.headers } : legacyHeaders({ "mcp-protocol-version": VERSION.legacy, ...o.headers });
  let body: Record<string, unknown>;
  if (o.meta === "omit") body = { ...params };
  else if (era === "modern") body = { ...params, _meta: { [PV]: VERSION.modern, "io.modelcontextprotocol/clientCapabilities": {}, ...o.meta } };
  else body = o.meta === undefined ? { ...params } : { ...params, _meta: o.meta };
  return { headers, body: JSON.stringify({ jsonrpc: "2.0", id: o.id === undefined ? ID : o.id, method, params: body }) };
}

/** The era's headers around an arbitrary body (framing faults). */
function framed(era: EraName, body: string | Buffer, extra: Record<string, string> = {}): Req {
  return { headers: era === "modern" ? { ...modernHeaders("tools/list"), ...extra } : legacyHeaders({ "mcp-protocol-version": VERSION.legacy, ...extra }), body };
}

function without(headers: Record<string, string | string[]>, name: string): Record<string, string | string[]> {
  return Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== name));
}

const call = (era: EraName, name: string, args: unknown = {}, extra: Record<string, unknown> = {}, o: { headers?: Record<string, string> } = {}): Req => rpc(era, "tools/call", { name, arguments: args, ...extra }, o);
const both = (e: Expect, legacyStatus = e[0]): { modern: Expect; legacy: Expect } => ({ modern: e, legacy: [legacyStatus, e[1]] });

const CASES: Case[] = [
  // HTTP-level refusals: the same status in both eras.
  { error: "Host not allowed", ...both([403, -32600]), build: (era) => ({ ...rpc(era, "tools/list"), headers: { ...rpc(era, "tools/list").headers, host: "evil.example" } }) },
  { error: "Origin not allowed", ...both([403, -32600]), build: (era) => rpc(era, "tools/list", {}, { headers: { origin: "https://evil.example" } }) },
  { error: "no bearer", ...both([401, -32600]), build: (era) => { const r = rpc(era, "tools/list"); return { ...r, headers: without(r.headers, "authorization") }; } },
  { error: "wrong bearer", ...both([401, -32600]), build: (era) => rpc(era, "tools/list", {}, { headers: { authorization: "Bearer wrong" } }) },
  { error: "Authorization sent twice", ...both([400, -32600]), build: (era) => { const r = rpc(era, "tools/list"); return { ...r, headers: { ...r.headers, authorization: [`Bearer ${BEARER}`, `Bearer ${BEARER}`] } }; } },
  { error: "verifier timeout", server: "slowVerifier", ...both([503, -32603]), build: (era) => rpc(era, "tools/list") },
  { error: "verifier ok without a principal", server: "badVerifier", ...both([500, -32603]), build: (era) => rpc(era, "tools/list") },
  { error: "at capacity (maxInFlight)", server: "capacity", ...both([503, -32603]), build: (era) => rpc(era, "tools/list") },
  { error: "GET on the endpoint", ...both([405, null]), build: (era) => ({ method: "GET", headers: rpc(era, "tools/list").headers }) },
  { error: "Accept without application/json", ...both([406, -32600]), build: (era) => rpc(era, "tools/list", {}, { headers: { accept: "text/event-stream" } }) },
  { error: "Content-Type not JSON", ...both([415, -32600]), build: (era) => rpc(era, "tools/list", {}, { headers: { "content-type": "text/plain" } }) },
  { error: "Content-Encoding", ...both([415, -32600]), build: (era) => rpc(era, "tools/list", {}, { headers: { "content-encoding": "gzip" } }) },
  { error: "Transfer-Encoding other than chunked", ...both([400, -32600]), build: (era) => ({ ...rpc(era, "tools/list", {}, { headers: { "transfer-encoding": "gzip, chunked" } }), chunked: true }) },
  { error: "body over maxBodyBytes", server: "small", ...both([413, -32600]), build: (era) => rpc(era, "tools/list", { pad: "x".repeat(300) }) },
  { error: "malformed JSON", ...both([400, -32700]), build: (era) => framed(era, '{"jsonrpc":"2.0",') },
  { error: "body not UTF-8", ...both([400, -32700]), build: (era) => framed(era, Buffer.from([0x7b, 0xff, 0x7d])) },
  { error: "duplicate key", ...both([400, -32700]), build: (era) => framed(era, `{"jsonrpc":"2.0","id":${String(ID)},"method":"tools/list","method":"ping"}`) },
  { error: "nested deeper than maxJsonDepth", ...both([400, -32600]), build: (era) => framed(era, `{"jsonrpc":"2.0","id":${String(ID)},"method":"tools/list","params":{"d":${"[".repeat(70)}${"]".repeat(70)}}}`) },
  { error: "batch", ...both([400, -32600]), build: (era) => framed(era, JSON.stringify([{ jsonrpc: "2.0", id: ID, method: "tools/list" }])) },
  { error: "body not an object", ...both([400, -32600]), build: (era) => framed(era, "42") },
  { error: "jsonrpc not 2.0", ...both([400, -32600]), build: (era) => framed(era, JSON.stringify({ jsonrpc: "1.0", id: ID, method: "tools/list" })) },
  { error: "a response with an id (WO §5.2)", ...both([400, -32600]), build: (era) => framed(era, JSON.stringify({ jsonrpc: "2.0", id: ID, result: {} })) },
  { error: "id null (WO §5.1)", ...both([400, -32600]), build: (era) => rpc(era, "tools/list", {}, { id: null }) },
  { error: "id not a string or integer", ...both([400, -32600]), build: (era) => rpc(era, "tools/list", {}, { id: 1.5 }) },
  { error: "member JSON-RPC does not define", ...both([400, -32600]), build: (era) => framed(era, JSON.stringify({ jsonrpc: "2.0", id: ID, method: "tools/list", extra: 1 })) },
  { error: "method missing", ...both([400, -32600]), build: (era) => framed(era, JSON.stringify({ jsonrpc: "2.0", id: ID })) },
  { error: "method empty", ...both([400, -32600]), build: (era) => framed(era, JSON.stringify({ jsonrpc: "2.0", id: ID, method: "" })) },
  { error: "params not an object", ...both([400, -32600]), build: (era) => framed(era, JSON.stringify({ jsonrpc: "2.0", id: ID, method: "tools/list", params: [] })) },
  { error: "notification not accepted", ...both([400, -32601]), build: (era) => framed(era, JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: {} })) },
  { error: "notifications/initialized with a disagreeing _meta version", modern: null, legacy: [400, -32020], build: (era) => framed(era, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: { _meta: { [PV]: VERSION.modern } } })) },
  { error: "MCP-Protocol-Version unsupported", ...both([400, -32022]), build: (era) => rpc(era, "tools/list", {}, { headers: { "mcp-protocol-version": "2099-01-01" } }) },
  { error: "MCP-Protocol-Version missing (not initialize)", ...both([400, -32020]), build: (era) => { const r = rpc(era, "tools/list"); return { ...r, headers: without(r.headers, "mcp-protocol-version") }; } },
  { error: "MCP-Protocol-Version sent twice", ...both([400, -32020]), build: (era) => { const r = rpc(era, "tools/list"); return { ...r, headers: { ...r.headers, "mcp-protocol-version": [VERSION[era], VERSION[era]] } }; } },
  { error: "_meta protocol version disagrees with the header", ...both([400, -32020]), build: (era) => rpc(era, "tools/list", {}, { meta: { [PV]: era === "modern" ? VERSION.legacy : VERSION.modern } }) },
  { error: "legacy initialize without the header, _meta naming another version", modern: null, legacy: [400, -32020], build: (era) => { const r = rpc(era, "initialize", { protocolVersion: VERSION.legacy, capabilities: {}, clientInfo: { name: "c", version: "0" } }, { meta: { [PV]: VERSION.modern } }); return { ...r, headers: without(r.headers, "mcp-protocol-version") }; } },
  { error: "Mcp-Method missing", modern: [400, -32020], legacy: null, build: (era) => { const r = rpc(era, "tools/list"); return { ...r, headers: without(r.headers, "mcp-method") }; } },
  { error: "Mcp-Method disagrees with the body", ...both([400, -32020]), build: (era) => rpc(era, "tools/list", {}, { headers: { "mcp-method": "tools/call" } }) },
  { error: "Mcp-Name disagrees with the body", ...both([400, -32020]), build: (era) => call(era, "echo", { text: "a" }, {}, { headers: { "mcp-name": "no_args" } }) },
  { error: "Mcp-Param-* disagrees with the arguments", ...both([400, -32020]), build: (era) => call(era, "region_query", { query: "q", region: "a" }, {}, { headers: { "mcp-param-region": "b" } }) },

  // JSON-RPC errors answering a well-formed request: the modern status, and 200 on the legacy era.
  { error: "unknown method", ...both([404, -32601], 200), build: (era) => rpc(era, "no/such-method") },
  { error: "ping on the modern era", modern: [404, -32601], legacy: null, build: (era) => rpc(era, "ping") },
  { error: "params._meta missing", modern: [400, -32602], legacy: null, build: (era) => rpc(era, "tools/list", {}, { meta: "omit" }) },
  { error: "params._meta not an object", ...both([400, -32602], 200), build: (era) => ({ ...rpc(era, "tools/list"), body: JSON.stringify({ jsonrpc: "2.0", id: ID, method: "tools/list", params: { _meta: 1 } }) }) },
  { error: "tools/list with a cursor", ...both([400, -32602], 200), build: (era) => rpc(era, "tools/list", { cursor: "c" }) },
  { error: "tools/call without params.name (modern: the Mcp-Name gate answers first)", modern: [400, -32020], legacy: [200, -32602], build: (era) => rpc(era, "tools/call", { arguments: {} }) },
  { error: "unknown tool", ...both([400, -32602], 200), build: (era) => call(era, "no_such_tool") },
  { error: "arguments not an object", ...both([400, -32602], 200), build: (era) => call(era, "echo", []) },
  { error: "arguments fail the input schema", ...both([400, -32602], 200), build: (era) => call(era, "echo", {}) },
  { error: "validation over validationTimeoutMs", server: "fast", ...both([400, -32602], 200), build: (era) => call(era, "costly_schema", { tags: Array.from({ length: 20_000 }, (_, i) => ({ k: i })) }) },
  { error: "handler throws", ...both([500, -32603], 200), build: (era) => call(era, "throws_refusal") },
  { error: "handler over handlerTimeoutMs", server: "fast", ...both([500, -32603], 200), build: (era) => call(era, "slow") },
  { error: "result over maxResultBytes", ...both([500, -32603], 200), build: (era) => call(era, "big", { size: 300_000 }) },
  { error: "tool returned no result", ...both([500, -32603], 200), build: (era) => call(era, "returns_nothing") },
  { error: "tool returned an unknown resultType", ...both([500, -32603], 200), build: (era) => call(era, "returns_task") },
  { error: "tool returned no content", ...both([500, -32603], 200), build: (era) => call(era, "returns_no_content") },
  { error: "result not serializable (ST-5: no id, so never 200)", ...both([500, -32603]), build: (era) => call(era, "returns_bigint") },
  { error: "input_required on the legacy era (LG-8)", modern: null, legacy: [200, -32601], build: (era) => call(era, "ask") },
  { error: "input request of an unknown kind", modern: [500, -32603], legacy: [200, -32601], build: (era) => call(era, "bad_input_kind") },
  { error: "input_required with nothing in it", modern: [500, -32603], legacy: [200, -32601], build: (era) => call(era, "empty_input") },
  { error: "input request needs an undeclared capability", modern: [400, -32021], legacy: [200, -32601], build: (era) => call(era, "needs_sampling") },
  { error: "requestState cannot be sealed (no key)", server: "noKey", modern: [500, -32603], legacy: [200, -32601], build: (era) => call(era, "ask_other") },
  { error: "inputResponses not an object of objects", modern: [400, -32602], legacy: null, build: (era) => call(era, "echo", { text: "a" }, { inputResponses: "x" }) },
  { error: "requestState refused", modern: [400, -32602], legacy: null, build: (era) => call(era, "ask", {}, { requestState: "not-a-state" }) },
];

interface Row {
  error: string;
  cells: Record<EraName, string>;
  bodies: Record<EraName, string>;
}

void describe("WO §3.3 every error × era × status (SPEC-MAP ST-1…ST-4)", () => {
  const servers = new Map<ServerKey, Promise<Server>>();
  const server = (key: ServerKey): Promise<Server> => {
    let s = servers.get(key);
    if (s === undefined) {
      s = startServer(key);
      servers.set(key, s);
    }
    return s;
  };
  const rows: Row[] = [];
  after(async () => {
    console.log("ERA-STATUS | # | Error | Code | 2026-07-28 | 2025-11-25 |");
    console.log("ERA-STATUS |---|---|---|---|---|");
    rows.forEach((r, i) => {
      const c = CASES[i];
      const code = (c?.modern ?? c?.legacy)?.[1];
      const legacyCode = c?.legacy?.[1];
      const codeCell = code === null || code === undefined ? "(no body)" : legacyCode !== undefined && legacyCode !== code ? `${String(code)} / ${String(legacyCode)}` : String(code);
      console.log(`ERA-STATUS | ${String(i + 1)} | ${r.error} | ${codeCell} | ${r.cells.modern} | ${r.cells.legacy} |`);
    });
    for (const r of rows) for (const era of ["modern", "legacy"] as const) console.log(`${era.toUpperCase()}-BODY ${JSON.stringify({ error: r.error, body: r.bodies[era] })}`);
    for (const s of servers.values()) await (await s).close();
  });

  const send = async (c: Case, era: EraName): Promise<Reply> => {
    const s = await server(c.server ?? "main");
    const req = c.build(era);
    if (c.server !== "capacity") return raw(s.t, req);
    // Hold the only slot with a call that waits on its gate, then send the row's request.
    const before = held.gates.length;
    const holding = raw(s.t, rpc("modern", "tools/call", { name: "hold", arguments: {} }));
    while (held.gates.length === before) await new Promise((r) => setTimeout(r, 5));
    try {
      return await raw(s.t, req);
    } finally {
      held.gates.at(-1)?.open();
      await holding;
    }
  };

  for (const c of CASES) {
    const row: Row = { error: c.error, cells: { modern: "—", legacy: "—" }, bodies: { modern: "", legacy: "" } };
    rows.push(row);
    void it(`ST ${c.error}`, async () => {
      for (const era of ["modern", "legacy"] as const) {
        const want = c[era];
        if (want === null) continue;
        const r = await send(c, era);
        const body = r.json as { id?: unknown; error?: { code?: unknown } } | undefined;
        const got: Expect = [r.status, body?.error?.code === undefined ? null : (body.error.code as number)];
        row.cells[era] = String(r.status);
        row.bodies[era] = r.text;
        assert.deepEqual(got, want, `${c.error} on ${era}: ${r.text.slice(0, 300)}`);
        if (want[1] !== null) assert.equal(r.headers["content-type"], "application/json", `${c.error} on ${era}: content type`);
        // A JSON-RPC error at 200 always answers a request: it carries that request's id.
        if (r.status === 200) assert.equal(body?.id, ID, `${c.error} on ${era}: a 200 carries the request id`);
      }
    });
  }
});
