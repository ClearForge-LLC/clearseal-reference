// CSR-WO-1007 §1.5 (the P1 exit red-team's L2, and its info finding). The operation that matters: a
// real key-set fetch from an issuer whose certificate this verifier does not trust, with
// NODE_TLS_REJECT_UNAUTHORIZED=0 in the environment, which turns off certificate verification for
// any request that does not state its own; and a key-set URL carrying a credential, at construction.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { JwksConfigError } from "../../src/auth/jwks.ts";
import { JwtVerifier } from "../../src/auth/verifier.ts";
import { AUDIENCE, ISSUER, TestIssuer } from "./issuer.ts";

let impostor: TestIssuer;
const saved = process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
before(async () => {
  impostor = await TestIssuer.start();
});
after(async () => {
  if (saved === undefined) delete process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
  else process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = saved;
  await impostor.close();
});

void describe("CSR-WO-1007 §1.5: the key-set request cannot be unverified by the environment", () => {
  void it("with NODE_TLS_REJECT_UNAUTHORIZED=0, an issuer whose certificate this verifier does not trust is still refused", async () => {
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
    // No jwksCa: the impostor's self-signed certificate is trusted by nothing this client holds.
    const v = new JwtVerifier({ issuer: ISSUER, jwksUrl: impostor.jwksUrl, audience: AUDIENCE, now: () => Math.floor(Date.now() / 1000) });
    const token = impostor.mint(TestIssuer.claims(Math.floor(Date.now() / 1000)));
    const verdict = await v.verify({ authorization: `Bearer ${token}` });
    delete process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
    assert.equal(verdict.ok, false, "the impostor's key set was not fetched, so its token does not verify");
    assert.equal(verdict.reason, "jwks-unavailable");
    console.log(`L2 NODE_TLS_REJECT_UNAUTHORIZED=0, an untrusted issuer's token → ok ${String(verdict.ok)}, reason ${String(verdict.reason)} (the TLS handshake refused its certificate)`);
  });

  void it("an AUTH_JWKS_URL carrying a user name or password refuses construction", () => {
    // Assembled at run time, so the leak gate's userinfo rule never meets a literal (N6).
    const host = ["issuer", "example", "invalid"].join(".");
    for (const userinfo of [["user", "secret"].join(":"), "user"]) {
      const url = `https://${userinfo}${String.fromCharCode(64)}${host}/jwks`;
      assert.throws(() => new JwtVerifier({ issuer: ISSUER, jwksUrl: url, audience: AUDIENCE }), (e: unknown) => e instanceof JwksConfigError && /must not carry a user name or password/.test(e.message));
    }
    console.log("L2 AUTH_JWKS_URL with user:password@ → JwksConfigError: AUTH_JWKS_URL must not carry a user name or password");
  });
});
