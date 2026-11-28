// CSR-WO-2010: the official v2 client (@modelcontextprotocol/client, pinned in this spike's
// package.json) against a real teaching node, started through the core's startNodeFromEnv with the
// local test issuer, and against the conformance fixture server for the MRTR round trip (the teaching
// edition has no input_required tool). Every HTTP exchange is recorded verbatim, through a fetch
// wrapper, into results/probe.json. Nothing here changes what it measures.
//
//   node probe.ts            (after `npm install` in this directory; starts the fixture server on
//                             FIXTURE_PORT, default 3999)

import { writeFileSync, mkdirSync } from "node:fs";

import { startFixture } from "./fixture.ts";
import { AUDIENCE, cleanup, definitionsFor, notesRoot, pin, restoreEnv, startNode, TestIssuer } from "../../packages/teaching/test/node.ts";

/** The slice of the client this probe uses, declared here: the spike is not a workspace, so the
 *  repository's lint runs without its node_modules and cannot resolve the SDK's own types. */
interface ClientLike {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
  getNegotiatedProtocolVersion(): string | undefined;
  getServerVersion(): unknown;
  discover(): Promise<unknown>;
  listTools(params?: unknown, options?: unknown): Promise<unknown>;
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
  setRequestHandler(method: string, handler: () => Promise<unknown>): void;
}
type Sdk = {
  Client: new (info: { name: string; version: string }, options: Record<string, unknown>) => ClientLike;
  StreamableHTTPClientTransport: new (url: URL, options: Record<string, unknown>) => unknown;
};
const SDK_MODULE = "@modelcontextprotocol/client";
const { Client, StreamableHTTPClientTransport } = (await import(SDK_MODULE)) as Sdk;

type Exchange = { probe: string; request: { method: string; url: string; headers: Record<string, string>; body?: unknown }; response?: { status: number; headers: Record<string, string>; body: string }; error?: string };
const exchanges: Exchange[] = [];
const outcomes: Record<string, unknown> = {};
let current = "";

const headersOf = (h: HeadersInit | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  new Headers(h).forEach((v, k) => {
    out[k] = k === "authorization" ? v.replace(/^(Bearer) .+$/i, "$1 <test-issuer token>") : v;
  });
  return out;
};

/** Where the node's own advertised origin (AUDIENCE's) is actually served: set once the node starts. */
let nodeOrigin = "";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const ISSUER = "https://issuer.example.invalid";
let asMetadata = false;

/** A fetch that records every exchange the client makes, request and response, verbatim. Nothing
 *  leaves the machine: a request to the node's advertised origin goes to the node on loopback, and
 *  any other non-loopback host is recorded and refused without a network call (WO §7). */
const recordingFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const target = new URL(url);
  if (target.origin === new URL(AUDIENCE).origin && nodeOrigin !== "") input = `${nodeOrigin}${target.pathname}${target.search}`;
  else if (target.href === `${ISSUER}/.well-known/oauth-authorization-server` && asMetadata) {
    // The test issuer serves only a key set. For the one probe that asks, the probe answers the
    // issuer's authorization-server metadata itself, so the flow reaches the authorization request.
    const res = Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, response_types_supported: ["code"], code_challenge_methods_supported: ["S256"], authorization_response_iss_parameter_supported: true });
    exchanges.push({ probe: current, request: { method: init?.method ?? "GET", url, headers: headersOf(init?.headers) }, response: { status: 200, headers: { "content-type": "application/json", "x-probe": "answered by the probe for the local test issuer" }, body: await res.clone().text() } });
    return res;
  } else if (!LOOPBACK.has(target.hostname)) {
    exchanges.push({ probe: current, request: { method: init?.method ?? "GET", url, headers: headersOf(init?.headers) }, error: "refused by the probe: not a local host" });
    throw new TypeError(`probe refused a non-local host: ${target.host}`);
  }
  let body: unknown;
  if (typeof init?.body === "string") {
    try {
      body = JSON.parse(init.body);
    } catch {
      body = init.body;
    }
  }
  const ex: Exchange = { probe: current, request: { method: init?.method ?? "GET", url, headers: headersOf(init?.headers), ...(body === undefined ? {} : { body }) } };
  exchanges.push(ex);
  try {
    const res = await fetch(input, init);
    const text = await res.clone().text();
    ex.response = { status: res.status, headers: headersOf(res.headers), body: text.length > 4000 ? `${text.slice(0, 4000)}…` : text };
    return res;
  } catch (err) {
    ex.error = String(err);
    throw err;
  }
};

