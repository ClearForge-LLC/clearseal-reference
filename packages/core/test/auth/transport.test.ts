// CSR-WO-1003 §1.2, §1.7, §3.2 and §5.5 through the real transport: the 401 challenge naming the
// metadata document, the RFC 9728 document, /health, a valid token dispatching, the principal (the
// token's sub) reaching handlers and every call-scoped audit line, a late containment refusal
// included, and a token offered two ways refused.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { recordingCageFactory } from "../../src/containment/cage.ts";
import type { PinnableTool } from "../../src/pinning/manifest.ts";
import { JwtVerifier } from "../../src/auth/verifier.ts";
import { DEFAULT_LIMITS } from "../../src/transport/config.ts";
import { compileSchema } from "../../src/transport/schema.ts";
import { type RunningTransport, startTransport } from "../../src/transport/server.ts";
import { pinForTest } from "../fixtures/pin.ts";
import { tag } from "../fixtures/tools.ts";
import { modernBody, modernHeaders, raw, type Reply } from "../transport/helpers.ts";
import { AUDIENCE, ISSUER, TestIssuer } from "./issuer.ts";

const RESOURCE = AUDIENCE;
const PRM_URL = "https://mcp.example.invalid/.well-known/oauth-protected-resource/mcp";
const scratch = mkdtempSync(join(tmpdir(), "clearseal-auth-"));
const OUTSIDE = join(scratch, "outside.txt");

/** A late reach: the handler answers at once, then asks its cage to write outside any domain once
 *  `go` resolves, after the response has been sent. */
let lateGo: Promise<void> = Promise.resolve();
const lateDone: Promise<void>[] = [];

const whoami: PinnableTool = {
  name: "whoami",
  description: "Answers with the caller's principal id.",
  inputSchema: { type: "object" },
  capability: tag("whoami"),
  handler: (_args, ctx) => Promise.resolve({ content: [{ type: "text", text: ctx.principal.id }] }),
};
const lateReacher: PinnableTool = {
  name: "late_reacher",
  description: "Answers, then writes outside its (null) domain after it has returned.",
  inputSchema: { type: "object" },
  capability: tag("late"),
  handler: (_args, ctx) => {
    lateDone.push(
      lateGo.then(async () => {
        await ctx.cage.open(OUTSIDE, "w").then((h) => h.close(), () => undefined);
      }),
    );
    return Promise.resolve({ content: [{ type: "text", text: "answered" }] });
  },
};

let issuer: TestIssuer;
let t: RunningTransport;
const audits: string[] = [];

before(async () => {
  issuer = await TestIssuer.start();
  const registry = pinForTest([whoami, lateReacher], compileSchema, DEFAULT_LIMITS, true, { cageFor: (d, p) => recordingCageFactory(d, p) });
  t = await startTransport({
    registry,
    serverInfo: { name: "@clearseal/core", version: "0.0.0" },
    config: { resourceUrl: RESOURCE },
    verifier: new JwtVerifier({ issuer: ISSUER, jwksUrl: issuer.jwksUrl, audience: AUDIENCE, jwksCa: issuer.ca }),
    requestStateKey: randomBytes(32),
    audit: (e, f) => audits.push(`${e} ${JSON.stringify(f)}`),
  });
});
after(async () => {
  await t.close();
  await issuer.close();
  rmSync(scratch, { recursive: true, force: true });
});

const now = (): number => Math.floor(Date.now() / 1000);
const token = (extra: Record<string, unknown> = {}): string => issuer.mint(TestIssuer.claims(now(), extra));

/** A request in the shape `curl -i` prints: status line, the headers that matter, the body. */
function transcript(label: string, request: string, r: Reply): void {
  const keep = ["content-type", "www-authenticate", "cache-control"];
  const headers = keep.filter((h) => r.headers[h] !== undefined).map((h) => `${h}: ${String(r.headers[h])}`);
  console.log(`TRANSCRIPT ${label}\n$ ${request}\nHTTP/1.1 ${String(r.status)}\n${headers.join("\n")}\n\n${r.text}\n`);
}

function call(name: string, bearer: string | undefined, extra: Record<string, string> = {}): Promise<Reply> {
  const headers = modernHeaders("tools/call", name, extra);
  if (bearer === undefined) delete headers["authorization"];
  else headers["authorization"] = `Bearer ${bearer}`;
  return raw(t, { headers, body: JSON.stringify(modernBody("tools/call", { name, arguments: {} })) });
}

