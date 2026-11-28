// CSR-WO-2004 §1.5: the provenance module against the spike's committed vectors, and one red-proof per
// structure check, per gate check, and per allowlist rule. Every refusal is asserted by its gate AND
// check, so a refusal for the wrong reason fails the test (RULES.md).

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { AllowlistError, type Channel, loadAllowlist, type ProvenanceKeyData } from "../../src/provenance/allowlist.ts";
import { ALERT_SCHEMA, type Alert, canonicalBytes, type EnvelopeFields, envelopeObject, type PayloadSchema, SerializationRefusal } from "../../src/provenance/envelope.ts";
import { type MessageInput, SignerError, signMessage } from "../../src/provenance/signer.ts";
import { MAX_WIRE_BYTES, ProvenanceVerifier, type ProvenanceVerdict } from "../../src/provenance/verify.ts";
import { CHANNEL, entry, FIXTURE_PUBLIC_KEY, FIXTURE_PUBLIC_RAW_B64, fixtureSigner, KID, keySigner, NOW, OTHER_KID, OTHER_SENDER, otherKeyPair, SENDER } from "./fixture.ts";

const text = (w: Uint8Array): string => Buffer.from(w).toString("utf8");
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

const input = (over: Partial<MessageInput<Alert>> = {}): MessageInput<Alert> => ({ sender_id: SENDER, issued_at: NOW, nonce: "AAAABBBBCCCCDDDD", payload: { severity: "info", text: "all clear" }, ...over });
const signed = (over: Partial<MessageInput<Alert>> = {}): Promise<Uint8Array> => signMessage(input(over), fixtureSigner);

interface Rig {
  v: ProvenanceVerifier;
  rows: { event: string; fields: Record<string, string | number> }[];
}
function rig(allowlist: readonly ProvenanceKeyData[] = [entry()], maxNonces?: number, schema?: PayloadSchema<Alert>): Rig {
  const rows: Rig["rows"] = [];
  const v = new ProvenanceVerifier<Alert>({ allowlist, audit: (event, fields) => rows.push({ event, fields }), ...(maxNonces === undefined ? {} : { maxNonces }), ...(schema === undefined ? {} : { schema }) });
  return { v, rows };
}

function refused(verdict: ProvenanceVerdict<unknown>, gate: string, check: string): void {
  assert.equal(verdict.accepted, false, `expected a refusal by ${gate}/${check}, got acceptance`);
  if (!verdict.accepted) assert.deepEqual({ gate: verdict.gate, check: verdict.check }, { gate, check });
}
const accepted = (verdict: ProvenanceVerdict<unknown>): void => {
  assert.equal(verdict.accepted, true, verdict.accepted ? "" : `refused by ${verdict.gate}/${verdict.check}`);
};

/** A wire whose envelope fields are signed exactly as given (v included), bypassing signMessage's v: 1,
 *  so a check's red-proof is accepted once that check alone is deleted. */
async function signedFields(over: Partial<Record<keyof EnvelopeFields<Alert>, unknown>>): Promise<Uint8Array> {
  const fields = { v: 1, sender_id: SENDER, origin_class: "system", key_id: KID, issued_at: NOW, nonce: "AAAABBBBCCCCDDDD", payload: { severity: "info", text: "all clear" }, ...over } as unknown as EnvelopeFields<Alert>;
  const signature = Buffer.from(await fixtureSigner.sign(canonicalBytes(fields, ALERT_SCHEMA))).toString("base64");
  return bytes(JSON.stringify({ envelope: envelopeObject(fields, ALERT_SCHEMA), signature }));
}

/** The wire with one textual replacement, which must occur exactly once. */
function edit(w: Uint8Array, from: string, to: string): Uint8Array {
  const t = text(w);
  assert.equal(t.split(from).length, 2, `"${from}" occurs once in the wire`);
  return bytes(t.replace(from, to));
}

/** The wire re-serialized after changing its parsed form. */
function reshape(w: Uint8Array, change: (wire: { envelope: Record<string, unknown>; signature?: unknown } & Record<string, unknown>) => void): Uint8Array {
  const wire = JSON.parse(text(w)) as { envelope: Record<string, unknown> } & Record<string, unknown>;
  change(wire);
  return bytes(JSON.stringify(wire));
}

