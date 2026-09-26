// CSR-WO-1003a: the auth corrections from the -1003 review and red-team. An issuer outage answers 503
// with Retry-After; a lifetime horizon bounds exp; typ accepts the registered spellings, strict on
// request; the default audit sink escapes line-breaking and bidirectional characters; a private CA
// is trusted through AUTH_JWKS_CA_FILE by the key-set client only; a differing audience is audited
// at start; JSON-RPC errors write one rpc-refused line each. Each has its red-proof.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { get as httpsGet } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { recordingCageFactory } from "../../src/containment/cage.ts";
import { AuthConfigError, JwtVerifier, type JwtVerifierConfig, jwtVerifierFromEnv, readCaFile } from "../../src/auth/verifier.ts";
import { JWKS_FAILURE_COOLDOWN_MS } from "../../src/auth/jwks.ts";
import type { PinnableTool } from "../../src/pinning/manifest.ts";
import { DEFAULT_LIMITS } from "../../src/transport/config.ts";
import { compileSchema } from "../../src/transport/schema.ts";
import { renderAuditLine, type RunningTransport, startTransport } from "../../src/transport/server.ts";
import type { Verdict } from "../../src/transport/verifier.ts";
import { pinForTest } from "../fixtures/pin.ts";
import { tag } from "../fixtures/tools.ts";
import { legacyHeaders, modern, modernBody, modernHeaders, raw, type Reply, start } from "../transport/helpers.ts";
import { selfSigned } from "./cert.ts";
import { AUDIENCE, ISSUER, TestIssuer } from "./issuer.ts";

let issuer: TestIssuer;
let clock = Math.floor(Date.now() / 1000) * 1000;
const nowS = (): number => Math.floor(clock / 1000);
const claims = (extra: Record<string, unknown> = {}): Record<string, unknown> => TestIssuer.claims(nowS(), extra);
const scratch = mkdtempSync(join(tmpdir(), "clearseal-1003a-"));
const why = (v: Verdict): string | undefined => (v.ok ? "ok" : v.reason);

before(async () => {
  issuer = await TestIssuer.start();
});
after(async () => {
  await issuer.close();
  rmSync(scratch, { recursive: true, force: true });
});

function mk(extra: Partial<JwtVerifierConfig> = {}): JwtVerifier {
  return new JwtVerifier({ issuer: ISSUER, jwksUrl: issuer.jwksUrl, audience: AUDIENCE, jwksCa: issuer.ca, now: () => clock, ...extra });
}
const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

const whoami: PinnableTool = {
  name: "whoami",
  description: "Answers with the caller's principal id.",
  inputSchema: { type: "object" },
  capability: tag("whoami"),
  handler: (_args, ctx) => Promise.resolve({ content: [{ type: "text", text: ctx.principal.id }] }),
};

async function node(verifier: JwtVerifier, resourceUrl = AUDIENCE): Promise<{ t: RunningTransport; lines: string[] }> {
  const lines: string[] = [];
  const t = await startTransport({
    registry: pinForTest([whoami], compileSchema, DEFAULT_LIMITS, true, { cageFor: (d, p) => recordingCageFactory(d, p) }),
    serverInfo: { name: "@clearseal/core", version: "0.0.0" },
    config: { resourceUrl },
    verifier,
    audit: (e, f) => lines.push(`${e} ${JSON.stringify(f)}`),
  });
  return { t, lines };
}
const call = (t: RunningTransport, token: string): Promise<Reply> =>
  raw(t, { headers: { ...modernHeaders("tools/call", "whoami"), authorization: `Bearer ${token}` }, body: JSON.stringify(modernBody("tools/call", { name: "whoami", arguments: {} })) });

