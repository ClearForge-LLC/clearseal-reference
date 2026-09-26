// CSR-WO-1003 §1.3, §1.4, §3.3–§3.6 and the §5 cases: every check in CHECKS.md with its negative
// test, against the in-process issuer over loopback HTTPS. Each refusal row names the check it
// proves; the red-proof matrix removes each check and watches its row fail.

import assert from "node:assert/strict";
import { createHash, createHmac, createPublicKey, randomBytes, verify as cryptoVerify } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { AuthConfigError, JwtVerifier, type JwtVerifierConfig, jwtVerifierFromEnv } from "../../src/auth/verifier.ts";
import { importKey } from "../../src/auth/jws.ts";
import { JWKS_FAILURE_COOLDOWN_MS, JWKS_MAX_KEYS, JwksConfigError } from "../../src/auth/jwks.ts";
import type { Verdict } from "../../src/transport/verifier.ts";
import { AUDIENCE, b64, ISSUER, key, type SigningKey, TestIssuer } from "./issuer.ts";

/** The refusal reason, or "ok". */
const why = (v: Verdict): string | undefined => (v.ok ? "ok" : v.reason);

let issuer: TestIssuer;
let attacker: TestIssuer;
let clock = Date.now();
const nowS = (): number => Math.floor(clock / 1000);
const claims = (extra: Record<string, unknown> = {}): Record<string, unknown> => TestIssuer.claims(nowS(), extra);

/** A verifier with a cold cache on the test issuer, on the test clock. */
function mk(extra: Partial<JwtVerifierConfig> = {}): JwtVerifier {
  return new JwtVerifier({ issuer: ISSUER, jwksUrl: issuer.jwksUrl, audience: AUDIENCE, jwksCa: issuer.ca, now: () => clock, ...extra });
}
const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

let encKey: SigningKey;
let es384Key: SigningKey;
let weakKey: SigningKey;
let opsKey: SigningKey;
let dupEc: SigningKey;
let dupEd: SigningKey;

before(async () => {
  issuer = await TestIssuer.start();
  attacker = await TestIssuer.start();
  // Keys the K2 and K3 rows need: fit for signing, but served with a use, alg or size that is not.
  encKey = issuer.rotate("es-enc", key("es-enc", "ES256"));
  encKey.jwk["use"] = "enc";
  es384Key = issuer.rotate("es-384", key("es-384", "ES256"));
  es384Key.jwk["alg"] = "ES384";
  weakKey = issuer.rotate("rs-weak", key("rs-weak", "RS256", 1024));
  opsKey = issuer.rotate("es-ops", key("es-ops", "ES256"));
  opsKey.jwk["key_ops"] = ["encrypt"];
  // One kid naming two keys of different types (RFC 7517 allows it): EC first, then OKP.
  dupEc = issuer.rotate("dup-1", key("dup-1", "ES256"));
  dupEd = issuer.rotate("dup-1", key("dup-1", "EdDSA"));
});
after(async () => {
  await issuer.close();
  await attacker.close();
});

interface Row {
  id: string;
  name: string;
  headers: () => Record<string, string>;
  error: "invalid_request" | "invalid_token" | undefined;
  reason: string;
  /** The check must fire before any key is fetched. */
  noFetch?: boolean;
  config?: Partial<JwtVerifierConfig>;
}

const seg = (v: unknown): string => b64(v);
const hdr = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ alg: "ES256", typ: "at+jwt", kid: "es-1", ...extra });

