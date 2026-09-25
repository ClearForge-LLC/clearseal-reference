// CSR-WO-0100 spike probe: starts the spike server on loopback and MEASURES what the pinned SDK does.
// Every finding line is `FINDING [wire|static] <id> | <value> | <how>`: [wire] values come from an
// HTTP exchange with the running server, [static] ones from the installed package or lockfile.
// Timings are separate `timing.*` lines so a diff of two runs shows only real changes. A `RAW`
// section follows with the exchanges the work order asks to be pasted. Findings are buffered and
// printed only when every measurement succeeded: a server that does not start, or a request that
// cannot be made, exits non-zero and prints no findings at all.
//
//   node spikes/0100-protocol/probe.ts     (any working directory; the pinned Node strips types)

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_NEGOTIATED_PROTOCOL_VERSION,
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";

import { startServer, type SpikeServer } from "./server.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ACCEPT = "application/json, text/event-stream";
const ARCHITECTURE_TARGET = "2026-07-28";
const UNKNOWN_REVISION = "1999-01-01";

interface Exchange {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Ephemeral ports differ on every run; a value that quotes one is normalised so runs compare. */
const noPort = (text: string): string => text.replace(/(localhost|127\.0\.0\.1):\d+/g, "$1:<port>");

const lines: string[] = [];
const raw: string[] = [];
function finding(kind: "wire" | "static", id: string, value: string, how: string): void {
  lines.push(noPort(`FINDING [${kind}] ${id} | ${value} | ${how}`));
}
function timing(id: string, ms: number, how: string): void {
  lines.push(`TIMING ${id} | ${String(Math.round(ms))} ms | ${how}`);
}
function keepRaw(title: string, req: string, ex: Exchange): void {
  const hdrs = Object.entries(ex.headers)
    .filter(([k]) => !["date", "connection", "keep-alive", "transfer-encoding"].includes(k))
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  raw.push(noPort(`--- ${title}\n>>> ${req}\n<<< HTTP ${String(ex.status)}\n${hdrs}\n\n${ex.body.trim()}\n`));
}

/** The installed SDK's own package.json, found from the module this probe actually imports. */
function sdkPackageJson(): { version: string; dependencies?: Record<string, string>; peerDependencies?: Record<string, string> } {
  let dir = path.dirname(fileURLToPath(import.meta.resolve("@modelcontextprotocol/sdk/types.js")));
  for (;;) {
    const candidate = path.join(dir, "package.json");
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string; version: string };
      if (pkg.name === "@modelcontextprotocol/sdk") return pkg;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("the imported SDK's package.json was not found");
    dir = parent;
  }
}

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

/** Raw HTTP/1.1 over a socket: for a Host header fetch will not set, or a chunked body. */
async function rawPost(
  port: number,
  host: string,
  body: string,
  extra: Record<string, string> = {},
  chunked = false,
): Promise<Exchange> {
  const head = [
    "POST / HTTP/1.1",
    `Host: ${host}`,
    "Content-Type: application/json",
    `Accept: ${ACCEPT}`,
    chunked ? "Transfer-Encoding: chunked" : `Content-Length: ${String(Buffer.byteLength(body))}`,
    "Connection: close",
    ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
    "",
    "",
  ].join("\r\n");
  const payloadBytes = chunked ? `${Buffer.byteLength(body).toString(16)}\r\n${body}\r\n0\r\n\r\n` : body;
  const text = await new Promise<string>((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => socket.end(head + payloadBytes));
    const chunks: Buffer[] = [];
    socket.on("data", (c: Buffer) => chunks.push(c));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", (err) => (chunks.length > 0 ? resolve(Buffer.concat(chunks).toString("utf8")) : reject(err)));
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

/** Status, headers, what arrived in 1.5 s, and whether the response was still open (a stream may never end). */
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
    // aborted: still open after 1.5 s
  } finally {
    clearTimeout(timer);
  }
  return `HTTP ${String(res.status)} ${res.headers.get("content-type") ?? "-"}; ${ended ? "response ended" : "STREAM STILL OPEN after 1.5 s"}; body="${got.slice(0, 100)}"`;
}

/** Every JSON-RPC message in a response, whether sent as JSON or as server-sent events. */
function messages(ex: Exchange): unknown[] {
  const events = ex.body.split("\n").filter((l) => l.startsWith("data: "));
  const texts = events.length > 0 ? events.map((l) => l.slice(6)) : [ex.body];
  return texts.flatMap((t) => {
    try {
      const v = JSON.parse(t) as unknown;
      return Array.isArray(v) ? (v as unknown[]) : [v];
    } catch {
      return [];
    }
  });
}