void describe("CSR-WO-2004 vectors: the module signs the spike's committed vectors to the same bytes", () => {
  const file = JSON.parse(readFileSync(new URL("../../../../spikes/0102-envelope/vectors/option-a.json", import.meta.url), "utf8")) as {
    fixture_public_key_b64: string;
    vectors: { name: string; input: { v: number; sender_id: string; origin_class: string; key_id: string; issued_at: number; nonce: string; alert: Alert }; now: number; signed_bytes_b64: string; wire_b64: string }[];
  };

  void it("PV-1: the fixture key is CSR-WO-0102 §1.1's, and the oracle's", () => {
    const raw = Buffer.from(FIXTURE_PUBLIC_KEY.export({ format: "der", type: "spki" })).subarray(12).toString("base64");
    assert.equal(raw, FIXTURE_PUBLIC_RAW_B64);
    assert.equal(file.fixture_public_key_b64, FIXTURE_PUBLIC_RAW_B64);
  });

  for (const vec of file.vectors) {
    void it(`PV-1 ${vec.name}: canonical bytes and the whole wire are byte-identical to the vector, and it verifies`, async () => {
      const { sender_id, origin_class, key_id, issued_at, nonce, alert } = vec.input;
      assert.equal(key_id, KID);
      const fields = { v: 1 as const, sender_id, origin_class, key_id, issued_at, nonce, payload: alert };
      assert.deepEqual(Buffer.from(canonicalBytes(fields, ALERT_SCHEMA)), Buffer.from(vec.signed_bytes_b64, "base64"));
      const wire = await signMessage({ sender_id, origin_class, issued_at, nonce, payload: alert }, fixtureSigner);
      assert.deepEqual(Buffer.from(wire), Buffer.from(vec.wire_b64, "base64"), "the wire, byte for byte");
      accepted(rig().v.verify(new Uint8Array(Buffer.from(vec.wire_b64, "base64")), { ...CHANNEL, floor: "confirmed_attack" }, vec.now));
    });
  }
});

void describe("CSR-WO-2004 the signer interface (PV-2)", () => {
  void it("PV-2: signMessage hands the signer exactly canonical_bytes and puts its 64 bytes on the wire; it never sees a key", async () => {
    const seen: Uint8Array[] = [];
    const wire = await signMessage(input(), { kid: KID, sign: async (b) => (seen.push(b), fixtureSigner.sign(b)) });
    const fields = { v: 1 as const, sender_id: SENDER, origin_class: "system", key_id: KID, issued_at: NOW, nonce: "AAAABBBBCCCCDDDD", payload: { severity: "info" as const, text: "all clear" } };
    assert.deepEqual(seen, [canonicalBytes(fields, ALERT_SCHEMA)]);
    accepted(rig().v.verify(wire, CHANNEL, NOW));
  });

  void it("PV-2: a signer that returns anything but 64 bytes is refused (SignerError)", async () => {
    await assert.rejects(signMessage(input(), { kid: KID, sign: () => Promise.resolve(new Uint8Array(63)) }), SignerError);
    await assert.rejects(signMessage(input(), { kid: KID, sign: () => Promise.resolve("sig" as unknown as Uint8Array) }), SignerError);
  });

  void it("PV-2: a lone surrogate is refused at serialization, so the bytes signed are always the string given", async () => {
    await assert.rejects(signMessage(input({ payload: { severity: "info", text: "a\ud800b" } }), fixtureSigner), SerializationRefusal);
  });
});