const ROWS: Row[] = [
  { id: "H2", name: "no Authorization header", headers: () => ({}), error: undefined, reason: "missing", noFetch: true },
  { id: "H3", name: "scheme is Basic (no error code: an unsupported method)", headers: () => ({ authorization: "Basic dXNlcjpwYXNz" }), error: undefined, reason: "scheme", noFetch: true },
  { id: "H3", name: "Bearer with two tokens", headers: () => ({ authorization: `Bearer ${issuer.mint(claims())} x` }), error: "invalid_request", reason: "malformed-bearer", noFetch: true },
  { id: "H3", name: "two Bearer credentials joined by a comma", headers: () => ({ authorization: `Bearer ${issuer.mint(claims())}, Bearer ${issuer.mint(claims())}` }), error: "invalid_request", reason: "malformed-bearer", noFetch: true },
  { id: "H3", name: "Bearer with no token", headers: () => ({ authorization: "Bearer " }), error: "invalid_request", reason: "malformed-bearer", noFetch: true },
  { id: "H4", name: "two segments", headers: () => bearer(`${seg(hdr())}.${seg(claims())}`), error: "invalid_token", reason: "malformed", noFetch: true },
  { id: "H4", name: "four segments", headers: () => bearer(`${issuer.mint(claims())}.x`), error: "invalid_token", reason: "malformed", noFetch: true },
  { id: "H4", name: "a validly signed token over 8 KiB", headers: () => bearer(issuer.mint(claims({ pad: "x".repeat(9000) }))), error: "invalid_token", reason: "malformed", noFetch: true },
  { id: "H4", name: "signature segment not base64url", headers: () => bearer(`${seg(hdr())}.${seg(claims())}.+++`), error: "invalid_token", reason: "malformed", noFetch: true },
  {
    id: "H4",
    name: "a valid signature respelled: unused trailing bits set (adversarial A11)",
    headers: () => {
      const [h, p, s] = issuer.mint(claims()).split(".") as [string, string, string];
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      const last = alphabet[alphabet.indexOf(s.slice(-1)) ^ 1] ?? "";
      return bearer(`${h}.${p}.${s.slice(0, -1)}${last}`);
    },
    error: "invalid_token",
    reason: "malformed",
    noFetch: true,
  },
  { id: "H5", name: "header not base64url JSON", headers: () => bearer(issuer.sign(`${b64("not json")}.${seg(claims())}`)), error: "invalid_token", reason: "header", noFetch: true },
  { id: "H5", name: "header is an array", headers: () => bearer(issuer.sign(`${seg([hdr()])}.${seg(claims())}`)), error: "invalid_token", reason: "header", noFetch: true },
  { id: "H5", name: "header with a duplicate key (alg twice)", headers: () => bearer(issuer.sign(`${b64('{"alg":"none","typ":"at+jwt","kid":"es-1","alg":"ES256"}')}.${seg(claims())}`)), error: "invalid_token", reason: "header", noFetch: true },
  { id: "H6", name: "alg none, unsigned", headers: () => bearer(`${seg(hdr({ alg: "none" }))}.${seg(claims())}.`), error: "invalid_token", reason: "alg", noFetch: true },
  { id: "H6", name: "alg None, unsigned", headers: () => bearer(`${seg(hdr({ alg: "None" }))}.${seg(claims())}.`), error: "invalid_token", reason: "alg", noFetch: true },
  {
    id: "H6",
    name: "WO §5.1: HS256 keyed with the issuer's own public key",
    headers: () => {
      const input = `${seg(hdr({ alg: "HS256" }))}.${seg(claims())}`;
      const secret = createPublicKey({ key: (issuer.keys[0] as SigningKey).jwk as never, format: "jwk" }).export({ type: "spki", format: "pem" });
      return bearer(`${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`);
    },
    error: "invalid_token",
    reason: "alg",
    noFetch: true,
  },
  { id: "H6", name: "alg PS256, not on the allow-list", headers: () => bearer(issuer.mint(claims(), { header: { alg: "PS256" } })), error: "invalid_token", reason: "alg", noFetch: true },
  { id: "H6", name: "EdDSA token, AUTH_ALGS=ES256", headers: () => bearer(issuer.mint(claims(), { using: "ed-1" })), error: "invalid_token", reason: "alg", noFetch: true, config: { algs: ["ES256"] } },
  { id: "H7", name: "crit present", headers: () => bearer(issuer.mint(claims(), { header: { crit: ["exp"] } })), error: "invalid_token", reason: "crit", noFetch: true },
  { id: "H9", name: "no kid", headers: () => bearer(issuer.mint(claims(), { header: { kid: undefined } })), error: "invalid_token", reason: "kid", noFetch: true },
  { id: "H9", name: "WO §5.4: path-shaped kid", headers: () => bearer(issuer.mint(claims(), { header: { kid: "../../jwks" } })), error: "invalid_token", reason: "kid", noFetch: true },
  { id: "H9", name: "kid of 129 characters", headers: () => bearer(issuer.mint(claims(), { header: { kid: "k".repeat(129) } })), error: "invalid_token", reason: "kid", noFetch: true },
  { id: "H9", name: "kid a number", headers: () => bearer(issuer.mint(claims(), { header: { kid: 1 } })), error: "invalid_token", reason: "kid", noFetch: true },
  { id: "H9", name: "WO §5.4: kid of 10 KB (over the token cap first)", headers: () => bearer(issuer.mint(claims(), { header: { kid: "k".repeat(10_240) } })), error: "invalid_token", reason: "malformed", noFetch: true },
  { id: "H10", name: "typ JOSE", headers: () => bearer(issuer.mint(claims(), { header: { typ: "JOSE" } })), error: "invalid_token", reason: "typ", noFetch: true },
  { id: "K1", name: "kid not in the key set", headers: () => bearer(issuer.mint(claims(), { header: { kid: "nope" } })), error: "invalid_token", reason: "unknown-kid" },
  { id: "K2", name: "WO §5.2: ES256 header naming an RS256 key", headers: () => bearer(issuer.mint(claims(), { header: { kid: "rs-1" } })), error: "invalid_token", reason: "key-mismatch" },
  { id: "K2", name: "a P-256 key served with use enc", headers: () => bearer(issuer.mint(claims(), { signer: encKey })), error: "invalid_token", reason: "key-mismatch" },
  { id: "K2", name: "a P-256 key served with key_ops [encrypt] (adversarial A8)", headers: () => bearer(issuer.mint(claims(), { signer: opsKey })), error: "invalid_token", reason: "key-mismatch" },
  { id: "K2", name: "a P-256 key served with alg ES384", headers: () => bearer(issuer.mint(claims(), { signer: es384Key })), error: "invalid_token", reason: "key-mismatch" },
  { id: "K3", name: "an RSA key of 1024 bits", headers: () => bearer(issuer.mint(claims(), { signer: weakKey })), error: "invalid_token", reason: "key-mismatch" },
  {
    id: "K3",
    name: "payload altered after signing",
    headers: () => {
      const [h, , s] = issuer.mint(claims()).split(".");
      return bearer(`${h ?? ""}.${seg(claims({ sub: "admin" }))}.${s ?? ""}`);
    },
    error: "invalid_token",
    reason: "signature",
  },
  { id: "K3", name: "signed by another key under a served kid", headers: () => bearer(attacker.mint(claims())), error: "invalid_token", reason: "signature" },
  { id: "C1", name: "payload not JSON", headers: () => bearer(issuer.sign(`${seg(hdr())}.${b64("not json")}`)), error: "invalid_token", reason: "payload" },
  { id: "C1", name: "payload with a duplicate key (sub twice)", headers: () => bearer(issuer.sign(`${seg(hdr())}.${b64(JSON.stringify(claims()).replace("{", '{"sub":"admin",'))}`)), error: "invalid_token", reason: "payload" },
  { id: "C2", name: "iss another issuer", headers: () => bearer(issuer.mint(claims({ iss: "https://other.example.invalid" }))), error: "invalid_token", reason: "iss" },
  { id: "C2", name: "iss with a trailing slash", headers: () => bearer(issuer.mint(claims({ iss: `${ISSUER}/` }))), error: "invalid_token", reason: "iss" },
  { id: "C2", name: "iss missing", headers: () => bearer(issuer.mint(claims({ iss: undefined }))), error: "invalid_token", reason: "iss" },
  { id: "C3", name: 'aud "them"', headers: () => bearer(issuer.mint(claims({ aud: "https://them.example.invalid" }))), error: "invalid_token", reason: "aud" },
  { id: "C3", name: 'aud ["us","them"]', headers: () => bearer(issuer.mint(claims({ aud: [AUDIENCE, "https://them.example.invalid"] }))), error: "invalid_token", reason: "aud" },
  { id: "C3", name: "aud missing", headers: () => bearer(issuer.mint(claims({ aud: undefined }))), error: "invalid_token", reason: "aud" },
  { id: "C3", name: "aud []", headers: () => bearer(issuer.mint(claims({ aud: [] }))), error: "invalid_token", reason: "aud" },
  { id: "C4", name: "exp missing", headers: () => bearer(issuer.mint(claims({ exp: undefined }))), error: "invalid_token", reason: "exp" },
  { id: "C4", name: "exp a string", headers: () => bearer(issuer.mint(claims({ exp: String(nowS() + 300) }))), error: "invalid_token", reason: "exp" },
  { id: "C4", name: "exp 90 s ago (skew 60)", headers: () => bearer(issuer.mint(claims({ exp: nowS() - 90 }))), error: "invalid_token", reason: "exp" },
  { id: "C5", name: "nbf 90 s ahead", headers: () => bearer(issuer.mint(claims({ nbf: nowS() + 90 }))), error: "invalid_token", reason: "nbf" },
  { id: "C5", name: "nbf a string", headers: () => bearer(issuer.mint(claims({ nbf: "0" }))), error: "invalid_token", reason: "nbf" },
  { id: "C6", name: "iat 90 s ahead", headers: () => bearer(issuer.mint(claims({ iat: nowS() + 90 }))), error: "invalid_token", reason: "iat" },
  { id: "C6", name: "iat a string", headers: () => bearer(issuer.mint(claims({ iat: "0" }))), error: "invalid_token", reason: "iat" },
  { id: "C7", name: "sub missing", headers: () => bearer(issuer.mint(claims({ sub: undefined }))), error: "invalid_token", reason: "sub" },
  { id: "C7", name: "sub empty", headers: () => bearer(issuer.mint(claims({ sub: "" }))), error: "invalid_token", reason: "sub" },
  { id: "C7", name: "sub of 257 characters", headers: () => bearer(issuer.mint(claims({ sub: "s".repeat(257) }))), error: "invalid_token", reason: "sub" },
  { id: "C7", name: "sub a number", headers: () => bearer(issuer.mint(claims({ sub: 42 }))), error: "invalid_token", reason: "sub" },
];