function summary(ex: Exchange): string {
  const shapes = messages(ex).map((m) => {
    const p = m as { result?: { protocolVersion?: string }; error?: { code?: number; message?: string } };
    if (p.result !== undefined) return `result${p.result.protocolVersion ? ` protocolVersion=${p.result.protocolVersion}` : ""}`;
    if (p.error !== undefined) return `error code=${String(p.error.code)} message="${p.error.message ?? ""}"`;
    return "unrecognised message";
  });
  const body = shapes.length > 0 ? shapes.join(" + ") : ex.body.length === 0 ? "empty body" : `body="${ex.body.slice(0, 120)}"`;
  return `HTTP ${String(ex.status)} ${ex.headers["content-type"] ?? "-"}; ${body}`;
}

function initialize(version: string, id = 1): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: { protocolVersion: version, capabilities: {}, clientInfo: { name: "probe", version: "0" } },
  });
}
const request = (method: string, id = 2, params: unknown = {}): string => JSON.stringify({ jsonrpc: "2.0", id, method, params });
const V = { "mcp-protocol-version": LATEST_PROTOCOL_VERSION };

async function measure(open: SpikeServer, guarded: SpikeServer): Promise<void> {
  const P = open.port;

  // Static: what the installed package and lockfile say.
  const sdk = sdkPackageJson();
  finding("static", "sdk.version", sdk.version, "package.json of the SDK module this probe imports");
  finding("static", "node.version", process.version, "process.version");
  finding("static", "sdk.LATEST_PROTOCOL_VERSION", LATEST_PROTOCOL_VERSION, "import from @modelcontextprotocol/sdk/types.js");
  finding("static", "sdk.SUPPORTED_PROTOCOL_VERSIONS", SUPPORTED_PROTOCOL_VERSIONS.join(","), "import from @modelcontextprotocol/sdk/types.js");
  finding("static", "sdk.DEFAULT_NEGOTIATED_PROTOCOL_VERSION", DEFAULT_NEGOTIATED_PROTOCOL_VERSION, "import from @modelcontextprotocol/sdk/types.js (used when a request carries no MCP-Protocol-Version header)");

  // 1. Revision negotiation on initialize.
  for (const v of [...SUPPORTED_PROTOCOL_VERSIONS, ARCHITECTURE_TARGET, UNKNOWN_REVISION]) {
    const ex = await post(P, initialize(v));
    finding("wire", `initialize.offer.${v}`, summary(ex), `POST / initialize protocolVersion=${v}`);
    if (v === LATEST_PROTOCOL_VERSION) keepRaw(`initialize offering LATEST (${v})`, `POST / ${initialize(v)}`, ex);
    if (v === ARCHITECTURE_TARGET) keepRaw(`initialize offering the architecture's target revision (${v}): counter-offered, not refused`, `POST / ${initialize(v)}`, ex);
  }

  // 2. MCP-Protocol-Version header on a post-initialize request.
  for (const [label, hdr] of [
    ["absent", {}],
    ["matching", V],
    ["architecture-target", { "mcp-protocol-version": ARCHITECTURE_TARGET }],
    ["unknown", { "mcp-protocol-version": UNKNOWN_REVISION }],
  ] as const) {
    const ex = await post(P, request("tools/list"), hdr);
    finding("wire", `header.mcp-protocol-version.${label}`, summary(ex), `POST / tools/list, MCP-Protocol-Version ${label === "absent" ? "absent" : `= ${Object.values(hdr)[0] ?? ""}`}`);
    if (label === "architecture-target") {
      keepRaw(`refusal: post-initialize request with MCP-Protocol-Version ${ARCHITECTURE_TARGET}`, `POST / ${request("tools/list")}; MCP-Protocol-Version: ${ARCHITECTURE_TARGET}`, ex);
    }
  }

  // 3. server/discover (and, separately, that the header gate runs before any method dispatch).
  const discover = await post(P, request("server/discover"));
  finding("wire", "server/discover", summary(discover), "POST / server/discover, no MCP-Protocol-Version header");
  keepRaw("server/discover", `POST / ${request("server/discover")}`, discover);
  const discoverV = await post(P, request("server/discover"), V);
  finding("wire", "server/discover.with-latest-header", summary(discoverV), `POST / server/discover, MCP-Protocol-Version = ${LATEST_PROTOCOL_VERSION}`);
  const gated = await post(P, request("server/discover"), { "mcp-protocol-version": ARCHITECTURE_TARGET });
  finding("wire", "header-gate.before-dispatch", summary(gated), `POST / server/discover, MCP-Protocol-Version = ${ARCHITECTURE_TARGET} (the header check answers before the method is looked up)`);

  // 4. Origin and Host, with the SDK's DNS-rebinding option off (default) and on, plus positive controls.
  for (const [mode, s] of [
    ["protection-off(default)", open],
    ["protection-on", guarded],
  ] as const) {
    const host = `127.0.0.1:${String(s.port)}`;
    const cases: [string, string, Record<string, string>, string][] = [
      ["origin.foreign", host, { Origin: "http://evil.example" }, "Host loopback, Origin: http://evil.example"],
      ["host.non-loopback", "evil.example", {}, "Host: evil.example, no Origin"],
      ["control.loopback-no-origin", host, {}, "Host 127.0.0.1:<port>, no Origin"],
      ["control.matching-origin", host, { Origin: `http://${host}` }, "Host 127.0.0.1:<port>, Origin http://127.0.0.1:<port>"],
      ["host.localhost", `localhost:${String(s.port)}`, {}, "Host localhost:<port>, no Origin"],
    ];
    for (const [id, h, extra, how] of cases) {
      const ex = await rawPost(s.port, h, initialize(LATEST_PROTOCOL_VERSION), extra);
      finding("wire", `${id}.${mode}`, summary(ex), `raw POST initialize, ${how}`);
      if (id === "origin.foreign" || id === "host.non-loopback") keepRaw(`${id}, ${mode}`, `POST / initialize; ${how}`, ex);
    }
  }

  // 5. Session behaviour when stateless.
  const init = await post(P, initialize(LATEST_PROTOCOL_VERSION));
  finding("wire", "session.header-on-initialize", init.headers["mcp-session-id"] ?? "absent", "POST / initialize: response header mcp-session-id");
  const withSession = await post(P, request("tools/list"), { ...V, "mcp-session-id": "client-invented-session" });
  finding("wire", "session.client-supplied-id", `${summary(withSession)}; response mcp-session-id=${withSession.headers["mcp-session-id"] ?? "absent"}`, "POST / tools/list with mcp-session-id: client-invented-session");
  finding("wire", "session.GET-stream", await boundedFetch(P, { headers: { accept: "text/event-stream" } }), "GET / Accept: text/event-stream (read 1.5 s, then aborted)");
  finding("wire", "session.DELETE", await boundedFetch(P, { method: "DELETE" }), "DELETE / (read 1.5 s, then aborted)");

  // 6. Body size and concurrency.
  const big = JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "echo", arguments: { text: "x".repeat(10 * 1024 * 1024) } } });
  let t = performance.now();
  const declared = await post(P, big, V);
  timing("limit.body-10MB.declared", performance.now() - t, "as below");
  finding("wire", "limit.body-10MB.declared-length", `${summary(declared)}; response ${String(declared.body.length)} bytes`, `POST / tools/call echo, ${String(Buffer.byteLength(big))}-byte body with Content-Length`);
  t = performance.now();
  const chunked = await rawPost(P, `127.0.0.1:${String(P)}`, big, V, true);
  timing("limit.body-10MB.chunked", performance.now() - t, "as below");
  finding("wire", "limit.body-10MB.chunked", summary(chunked), `raw POST tools/call echo, the same ${String(Buffer.byteLength(big))} bytes chunked, no Content-Length`);
  t = performance.now();
  const many = await Promise.allSettled(Array.from({ length: 200 }, (_, i) => post(P, initialize(LATEST_PROTOCOL_VERSION, i))));
  timing("limit.connections-200", performance.now() - t, "as below");
  const tally = (rs: PromiseSettledResult<Exchange>[]): string => {
    const counts = new Map<string, number>();
    for (const r of rs) {
      const k = r.status === "fulfilled" ? `HTTP ${String(r.value.status)}` : `rejected ${(r.reason as Error).message}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts].map(([k, v]) => `${k} ×${String(v)}`).join(", ");
  };
  finding("wire", "limit.connections-200", `${tally(many)}; server peak in flight ${String(open.peakInFlight())}`, "200 simultaneous POST / initialize");
  t = performance.now();
  const slow = await Promise.allSettled(
    Array.from({ length: 200 }, (_, i) => post(P, request("tools/call", 1000 + i, { name: "sleep", arguments: { ms: 500 } }), V)),
  );
  timing("limit.concurrency-200-overlapping", performance.now() - t, "as below");
  finding("wire", "limit.concurrency-200-overlapping", `${tally(slow)}; server peak in flight ${String(open.peakInFlight())}`, "200 simultaneous POST / tools/call sleep 500 ms (requests genuinely overlap)");

  // 7. Error and input shapes (§5.3): the baseline P1's fail-closed behaviour must not be looser than.
  const shapes: [string, string, Record<string, string>, string][] = [
    ["error.malformed-json", "{not json", V, "body `{not json`"],
    ["error.unknown-method", request("no/such/method"), V, "method no/such/method"],
    ["error.missing-jsonrpc", JSON.stringify({ id: 3, method: "tools/list" }), V, "request without the jsonrpc member"],
    ["input.notification-unknown-method", JSON.stringify({ jsonrpc: "2.0", method: "no/such/notification" }), V, "notification (no id) for an unknown method"],
    ["input.batch-of-2", `[${request("tools/list", 4)},${request("tools/list", 5)}]`, V, "JSON-RPC batch of two tools/list"],
    ["input.batch-empty", "[]", V, "empty batch []"],
    ["input.batch-of-101", `[${Array.from({ length: 101 }, (_, i) => request("tools/list", 100 + i)).join(",")}]`, V, "batch of 101 tools/list"],
    ["input.empty-body", "", V, "empty body"],
  ];
  for (const [id, body, hdr, how] of shapes) {
    const ex = await post(P, body, hdr);
    finding("wire", id, summary(ex), `POST / ${how}`);
    if (id === "error.malformed-json" || id === "error.unknown-method") keepRaw(id, `POST / ${body}`, ex);
  }
  const textPlain = await post(P, request("tools/list"), { ...V, "content-type": "text/plain" });
  finding("wire", "input.content-type-text-plain", summary(textPlain), "POST / tools/list, Content-Type: text/plain");
  const noAccept = await post(P, request("tools/list"), { ...V, accept: "application/json" });
  finding("wire", "input.accept-json-only", summary(noAccept), "POST / tools/list, Accept: application/json (no text/event-stream)");

  // 8. The dependency tree the spike's SDK brings, and install scripts in that tree only.
  const parseable = execFileSync("npm", ["ls", "--all", "--workspace", "@clearseal/spike-0100-protocol", "--parseable"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const installPaths = parseable.slice(2); // [0] is the root project, [1] the workspace link
  const distinct = new Set(
    installPaths.map((p) => {
      const pkg = JSON.parse(readFileSync(path.join(p, "package.json"), "utf8")) as { name: string; version: string };
      return `${pkg.name}@${pkg.version}`;
    }),
  );
  const treeLines = execFileSync("npm", ["ls", "--all", "--workspace", "@clearseal/spike-0100-protocol"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean).length;
  finding("static", "deps.install-paths", String(installPaths.length), "npm ls --all --workspace @clearseal/spike-0100-protocol --parseable, minus the root and the workspace link");
  finding("static", "deps.distinct-name-at-version", String(distinct.size), "the same paths, de-duplicated by name and version from each package.json");
  finding("static", "deps.tree-lines", String(treeLines), "npm ls --all --workspace @clearseal/spike-0100-protocol | wc -l (non-blank; includes deduped and unmet-optional lines)");
  finding("static", "deps.sdk-direct", Object.keys(sdk.dependencies ?? {}).sort().join(","), "dependencies in the SDK's package.json");
  finding("static", "deps.sdk-peer", Object.keys(sdk.peerDependencies ?? {}).sort().join(",") || "none", "peerDependencies in the SDK's package.json");
  const lock = JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8")) as { packages: Record<string, { hasInstallScript?: boolean }> };
  const rel = new Set(installPaths.map((p) => path.relative(ROOT, p).split(path.sep).join("/")));
  const scripted = Object.entries(lock.packages).filter(([k, v]) => rel.has(k) && v.hasInstallScript === true).map(([k]) => k);
  finding("static", "deps.install-scripts", `${String(scripted.length)}${scripted.length > 0 ? ` (${scripted.join(",")})` : ""}`, "package-lock.json hasInstallScript, restricted to the spike's install paths (ignore-scripts=true would suppress them)");
}

async function main(): Promise<void> {
  let open: SpikeServer | undefined;
  let guarded: SpikeServer | undefined;
  try {
    open = await startServer({ dnsRebindingProtection: false });
    guarded = await startServer({ dnsRebindingProtection: true });
    await measure(open, guarded);
  } catch (err) {
    console.error(`probe: FAIL — ${err instanceof Error ? err.message : String(err)} (no findings printed)`);
    process.exitCode = 1;
    return;
  } finally {
    await open?.close();
    await guarded?.close();
  }
  console.log(`${lines.join("\n")}\n\nprobe: ${String(lines.filter((l) => l.startsWith("FINDING")).length)} findings\n\n=== RAW EXCHANGES ===\n${raw.join("\n")}`);
}

await main();