async function step(name: string, run: () => Promise<unknown>): Promise<void> {
  current = name;
  try {
    outcomes[name] = { ok: true, value: await run() };
  } catch (err) {
    outcomes[name] = { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err), data: (err as { data?: unknown } | null)?.data };
  }
  console.log(`PROBE ${name}: ${JSON.stringify(outcomes[name]).slice(0, 300)}`);
}

const now = (): number => Math.floor(Date.now() / 1000);

const issuer = await TestIssuer.start();
const root = notesRoot();
writeFileSync(`${root}/today.md`, "a note for the interop spike\n");
const manifest = pin(definitionsFor(root), root);
const node = await startNode(issuer, root, manifest);
// The core's types come from its build, which CI's lint runs before: read the port as the probe uses it.
const { port } = node.t as unknown as { port: number };
nodeOrigin = `http://127.0.0.1:${String(port)}`;
const url = new URL(`${nodeOrigin}/mcp`);

type Mode = "legacy" | "auto" | { pin: string };
const MODERN: Mode = { pin: "2026-07-28" };

const connect = async (opts: { token?: () => string | undefined; mode?: Mode; authProvider?: unknown; at?: URL } = {}): Promise<ClientLike> => {
  const transport = new StreamableHTTPClientTransport(opts.at ?? url, {
    fetch: recordingFetch,
    ...(opts.token === undefined ? {} : { authProvider: { token: () => Promise.resolve(opts.token?.()) } }),
    ...(opts.authProvider === undefined ? {} : { authProvider: opts.authProvider }),
  });
  // The client's own default is 'legacy' (no server/discover probe): each probe names its mode.
  const client = new Client({ name: "clearseal-interop-spike", version: "0.0.0" }, { capabilities: {}, versionNegotiation: { mode: opts.mode ?? MODERN } });
  await client.connect(transport);
  return client;
};