void describe("§1.1 an issuer outage answers 503 with Retry-After, never 401 invalid_token", () => {
  void it("cache expired and the issuer down: 503, Retry-After from the cooldown, no challenge, one auth-unavailable line; issuer up: 200", async () => {
    const v = mk();
    const { t, lines } = await node(v);
    const saved = clock;
    try {
      assert.equal((await call(t, issuer.mint(claims()))).status, 200, "warm");
      clock += 301_000; // past the 300 s TTL
      issuer.mode = "down";
      const before = lines.length;
      const r = await call(t, issuer.mint(claims()));
      const written = lines.slice(before);
      console.log(`OUTAGE expired cache, issuer down: ${String(r.status)} Retry-After=${String(r.headers["retry-after"])} WWW-Authenticate=${String(r.headers["www-authenticate"])} | ${written.join(" ; ")}`);
      assert.equal(r.status, 503);
      assert.equal(r.headers["retry-after"], String(JWKS_FAILURE_COOLDOWN_MS / 1000));
      assert.equal(r.headers["www-authenticate"], undefined, "no challenge: nothing to tell the client to change");
      assert.deepEqual(written, [`auth-unavailable {"reason":"jwks-unavailable","retryAfterS":${String(JWKS_FAILURE_COOLDOWN_MS / 1000)}}`]);
      clock += 4_000;
      const later = await call(t, issuer.mint(claims()));
      console.log(`OUTAGE 4 s into the cooldown: ${String(later.status)} Retry-After=${String(later.headers["retry-after"])}`);
      assert.equal(later.status, 503);
      assert.equal(later.headers["retry-after"], "6", "the remaining cooldown");
      issuer.mode = "ok";
      clock += JWKS_FAILURE_COOLDOWN_MS;
      const up = await call(t, issuer.mint(claims()));
      console.log(`OUTAGE issuer back: ${String(up.status)}`);
      assert.equal(up.status, 200);
    } finally {
      issuer.mode = "ok";
      clock = saved;
      await t.close();
    }
  });

  void it("a cold cache with the issuer down, and a key set answering 200 with garbage: 503 each", async () => {
    for (const setup of [() => (issuer.mode = "down"), () => (issuer.body = "not json")]) {
      setup();
      try {
        const { t } = await node(mk());
        try {
          const r = await call(t, issuer.mint(claims()));
          assert.equal(r.status, 503);
          assert.ok(Number(r.headers["retry-after"]) >= 1);
        } finally {
          await t.close();
        }
      } finally {
        issuer.mode = "ok";
        issuer.body = undefined;
      }
    }
  });

  void it("WO §5.2: with the issuer up, a forged token stays 401 invalid_token", async () => {
    const { t } = await node(mk());
    try {
      const [h, , s] = issuer.mint(claims()).split(".");
      const r = await call(t, `${h ?? ""}.${Buffer.from(JSON.stringify(claims({ sub: "admin" }))).toString("base64url")}.${s ?? ""}`);
      assert.equal(r.status, 401);
      assert.match(String(r.headers["www-authenticate"]), /error="invalid_token"$/);
      const unknown = await call(t, issuer.mint(claims(), { header: { kid: "never-served" } }));
      assert.equal(unknown.status, 401, "an unknown kid with the issuer up is the token's fault");
    } finally {
      await t.close();
    }
  });

  void it("the verdict carries the distinction as a field, never as the reason string", async () => {
    issuer.mode = "down";
    try {
      const verdict = await mk().verify(bearer(issuer.mint(claims())));
      assert.deepEqual(verdict, { ok: false, reason: "jwks-unavailable", unavailable: { retryAfterS: 10 } });
    } finally {
      issuer.mode = "ok";
    }
  });
});

void describe("§1.2 the token lifetime horizon", () => {
  void it("exp at the horizon (now + skew + 86400) is accepted; one second past is refused exp-horizon", async () => {
    const edge = nowS() + 60 + 86_400;
    const at = await mk().verify(bearer(issuer.mint(claims({ exp: edge }))));
    const past = await mk().verify(bearer(issuer.mint(claims({ exp: edge + 1 }))));
    const floatUnder = await mk().verify(bearer(issuer.mint(claims({ exp: edge - 0.001 }))));
    const noIat = await mk().verify(bearer(issuer.mint(claims({ exp: edge + 1, iat: undefined, nbf: undefined }))));
    console.log(`HORIZON exp = now+60+86400: ${String(why(at))} | +1 s: ${String(why(past))} | -0.001 s: ${String(why(floatUnder))} | +1 s without iat: ${String(why(noIat))}`);
    assert.equal(at.ok, true);
    assert.equal(why(past), "exp-horizon");
    assert.equal(floatUnder.ok, true);
    assert.equal(why(noIat), "exp-horizon", "the horizon needs no iat");
  });

  void it("AUTH_MAX_TOKEN_LIFETIME_S is bounded 60 to 604800 and moves the edge", async () => {
    const env = (v: string): NodeJS.ProcessEnv => ({ AUTH_ISSUER: ISSUER, AUTH_JWKS_URL: "https://127.0.0.1:9/jwks", AUTH_AUDIENCE: AUDIENCE, AUTH_MAX_TOKEN_LIFETIME_S: v });
    for (const v of ["59", "604801", "abc", "-1"]) assert.throws(() => jwtVerifierFromEnv(env(v)), AuthConfigError, v);
    for (const v of ["60", "604800", ""]) assert.ok(jwtVerifierFromEnv(env(v)) instanceof JwtVerifier, v);
    const short = mk({ maxTokenLifetimeS: 60 });
    assert.equal((await short.verify(bearer(issuer.mint(claims({ exp: nowS() + 120 }))))).ok, true);
    assert.equal(why(await short.verify(bearer(issuer.mint(claims({ exp: nowS() + 121 }))))), "exp-horizon");
  });
});

