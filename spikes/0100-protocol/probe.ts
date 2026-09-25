// CSR-WO-0100 spike probe: starts the spike server on loopback and MEASURES what the pinned SDK does.
// Prints one `FINDING` line per measurement, each naming the request or command that produced it,
// then a `RAW` section with the exchanges the work order asks to be pasted. Exits non-zero if the
// server does not start or a request cannot be made, so it never prints findings from a dead port.
//
//   node spikes/0100-protocol/probe.ts          (from the repository root, on the pinned Node)

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  DEFAULT_NEGOTIATED_PROTOCOL_VERSION,
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";

import { startServer, type SpikeServer } from "./server.ts";

const ACCEPT = "application/json, text/event-stream";
const ARCHITECTURE_TARGET = "2026-07-28";
const UNKNOWN_REVISION = "1999-01-01";

interface Exchange {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** One POST to the server; the Host header is whatever fetch sends unless overridden. */
async function post(port: number, body: string, headers: Record<string, string> = {}): Promise<Exchange> {
  const res = await fetch(`http://127.0.0.1:${String(port)}/`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: ACCEPT, ...headers },
    body,
  });
  const out: Record<string, string> = {};
  res.headers.forEach((v, k) => (out[k] = v));
  return { status: res.status, headers: out, body: await res.text() };
}

/** Raw HTTP/1.1 over a socket, for a Host header fetch will not let us set. */
async function rawPost(port: number, host: string, body: string, extra: Record<string, string> = {}): Promise<Exchange> {
  const { connect } = await import("node:net");
  const head = [
    "POST / HTTP/1.1",
    `Host: ${host}`,
    "Content-Type: application/json",
    `Accept: ${ACCEPT}`,
    `Content-Length: ${String(Buffer.byteLength(body))}`,
    "Connection: close",
    ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
    "",
    "",
  ].join("\r\n");
  const text = await new Promise<string>((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => socket.end(head + body));
    const chunks: Buffer[] = [];
    socket.on("data", (c: Buffer) => chunks.push(c));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", reject);
  });
  const [statusLine = "", ...rest] = text.split("\r\n");
  const blank = rest.indexOf("");
  const headers: Record<string, string> = {};
  for (const line of rest.slice(0, blank)) {
    const i = line.indexOf(":");
    headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
  }
  return { status: Number(statusLine.split(" ")[1]), headers, body: rest.slice(blank + 1).join("\r\n") };
}

/** The JSON-RPC payload of a response, whether sent as JSON or as one server-sent event. */
function payload(ex: Exchange): unknown {
  const data = ex.body.split("\n").find((l) => l.startsWith("data: "));
  try {
    return JSON.parse(data === undefined ? ex.body : data.slice(6)) as unknown;
  } catch {
    return undefined;
  }
}

/** A request whose response may be a stream that never ends: status, headers, what arrived in 1.5 s, and whether it was still open. */
async function boundedFetch(port: number, init: RequestInit): Promise<string> {
  const ac = new AbortController();
  const res = await fetch(`http://127.0.0.1:${String(port)}/`, { ...init, signal: ac.signal });
  const reader = res.body?.getReader();
  let got = "";
  let ended = false;
  const timer = setTimeout(() => ac.abort(), 1500);
  try {
    for (;;) {
      const chunk = await reader?.read();
      if (chunk === undefined || chunk.done) {
        ended = true;
        break;
      }
      got += Buffer.from(chunk.value).toString("utf8");
    }
  } catch {
    // aborted: the stream was still open after 1.5 s
  } finally {
    clearTimeout(timer);
  }
  const type = res.headers.get("content-type") ?? "-";
  return `HTTP ${String(res.status)} ${type}; ${ended ? "response ended" : "STREAM STILL OPEN after 1.5 s"}; body="${got.slice(0, 100).replaceAll("\n", "\\n")}"`;
}

const boundedGet = (port: number): Promise<string> => boundedFetch(port, { headers: { accept: "text/event-stream" } });

function initialize(version: string, id = 1): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: { protocolVersion: version, capabilities: {}, clientInfo: { name: "probe", version: "0" } },
  });
}

const request = (method: string, id = 2, params: unknown = {}): string => JSON.stringify({ jsonrpc: "2.0", id, method, params });

function summary(ex: Exchange): string {
  const p = payload(ex) as { result?: { protocolVersion?: string }; error?: { code?: number; message?: string } } | undefined;
  const shape = p?.result !== undefined ? `result${p.result.protocolVersion ? ` protocolVersion=${p.result.protocolVersion}` : ""}` : p?.error !== undefined ? `error code=${String(p.error.code)} message="${p.error.message ?? ""}"` : `body="${ex.body.slice(0, 120)}"`;
  return `HTTP ${String(ex.status)} ${ex.headers["content-type"] ?? "-"}; ${shape}`;
}