void describe("the refusal matrix: one row per check (CHECKS.md, WO §3.3)", () => {
  for (const row of ROWS) {
    void it(`${row.id} ${row.name} → ${row.error ?? "no error"} / ${row.reason}`, async () => {
      const v = mk(row.config);
      const verdict = await v.verify(row.headers());
      console.log(`REFUSAL | ${row.id} | ${row.name} | 401 ${row.error ?? "(no error)"} | ${verdict.ok ? "ACCEPTED" : String(verdict.reason)} | fetches ${String(v.jwks.fetches)}`);
      assert.equal(verdict.ok, false);
      assert.equal(verdict.error, row.error);
      assert.equal(verdict.reason, row.reason);
      if (row.noFetch === true) assert.equal(v.jwks.fetches, 0, "refused before any key was fetched");
    });
  }

  void it("every row's check id is one CHECKS.md defines", () => {
    const ids = new Set(ROWS.map((r) => r.id));
    for (const id of ["H2", "H3", "H4", "H5", "H6", "H7", "H9", "H10", "K1", "K2", "K3", "C1", "C2", "C3", "C4", "C5", "C6", "C7"]) assert.ok(ids.has(id), id);
  });
});

void describe("the accepted cases: each check's boundary, on the inside", () => {
  const ok: [string, () => Record<string, string>, Partial<JwtVerifierConfig>?][] = [
    ["ES256", () => bearer(issuer.mint(claims()))],
    ["EdDSA", () => bearer(issuer.mint(claims(), { using: "ed-1" }))],
    ["RS256", () => bearer(issuer.mint(claims(), { using: "rs-1" }))],
    ["scheme bearer in lower case", () => ({ authorization: `bearer ${issuer.mint(claims())}` })],
    ["typ JWT", () => bearer(issuer.mint(claims(), { header: { typ: "JWT" } }))],
    ["typ absent", () => bearer(issuer.mint(claims(), { header: { typ: undefined } }))],
    ['WO §3.6 aud ["us"]', () => bearer(issuer.mint(claims({ aud: [AUDIENCE] })))],
    ["WO §3.5 exp 30 s ago (skew 60)", () => bearer(issuer.mint(claims({ exp: nowS() - 30 })))],
    ["nbf 30 s ahead", () => bearer(issuer.mint(claims({ nbf: nowS() + 30 })))],
    ["iat 30 s ahead", () => bearer(issuer.mint(claims({ iat: nowS() + 30 })))],
    ["nbf and iat absent", () => bearer(issuer.mint(claims({ nbf: undefined, iat: undefined })))],
    ["sub of 256 characters", () => bearer(issuer.mint(claims({ sub: "s".repeat(256) })))],
    ["one kid naming an EC and an OKP key: an EdDSA token finds the OKP one (adversarial A7)", () => bearer(issuer.mint(claims(), { signer: dupEd }))],
    ["one kid naming an EC and an OKP key: an ES256 token finds the EC one (adversarial A7)", () => bearer(issuer.mint(claims(), { signer: dupEc }))],
  ];
  for (const [name, headers, config] of ok) {
    void it(name, async () => {
      const verdict = await mk(config).verify(headers());
      console.log(`ACCEPTED | ${name} | ${verdict.ok ? `principal ${verdict.principal.id.slice(0, 16)}` : `refused ${String(verdict.reason)}`}`);
      assert.equal(verdict.ok, true);
    });
  }

  void it("C7: the principal's id is the token's sub, and only that", async () => {
    const verdict = await mk().verify(bearer(issuer.mint(claims({ sub: "alice", email: "bob@example.invalid", principal: "bob", client_id: "bob" }))));
    assert.deepEqual(verdict, { ok: true, principal: { id: "alice" } });
  });
});