void describe("§1.3 typ: the registered spellings, strict on request", () => {
  const cases: [string, unknown, boolean, boolean][] = [
    // [label, typ, lenient accepts, strict accepts]
    ["absent", undefined, true, false],
    ["JWT", "JWT", true, false],
    ["jwt", "jwt", true, false],
    ["at+jwt", "at+jwt", true, true],
    ["AT+JWT", "AT+JWT", true, true],
    ["application/at+jwt", "application/at+jwt", true, true],
    ["Application/AT+JWT", "Application/AT+JWT", true, true],
    ["application/jwt", "application/jwt", true, false],
    ["Application/JWT", "Application/JWT", true, false],
    ["JOSE", "JOSE", false, false],
    ['" at+jwt"', " at+jwt", false, false],
    ['"at+jwt "', "at+jwt ", false, false],
    ['"at+jwt; v=1"', "at+jwt; v=1", false, false],
    ["the number 1", 1, false, false],
  ];
  void it("the matrix under both settings", async () => {
    const rows: string[] = [];
    for (const [label, typ, lenient, strict] of cases) {
      const token = issuer.mint(claims(), { header: { typ } });
      const l = await mk().verify(bearer(token));
      const s = await mk({ requireAtJwt: true }).verify(bearer(token));
      rows.push(`| ${label} | ${l.ok ? "accepted" : String(why(l))} | ${s.ok ? "accepted" : String(why(s))} |`);
      assert.equal(l.ok, lenient, `lenient ${label}`);
      assert.equal(s.ok, strict, `strict ${label}`);
    }
    console.log(`TYP\n| typ | default | AUTH_REQUIRE_AT_JWT=true |\n|---|---|---|\n${rows.join("\n")}`);
  });

  void it("AUTH_REQUIRE_AT_JWT is true or false; anything else refuses start", () => {
    const env = (v: string): NodeJS.ProcessEnv => ({ AUTH_ISSUER: ISSUER, AUTH_JWKS_URL: "https://127.0.0.1:9/jwks", AUTH_AUDIENCE: AUDIENCE, AUTH_REQUIRE_AT_JWT: v });
    for (const v of ["yes", "1", "TRUE", " true"]) assert.throws(() => jwtVerifierFromEnv(env(v)), AuthConfigError, v);
    for (const v of ["true", "false", ""]) assert.ok(jwtVerifierFromEnv(env(v)) instanceof JwtVerifier, v);
  });
});