let n = 0;
function finding(id: string, value: string, how: string): void {
  n++;
  console.log(`FINDING ${id} | ${value} | ${how}`);
}
const raw: string[] = [];
function keepRaw(title: string, req: string, ex: Exchange): void {
  const hdrs = Object.entries(ex.headers)
    .filter(([k]) => !["date", "connection", "keep-alive", "transfer-encoding"].includes(k))
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  raw.push(`--- ${title}\n>>> ${req}\n<<< HTTP ${String(ex.status)}\n${hdrs}\n\n${ex.body.trim()}\n`);
}

async function main(): Promise<void> {
  const sdkVersion = (JSON.parse(readFileSync("node_modules/@modelcontextprotocol/sdk/package.json", "utf8")) as { version: string }).version;
  finding("sdk.version", sdkVersion, "node_modules/@modelcontextprotocol/sdk/package.json");
  finding("node.version", process.version, "process.version");
  finding("sdk.LATEST_PROTOCOL_VERSION", LATEST_PROTOCOL_VERSION, "import from @modelcontextprotocol/sdk/types.js");
  finding("sdk.SUPPORTED_PROTOCOL_VERSIONS", SUPPORTED_PROTOCOL_VERSIONS.join(","), "import from @modelcontextprotocol/sdk/types.js");
  finding("sdk.DEFAULT_NEGOTIATED_PROTOCOL_VERSION", DEFAULT_NEGOTIATED_PROTOCOL_VERSION, "import from @modelcontextprotocol/sdk/types.js");

  let open: SpikeServer;
  let guarded: SpikeServer;
  try {
    open = await startServer({ dnsRebindingProtection: false });
    guarded = await startServer({ dnsRebindingProtection: true });
  } catch (err) {
    console.error(`probe: FAIL — the spike server did not start: ${String(err)}`);
    process.exit(1);
  }
  const P = open.port;
  const init = await post(P, initialize(LATEST_PROTOCOL_VERSION)).catch((err: unknown) => {
    console.error(`probe: FAIL — no response from the spike server on loopback: ${String(err)}`);
    process.exit(1);
  });

  // 1. Revision negotiation on initialize.
  keepRaw(`initialize offering LATEST (${LATEST_PROTOCOL_VERSION})`, `POST / ${initialize(LATEST_PROTOCOL_VERSION)}`, init);
  finding("initialize.offer." + LATEST_PROTOCOL_VERSION, summary(init), `POST / initialize protocolVersion=${LATEST_PROTOCOL_VERSION}`);
  for (const v of [...SUPPORTED_PROTOCOL_VERSIONS.slice(1), ARCHITECTURE_TARGET, UNKNOWN_REVISION]) {
    const ex = await post(P, initialize(v));
    finding("initialize.offer." + v, summary(ex), `POST / initialize protocolVersion=${v}`);
    if (v === ARCHITECTURE_TARGET) keepRaw(`initialize offering the architecture's target revision (${v})`, `POST / ${initialize(v)}`, ex);
    if (v === UNKNOWN_REVISION) keepRaw(`initialize offering an unknown revision (${v})`, `POST / ${initialize(v)}`, ex);
  }

  // 2. MCP-Protocol-Version header on a post-initialize request (stateless: any request after initialize).
  for (const [label, hdr] of [
    ["absent", {}],
    ["matching", { "mcp-protocol-version": LATEST_PROTOCOL_VERSION }],
    ["architecture-target", { "mcp-protocol-version": ARCHITECTURE_TARGET }],
    ["unknown", { "mcp-protocol-version": UNKNOWN_REVISION }],
  ] as const) {
    const ex = await post(P, request("tools/list"), hdr);
    finding(`header.mcp-protocol-version.${label}`, summary(ex), `POST / tools/list with MCP-Protocol-Version ${label === "absent" ? "absent" : `= ${Object.values(hdr)[0] ?? ""}`}`);
  }

  // 3. server/discover.
  for (const [label, hdr] of [
    ["no-version-header", {}],
    ["version-header-target", { "mcp-protocol-version": ARCHITECTURE_TARGET }],
  ] as const) {
    const ex = await post(P, request("server/discover"), hdr);
    finding(`server/discover.${label}`, summary(ex), `POST / server/discover${label === "no-version-header" ? "" : ` with MCP-Protocol-Version ${ARCHITECTURE_TARGET}`}`);
    if (label === "no-version-header") keepRaw("server/discover", `POST / ${request("server/discover")}`, ex);
  }

  // 4. Origin and Host, with the SDK's DNS-rebinding option off (default) and on.
  for (const [mode, s] of [
    ["protection-off(default)", open],
    ["protection-on", guarded],
  ] as const) {
    const foreignOrigin = await rawPost(s.port, `127.0.0.1:${String(s.port)}`, initialize(LATEST_PROTOCOL_VERSION), { Origin: "http://evil.example" });
    finding(`origin.foreign.${mode}`, summary(foreignOrigin), "raw POST initialize, Host loopback, Origin: http://evil.example");
    keepRaw(`Origin foreign, ${mode}`, "POST / initialize; Host: 127.0.0.1:<port>; Origin: http://evil.example", foreignOrigin);
    const foreignHost = await rawPost(s.port, "evil.example", initialize(LATEST_PROTOCOL_VERSION));
    finding(`host.non-loopback.${mode}`, summary(foreignHost), "raw POST initialize, Host: evil.example, no Origin");
    keepRaw(`Host non-loopback, ${mode}`, "POST / initialize; Host: evil.example; no Origin", foreignHost);
  }

  // 5. Session behaviour when stateless.
  finding("session.header-on-initialize", init.headers["mcp-session-id"] ?? "absent", "POST / initialize: response header mcp-session-id");
  const withSession = await post(P, request("tools/list"), { "mcp-session-id": "client-invented-session", "mcp-protocol-version": LATEST_PROTOCOL_VERSION });
  finding("session.client-supplied-id", `${summary(withSession)}; response mcp-session-id=${withSession.headers["mcp-session-id"] ?? "absent"}`, "POST / tools/list with mcp-session-id: client-invented-session");
  finding("session.GET-stream", await boundedGet(P), "GET / Accept: text/event-stream (read for 1.5 s, then aborted)");
  finding("session.DELETE", await boundedFetch(P, { method: "DELETE" }), "DELETE / (read for 1.5 s, then aborted)");

  // 6. Body size and concurrency limits.
  const big = JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "echo", arguments: { text: "x".repeat(10 * 1024 * 1024) } } });
  const t0 = performance.now();
  const bigEx = await post(P, big, { "mcp-protocol-version": LATEST_PROTOCOL_VERSION });
  finding("limit.body-10MB", `${summary(bigEx)}; ${String(Math.round(performance.now() - t0))} ms; response ${String(bigEx.body.length)} bytes`, "POST / tools/call echo with a 10 MB string argument");
  const t1 = performance.now();
  const many = await Promise.allSettled(Array.from({ length: 200 }, (_, i) => post(P, initialize(LATEST_PROTOCOL_VERSION, i))));
  const counts = new Map<string, number>();
  for (const r of many) {
    const k = r.status === "fulfilled" ? `HTTP ${String(r.value.status)}` : `rejected ${String((r.reason as Error).message)}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  finding("limit.concurrency-200", `${[...counts].map(([k, v]) => `${k} ×${String(v)}`).join(", ")}; ${String(Math.round(performance.now() - t1))} ms`, "200 concurrent POST / initialize");

  // 7. Malformed input (§5.3).
  const bad = await post(P, "{not json", { "mcp-protocol-version": LATEST_PROTOCOL_VERSION });
  finding("error.malformed-json", summary(bad), "POST / body `{not json`");
  keepRaw("malformed JSON", "POST / {not json", bad);
  const unknownMethod = await post(P, request("no/such/method"), { "mcp-protocol-version": LATEST_PROTOCOL_VERSION });
  finding("error.unknown-method", summary(unknownMethod), "POST / method no/such/method");
  keepRaw("unknown method", `POST / ${request("no/such/method")}`, unknownMethod);

  await open.close();
  await guarded.close();

  // 8. The dependency tree the SDK brings.
  const ls = execFileSync("npm", ["ls", "--all", "--workspace", "@clearseal/spike-0100-protocol", "--parseable"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  finding("deps.npm-ls-all", `${String(ls.length - 1)} package paths under the spike (npm ls --all --parseable, minus the workspace itself)`, "npm ls --all --workspace @clearseal/spike-0100-protocol --parseable");
  const sdkPkg = JSON.parse(readFileSync("node_modules/@modelcontextprotocol/sdk/package.json", "utf8")) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
  finding("deps.sdk-direct", Object.keys(sdkPkg.dependencies ?? {}).sort().join(","), "node_modules/@modelcontextprotocol/sdk/package.json dependencies");
  finding("deps.sdk-peer", Object.keys(sdkPkg.peerDependencies ?? {}).sort().join(",") || "none", "node_modules/@modelcontextprotocol/sdk/package.json peerDependencies");
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as { packages: Record<string, { hasInstallScript?: boolean }> };
  const scripted = Object.entries(lock.packages).filter(([, v]) => v.hasInstallScript === true).map(([k]) => k);
  finding("deps.install-scripts", `${String(scripted.length)}${scripted.length > 0 ? ` (${scripted.join(",")})` : ""}`, "package-lock.json entries with hasInstallScript: true (ignore-scripts=true suppresses them)");

  console.log(`\nprobe: ${String(n)} findings\n\n=== RAW EXCHANGES ===\n${raw.join("\n")}`);
}

await main();