void describe("CSR-WO-2004 structure: refused before any gate (PV-3)", () => {
  void it("baseline: a valid message is accepted, and writes one line: sender, kid, effect", async () => {
    const r = rig();
    accepted(r.v.verify(await signed(), CHANNEL, NOW));
    assert.deepEqual(r.rows, [{ event: "provenance-accepted", fields: { sender: SENDER, kid: KID, effect: "info" } }]);
  });

  void it("too-large: a wire over MAX_WIRE_BYTES is refused before it is decoded", async () => {
    const r = rig();
    const big = await signed({ payload: { severity: "info", text: "x".repeat(MAX_WIRE_BYTES) } });
    refused(r.v.verify(big, CHANNEL, NOW), "structure", "too-large");
    accepted(rig().v.verify(await signed({ payload: { severity: "info", text: "x".repeat(MAX_WIRE_BYTES - 400) } }), CHANNEL, NOW));
  });

  void it("malformed: invalid UTF-8, a BOM, and text that is not JSON", async () => {
    const w = await signed();
    refused(rig().v.verify(Uint8Array.from([...w.slice(0, 10), 0xff, ...w.slice(10)]), CHANNEL, NOW), "structure", "malformed");
    refused(rig().v.verify(Uint8Array.from([0xef, 0xbb, 0xbf, ...w]), CHANNEL, NOW), "structure", "malformed");
    refused(rig().v.verify(bytes(`${text(w)}x`), CHANNEL, NOW), "structure", "malformed");
  });

  void it("duplicate-key: a repeated key at the top, in the envelope, and nested in the payload", async () => {
    const w = await signed();
    refused(rig().v.verify(edit(w, '{"envelope":', '{"signature":"x","envelope":'), CHANNEL, NOW), "structure", "duplicate-key");
    refused(rig().v.verify(edit(w, '"v":1,', '"v":1,"v":1,'), CHANNEL, NOW), "structure", "duplicate-key");
    refused(rig().v.verify(edit(w, '"severity":"info"', '"severity":"info","severity":"critical"'), CHANNEL, NOW), "structure", "duplicate-key");
  });

  void it("depth: nesting past MAX_WIRE_DEPTH is refused by the strict parser", async () => {
    refused(rig().v.verify(edit(await signed(), '"text":"all clear"', `"text":${"[".repeat(9)}${"]".repeat(9)}`), CHANNEL, NOW), "structure", "depth");
  });

  void it("lone-surrogate: an escaped lone surrogate in a string is refused", async () => {
    refused(rig().v.verify(edit(await signed(), "all clear", "all \\ud800clear"), CHANNEL, NOW), "structure", "lone-surrogate");
  });

  void it("negative-zero: -0 is refused by name, where the same message with 0 is accepted", async () => {
    // issued_at 0, verified at 100 s with a key valid from 0: fresh, so only the -0 spelling refuses it.
    const w = await signed({ issued_at: 0 });
    const early = (): ProvenanceVerifier => rig([entry({ notBefore: 0 })]).v;
    accepted(early().verify(w, CHANNEL, 100));
    refused(early().verify(edit(w, '"issued_at":0', '"issued_at":-0'), CHANNEL, 100), "structure", "negative-zero");
    refused(early().verify(edit(w, '"issued_at":0', '"issued_at":-0.0'), CHANNEL, 100), "structure", "negative-zero");
  });

  void it("non-shortest-number: 1.0, 1e0 and 10E-1 for v, and a fraction or exponent for issued_at", async () => {
    const w = await signed();
    for (const v of ["1.0", "1e0", "10E-1", "1E+0"]) refused(rig().v.verify(edit(w, '"v":1,', `"v":${v},`), CHANNEL, NOW), "structure", "non-shortest-number");
    refused(rig().v.verify(edit(w, `"issued_at":${String(NOW)}`, `"issued_at":${String(NOW)}.0`), CHANNEL, NOW), "structure", "non-shortest-number");
    refused(rig().v.verify(edit(w, `"issued_at":${String(NOW)}`, '"issued_at":1.7877e9'), CHANNEL, NOW), "structure", "non-shortest-number");
  });

  void it("unknown-field: an extra key at the top and in the envelope", async () => {
    const w = await signed();
    refused(rig().v.verify(reshape(w, (x) => (x["priority"] = "high")), CHANNEL, NOW), "structure", "unknown-field");
    refused(rig().v.verify(reshape(w, (x) => (x.envelope["priority"] = "high")), CHANNEL, NOW), "structure", "unknown-field");
  });

  void it("unsigned: a wire with no signature", async () => {
    refused(rig().v.verify(reshape(await signed(), (x) => delete x.signature), CHANNEL, NOW), "structure", "unsigned");
  });

  void it("missing-field: no envelope, and an envelope without a field", async () => {
    const w = await signed();
    refused(rig().v.verify(bytes(JSON.stringify({ signature: (JSON.parse(text(w)) as { signature: string }).signature })), CHANNEL, NOW), "structure", "missing-field");
    refused(rig().v.verify(reshape(w, (x) => delete x.envelope["nonce"]), CHANNEL, NOW), "structure", "missing-field");
  });

  void it('version: v of 2, 0 and the string "1", each validly signed, is refused, never parsed best-effort', async () => {
    for (const v of [2, 0, "1"]) refused(rig().v.verify(await signedFields({ v }), CHANNEL, NOW), "structure", "version");
  });

  void it("sender-id: a sender that does not match the pattern", async () => {
    refused(rig().v.verify(await signed({ sender_id: "Node.Upper" }), CHANNEL, NOW), "structure", "sender-id");
  });

  void it("key-id: a kid that does not match the pattern", async () => {
    refused(rig().v.verify(await signMessage(input(), keySigner("Bad Kid")), CHANNEL, NOW), "structure", "key-id");
  });

  void it("origin-class: anything but system", async () => {
    refused(rig().v.verify(await signed({ origin_class: "user" }), CHANNEL, NOW), "structure", "origin-class");
  });

  void it("issued-at: a negative and a string (past 2^53-1 is integer-range)", async () => {
    // -5, validly signed and verified at 100 s with a key valid from 0, would be fresh: only issued-at refuses it.
    refused(rig([entry({ notBefore: 0 })]).v.verify(await signedFields({ issued_at: -5 }), CHANNEL, 100), "structure", "issued-at");
    const w = await signed();
    for (const t of ["-5", `"${String(NOW)}"`]) refused(rig().v.verify(edit(w, `"issued_at":${String(NOW)}`, `"issued_at":${t}`), CHANNEL, NOW), "structure", "issued-at");
    refused(rig().v.verify(edit(w, `"issued_at":${String(NOW)}`, '"issued_at":9007199254740992'), CHANNEL, NOW), "structure", "integer-range");
  });

  void it("nonce: too short, too long, and outside the alphabet", async () => {
    for (const nonce of ["AAAABBBBCCCCDDD", "A".repeat(129), "AAAABBBBCCCCDDD="]) refused(rig().v.verify(await signed({ nonce }), CHANNEL, NOW), "structure", "nonce");
  });

  void it("alert-shape, alert-unknown-field, alert-missing-field, alert-severity, alert-text", async () => {
    const w = await signed();
    refused(rig().v.verify(reshape(w, (x) => (x.envelope["alert"] = "info")), CHANNEL, NOW), "structure", "alert-shape");
    refused(rig().v.verify(reshape(w, (x) => ((x.envelope["alert"] as Record<string, unknown>)["priority"] = 1)), CHANNEL, NOW), "structure", "alert-unknown-field");
    refused(rig().v.verify(reshape(w, (x) => delete (x.envelope["alert"] as Record<string, unknown>)["text"]), CHANNEL, NOW), "structure", "alert-missing-field");
    refused(rig().v.verify(edit(w, '"severity":"info"', '"severity":"urgent"'), CHANNEL, NOW), "structure", "alert-severity");
    refused(rig().v.verify(edit(w, '"text":"all clear"', '"text":5'), CHANNEL, NOW), "structure", "alert-text");
  });

  void it("signature-encoding: non-canonical base64, the wrong length, and not a string", async () => {
    const w = await signed();
    const sig = (JSON.parse(text(w)) as { signature: string }).signature;
    const last = sig.at(-3) ?? "A";
    const noncanonical = `${sig.slice(0, -3)}${last === "A" ? "B" : String.fromCharCode(last.charCodeAt(0) ^ 1)}==`;
    for (const s of [noncanonical, sig.slice(0, -4), `${sig}AAAA`, sig.replaceAll("=", "")]) refused(rig().v.verify(edit(w, sig, s), CHANNEL, NOW), "structure", "signature-encoding");
    refused(rig().v.verify(edit(w, `"${sig}"`, "64"), CHANNEL, NOW), "structure", "signature-encoding");
  });

  void it("integer-range: an integer past 2^53-1 is refused, since it reads as a different integer than it spells", async () => {
    // A pluggable payload with an integer field: signed as 9007199254740992, edited to ...993, which
    // JSON.parse reads as the same number. Only integer-range tells them apart.
    const counter: PayloadSchema<{ n: number }> = {
      key: "count",
      context: "ClearSeal/test-count-envelope/v1\x00",
      canonicalFields: (p) => [String(p.n)],
      parse: (v) => (typeof v === "object" && v !== null && typeof (v as { n?: unknown }).n === "number" ? { ok: true, payload: { n: (v as { n: number }).n } } : { ok: false, check: "count" }),
      effect: () => "info",
    };
    const w = await signMessage({ sender_id: SENDER, issued_at: NOW, nonce: "AAAABBBBCCCCDDDD", payload: { n: 2 ** 53 } }, fixtureSigner, counter);
    const v = new ProvenanceVerifier({ allowlist: [entry()], audit: () => undefined, schema: counter });
    refused(v.verify(edit(w, '"n":9007199254740992', '"n":9007199254740993'), CHANNEL, NOW), "structure", "integer-range");
  });

  void it("uint32 length edges: an empty text and a near-cap text are framed and accepted", async () => {
    accepted(rig().v.verify(await signed({ payload: { severity: "info", text: "" } }), CHANNEL, NOW));
    const fields = { v: 1 as const, sender_id: SENDER, origin_class: "system", key_id: KID, issued_at: NOW, nonce: "AAAABBBBCCCCDDDD", payload: { severity: "info" as const, text: "" } };
    // The last two fields: uint32_be(4) "info", then uint32_be(0) and no bytes for the empty text.
    assert.deepEqual([...canonicalBytes(fields, ALERT_SCHEMA).slice(-12)], [0, 0, 0, 4, 0x69, 0x6e, 0x66, 0x6f, 0, 0, 0, 0]);
  });
});