void describe("§1.4 the default audit sink escapes line-breaking and bidirectional characters", () => {
  const UNSAFE = [" ", " ", "\u0085", "‪", "‫", "‬", "‭", "‮", "⁦", "⁧", "⁨", "⁩"];

  void it("user-\\u202Enimda and a U+2028 in sub each land on one line, escaped; every listed character and lone surrogates too", () => {
    const a = renderAuditLine("rpc-refused", { code: -32601, method: "x", principal: "user-‮nimda" });
    const b = renderAuditLine("rpc-refused", { code: -32601, method: "x", principal: "line break" });
    console.log(`ESCAPED ${a}\nESCAPED ${b}`);
    assert.equal(a, '[audit-seam] rpc-refused {"code":-32601,"method":"x","principal":"user-\\u202enimda"}');
    assert.equal(b, '[audit-seam] rpc-refused {"code":-32601,"method":"x","principal":"line\\u2028break"}');
    for (const c of UNSAFE) {
      const line = renderAuditLine(`ev${c}`, { principal: `p${c}q` });
      assert.ok(!line.includes(c), `U+${c.charCodeAt(0).toString(16)} is escaped`);
      assert.ok(line.includes(`\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`));
    }
    const surrogates = renderAuditLine("e", { principal: "a\ud800b\udc00c" });
    assert.equal(surrogates, '[audit-seam] e {"principal":"a\\ud800b\\udc00c"}');
    assert.ok(!/[\n\r]/.test(renderAuditLine("e", { principal: "a\nb\rc" })));
  });

  void it("through the transport: the default sink writes the escaped line, while a custom sink receives the principal unchanged", async () => {
    const sub = "user-‮nimda x";
    const token = issuer.mint(claims({ sub }));
    const logged: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]): void => {
      logged.push(args.map(String).join(" "));
    };
    const t = await startTransport({
      registry: pinForTest([whoami], compileSchema, DEFAULT_LIMITS, true, { cageFor: (d, p) => recordingCageFactory(d, p) }),
      serverInfo: { name: "x", version: "0" },
      config: { resourceUrl: AUDIENCE },
      verifier: mk(),
    });
    try {
      await raw(t, { headers: { ...modernHeaders("tools/call", "nope"), authorization: `Bearer ${token}` }, body: JSON.stringify(modernBody("tools/call", { name: "nope", arguments: {} })) });
    } finally {
      console.error = original;
      await t.close();
    }
    const line = logged.find((l) => l.includes("rpc-refused"));
    console.log(`DEFAULT-SINK ${String(line)}`);
    assert.equal(line, '[audit-seam] rpc-refused {"code":-32602,"method":"tools/call","principal":"user-\\u202enimda\\u2028x"}');
    const custom: Record<string, string | number>[] = [];
    const c = await startTransport({
      registry: pinForTest([whoami], compileSchema, DEFAULT_LIMITS, true, { cageFor: (d, p) => recordingCageFactory(d, p) }),
      serverInfo: { name: "x", version: "0" },
      config: { resourceUrl: AUDIENCE },
      verifier: mk(),
      audit: (e, f) => {
        if (e === "rpc-refused") custom.push(f);
      },
    });
    try {
      await raw(c, { headers: { ...modernHeaders("tools/call", "nope"), authorization: `Bearer ${token}` }, body: JSON.stringify(modernBody("tools/call", { name: "nope", arguments: {} })) });
    } finally {
      await c.close();
    }
    assert.equal(custom[0]?.["principal"], sub, "the structured field is the principal itself");
  });
});

void describe("§1.5 AUTH_JWKS_CA_FILE: a private CA trusted by the key-set client only", () => {
  const env = (file: string): NodeJS.ProcessEnv => ({ AUTH_ISSUER: ISSUER, AUTH_JWKS_URL: issuer.jwksUrl, AUTH_AUDIENCE: AUDIENCE, AUTH_JWKS_CA_FILE: file });

  void it("a PEM certificate file: the key set is fetched through it and a token verifies; the rest of the process still distrusts that issuer", async () => {
    const file = join(scratch, "issuer-ca.pem");
    writeFileSync(file, issuer.ca);
    const v = jwtVerifierFromEnv(env(file));
    const verdict = await v.verify(bearer(issuer.mint(TestIssuer.claims(Math.floor(Date.now() / 1000)))));
    assert.equal(verdict.ok, true);
    const plain = await new Promise<string>((resolve) => {
      httpsGet(issuer.jwksUrl, (res) => {
        res.resume();
        resolve(`status ${String(res.statusCode)}`);
      }).on("error", (e: NodeJS.ErrnoException) => {
        resolve(String(e.code));
      });
    });
    console.log(`CA-FILE verifier: ${verdict.ok ? "verified" : String(why(verdict))} | a plain https request in the same process: ${plain}`);
    assert.equal(plain, "DEPTH_ZERO_SELF_SIGNED_CERT");
    const without = await new JwtVerifier({ issuer: ISSUER, jwksUrl: issuer.jwksUrl, audience: AUDIENCE }).verify(bearer(issuer.mint(TestIssuer.claims(Math.floor(Date.now() / 1000)))));
    assert.equal(why(without), "jwks-unavailable", "without the file, the issuer is not trusted");
  });

  void it("WO §5.6: missing, a directory, empty, a private key, a certificate with a key, a malformed certificate, or /dev/zero: start is refused", () => {
    const own = selfSigned();
    const files: Record<string, string | null> = {
      missing: null,
      empty: "",
      "private key": own.keyPem,
      "certificate and key": `${own.certPem}${own.keyPem}`,
      malformed: "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n",
      "not PEM": "hello",
    };
    const refused: string[] = [];
    for (const [label, content] of Object.entries(files)) {
      const file = join(scratch, `bad-${label.replaceAll(" ", "-")}.pem`);
      if (content !== null) writeFileSync(file, content);
      assert.throws(() => jwtVerifierFromEnv(env(file)), AuthConfigError, label);
      refused.push(label);
    }
    const dir = join(scratch, "a-directory");
    mkdirSync(dir);
    assert.throws(() => readCaFile(dir), /not a regular file/);
    refused.push("a directory");
    if (process.platform !== "win32") {
      const zero = join(scratch, "zero.pem");
      symlinkSync("/dev/zero", zero);
      assert.throws(() => readCaFile(zero), /not a regular file/);
      refused.push("a symlink to /dev/zero");
    }
    console.log(`CA-FILE refused at start: ${refused.join(", ")}`);
  });
});