void describe("the transcripts (WO §3.2)", () => {
  void it("unauthenticated /mcp: 401, WWW-Authenticate naming the metadata document, no error code", async () => {
    const r = await call("whoami", undefined);
    transcript("unauthenticated", "curl -i -X POST /mcp (no Authorization)", r);
    assert.equal(r.status, 401);
    assert.equal(r.headers["www-authenticate"], `Bearer resource_metadata="${PRM_URL}"`);
    assert.ok(audits.includes('auth-refused {"reason":"missing"}'));
  });

  void it("the protected-resource metadata document, at both well-known paths (G2)", async () => {
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const r = await raw(t, { method: "GET", path });
      if (path.endsWith("/mcp")) transcript("metadata", `curl -i ${path}`, r);
      assert.equal(r.status, 200);
      assert.deepEqual(r.json, { resource: RESOURCE, authorization_servers: [ISSUER], bearer_methods_supported: ["header"], scopes_supported: [] });
    }
  });

  void it("the resource comes from configuration, never from Host", async () => {
    const r = await raw(t, { method: "GET", path: "/.well-known/oauth-protected-resource", headers: { host: `localhost:${String(t.port)}` } });
    assert.equal((r.json as { resource: string }).resource, RESOURCE);
  });

  void it("/health: 200 without a token", async () => {
    const r = await raw(t, { method: "GET", path: "/health" });
    transcript("health", "curl -i /health", r);
    assert.equal(r.status, 200);
  });

  void it("a valid token dispatches, and the handler sees the token's sub as the principal (WO §1.7)", async () => {
    const r = await call("whoami", token({ sub: "alice" }));
    transcript("valid token", "curl -i -X POST /mcp -H 'Authorization: Bearer <token, sub alice>'", r);
    assert.equal(r.status, 200);
    assert.match(r.text, /"text":"alice"/);
  });
});

void describe("refusals at the transport (G3, H1, H3, WO §5.5)", () => {
  void it("G3 a failed token: 401 with error=invalid_token; the reason reaches the audit seam and never the client", async () => {
    const before = audits.length;
    const r = await call("whoami", token({ aud: "https://them.example.invalid" }));
    transcript("wrong audience", "curl -i -X POST /mcp -H 'Authorization: Bearer <token, aud them>'", r);
    assert.equal(r.status, 401);
    assert.equal(r.headers["www-authenticate"], `Bearer resource_metadata="${PRM_URL}", error="invalid_token"`);
    assert.ok(!/\baud\b|them\.example/.test(`${r.text}${String(r.headers["www-authenticate"])}`), "no check or claim value reaches the client");
    assert.deepEqual(audits.slice(before), ['auth-refused {"reason":"aud"}']);
  });

  void it("H3 a scheme other than Bearer: 401 with the challenge and no error code (RFC 6750)", async () => {
    const r = await raw(t, { headers: { ...modernHeaders("tools/call", "whoami"), authorization: "Basic dXNlcjpwYXNz" }, body: JSON.stringify(modernBody("tools/call", { name: "whoami", arguments: {} })) });
    assert.equal(r.status, 401);
    assert.equal(r.headers["www-authenticate"], `Bearer resource_metadata="${PRM_URL}"`);
  });

  void it("H3 a malformed Bearer (two credentials joined by a comma): 400 invalid_request, not dispatched", async () => {
    const r = await raw(t, { headers: { ...modernHeaders("tools/call", "whoami"), authorization: `Bearer ${token({ sub: "alice" })}, Bearer ${token({ sub: "bob" })}` }, body: JSON.stringify(modernBody("tools/call", { name: "whoami", arguments: {} })) });
    assert.equal(r.status, 400);
    assert.equal(r.headers["www-authenticate"], `Bearer resource_metadata="${PRM_URL}", error="invalid_request"`);
    assert.ok(!r.text.includes("alice") && !r.text.includes("bob"));
  });

  void it("H1 two Authorization headers, both valid: 400 and nothing dispatched", async () => {
    const r = await raw(t, { headers: { ...modernHeaders("tools/call", "whoami"), authorization: [`Bearer ${token({ sub: "alice" })}`, `Bearer ${token({ sub: "bob" })}`] }, body: JSON.stringify(modernBody("tools/call", { name: "whoami", arguments: {} })) });
    assert.equal(r.status, 400);
    assert.ok(!r.text.includes("alice") && !r.text.includes("bob"));
  });

  void it("WO §5.5 a token in the header and the query: 400 invalid_request, and the query token is never read", async () => {
    const before = audits.length;
    const r = await raw(t, { path: `/mcp?access_token=${token({ sub: "mallory" })}`, headers: modernHeaders("tools/call", "whoami", { authorization: `Bearer ${token({ sub: "alice" })}` }), body: JSON.stringify(modernBody("tools/call", { name: "whoami", arguments: {} })) });
    transcript("two tokens", "curl -i -X POST '/mcp?access_token=<token>' -H 'Authorization: Bearer <token>'", r);
    assert.equal(r.status, 400);
    assert.match(String(r.headers["www-authenticate"]), /error="invalid_request"$/);
    assert.deepEqual(audits.slice(before), ['auth-refused {"reason":"token-elsewhere"}']);
  });

  void it("WO §5.5 a token in the header and a form body: 400 invalid_request", async () => {
    const r = await raw(t, { headers: { ...modernHeaders("tools/call", "whoami"), authorization: `Bearer ${token()}`, "content-type": "application/x-www-form-urlencoded" }, body: `access_token=${token()}` });
    assert.equal(r.status, 400);
    assert.match(String(r.headers["www-authenticate"]), /error="invalid_request"$/);
  });

  void it("a token in the query alone is refused the same way, never used", async () => {
    const headers = modernHeaders("tools/call", "whoami");
    delete headers["authorization"];
    const r = await raw(t, { path: `/mcp?access_token=${token()}`, headers, body: JSON.stringify(modernBody("tools/call", { name: "whoami", arguments: {} })) });
    assert.equal(r.status, 400);
  });
});