void describe("CSR-WO-2004 gate 1, signature (PV-4)", () => {
  void it("unknown-key: a kid with no allowlist entry", async () => {
    refused(rig().v.verify(await signMessage(input(), keySigner(OTHER_KID)), CHANNEL, NOW), "signature", "unknown-key");
  });

  void it("key-window: outside the entry's window at both edges; inside at exactly notBefore and notAfter", async () => {
    const w = await signed();
    refused(rig([entry({ notBefore: NOW - 86_400, notAfter: NOW - 1 })]).v.verify(w, CHANNEL, NOW), "signature", "key-window");
    refused(rig([entry({ notBefore: NOW + 1, notAfter: NOW + 86_400 })]).v.verify(w, CHANNEL, NOW), "signature", "key-window");
    accepted(rig([entry({ notBefore: NOW, notAfter: NOW })]).v.verify(w, CHANNEL, NOW));
  });

  void it("bad-signature: one flipped byte of signed content, and a different key under the listed kid", async () => {
    const w = await signed();
    refused(rig().v.verify(edit(w, "all clear", "all clean"), CHANNEL, NOW), "signature", "bad-signature");
    const { privateKey } = otherKeyPair();
    refused(rig().v.verify(await signMessage(input(), keySigner(KID, privateKey)), CHANNEL, NOW), "signature", "bad-signature");
  });

  void it("bad-signature: the signature is checked over bytes recomputed from the parsed fields, not over the wire", async () => {
    // Reordered keys and added whitespace change the wire but not the fields: still accepted.
    const w = await signed();
    const x = JSON.parse(text(w)) as { envelope: Record<string, unknown>; signature: string };
    const reordered = bytes(` { "signature" : "${x.signature}", "envelope" : ${JSON.stringify(Object.fromEntries(Object.entries(x.envelope).reverse()), null, 1)} } `);
    accepted(rig().v.verify(reordered, CHANNEL, NOW));
    // One trailing space in a field changes the recomputed bytes, so the same signature no longer verifies.
    refused(rig().v.verify(edit(w, '"text":"all clear"', '"text":"all clear "'), CHANNEL, NOW), "signature", "bad-signature");
  });

  void it("stale: issued 301 s before now; exactly 300 s is accepted", async () => {
    refused(rig().v.verify(await signed({ issued_at: NOW - 301 }), CHANNEL, NOW), "signature", "stale");
    accepted(rig().v.verify(await signed({ issued_at: NOW - 300 }), CHANNEL, NOW));
  });

  void it("future: issued 61 s ahead; exactly 60 s is accepted", async () => {
    refused(rig().v.verify(await signed({ issued_at: NOW + 61 }), CHANNEL, NOW), "signature", "future");
    accepted(rig().v.verify(await signed({ issued_at: NOW + 60 }), CHANNEL, NOW));
  });

  void it("stale: the clock never runs behind its latest reading, so a step back does not reopen a message", async () => {
    const r = rig();
    const old = await signed({ issued_at: NOW - 200 });
    accepted(r.v.verify(await signed({ nonce: "AAAABBBBCCCCDDD9" }), CHANNEL, NOW + 200));
    refused(r.v.verify(old, CHANNEL, NOW), "signature", "stale");
  });

  void it("replay: an accepted nonce is refused again; a refused message's nonce is not remembered", async () => {
    const r = rig();
    const w = await signed();
    accepted(r.v.verify(w, CHANNEL, NOW));
    refused(r.v.verify(w, CHANNEL, NOW + 1), "signature", "replay");
    const r2 = rig();
    const above = await signed({ payload: { severity: "warn", text: "x" } });
    refused(r2.v.verify(above, CHANNEL, NOW), "effect", "above-floor");
    accepted(r2.v.verify(above, { ...CHANNEL, floor: "warn" }, NOW));
  });

  void it("replay: accepted at NOW, a later message forgets at NOW+301, the first replayed at NOW+10 is refused", async () => {
    const r = rig();
    const first = await signed();
    accepted(r.v.verify(first, CHANNEL, NOW));
    accepted(r.v.verify(await signed({ issued_at: NOW + 301, nonce: "AAAABBBBCCCCDDD8" }), CHANNEL, NOW + 301));
    refused(r.v.verify(first, CHANNEL, NOW + 10), "signature", "stale");
  });

  void it("replay is per sender: one author sending another's nonce first never blocks the other's message", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const other = entry({ kid: OTHER_KID, sender_id: OTHER_SENDER, publicKey: publicKey.export({ format: "pem", type: "spki" }).toString() });
    const r = rig([entry(), other]);
    const both = { ...CHANNEL, authors: [SENDER, OTHER_SENDER] };
    accepted(r.v.verify(await signMessage(input({ sender_id: OTHER_SENDER }), keySigner(OTHER_KID, privateKey)), both, NOW));
    accepted(r.v.verify(await signed(), both, NOW));
  });

  void it("the clock moves only on accept: a valid message checked at a wrong future now does not lock out the present", async () => {
    const r = rig([entry({ notAfter: NOW + 200_000 })]);
    refused(r.v.verify(await signed({ nonce: "AAAABBBBCCCCDDD7" }), CHANNEL, NOW + 80_000), "signature", "stale");
    accepted(r.v.verify(await signed(), CHANNEL, NOW));
  });

  void it("nonce-cache-full: at capacity a new message is refused, never evicted for; room returns as nonces expire", async () => {
    const r = rig([entry()], 2);
    const a = await signed({ nonce: "AAAABBBBCCCCDDD1" });
    accepted(r.v.verify(a, CHANNEL, NOW));
    accepted(r.v.verify(await signed({ nonce: "AAAABBBBCCCCDDD2" }), CHANNEL, NOW));
    refused(r.v.verify(await signed({ nonce: "AAAABBBBCCCCDDD3" }), CHANNEL, NOW), "signature", "nonce-cache-full");
    refused(r.v.verify(a, CHANNEL, NOW), "signature", "replay");
    assert.deepEqual(r.rows.at(-2), { event: "provenance-refused", fields: { gate: "signature", check: "nonce-cache-full", sender: SENDER, kid: KID } });
    accepted(r.v.verify(await signed({ issued_at: NOW + 301, nonce: "AAAABBBBCCCCDDD4" }), CHANNEL, NOW + 301));
  });
});