void describe("§1.6 an audience that differs from the resource URL is audited at start", () => {
  void it("one auth-audience-differs line naming both; none when they match; the node starts either way", async () => {
    const differs = await node(mk({ audience: "urn:example:clearseal" }));
    const same = await node(mk());
    try {
      const line = differs.lines.filter((l) => l.startsWith("auth-audience-differs"));
      console.log(`AUDIENCE ${line.join(" ; ")}`);
      assert.deepEqual(line, [`auth-audience-differs {"audience":"urn:example:clearseal","resource":"${AUDIENCE}"}`]);
      assert.equal(same.lines.filter((l) => l.startsWith("auth-audience-differs")).length, 0);
    } finally {
      await differs.t.close();
      await same.t.close();
    }
  });
});

void describe("§1.7 a JSON-RPC error writes one rpc-refused line, never two", () => {
  void it("method not found, invalid params, a header mismatch, legacy-era errors, and a handler error that already audits", async () => {
    const s = await start();
    try {
      const rows: string[] = [];
      const one = async (label: string, send: () => Promise<Reply>, expected: string[]): Promise<void> => {
        const before = s.lines.length;
        const r = await send();
        const written = s.lines.slice(before);
        rows.push(`| ${label} | ${String(r.status)} | ${written.join(" ; ")} |`);
        assert.deepEqual(written, expected, label);
      };
      await one("method not found", () => modern(s.t, "nope/nope"), ['rpc-refused {"code":-32601,"method":"nope/nope","principal":"test-principal"}']);
      await one("invalid params (a cursor)", () => modern(s.t, "tools/list", { cursor: "x" }), ['rpc-refused {"code":-32602,"method":"tools/list","principal":"test-principal"}']);
      await one("a header that disagrees with the body", () => modern(s.t, "tools/call", { arguments: {} }), ['rpc-refused {"code":-32020,"method":"tools/call","principal":"test-principal"}']);
      await one("unknown tool, legacy era (answered 200)", () => raw(s.t, { headers: legacyHeaders({ "mcp-protocol-version": "2025-11-25" }), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "nope", arguments: {} } }) }), ['rpc-refused {"code":-32602,"method":"tools/call","principal":"test-principal"}']);
      await one("a handler error (already audited)", () => modern(s.t, "tools/call", { name: "throws_refusal", arguments: {} }), ['handler-error {"tool":"throws_refusal","principal":"test-principal"}']);
      await one("a handler error on the legacy era (already audited, mapped to 200)", () => raw(s.t, { headers: legacyHeaders({ "mcp-protocol-version": "2025-11-25" }), body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "throws_refusal", arguments: {} } }) }), ['handler-error {"tool":"throws_refusal","principal":"test-principal"}']);
      console.log(`RPC-REFUSED\n| case | status | audit line(s) |\n|---|---|---|\n${rows.join("\n")}`);
    } finally {
      await s.close();
    }
  });
});

void describe("adversarial A1: a key rotated in just before an outage is an outage, not a bad token", () => {
  void it("valid cache, a new kid, the issuer down: 503; the issuer back past the cooldown: 200 in the same TTL window", async () => {
    const v = mk();
    const { t, lines } = await node(v);
    const saved = clock;
    try {
      assert.equal((await call(t, issuer.mint(claims()))).status, 200, "warm, cache valid");
      const rotated = issuer.rotate(`rot-a1-${String(issuer.fetches)}`);
      issuer.mode = "down";
      const during = await call(t, issuer.mint(claims(), { signer: rotated }));
      console.log(`A1 rotated kid, issuer down, cache valid: ${String(during.status)} Retry-After=${String(during.headers["retry-after"])} | ${lines.filter((l) => l.startsWith("auth-")).slice(-1).join("")}`);
      assert.equal(during.status, 503);
      issuer.mode = "ok";
      clock += JWKS_FAILURE_COOLDOWN_MS + 1_000;
      const back = await call(t, issuer.mint(claims(), { signer: rotated }));
      console.log(`A1 issuer back, same TTL window: ${String(back.status)}`);
      assert.equal(back.status, 200, "the failed refetch did not spend the window");
    } finally {
      issuer.mode = "ok";
      clock = saved;
      await t.close();
    }
  });
});

