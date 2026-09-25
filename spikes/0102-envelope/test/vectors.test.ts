// Cross-language vectors (WO §1.2.2, N3): the bytes come from the Python oracle
// (oracle/gen_vectors.py) and are committed under vectors/. The TypeScript side never generates
// what it is checked against; it must (1) accept every oracle vector and (2) produce byte-identical
// output from the same inputs. For option A it must also show that no normalization happened.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import * as A from "../option-a.ts";
import * as B from "../option-b.ts";
import * as C from "../option-c.ts";
import { ALERT_SCHEMA, type Alert, FIXTURE_PRIVATE_KEY, FIXTURE_PUBLIC_KEY, NonceStore, rawPublicKey, type SignInput } from "../common.ts";
import { allowlist, sha256 } from "./harness.ts";

interface VectorInput {
  v: number;
  sender_id: string;
  origin_class: string;
  key_id: string;
  issued_at: number;
  nonce: string;
  alert: Alert;
}

interface Vector {
  name: string;
  input: VectorInput;
  now: number;
  text_utf8: string;
  signed_bytes_b64: string;
  wire_b64: string;
  request?: { method: string; url: string; headers: [string, string][]; body_b64: string };
  jws?: string;
  payload_b64?: string;
}

function load(option: string): { fixture_public_key_b64: string; vectors: Vector[] } {
  return JSON.parse(readFileSync(new URL(`../vectors/${option}.json`, import.meta.url), "utf8")) as { fixture_public_key_b64: string; vectors: Vector[] };
}

const b64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64"));
const toInput = ({ alert, ...rest }: VectorInput): SignInput => ({ ...rest, payload: alert });
const ctx = (now: number): { now: number; nonces: NonceStore } => ({ now, nonces: new NonceStore() });
const spacedHex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");

function assertSameBytes(label: string, ts: Uint8Array, py: Uint8Array): void {
  assert.ok(Buffer.from(ts).equals(Buffer.from(py)), `${label}: TypeScript and Python bytes differ`);
  console.log(`${label}: ${String(ts.length)} bytes, sha256 ts=${sha256(ts)} py=${sha256(py)}`);
}

for (const option of ["option-a", "option-b", "option-c"]) {
  void describe(`${option}: oracle vectors`, () => {
    void it("the oracle signed with the WO's fixture key", () => {
      assert.equal(load(option).fixture_public_key_b64, Buffer.from(rawPublicKey(FIXTURE_PUBLIC_KEY)).toString("base64"));
    });
  });
}

void describe("option A: oracle vectors", () => {
  const { vectors } = load("option-a");
  for (const v of vectors) {
    void it(`${v.name}: TypeScript verifies the oracle's wire and signs the identical bytes`, () => {
      const verdict = A.verify(b64(v.wire_b64), allowlist(), "warn", ctx(v.now));
      assert.equal(verdict.accepted, true, verdict.accepted ? "" : `${verdict.gate}/${verdict.check}: ${verdict.detail}`);
      assertSameBytes(`A ${v.name} canonical`, A.canonicalBytes(toInput(v.input), ALERT_SCHEMA), b64(v.signed_bytes_b64));
      assertSameBytes(`A ${v.name} wire`, A.sign(toInput(v.input), FIXTURE_PRIVATE_KEY), b64(v.wire_b64));
    });
  }

  void it("M5: the signed bytes end with the payload text exactly as given — no normalization, no trimming", () => {
    for (const v of vectors) {
      const signed = b64(v.signed_bytes_b64);
      const text = new TextEncoder().encode(v.input.alert.text);
      assert.equal(spacedHex(text), v.text_utf8);
      // The last canonical field is alert.text: uint32_be(length) ‖ bytes.
      const tail = signed.subarray(signed.length - text.length - 4);
      assert.equal(new DataView(tail.buffer, tail.byteOffset).getUint32(0, false), text.length);
      assert.equal(spacedHex(tail.subarray(4)), v.text_utf8);
      console.log(`A ${v.name}: signed tail ${spacedHex(tail)}`);
    }
    const byName = new Map(vectors.map((v) => [v.name, v]));
    const composed = byName.get("m5-composed");
    const decomposed = byName.get("m5-decomposed");
    const nbsp = byName.get("m5-nbsp");
    assert.ok(composed && decomposed && nbsp);
    assert.equal(composed.input.alert.text.normalize("NFC"), decomposed.input.alert.text.normalize("NFC"), "the two render the same under NFC");
    assert.notEqual(composed.signed_bytes_b64, decomposed.signed_bytes_b64, "and are signed as different bytes");
    assert.ok(spacedHex(b64(nbsp.signed_bytes_b64)).endsWith("63 6c 65 61 72 c2 a0"), "U+00A0 is signed, not stripped");
  });

  void it("M5: a composed-text signature does not verify decomposed text (the verifier does not normalize either)", () => {
    const decomposed = load("option-a").vectors.find((v) => v.name === "m5-decomposed");
    assert.ok(decomposed);
    const swapped = Buffer.from(b64(decomposed.wire_b64)).toString("utf8").replace("café", "café");
    const verdict = A.verify(new TextEncoder().encode(swapped), allowlist(), "warn", ctx(decomposed.now));
    assert.deepEqual(verdict.accepted ? "accepted" : `${verdict.gate}/${verdict.check}`, "signature/bad-signature");
  });
});

void describe("option B: oracle vectors", () => {
  for (const v of load("option-b").vectors) {
    void it(`${v.name}: TypeScript verifies the oracle's request and signs the identical bytes`, async () => {
      assert.ok(v.request);
      const request: B.RequestB = { method: v.request.method, url: v.request.url, headers: Object.fromEntries(v.request.headers), body: b64(v.request.body_b64) };
      const verdict = B.verify(request, allowlist(), "warn", ctx(v.now));
      assert.equal(verdict.accepted, true, verdict.accepted ? "" : `${verdict.gate}/${verdict.check}: ${verdict.detail}`);
      assertSameBytes(`B ${v.name} wire`, B.toHttp1(await B.sign(toInput(v.input), FIXTURE_PRIVATE_KEY)), b64(v.wire_b64));
      assert.ok(Buffer.from(request.body).toString("hex").endsWith(Buffer.from(v.text_utf8.replaceAll(" ", ""), "hex").toString("hex") + "227d7d"), "body carries the text bytes as given");
    });
  }
});

void describe("option C: oracle vectors", () => {
  for (const v of load("option-c").vectors) {
    void it(`${v.name}: TypeScript verifies the oracle's token and signs the identical bytes`, async () => {
      assert.ok(v.jws !== undefined && v.payload_b64 !== undefined);
      const verdict = await C.verify({ jws: v.jws, payload: b64(v.payload_b64) }, allowlist(), "warn", ctx(v.now));
      assert.equal(verdict.accepted, true, verdict.accepted ? "" : `${verdict.gate}/${verdict.check}: ${verdict.detail}`);
      assertSameBytes(`C ${v.name} wire`, C.toWireBytes(await C.sign(toInput(v.input), FIXTURE_PRIVATE_KEY)), b64(v.wire_b64));
    });
  }
});
