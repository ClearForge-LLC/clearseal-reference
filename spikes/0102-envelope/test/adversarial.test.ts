// Regressions from the CSR-WO-0102 adversarial pass (WO §5) that the spike fixed or must hold.
// Findings recorded but deliberately not fixed (duplicate JSON keys, number forms, B's URL
// binding) are measurements; they are in FEEDBACK, not pinned here.

import assert from "node:assert/strict";
import { createHmac, sign as edSign } from "node:crypto";
import { describe, it } from "node:test";

import { compactVerify } from "jose";

import * as A from "../option-a.ts";
import * as B from "../option-b.ts";
import * as C from "../option-c.ts";
import { FIXTURE_PRIVATE_KEY, FIXTURE_PUBLIC_KEY, NonceStore, rawPublicKey, type Verdict } from "../common.ts";
import { allowlist, input, NOW } from "./harness.ts";

const show = (v: Verdict<unknown>): string => (v.accepted ? "accepted" : `${v.gate}/${v.check}`);

void describe("replay after the verifier clock steps back (finding F1, fixed)", () => {
  const options = {
    A: async (i: ReturnType<typeof input>) => Promise.resolve(A.sign(i, FIXTURE_PRIVATE_KEY)),
    B: (i: ReturnType<typeof input>) => B.sign(i, FIXTURE_PRIVATE_KEY),
    C: (i: ReturnType<typeof input>) => C.sign(i, FIXTURE_PRIVATE_KEY),
  };
  const verify = {
    A: (w: unknown, now: number, nonces: NonceStore) => Promise.resolve(A.verify(w as Uint8Array, allowlist(), "info", { now, nonces })),
    B: (w: unknown, now: number, nonces: NonceStore) => Promise.resolve(B.verify(w as B.RequestB, allowlist(), "info", { now, nonces })),
    C: (w: unknown, now: number, nonces: NonceStore) => C.verify(w as C.DetachedJws, allowlist(), "info", { now, nonces }),
  };
  for (const name of ["A", "B", "C"] as const) {
    void it(`option ${name}: accepted at NOW, a later message prunes at NOW+301, the first replayed at NOW+10 is refused`, async () => {
      const nonces = new NonceStore();
      const first = await options[name](input());
      assert.equal(show(await verify[name](first, NOW, nonces)), "accepted");
      assert.equal(show(await verify[name](await options[name](input({ issued_at: NOW + 301 })), NOW + 301, nonces)), "accepted");
      assert.equal(show(await verify[name](first, NOW + 10, nonces)), "signature/stale");
    });
  }
});

void describe("option C: alg confusion (WO §5.4)", () => {
  const b64url = (b: Uint8Array | string): string => Buffer.from(b).toString("base64url");
  const header = (alg: string): string => b64url(JSON.stringify({ alg, typ: C.TYP, kid: "test-fixture-key", iat: NOW, exp: NOW + 300, jti: "ALGCONFUSION0001" }));
  const payload = new TextEncoder().encode(JSON.stringify({ v: 1, sender_id: "node.alerter-example", origin_class: "system", alert: { severity: "info", text: "all clear" } }));
  const ctx = (): { now: number; nonces: NonceStore } => ({ now: NOW, nonces: new NonceStore() });
  const pem = FIXTURE_PUBLIC_KEY.export({ format: "pem", type: "spki" });
  const raw = rawPublicKey(FIXTURE_PUBLIC_KEY);

  void it('alg "none" is refused: empty signature, garbage signature, and a valid Ed25519 signature', async () => {
    const h = header("none");
    const input = `${h}.${b64url(payload)}`;
    for (const s of ["", b64url(new Uint8Array(64).fill(7)), b64url(edSign(null, Buffer.from(input), FIXTURE_PRIVATE_KEY))]) {
      const v = await C.verify({ jws: `${h}..${s}`, payload }, allowlist(), "info", ctx());
      assert.equal(v.accepted, false);
    }
  });

  void it('alg "HS256" keyed with the public key is refused: raw key bytes and SPKI PEM text', async () => {
    const h = header("HS256");
    for (const key of [raw, pem]) {
      const s = b64url(createHmac("sha256", key).update(`${h}.${b64url(payload)}`).digest());
      const v = await C.verify({ jws: `${h}..${s}`, payload }, allowlist(), "info", ctx());
      assert.equal(show(v), "structure/field");
    }
  });

  void it("measurement: jose alone, WITHOUT the algorithms option, accepts HS256 keyed with the raw public-key bytes", async () => {
    const h = header("HS256");
    const s = b64url(createHmac("sha256", raw).update(`${h}.${b64url(payload)}`).digest());
    const result = await compactVerify(`${h}.${b64url(payload)}.${s}`, raw);
    assert.equal(result.protectedHeader.alg, "HS256");
    // With the Ed25519 KeyObject itself, jose refuses on key type.
    await assert.rejects(compactVerify(`${h}.${b64url(payload)}.${s}`, FIXTURE_PUBLIC_KEY), TypeError);
  });
});
