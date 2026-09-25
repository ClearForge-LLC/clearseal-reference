// The WO §1.2.3 negative list, written once and run against each option through a small adapter.
// Every case asserts the gate AND the check that refused, so a refusal for the wrong reason fails.

import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, type KeyObject } from "node:crypto";
import { describe, it } from "node:test";

import { type Allowlist, type Effect, FIXTURE_PRIVATE_KEY, FIXTURE_PUBLIC_KEY, NonceStore, SerializationRefusal, type SignInput, type Verdict } from "../common.ts";

export const NOW = 1787700000;
export const SENDER = "node.alerter-example";
export const OTHER_SENDER = "node.other-example";
export const KID = "test-fixture-key";

let counter = 0;
/** A fresh, valid nonce per call. */
export function nonce(): string {
  counter++;
  return `N${String(counter).padStart(15, "0")}`;
}

export function input(over: Partial<SignInput> = {}): SignInput {
  return {
    v: 1,
    sender_id: SENDER,
    origin_class: "system",
    key_id: KID,
    issued_at: NOW,
    nonce: nonce(),
    payload: { severity: "info", text: "all clear" },
    ...over,
  };
}

export function allowlist(over: Partial<Allowlist> = {}, window: [number, number] = [NOW - 86400, NOW + 86400]): Allowlist {
  return {
    channel: "alerts",
    keys: [{ kid: KID, sender_id: SENDER, public_key: FIXTURE_PUBLIC_KEY, not_before: window[0], not_after: window[1] }],
    authors: [SENDER],
    ...over,
  };
}

export function sha256(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("base64");
}

/** Flips the lowest bit of the last byte of `needle` inside `bytes` (first occurrence). */
export function flipLastByteOf(bytes: Uint8Array, needle: string): Uint8Array {
  const at = Buffer.from(bytes).indexOf(needle);
  assert.ok(at >= 0, `needle "${needle}" not found`);
  const out = Uint8Array.from(bytes);
  const i = at + Buffer.byteLength(needle) - 1;
  out[i] = (out[i] as number) ^ 0x01;
  return out;
}

export interface Adapter<W> {
  sign: (input: SignInput, key?: KeyObject) => Promise<W>;
  /** Signed, carrying one field the contract does not have (signed over wherever the option can). */
  withUnknownField: (input: SignInput) => Promise<W>;
  /** One byte of the signed content flipped; the rest of the wire left consistent. */
  flipSignedByte: (w: W) => W;
  /** The same wire with its signature removed. */
  unsigned: (w: W) => W;
  /** The same wire whose JSON body/envelope text carries a lone-surrogate escape in alert.text. */
  withLoneSurrogateEscape: (w: W) => W;
  verify: (w: W, allowlist: Allowlist, floor: Effect, ctx: { now: number; nonces: NonceStore }) => Promise<Verdict<unknown>>;
}

function expectRefusal(v: Verdict<unknown>, gate: string, check: string): void {
  assert.equal(v.accepted, false, `expected a refusal by ${gate}/${check}, got acceptance`);
  if (!v.accepted) assert.deepEqual({ gate: v.gate, check: v.check }, { gate, check }, v.detail);
}