void describe("the principal on every call-scoped audit line (WO §1.7, kickoff)", () => {
  void it("a containment refusal that fires after the handler returned carries the caller's principal id", async () => {
    let go = (): void => undefined;
    lateGo = new Promise((resolve) => {
      go = resolve;
    });
    const r = await call("late_reacher", token({ sub: "carol" }));
    assert.equal(r.status, 200, "the call answered before the reach");
    assert.ok(!audits.some((a) => a.startsWith("containment-refused")), "nothing refused yet");
    go();
    await Promise.all(lateDone.splice(0));
    const line = audits.find((a) => a.startsWith("containment-refused"));
    console.log(`LATE ${String(line)}`);
    assert.equal(line, `containment-refused {"tool":"late_reacher","kind":"fs","sink":${JSON.stringify(OUTSIDE)},"principal":"carol"}`);
    assert.equal(existsSync(OUTSIDE), false, "the write never happened");
  });

  void it("two callers' late refusals, interleaved, each carry their own principal", async () => {
    audits.length = 0;
    let go = (): void => undefined;
    lateGo = new Promise((resolve) => {
      go = resolve;
    });
    const [a, b] = await Promise.all([call("late_reacher", token({ sub: "dave" })), call("late_reacher", token({ sub: "erin" }))]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    go();
    await Promise.all(lateDone.splice(0));
    const principals = audits.filter((x) => x.startsWith("containment-refused")).map((x) => (JSON.parse(x.slice(x.indexOf("{"))) as { principal: string }).principal);
    assert.deepEqual(principals.sort(), ["dave", "erin"]);
    assert.equal(existsSync(OUTSIDE), false);
  });
});

void describe("G1 the resource URL comes from configuration", () => {
  void it("with the core's verifier and no resource URL, the transport refuses to start", async () => {
    const registry = pinForTest([whoami], compileSchema, DEFAULT_LIMITS);
    let err: unknown;
    try {
      // Closed if it starts after all, so a regression fails here rather than hanging the run.
      await (await startTransport({ registry, serverInfo: { name: "x", version: "0" }, verifier: new JwtVerifier({ issuer: ISSUER, jwksUrl: issuer.jwksUrl, audience: AUDIENCE }) })).close();
    } catch (e) {
      err = e;
    }
    assert.match(String(err), /resource URL is not configured/);
  });
});