void describe("WO §5.3 / H8: jku, x5u, jwk and x5c are never followed", () => {
  const bundle = (): string => `${issuer.ca}${attacker.ca}`;

  void it("the attacker's key set is reachable with this trust: a fetch there would succeed", async () => {
    // Without this, a verifier that followed jku would fail at TLS and the fetch count would prove
    // nothing (adversarial A3).
    const reach = new JwtVerifier({ issuer: ISSUER, jwksUrl: attacker.jwksUrl, audience: AUDIENCE, jwksCa: bundle(), now: () => clock });
    const before = attacker.fetches;
    assert.equal((await reach.verify(bearer(attacker.mint(claims())))).ok, true);
    assert.equal(attacker.fetches - before, 1);
  });

  for (const [label, kid, reason] of [["a kid the real key set serves", "es-1", "signature"], ["a kid only the attacker serves (the refetch path live)", "atk-1", "unknown-kid"]] as const) {
    void it(`${label}: the attacker's key set, named in every header, is never fetched`, async () => {
      const v = mk({ jwksCa: bundle() });
      const own = attacker.keys.find((k) => k.kid === kid) ?? attacker.rotate(kid);
      const before = attacker.fetches;
      const token = attacker.mint(claims(), { signer: own, header: { jku: attacker.jwksUrl, x5u: attacker.jwksUrl, jwk: own.jwk, x5c: ["AAAA"], x5t: "AAAA" } });
      const verdict = await v.verify(bearer(token));
      console.log(`H8 | ${kid} | attacker fetches ${String(attacker.fetches - before)} | configured fetches ${String(v.jwks.fetches)} | ${verdict.ok ? "ACCEPTED" : String(verdict.reason)}`);
      assert.equal(verdict.ok, false);
      assert.equal(verdict.reason, reason);
      assert.equal(attacker.fetches, before, "the attacker's key set was never requested");
    });
  }
});