try {
  // §0.1 the modern era, with a valid token.
  const good = (): string => issuer.mint(TestIssuer.claims(now()));
  let client: ClientLike | undefined;
  await step("0.1 connect, mode auto (what the client concludes from our server/discover)", async () => {
    const auto = await connect({ token: good, mode: "auto" });
    const out = { negotiated: auto.getNegotiatedProtocolVersion() };
    await auto.close();
    return out;
  });
  await step("0.1 connect, pinned to 2026-07-28", async () => {
    client = await connect({ token: good, mode: MODERN });
    return { negotiated: client.getNegotiatedProtocolVersion(), server: client.getServerVersion() };
  });
  if (client !== undefined) {
    const c = client;
    await step("0.1 server/discover", () => c.discover());
    await step("0.1 tools/list", () => c.listTools());
    await step("0.1 tools/list again (the client's list cache, TTL and cacheScope honoured or not)", () => c.listTools());
    await step("0.1 tools/call read_only (notes.read today.md)", () => c.callTool({ name: "notes.read", arguments: { name: "today.md" } }));
    await step("0.1 tool error (notes.read of a missing note)", () => c.callTool({ name: "notes.read", arguments: { name: "missing.md" } }));
    await step("0.1 refused arguments (notes.read climbing out)", () => c.callTool({ name: "notes.read", arguments: { name: "../x" } }));
    await c.close();
  }

  // §0.2 the legacy era: the client's default mode, the plain 2025-11-25 handshake.
  await step("0.2 connect in the client's default legacy mode", async () => {
    const legacy = await connect({ token: good, mode: "legacy" });
    const out = { negotiated: legacy.getNegotiatedProtocolVersion(), tools: await legacy.listTools(), call: await legacy.callTool({ name: "notes.read", arguments: { name: "today.md" } }) };
    await legacy.close();
    return out;
  });

  // §0.3 auth, against the node's own verifier and metadata.
  await step("0.3 no token", async () => {
    const c = await connect();
    const r = await c.listTools();
    await c.close();
    return r;
  });
  await step("0.3 wrong-audience token", async () => {
    const c = await connect({ token: () => issuer.mint(TestIssuer.claims(now(), { aud: "https://other.example.invalid/mcp" })) });
    const r = await c.listTools();
    await c.close();
    return r;
  });
  await step("0.3 token from another issuer (iss)", async () => {
    const c = await connect({ token: () => issuer.mint(TestIssuer.claims(now(), { iss: "https://other-issuer.example.invalid" })) });
    const r = await c.listTools();
    await c.close();
    return r;
  });
  outcomes["0.3 audience"] = AUDIENCE;

  // §0.3 what the client does with our 401's resource_metadata when it holds an OAuth provider and no
  // token: which metadata it fetches, and the authorization URL it would send the user to (RFC 8707's
  // `resource`). No authorization server exists: the flow stops at the redirect, which is recorded.
  let authorizationUrl: string | undefined;
  await step("0.3 OAuth provider, no token (metadata discovery and the authorization request)", async () => {
    const provider = {
      redirectUrl: "http://127.0.0.1:1/callback",
      clientMetadata: { client_name: "clearseal-interop-spike", redirect_uris: ["http://127.0.0.1:1/callback"] },
      clientInformation: () => ({ client_id: "interop-spike" }),
      tokens: () => undefined,
      saveTokens: () => undefined,
      redirectToAuthorization: (u: URL) => {
        authorizationUrl = u.href;
      },
      saveCodeVerifier: () => undefined,
      codeVerifier: () => "unused",
    };
    asMetadata = true;
    try {
      // At the node's advertised URL (routed to loopback by recordingFetch), so the client's check that
      // the metadata's `resource` names the server it connected to sees what a deployment would.
      const c = await connect({ authProvider: provider, at: new URL(AUDIENCE) });
      await c.close();
    } finally {
      asMetadata = false;
      outcomes["0.3 authorization URL the client built"] = authorizationUrl ?? null;
    }
    return { authorizationUrl };
  });
} finally {
  await node.close();
  await issuer.close();
  restoreEnv();
  cleanup(root);
}

// §0.1 the MRTR round trip, against the conformance fixture server (admit-all verifier; no token).
const fixture = await startFixture(process.env["FIXTURE_PORT"] ?? "3999");
await step("0.1 MRTR input_required round trip (fixture server)", async () => {
  const transport = new StreamableHTTPClientTransport(new URL(fixture.url), { fetch: recordingFetch });
  const client = new Client({ name: "clearseal-interop-spike", version: "0.0.0" }, { capabilities: { elicitation: {} }, versionNegotiation: { mode: MODERN } });
  client.setRequestHandler("elicitation/create", () => Promise.resolve({ action: "accept", content: { username: "spike", name: "spike", value: "spike" } }));
  await client.connect(transport);
  const r = await client.callTool({ name: "test_input_required_result_elicitation", arguments: {} });
  await client.close();
  return r;
});
fixture.stop();

mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
writeFileSync(new URL("./results/probe.json", import.meta.url), JSON.stringify({ client: "@modelcontextprotocol/client 2.4.0", ran: new Date().toISOString(), outcomes, exchanges }, null, 2) + "\n");
console.log(`PROBE wrote results/probe.json: ${String(exchanges.length)} exchanges`);
