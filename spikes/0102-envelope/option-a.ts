// CSR-WO-0102 option A: the field verifier's contract (WO §1.1), byte for byte, with the payload
// generalized to a pluggable schema. The wire is UTF-8 JSON `{"envelope":{...},"signature":"<b64>"}`;
// the signature is over canonical_bytes(envelope), never over the JSON:
//   CONTEXT ‖ for each field in fixed order: uint32_be(byte_length(utf8(value))) ‖ utf8(value)
// Strings are signed as given: no Unicode normalization, ever.

import { sign as edSign, verify as edVerify, type KeyObject } from "node:crypto";

import {
  accept,
  ALERT_SCHEMA,
  type Alert,
  type Allowlist,
  assertWellFormed,
  type Effect,
  exactKeys,
  freshAndUnseen,
  gateAuthor,
  gateEffect,
  ID_RE,
  isPlainObject,
  isTime,
  NONCE_RE,
  ORIGIN_CLASSES,
  parseJsonBytes,
  type PayloadSchema,
  refuse,
  selectKey,
  type SignInput,
  strictBase64,
  type Verdict,
  type VerifyContext,
  wellFormedDeep,
} from "./common.ts";

const utf8 = new TextEncoder();

/** CONTEXT ‖ (uint32_be length ‖ UTF-8 value) for each field in the fixed order. */
export function canonicalBytes<P>(input: SignInput<P>, schema: PayloadSchema<P>): Uint8Array {
  const values = [String(input.v), input.sender_id, input.origin_class, input.key_id, String(input.issued_at), input.nonce, ...schema.canonicalFields(input.payload)];
  const parts: Uint8Array[] = [utf8.encode(schema.context)];
  for (const [i, value] of values.entries()) {
    assertWellFormed(value, `canonical field ${String(i)}`);
    const bytes = utf8.encode(value);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, bytes.length, false);
    parts.push(len, bytes);
  }
  return Buffer.concat(parts);
}

function envelopeObject<P>(input: SignInput<P>, schema: PayloadSchema<P>): Record<string, unknown> {
  return {
    v: input.v,
    sender_id: input.sender_id,
    origin_class: input.origin_class,
    key_id: input.key_id,
    issued_at: input.issued_at,
    nonce: input.nonce,
    [schema.key]: input.payload,
  };
}

/** Signs and serializes. Throws SerializationRefusal on a lone surrogate; checks nothing else, so
 *  tests can sign what the verifier must refuse. */
export function sign<P = Alert>(input: SignInput<P>, key: KeyObject, schema: PayloadSchema<P> = ALERT_SCHEMA as unknown as PayloadSchema<P>): Uint8Array {
  const envelope = envelopeObject(input, schema);
  assertWellFormed(envelope, "envelope");
  const signature = edSign(null, canonicalBytes(input, schema), key).toString("base64");
  return utf8.encode(JSON.stringify({ envelope, signature }));
}

export interface AcceptedA<P> {
  envelope: SignInput<P>;
}

export function verify<P = Alert>(
  wire: Uint8Array,
  allowlist: Allowlist,
  floor: Effect,
  ctx: VerifyContext,
  schema: PayloadSchema<P> = ALERT_SCHEMA as unknown as PayloadSchema<P>,
): Verdict<AcceptedA<P>> {
  // ---- structure ----
  const outer = parseJsonBytes(wire);
  if (!isPlainObject(outer)) return refuse("structure", "malformed", "not strict UTF-8 JSON object");
  if (!wellFormedDeep(outer)) return refuse("structure", "lone-surrogate", "a string holds a lone surrogate");
  const outerBad = exactKeys(outer, ["envelope", "signature"]);
  if (outerBad !== null) return refuse("structure", outerBad.startsWith("unknown") ? "unknown-field" : "unsigned", outerBad);
  const env = outer["envelope"];
  if (!isPlainObject(env)) return refuse("structure", "malformed", "envelope is not an object");
  const envBad = exactKeys(env, ["v", "sender_id", "origin_class", "key_id", "issued_at", "nonce", schema.key]);
  if (envBad !== null) return refuse("structure", envBad.startsWith("unknown") ? "unknown-field" : "missing-field", envBad);
  if (env["v"] !== 1) return refuse("structure", "version", `v is ${JSON.stringify(env["v"])}`);
  const { sender_id, origin_class, key_id, issued_at, nonce } = env;
  if (typeof sender_id !== "string" || !ID_RE.test(sender_id)) return refuse("structure", "field", "sender_id");
  if (typeof origin_class !== "string" || !ORIGIN_CLASSES.includes(origin_class)) return refuse("structure", "field", "origin_class");
  if (typeof key_id !== "string" || !ID_RE.test(key_id)) return refuse("structure", "field", "key_id");
  if (!isTime(issued_at)) return refuse("structure", "field", "issued_at");
  if (typeof nonce !== "string" || !NONCE_RE.test(nonce)) return refuse("structure", "field", "nonce");
  const p = schema.parse(env[schema.key]);
  if (!p.ok) return refuse("structure", p.why.includes("unknown field") ? "unknown-field" : "field", p.why);
  const sigText = outer["signature"];
  const sig = typeof sigText === "string" ? strictBase64(sigText, false) : undefined;
  if (sig?.length !== 64) return refuse("structure", "signature-encoding", "signature is not canonical base64 of 64 bytes");
  const input: SignInput<P> = { v: 1, sender_id, origin_class, key_id, issued_at, nonce, payload: p.payload };

  // ---- gate 1: signature ----
  const key = selectKey(allowlist, key_id, ctx.now);
  if (!key.ok) return refuse("signature", key.check, key.why);
  if (!edVerify(null, canonicalBytes(input, schema), key.entry.public_key, sig)) return refuse("signature", "bad-signature", "signature does not verify over the canonical bytes");
  const stale = freshAndUnseen(issued_at, nonce, ctx);
  if (stale !== null) return refuse("signature", stale.check, stale.why);

  // ---- gate 2: author ----
  const author = gateAuthor(allowlist, sender_id, key.entry);
  if (author !== null) return refuse("author", author.check, author.why);

  // ---- gate 3: effect ----
  const effect = gateEffect(schema.effect(p.payload), floor);
  if (effect !== null) return refuse("effect", effect.check, effect.why);

  return accept({ envelope: input }, nonce, issued_at, ctx);
}