export function negatives<W>(name: string, a: Adapter<W>): void {
  const ctx = (now = NOW): { now: number; nonces: NonceStore } => ({ now, nonces: new NonceStore() });

  void describe(`${name}: WO §1.2.3 negatives`, () => {
    void it("baseline: a valid message is accepted", async () => {
      const v = await a.verify(await a.sign(input()), allowlist(), "info", ctx());
      assert.equal(v.accepted, true, v.accepted ? "" : `${v.gate}/${v.check}: ${v.detail}`);
    });

    void it("unknown field → refused (structure)", async () => {
      expectRefusal(await a.verify(await a.withUnknownField(input()), allowlist(), "info", ctx()), "structure", "unknown-field");
    });

    void it("wrong v → refused (structure), for 2, 0 and the string \"1\"", async () => {
      for (const bad of [2, 0, "1"]) {
        const w = await a.sign({ ...input(), v: bad as number });
        expectRefusal(await a.verify(w, allowlist(), "info", ctx()), "structure", "version");
      }
    });

    void it("expired → refused (gate 1: signature)", async () => {
      const w = await a.sign(input({ issued_at: NOW - 301 }));
      expectRefusal(await a.verify(w, allowlist(), "info", ctx()), "signature", "stale");
    });

    void it("issued beyond the future skew → refused (gate 1: signature)", async () => {
      const w = await a.sign(input({ issued_at: NOW + 61 }));
      expectRefusal(await a.verify(w, allowlist(), "info", ctx()), "signature", "future");
    });

    void it("replayed nonce → refused (gate 1: signature)", async () => {
      const c = ctx();
      const w = await a.sign(input());
      assert.equal((await a.verify(w, allowlist(), "info", c)).accepted, true);
      expectRefusal(await a.verify(w, allowlist(), "info", c), "signature", "replay");
    });

    void it("author not on the allowlist → refused (gate 2: author)", async () => {
      const w = await a.sign(input());
      expectRefusal(await a.verify(w, allowlist({ authors: [OTHER_SENDER] }), "info", ctx()), "author", "not-listed");
    });

    void it("listed author signing with another author's key → refused (gate 2: author)", async () => {
      const w = await a.sign(input({ sender_id: OTHER_SENDER }));
      expectRefusal(await a.verify(w, allowlist({ authors: [SENDER, OTHER_SENDER] }), "info", ctx()), "author", "key-not-author's");
    });

    void it("effect above the floor → refused (gate 3: effect)", async () => {
      const w = await a.sign(input({ payload: { severity: "critical", text: "all clear" } }));
      expectRefusal(await a.verify(w, allowlist(), "warn", ctx()), "effect", "above-floor");
    });

    void it("key outside its validity window → refused (gate 1: signature), both edges", async () => {
      const w1 = await a.sign(input());
      expectRefusal(await a.verify(w1, allowlist({}, [NOW - 86400, NOW - 1]), "info", ctx()), "signature", "key-window");
      const w2 = await a.sign(input());
      expectRefusal(await a.verify(w2, allowlist({}, [NOW + 1, NOW + 86400]), "info", ctx()), "signature", "key-window");
    });

    void it("lone surrogate → refused at serialization (signer) and at structure (verifier)", async () => {
      await assert.rejects(a.sign(input({ payload: { severity: "info", text: "bad \uD800 text" } })), SerializationRefusal);
      await assert.rejects(a.sign(input({ nonce: "AAAABBBBCCCC\uDC00DD" })), SerializationRefusal);
      expectRefusal(await a.verify(a.withLoneSurrogateEscape(await a.sign(input())), allowlist(), "info", ctx()), "structure", "lone-surrogate");
    });

    void it("signature valid but over different signed bytes (one flipped byte) → refused (gate 1: signature)", async () => {
      const w = a.flipSignedByte(await a.sign(input()));
      expectRefusal(await a.verify(w, allowlist(), "info", ctx()), "signature", "bad-signature");
    });

    void it("signed by a key that is not the listed one for its kid → refused (gate 1: signature)", async () => {
      const { privateKey } = generateKeyPairSync("ed25519");
      expectRefusal(await a.verify(await a.sign(input(), privateKey), allowlist(), "info", ctx()), "signature", "bad-signature");
    });

    void it("unsigned → refused (structure)", async () => {
      expectRefusal(await a.verify(a.unsigned(await a.sign(input())), allowlist(), "info", ctx()), "structure", "unsigned");
    });

    void it("unknown kid → refused (gate 1: signature)", async () => {
      expectRefusal(await a.verify(await a.sign(input({ key_id: "test-other-key" })), allowlist(), "info", ctx()), "signature", "unknown-key");
    });
  });
}

export { FIXTURE_PRIVATE_KEY };