void describe("the JWKS client (J1–J6, WO §3.4)", () => {
  const TTL_MS = 300_000;

  void it("J2 cache hit: two verifications, one fetch; past the TTL, a second fetch", async () => {
    const v = mk();
    const t0 = issuer.fetches;
    assert.equal((await v.verify(bearer(issuer.mint(claims())))).ok, true);
    assert.equal((await v.verify(bearer(issuer.mint(claims(), { using: "ed-1" })))).ok, true);
    const within = issuer.fetches - t0;
    const saved = clock;
    clock += TTL_MS + 1;
    try {
      assert.equal((await v.verify(bearer(issuer.mint(claims())))).ok, true);
    } finally {
      clock = saved;
    }
    console.log(`JWKS | cache hit | fetches within TTL ${String(within)} | after TTL ${String(issuer.fetches - t0)}`);
    assert.equal(within, 1);
    assert.equal(issuer.fetches - t0, 2);
  });

  void it("J3 unknown kid: one refetch finds a rotated key; a second unknown kid in the window gets none, and 401", async () => {
    const v = mk();
    assert.equal((await v.verify(bearer(issuer.mint(claims())))).ok, true);
    const t0 = issuer.fetches;
    const rotated = issuer.rotate(`rot-${String(t0)}`);
    const first = await v.verify(bearer(issuer.mint(claims(), { signer: rotated })));
    const afterFirst = issuer.fetches - t0;
    const second = await v.verify(bearer(issuer.mint(claims(), { header: { kid: "never-served" } })));
    const afterSecond = issuer.fetches - t0;
    console.log(`JWKS | unknown kid (rotated) | refetches ${String(afterFirst)} | ${first.ok ? "verified" : String(first.reason)}`);
    console.log(`JWKS | second unknown kid in TTL | refetches ${String(afterSecond - afterFirst)} | ${second.ok ? "ACCEPTED" : `401 ${String(second.reason)}`}`);
    assert.equal(first.ok, true);
    assert.equal(afterFirst, 1);
    assert.equal(second.ok, false);
    assert.equal(second.reason, "unknown-kid");
    assert.equal(afterSecond, 1, "no second refetch inside the window");
  });

  void it("J3 a burst of verifications on a cold cache shares one fetch (adversarial A9)", async () => {
    const v = mk();
    const t0 = issuer.fetches;
    const verdicts = await Promise.all(Array.from({ length: 50 }, () => v.verify(bearer(issuer.mint(claims())))));
    assert.ok(verdicts.every((x) => x.ok));
    assert.equal(issuer.fetches - t0, 1);
  });

  void it("J3 a burst of unknown kids at once costs one refetch", async () => {
    const v = mk();
    assert.equal((await v.verify(bearer(issuer.mint(claims())))).ok, true);
    const t0 = issuer.fetches;
    const verdicts = await Promise.all(Array.from({ length: 50 }, (_, i) => v.verify(bearer(issuer.mint(claims(), { header: { kid: `burst-${String(i)}` } })))));
    assert.ok(verdicts.every((x) => !x.ok && x.reason === "unknown-kid"));
    assert.equal(issuer.fetches - t0, 1);
  });

  void it("J4 issuer down with a warm cache: verified; with a cold cache: 401; with an expired cache: 401", async () => {
    const warm = mk();
    assert.equal((await warm.verify(bearer(issuer.mint(claims())))).ok, true);
    issuer.mode = "down";
    const saved = clock;
    try {
      const w = await warm.verify(bearer(issuer.mint(claims())));
      const c = await mk().verify(bearer(issuer.mint(claims())));
      clock += TTL_MS + 1;
      const e = await warm.verify(bearer(issuer.mint(claims())));
      console.log(`JWKS | issuer down, warm cache | ${w.ok ? "verified" : String(w.reason)}`);
      console.log(`JWKS | issuer down, cold cache | ${c.ok ? "ACCEPTED" : `401 ${String(c.reason)}`}`);
      console.log(`JWKS | issuer down, expired cache | ${e.ok ? "ACCEPTED" : `401 ${String(e.reason)}`}`);
      assert.equal(w.ok, true);
      assert.equal(c.ok, false);
      assert.equal(c.reason, "jwks-unavailable");
      assert.equal(e.ok, false);
      assert.equal(e.reason, "jwks-unavailable");
    } finally {
      issuer.mode = "ok";
      clock = saved;
    }
  });

  void it("J4 a failed refetch for an unknown kid keeps the warm cache", async () => {
    const v = mk();
    assert.equal((await v.verify(bearer(issuer.mint(claims())))).ok, true);
    issuer.mode = "down";
    try {
      // CSR-WO-1003a (adversarial A1): the kid may be a genuine new key, so a refetch that did not land is an outage.
      assert.equal(why(await v.verify(bearer(issuer.mint(claims(), { header: { kid: "unknown-while-down" } })))), "jwks-unavailable");
      assert.equal((await v.verify(bearer(issuer.mint(claims())))).ok, true, "the cache survived the failed refetch");
    } finally {
      issuer.mode = "ok";
    }
  });

  void it("J4 a failing issuer is not hammered: one fetch per cooldown, whatever the request rate (adversarial A2)", async () => {
    const v = mk();
    issuer.mode = "down";
    const saved = clock;
    try {
      const t0 = issuer.fetches;
      for (let i = 0; i < 30; i++) assert.equal(why(await v.verify(bearer(issuer.mint(claims())))), "jwks-unavailable");
      const within = issuer.fetches - t0;
      clock += JWKS_FAILURE_COOLDOWN_MS + 1;
      assert.equal(why(await v.verify(bearer(issuer.mint(claims())))), "jwks-unavailable");
      console.log(`JWKS | issuer down, cold cache, 30 requests | fetches ${String(within)} | after the cooldown ${String(issuer.fetches - t0)}`);
      assert.equal(within, 1);
      assert.equal(issuer.fetches - t0, 2);
      issuer.mode = "ok";
      clock += JWKS_FAILURE_COOLDOWN_MS + 1;
      assert.equal((await v.verify(bearer(issuer.mint(claims())))).ok, true, "recovers once the issuer is back");
    } finally {
      issuer.mode = "ok";
      clock = saved;
    }
  });

  void it("J4 an untrusted certificate is a fetch failure: the trust is this client's, not the process's", async () => {
    const v = new JwtVerifier({ issuer: ISSUER, jwksUrl: issuer.jwksUrl, audience: AUDIENCE, now: () => clock });
    const verdict = await v.verify(bearer(issuer.mint(claims())));
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, "jwks-unavailable");
  });

  void it("J5 WO §5.7: a 10 MB key set that is valid JSON is refused at the cap", async () => {
    issuer.body = JSON.stringify({ keys: issuer.keys.map((k) => k.jwk), pad: "x".repeat(10 * 1024 * 1024) });
    try {
      const t = performance.now();
      const verdict = await mk().verify(bearer(issuer.mint(claims())));
      console.log(`JWKS | 10 MB key set | ${verdict.ok ? "ACCEPTED" : `401 ${String(verdict.reason)}`} | ${(performance.now() - t).toFixed(0)} ms`);
      assert.equal(verdict.ok, false);
      assert.equal(verdict.reason, "jwks-unavailable");
    } finally {
      issuer.body = undefined;
    }
  });

  void it(`J5 ${String(JWKS_MAX_KEYS)} keys are served; ${String(JWKS_MAX_KEYS + 1)} are refused`, async () => {
    const pad = (n: number): unknown[] => [...issuer.keys.map((k) => k.jwk), ...Array.from({ length: n - issuer.keys.length }, (_, i) => ({ kty: "EC", kid: `pad-${String(i)}` }))];
    try {
      issuer.body = JSON.stringify({ keys: pad(JWKS_MAX_KEYS) });
      assert.equal((await mk().verify(bearer(issuer.mint(claims())))).ok, true);
      issuer.body = JSON.stringify({ keys: pad(JWKS_MAX_KEYS + 1) });
      const verdict = await mk().verify(bearer(issuer.mint(claims())));
      assert.equal(verdict.ok, false);
      assert.equal(verdict.reason, "jwks-unavailable");
    } finally {
      issuer.body = undefined;
    }
  });

  void it("J5 a key set that is not a key set, or has a duplicate key, is refused", async () => {
    for (const body of ['{"keys":{}}', "[]", `{"keys":[],"keys":${JSON.stringify(issuer.keys.map((k) => k.jwk))}}`]) {
      issuer.body = body;
      try {
        const verdict = await mk().verify(bearer(issuer.mint(claims())));
        assert.equal(verdict.ok, false, body.slice(0, 20));
        assert.equal(verdict.reason, "jwks-unavailable");
      } finally {
        issuer.body = undefined;
      }
    }
  });

  void it("J6 a redirect is not followed", async () => {
    issuer.mode = "redirect";
    try {
      const t0 = issuer.fetches;
      const verdict = await mk().verify(bearer(issuer.mint(claims())));
      assert.equal(verdict.ok, false);
      assert.equal(verdict.reason, "jwks-unavailable");
      assert.equal(issuer.fetches - t0, 1, "the Location was never requested");
    } finally {
      issuer.mode = "ok";
    }
  });

  void it("J6 a key set that never answers times out at 3 s", { timeout: 10_000 }, async () => {
    issuer.mode = "hang";
    try {
      const t = performance.now();
      const verdict = await mk().verify(bearer(issuer.mint(claims())));
      const ms = performance.now() - t;
      console.log(`JWKS | hanging key set | ${verdict.ok ? "ACCEPTED" : `401 ${String(verdict.reason)}`} | ${ms.toFixed(0)} ms`);
      assert.equal(verdict.ok, false);
      assert.equal(verdict.reason, "jwks-unavailable");
      assert.ok(ms >= 2_900 && ms < 6_000, String(ms));
    } finally {
      issuer.mode = "ok";
    }
  });

  void it("J6 a key set dripped one byte every 400 ms is cut off at the 3 s deadline (adversarial A1)", { timeout: 10_000 }, async () => {
    issuer.mode = "drip";
    try {
      const v = mk();
      const t = performance.now();
      const [first, second] = await Promise.all([v.verify(bearer(issuer.mint(claims()))), v.verify(bearer(issuer.mint(claims(), { using: "ed-1" })))]);
      const ms = performance.now() - t;
      console.log(`JWKS | key set dripped 1 byte / 400 ms | ${first.ok ? "ACCEPTED" : `401 ${String(first.reason)}`} | ${ms.toFixed(0)} ms`);
      assert.equal(why(first), "jwks-unavailable");
      assert.equal(why(second), "jwks-unavailable");
      assert.ok(ms >= 2_900 && ms < 4_500, String(ms));
    } finally {
      issuer.mode = "ok";
    }
  });

  void it("J1 a key-set URL that is not https refuses construction", () => {
    for (const jwksUrl of ["http://127.0.0.1/jwks", "file:///etc/passwd", "not a url"]) {
      assert.throws(() => mk({ jwksUrl }), JwksConfigError, jwksUrl);
    }
  });
});