void describe("CSR-WO-2004 gate 2, author, and gate 3, effect, each refusing on its own (PV-5)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const other = entry({ kid: OTHER_KID, sender_id: OTHER_SENDER, publicKey: publicKey.export({ format: "pem", type: "spki" }).toString() });

  void it("not-listed: a valid signature by a sender not on this channel's author list", async () => {
    refused(rig().v.verify(await signed(), { ...CHANNEL, authors: [OTHER_SENDER] }, NOW), "author", "not-listed");
  });

  void it("key-not-authors: a listed sender signing with another author's key", async () => {
    const w = await signMessage(input(), keySigner(OTHER_KID, privateKey));
    refused(rig([entry(), other]).v.verify(w, { ...CHANNEL, authors: [SENDER, OTHER_SENDER] }, NOW), "author", "key-not-authors");
  });

  void it("above-floor: a valid message from a listed author requesting more than the floor", async () => {
    refused(rig().v.verify(await signed({ payload: { severity: "warn", text: "x" } }), CHANNEL, NOW), "effect", "above-floor");
    accepted(rig().v.verify(await signed({ payload: { severity: "warn", text: "x" } }), { ...CHANNEL, floor: "warn" }, NOW));
  });

  void it("unknown-effect: a payload schema whose effect the floor ordering does not know is refused, never ranked lowest", async () => {
    const odd: PayloadSchema<Alert> = { ...ALERT_SCHEMA, effect: () => "launch" };
    refused(rig([entry()], undefined, odd).v.verify(await signed(), { ...CHANNEL, floor: "confirmed_attack" }, NOW), "effect", "unknown-effect");
  });

  void it("the order is fixed: signature before author before effect, and the first refusal names its gate", async () => {
    const above = await signed({ payload: { severity: "critical", text: "x" } });
    refused(rig().v.verify(above, { ...CHANNEL, authors: [OTHER_SENDER] }, NOW), "author", "not-listed");
    refused(rig().v.verify(edit(above, '"text":"x"', '"text":"y"'), { ...CHANNEL, authors: [OTHER_SENDER] }, NOW), "signature", "bad-signature");
  });

  void it("every refusal writes one line naming its gate and check, with no message content but sender and kid", async () => {
    const r = rig();
    refused(r.v.verify(edit(await signed(), "all clear", "SECRET-ALERT-TEXT"), CHANNEL, NOW), "signature", "bad-signature");
    assert.deepEqual(r.rows, [{ event: "provenance-refused", fields: { gate: "signature", check: "bad-signature", sender: SENDER, kid: KID } }]);
    assert.ok(!JSON.stringify(r.rows).includes("SECRET"));
  });
});

