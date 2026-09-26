// NOT FOR DEPLOYMENT (see README.md). The core's verifier against a real third-party authorization
// server, on loopback: node-oidc-provider mints a JWT access token by the client-credentials grant
// with a resource indicator, and the transport verifies it and dispatches one call.

import { generateKeyPairSync, randomBytes } from "node:crypto";
import { writeFileSync, mkdtempSync } from "node:fs";
import { createServer as createHttps, request as httpsRequest } from "node:https";
import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createNet, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Provider from "oidc-provider";

import { JwtVerifier } from "../../src/auth/verifier.ts";
import type { PinnableTool } from "../../src/pinning/manifest.ts";
import { DEFAULT_LIMITS } from "../../src/transport/config.ts";
import { compileSchema } from "../../src/transport/schema.ts";
import { startTransport } from "../../src/transport/server.ts";
import { selfSigned } from "../../test/auth/cert.ts";
import { pinForTest } from "../../test/fixtures/pin.ts";
import { tag } from "../../test/fixtures/tools.ts";

const CLIENT_ID = "clearseal-dev-client";
const secret = process.env["DEV_OIDC_CLIENT_SECRET"] ?? "";
if (secret.length < 32) {
  console.error("DEV_OIDC_CLIENT_SECRET must be set, at least 32 characters; the harness does not start without it");
  process.exit(2);
}
const serve = process.argv.includes("--serve");

/** A free loopback port, so the resource URL (and so the audience) is known before the node binds. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createNet().listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => {
        resolve(port);
      });
    });
    s.on("error", reject);
  });
}

function send(req: ReturnType<typeof httpRequest>, body: string): Promise<{ status: number; headers: IncomingMessage["headers"]; text: string }> {
  return new Promise((resolve, reject) => {
    req.on("response", (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

// 1. The authorization server: HTTPS on loopback, a certificate and a signing key made for this run.
const cert = selfSigned();
let handler: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => {
  res.writeHead(503).end();
};
const as = createHttps({ key: cert.keyPem, cert: cert.certPem }, (req, res) => {
  handler(req, res);
});
await new Promise<void>((resolve) => as.listen(0, "127.0.0.1", resolve));
const issuer = `https://127.0.0.1:${String((as.address() as AddressInfo).port)}`;
const mcpPort = await freePort();
const resource = `http://127.0.0.1:${String(mcpPort)}/mcp`;

const signing = { ...generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }), kid: `dev-${randomBytes(6).toString("hex")}`, alg: "ES256", use: "sig" };
const provider = new Provider(issuer, {
  clients: [{ client_id: CLIENT_ID, client_secret: secret, grant_types: ["client_credentials"], redirect_uris: [], response_types: [], id_token_signed_response_alg: "ES256" }],
  jwks: { keys: [signing] },
  ttl: { ClientCredentials: 600 },
  cookies: { keys: [randomBytes(32).toString("base64url")] },
  features: {
    devInteractions: { enabled: false },
    clientCredentials: { enabled: true },
    resourceIndicators: {
      enabled: true,
      defaultResource: () => resource,
      useGrantedResource: () => true,
      getResourceServerInfo: (_ctx: unknown, indicator: string) => {
        if (indicator !== resource) throw new Error(`unknown resource ${indicator}`);
        return { scope: "", audience: resource, accessTokenFormat: "jwt", jwt: { sign: { alg: "ES256" } } };
      },
    },
  },
});
const live = provider.callback();
// --serve only: SIGUSR1 takes the authorization server down (every request 503) and back up, to
// show the node's outage answer (CSR-WO-1003a §3.2).
let down = false;
handler = (req, res) => {
  if (down) res.writeHead(503).end();
  else live(req, res);
};

// 2. The node: the core's verifier, configured by issuer, key-set URL and audience only.
const whoami: PinnableTool = {
  name: "whoami",
  description: "Answers with the caller's principal id.",
  inputSchema: { type: "object" },
  capability: tag("whoami"),
  handler: (_args, ctx) => Promise.resolve({ content: [{ type: "text", text: ctx.principal.id }] }),
};
const node = await startTransport({
  registry: pinForTest([whoami], compileSchema, DEFAULT_LIMITS),
  serverInfo: { name: "@clearseal/core", version: "0.0.0" },
  config: { port: mcpPort, resourceUrl: resource },
  verifier: new JwtVerifier({ issuer, jwksUrl: `${issuer}/jwks`, audience: resource, jwksCa: cert.certPem, jwksTtlS: Number(process.env["AUTH_JWKS_TTL_S"] ?? "") || 300 }),
  audit: (event, fields) => {
    console.log(`[audit-seam] ${event} ${JSON.stringify(fields)}`);
  },
});

if (serve) {
  const dir = mkdtempSync(join(tmpdir(), "clearseal-dev-oidc-"));
  const caFile = join(dir, "issuer-cert.pem");
  writeFileSync(caFile, cert.certPem, { mode: 0o600 });
  process.on("SIGUSR1", () => {
    down = !down;
    console.log(`authorization server ${down ? "DOWN" : "UP"}`);
  });
  console.log(`NOT FOR DEPLOYMENT\nissuer   ${issuer}\ntoken    ${issuer}/token\nnode     ${resource}\ncacert   ${caFile}\nclient   ${CLIENT_ID}\nCtrl-C to stop.`);
} else {
  // 3. One end-to-end call: a token from the provider, then tools/call with it.
  const tokenRes = await send(
    httpsRequest(`${issuer}/token`, { method: "POST", ca: cert.certPem, headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${secret}`).toString("base64")}` } }),
    new URLSearchParams({ grant_type: "client_credentials", resource }).toString(),
  );
  const accessToken = (JSON.parse(tokenRes.text) as { access_token?: string }).access_token ?? "";
  const [h, p] = accessToken.split(".");
  if (tokenRes.status !== 200) console.log(`TOKEN-ERROR ${tokenRes.text}`);
  console.log(`TOKEN ${String(tokenRes.status)} header ${Buffer.from(h ?? "", "base64url").toString()}`);
  console.log(`TOKEN claims ${Buffer.from(p ?? "", "base64url").toString()}`);
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: {}, _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } } });
  const headers = { accept: "application/json, text/event-stream", "content-type": "application/json", "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "whoami" };
  const call = await send(httpRequest(resource, { method: "POST", headers: { ...headers, authorization: `Bearer ${accessToken}` } }), body);
  console.log(`CALL ${String(call.status)} ${call.text}`);
  const bad = await send(httpRequest(resource, { method: "POST", headers: { ...headers, authorization: `Bearer ${accessToken.slice(0, -4)}AAAA` } }), body);
  console.log(`TAMPERED ${String(bad.status)} ${String(bad.headers["www-authenticate"])}`);
  await node.close();
  as.closeAllConnections();
  as.close();
  process.exitCode = call.status === 200 && call.text.includes(CLIENT_ID) && bad.status === 401 ? 0 : 1;
}