void describe("WO §5.6: the clock stepped backwards 10 minutes mid-run", () => {
  void it("a token minted before the step is refused once it is outside skew; the cache is not stretched", async () => {
    const v = mk();
    const token = issuer.mint(claims());
    assert.equal((await v.verify(bearer(token))).ok, true);
    const t0 = issuer.fetches;
    const saved = clock;
    clock -= 600_000;
    try {
      const verdict = await v.verify(bearer(token));
      console.log(`CLOCK | stepped back 600 s | minted before the step: ${verdict.ok ? "ACCEPTED" : String(verdict.reason)}`);
      assert.equal(verdict.ok, false);
      assert.equal(verdict.reason, "nbf");
      // A token minted on the new clock verifies, and the cache is refreshed rather than trusted
      // for the extra ten minutes the step would otherwise add.
      assert.equal((await v.verify(bearer(issuer.mint(claims())))).ok, true);
      assert.equal(issuer.fetches - t0, 1, "a step back expires the cache");
      const iatOnly = issuer.mint(claims({ nbf: undefined, iat: nowS() + 600 }));
      const r = await v.verify(bearer(iatOnly));
      console.log(`CLOCK | iat 600 s in the future | ${r.ok ? "ACCEPTED" : String(r.reason)}`);
      assert.equal(r.ok, false);
      assert.equal(r.reason, "iat");
    } finally {
      clock = saved;
    }
  });

  void it("a step back does not hold the unknown-kid refetch window shut", async () => {
    const v = mk();
    assert.equal((await v.verify(bearer(issuer.mint(claims(), { header: { kid: "not-yet" } })))).ok, false);
    const saved = clock;
    clock -= 600_000;
    try {
      const rotated = issuer.rotate(`after-step-${String(issuer.fetches)}`);
      assert.equal((await v.verify(bearer(issuer.mint(claims(), { signer: rotated })))).ok, true);
    } finally {
      clock = saved;
    }
  });
});