void describe("adversarial A2, A3, A5, A6, A9", () => {
  void it("A2: DEL, the C1 controls and every format character are escaped too, astral ones as surrogate pairs", () => {
    const chars = ["\u007f", "\u0080", "\u009b", "\u009d", "؜", "​", "‍", "‎", "‏", "⁠", "⁪", "﻿", "￹", "\u{e0041}"];
    for (const c of chars) {
      const line = renderAuditLine("e", { principal: `a${c}b` });
      assert.ok(!line.includes(c), `U+${(c.codePointAt(0) ?? 0).toString(16)} escaped: ${line}`);
    }
    assert.equal(renderAuditLine("e", { principal: "\u{e0041}" }), '[audit-seam] e {"principal":"\\udb40\\udc41"}');
    assert.equal(renderAuditLine("e", { principal: "אב letters stay" }), '[audit-seam] e {"principal":"אב letters stay"}', "right-to-left letters are text, not controls");
  });

  void it("A3: a request's method reaches the audit line only as a method-shaped name of at most 128 characters", async () => {
    const s = await start();
    try {
      for (const [method, logged] of [["x".repeat(129), "(not a method name)"], ["m n", "(not a method name)"], ["a".repeat(1_000), "(not a method name)"], ["tools/nope", "tools/nope"]] as const) {
        const before = s.lines.length;
        // The Mcp-Method header cannot carry every character; the body's method is what gets logged.
        await raw(s.t, { headers: modernHeaders("tools/list"), body: JSON.stringify(modernBody(method)) });
        const line = s.lines.slice(before).find((l) => l.startsWith("rpc-refused")) ?? "";
        assert.ok(line.includes(`"method":"${logged}"`), `${method.slice(0, 20)}: ${line.slice(0, 120)}`);
        assert.ok(line.length < 300);
      }
    } finally {
      await s.close();
    }
  });

  void it("A5: other PEM armour in any case is refused; commentary between certificates is not", () => {
    const own = selfSigned();
    // The key's armour relabelled in lower case (built by pattern, so no key armour sits in the tree).
    const lowerKey = own.keyPem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, (_m, edge: string) => `-----${edge} private key-----`);
    const cases: [string, string, boolean][] = [
      ["a key under a lower-case label", `${issuer.ca}${lowerKey}`, false],
      ["trailing armour-like junk", `${issuer.ca}-----junk-----\n`, false],
      ["a comment line", `# the test issuer\n${issuer.ca}`, true],
      ["prose between certificates", `${issuer.ca}subject=the test issuer\n${own.certPem}`, true],
    ];
    for (const [label, content, ok] of cases) {
      const file = join(scratch, `a5-${label.replaceAll(" ", "-")}.pem`);
      writeFileSync(file, content);
      if (ok) assert.ok(readCaFile(file).includes("BEGIN CERTIFICATE"), label);
      else assert.throws(() => readCaFile(file), AuthConfigError, label);
    }
  });

  void it("A6: the numeric settings are plain decimal digits", () => {
    const base = { AUTH_ISSUER: ISSUER, AUTH_JWKS_URL: "https://127.0.0.1:9/jwks", AUTH_AUDIENCE: AUDIENCE };
    for (const name of ["AUTH_MAX_TOKEN_LIFETIME_S", "AUTH_CLOCK_SKEW_S", "AUTH_JWKS_TTL_S"]) {
      for (const v of ["0x3c", " 60 ", "6e1", "60.5", "0b111100", "60\n", "+60"]) {
        assert.throws(() => jwtVerifierFromEnv({ ...base, [name]: v }), Error, `${name}=${JSON.stringify(v)}`);
      }
      assert.ok(jwtVerifierFromEnv({ ...base, [name]: "60" }) instanceof JwtVerifier, name);
    }
  });

  void it("A9: a FIFO is refused at once, without blocking the start", () => {
    if (process.platform === "win32") return; // no FIFOs; the regular-file check stands
    const fifo = join(scratch, "a9.fifo");
    execFileSync("mkfifo", [fifo]);
    const t = performance.now();
    assert.throws(() => readCaFile(fifo), /not a regular file/);
    assert.ok(performance.now() - t < 1_000);
  });
});