void describe("CSR-WO-2004 the allowlist (PV-6)", () => {
  void it("refuses a duplicate kid: rotation adds a kid, never a second entry for one", () => {
    assert.throws(() => loadAllowlist([entry(), entry({ notBefore: NOW, notAfter: NOW + 10 })]), AllowlistError);
  });

  void it("refuses an inverted window", () => {
    assert.throws(() => loadAllowlist([entry({ notBefore: NOW + 1, notAfter: NOW })]), /inverted/);
  });

  void it("refuses a key that is not Ed25519: RSA, P-256 and X25519", () => {
    for (const k of [generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey, generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey, generateKeyPairSync("x25519").publicKey]) {
      assert.throws(() => loadAllowlist([entry({ publicKey: k.export({ format: "pem", type: "spki" }).toString() })]), /not Ed25519/);
    }
    assert.throws(() => loadAllowlist([entry({ publicKey: generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey })]), /not Ed25519/, "a KeyObject too");
  });

  void it("refuses a key-shaped plain object and a private key's PEM: only public PEM text or a real KeyObject loads", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const shaped = JSON.parse(JSON.stringify({ type: "public", asymmetricKeyType: "ed25519", format: "jwk", key: rsa.publicKey.export({ format: "jwk" }) })) as unknown as string;
    assert.throws(() => loadAllowlist([entry({ publicKey: shaped })]), /neither PEM text nor a KeyObject/);
    const { privateKey } = generateKeyPairSync("ed25519");
    assert.throws(() => loadAllowlist([entry({ publicKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString() })]), /not SPKI PEM text/);
  });

  void it("refuses a kid or sender outside the pattern, and a window that is not epoch seconds", () => {
    assert.throws(() => loadAllowlist([entry({ kid: "Bad Kid" })]), AllowlistError);
    assert.throws(() => loadAllowlist([entry({ sender_id: "x" })]), AllowlistError);
    assert.throws(() => loadAllowlist([entry({ notAfter: Number.NaN })]), AllowlistError);
  });

  void it("a channel with an unknown floor is refused at verify, never ranked", async () => {
    const w = await signed();
    assert.throws(() => rig().v.verify(w, { ...CHANNEL, authors: undefined } as unknown as Channel, NOW), /authors is not a list/);
    assert.throws(() => rig().v.verify(w, { ...CHANNEL, floor: "launch" } as unknown as Channel, NOW), AllowlistError);
  });
});