void describe("configuration (G1, WO §1.1)", () => {
  const env = (over: Record<string, string>): NodeJS.ProcessEnv => ({ AUTH_ISSUER: ISSUER, AUTH_JWKS_URL: "https://127.0.0.1:9/jwks", AUTH_AUDIENCE: AUDIENCE, ...over });

  void it("a blank issuer, key-set URL or audience refuses start, naming the variable", () => {
    for (const name of ["AUTH_ISSUER", "AUTH_JWKS_URL", "AUTH_AUDIENCE"]) {
      assert.throws(() => jwtVerifierFromEnv(env({ [name]: "" })), new RegExp(`${name} is not configured`));
      assert.throws(() => jwtVerifierFromEnv(env({ [name]: "   " })), AuthConfigError);
    }
    assert.ok(jwtVerifierFromEnv(env({})) instanceof JwtVerifier);
  });

  void it("AUTH_ALGS naming an algorithm this verifier does not implement refuses start (HS256, none, PS256)", () => {
    for (const a of ["HS256", "none", "PS256", "ES256,HS256"]) assert.throws(() => jwtVerifierFromEnv(env({ AUTH_ALGS: a })), AuthConfigError, a);
  });

  void it("a skew or TTL that is not a sane number refuses start", () => {
    for (const s of ["abc", "-1", "301"]) assert.throws(() => jwtVerifierFromEnv(env({ AUTH_CLOCK_SKEW_S: s })), AuthConfigError, s);
    for (const s of ["abc", "0", "-5", "29", "86401", "1e9"]) assert.throws(() => jwtVerifierFromEnv(env({ AUTH_JWKS_TTL_S: s })), JwksConfigError, s);
    for (const s of ["30", "86400"]) assert.ok(jwtVerifierFromEnv(env({ AUTH_JWKS_TTL_S: s })) instanceof JwtVerifier, s);
  });

  void it("the skew is the stated constant, and configurable: exp 30 s ago is refused under AUTH_CLOCK_SKEW_S=0", async () => {
    const verdict = await mk({ clockSkewS: 0 }).verify(bearer(issuer.mint(claims({ exp: nowS() - 30 }))));
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, "exp");
  });
});

void describe("red-team F3: an RSA key is used only with an odd exponent of at least 65537 and a 2048 to 8192 bit modulus", () => {
  const SHA256_DIGEST_INFO = Buffer.from("3031300d060960864801650304020105000420", "hex");
  /** The EMSA-PKCS1-v1_5 encoding of SHA-256(input), k bytes long. With e = 1 it is its own
   *  signature: s^1 mod n = s. No private key is involved. */
  const encoded = (input: string, k: number): Buffer => {
    const t = Buffer.concat([SHA256_DIGEST_INFO, createHash("sha256").update(input).digest()]);
    return Buffer.concat([Buffer.from([0, 1]), Buffer.alloc(k - t.length - 3, 0xff), Buffer.from([0]), t]);
  };
  /** A served RSA JWK with a real 2048-bit modulus and a chosen exponent (unusable as a signer). */
  const serve = (kid: string, n: string, e: string): void => {
    const k = key(kid, "RS256");
    k.jwk = { kty: "RSA", kid, alg: "RS256", use: "sig", n, e };
    issuer.rotate(kid, k);
  };
  const modulus = (bits: number): string => {
    const b = randomBytes(bits / 8);
    b[0] = (b[0] ?? 0) | 0x80;
    b[b.length - 1] = (b[b.length - 1] ?? 0) | 1;
    return b.toString("base64url");
  };

  void it("the e=1 forgery: node:crypto verifies it against that key, and the verifier refuses it", async () => {
    const n = String((issuer.keys.find((k) => k.kid === "rs-1") as SigningKey).jwk["n"]);
    serve("rs-e1", n, "AQ");
    const input = `${seg({ alg: "RS256", typ: "at+jwt", kid: "rs-e1" })}.${seg(claims({ sub: "forged" }))}`;
    const signature = encoded(input, 256);
    // The forgery is real: without the exponent rule, this is a valid RS256 signature.
    const e1 = createPublicKey({ key: { kty: "RSA", n, e: "AQ" }, format: "jwk" });
    assert.equal(cryptoVerify("sha256", Buffer.from(input), e1, signature), true, "the e=1 forgery verifies under node:crypto");
    const verdict = await mk().verify(bearer(`${input}.${signature.toString("base64url")}`));
    console.log(`F3 | e=1 forged token (no private key) | ${verdict.ok ? `ACCEPTED as ${verdict.principal.id}` : String(verdict.reason)}`);
    assert.equal(verdict.ok, false);
    assert.equal(why(verdict), "key-mismatch");
  });

  void it("exponents 3 and 65538 (even) and a 16384-bit modulus are never used; 65537 up to 8192 bits is", () => {
    const n = String((issuer.keys.find((k) => k.kid === "rs-1") as SigningKey).jwk["n"]);
    const three = Buffer.from([3]).toString("base64url");
    const even = Buffer.from([1, 0, 2]).toString("base64url");
    const f4 = Buffer.from([1, 0, 1]).toString("base64url");
    assert.equal(importKey({ kty: "RSA", n, e: three }, "RS256"), undefined, "e = 3");
    assert.equal(importKey({ kty: "RSA", n, e: even }, "RS256"), undefined, "e = 65538, even");
    assert.equal(importKey({ kty: "RSA", n: modulus(16384), e: f4 }, "RS256"), undefined, "16384 bits");
    assert.equal(importKey({ kty: "RSA", n: modulus(8200), e: f4 }, "RS256"), undefined, "8200 bits");
    assert.notEqual(importKey({ kty: "RSA", n: modulus(8192), e: f4 }, "RS256"), undefined, "8192 bits, e = 65537");
    assert.notEqual(importKey({ kty: "RSA", n, e: f4 }, "RS256"), undefined, "2048 bits, e = 65537");
  });

  void it("20 keys of 16384 bits under one kid (as many as fit the 64 KiB cap) cost no signature work: refused fast", async () => {
    const huge = Array.from({ length: 20 }, () => ({ kty: "RSA", kid: "rs-huge", alg: "RS256", use: "sig", n: modulus(16384), e: "AQAB" }));
    issuer.body = JSON.stringify({ keys: huge });
    try {
      const token = `${seg({ alg: "RS256", typ: "at+jwt", kid: "rs-huge" })}.${seg(claims())}.${Buffer.alloc(2048).toString("base64url")}`;
      const v = mk();
      await v.verify(bearer(token)); // warms the cache
      const t = performance.now();
      const verdict = await v.verify(bearer(token));
      const ms = performance.now() - t;
      console.log(`F3 | 20 x 16384-bit keys under one kid | ${String(why(verdict))} | ${ms.toFixed(1)} ms`);
      assert.equal(why(verdict), "key-mismatch");
      assert.ok(ms < 50, String(ms));
    } finally {
      issuer.body = undefined;
    }
  });
});

void describe("red-team F5: header, payload and key set decode as strict UTF-8", () => {
  /** A validly signed token whose payload bytes carry `sub` as the given raw bytes. */
  const withSubBytes = (subBytes: number[]): string => {
    const json = JSON.stringify(claims({ sub: "@@SUB@@" }));
    const [before, after] = json.split("@@SUB@@") as [string, string];
    const payload = Buffer.concat([Buffer.from(before), Buffer.from(subBytes), Buffer.from(after)]);
    return issuer.sign(`${seg(hdr())}.${payload.toString("base64url")}`);
  };

  void it("sub bytes 75 FF, 75 FE and 75 C0 are refused; 75 EF BF BD (a real U+FFFD) is a different, valid principal", async () => {
    const rows: string[] = [];
    const refused: string[] = [];
    for (const bytes of [[0x75, 0xff], [0x75, 0xfe], [0x75, 0xc0]]) {
      const verdict = await mk().verify(bearer(withSubBytes(bytes)));
      rows.push(`F5 | sub bytes ${Buffer.from(bytes).toString("hex")} | ${verdict.ok ? `ACCEPTED as ${JSON.stringify(verdict.principal.id)}` : String(verdict.reason)}`);
      refused.push(String(why(verdict)));
    }
    const real = await mk().verify(bearer(withSubBytes([0x75, 0xef, 0xbf, 0xbd])));
    rows.push(`F5 | sub bytes 75efbfbd | ${real.ok ? `accepted as ${JSON.stringify(real.principal.id)}` : String(real.reason)}`);
    console.log(rows.join("\n"));
    assert.deepEqual(refused, ["payload", "payload", "payload"]);
    assert.deepEqual(real, { ok: true, principal: { id: "u�" } });
  });

  void it("a header with an invalid byte is refused", async () => {
    const h = Buffer.concat([Buffer.from('{"alg":"ES256","typ":"at+jwt","kid":"es-1","x":"'), Buffer.from([0xff]), Buffer.from('"}')]);
    assert.equal(why(await mk().verify(bearer(issuer.sign(`${h.toString("base64url")}.${seg(claims())}`)))), "header");
  });

  void it("a key set with an invalid byte is refused", async () => {
    const good = JSON.stringify({ keys: issuer.keys.map((k) => k.jwk) });
    // The same key set with one extra top-level member whose value holds an invalid byte: valid
    // JSON either way, so only the UTF-8 check refuses it.
    issuer.body = Buffer.concat([Buffer.from(good.slice(0, -1)), Buffer.from(',"x":"'), Buffer.from([0xff]), Buffer.from('"}')]);
    try {
      const verdict = await mk().verify(bearer(issuer.mint(claims())));
      console.log(`F5 | key set with an invalid byte | ${verdict.ok ? "ACCEPTED" : String(verdict.reason)}`);
      assert.equal(why(verdict), "jwks-unavailable");
    } finally {
      issuer.body = undefined;
    }
  });
});
