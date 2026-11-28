// CSR-WO-2004: the class-5 envelope, Option A's field contract (CSR-WO-0102 §1.1) byte for byte, with
// the payload pluggable. Carried over from spikes/0102-envelope/common.ts and option-a.ts.
//
// The wire is UTF-8 JSON `{"envelope":{...},"signature":"<base64 Ed25519, 64 bytes>"}`. The signature is
// over canonical_bytes(envelope), never over the JSON:
//   CONTEXT ‖ for each field in the fixed order: uint32_be(byte_length(utf8(value))) ‖ utf8(value)
//   fixed order: v · sender_id · origin_class · key_id · issued_at · nonce · <the payload's fields>
// Strings are signed as given: no Unicode normalization on either side, ever. Integers are written in
// shortest decimal form. A change to the field list or the framing bumps CONTEXT's trailing `v1`.

/** The alert schema's 31-byte domain-separation prefix (CSR-WO-0102 §1.1). */
export const ALERT_CONTEXT = "ClearSeal/M6-alert-envelope/v1\x00";

export const ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
export const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;
export const MAX_TIME = 2 ** 53 - 1;
/** Freshness: a message is accepted from `issued_at` until 300 s after it, and up to 60 s before it. */
export const PAST_WINDOW_S = 300;
export const FUTURE_SKEW_S = 60;
/** The only origin class the contract names. */
export const ORIGIN_CLASSES: readonly string[] = ["system"];

export function isTime(t: unknown): t is number {
  return typeof t === "number" && Number.isSafeInteger(t) && t >= 0 && t <= MAX_TIME;
}

/** The alert schema's effects, lowest first. A channel's floor is one of these. */
export type Effect = "info" | "warn" | "critical" | "confirmed_attack";
export const EFFECT_ORDER: readonly Effect[] = ["info", "warn", "critical", "confirmed_attack"];

/** A payload shape: where it sits in the envelope, its fields' place in the fixed order, its own
 *  strict parse, and the effect it requests (gate 3). */
export interface PayloadSchema<P> {
  /** The envelope key the payload sits under. */
  readonly key: string;
  /** The domain-separation prefix; a new schema or framing gets a new one. */
  readonly context: string;
  /** The payload's field values, in the order they follow `nonce` in canonical_bytes. */
  canonicalFields(p: P): string[];
  /** The payload, or the name of the check that refuses it. */
  parse(v: unknown): { ok: true; payload: P } | { ok: false; check: string };
  /** The effect the payload requests. Gate 3 refuses one the floor ordering does not know. */
  effect(p: P): string;
}

export interface Alert {
  readonly severity: Effect;
  readonly text: string;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The keys of `obj` are exactly `keys`: the first unknown key, or the first missing one, or null. */
export function keyProblem(obj: Record<string, unknown>, keys: readonly string[]): { unknown: string } | { missing: string } | null {
  for (const k of Object.keys(obj)) if (!keys.includes(k)) return { unknown: k };
  for (const k of keys) if (!Object.hasOwn(obj, k)) return { missing: k };
  return null;
}

export const ALERT_SCHEMA: PayloadSchema<Alert> = Object.freeze({
  key: "alert",
  context: ALERT_CONTEXT,
  canonicalFields: (p: Alert) => [p.severity, p.text],
  parse: (v: unknown): { ok: true; payload: Alert } | { ok: false; check: string } => {
    if (!isPlainObject(v)) return { ok: false, check: "alert-shape" };
    const bad = keyProblem(v, ["severity", "text"]);
    if (bad !== null) return { ok: false, check: "unknown" in bad ? "alert-unknown-field" : "alert-missing-field" };
    const { severity, text } = v;
    if (typeof severity !== "string" || !(EFFECT_ORDER as readonly string[]).includes(severity)) return { ok: false, check: "alert-severity" };
    if (typeof text !== "string") return { ok: false, check: "alert-text" };
    return { ok: true, payload: { severity: severity as Effect, text } };
  },
  effect: (p: Alert) => p.severity,
});

/** The envelope's fields, as signed. */
export interface EnvelopeFields<P> {
  readonly v: 1;
  readonly sender_id: string;
  readonly origin_class: string;
  readonly key_id: string;
  readonly issued_at: number;
  readonly nonce: string;
  readonly payload: P;
}

/** Thrown when a string cannot be carried as UTF-8 (a lone surrogate): encoding would replace it with
 *  U+FFFD silently, and the bytes signed would not be the string given. */
export class SerializationRefusal extends Error {
  override name = "SerializationRefusal";
}

const utf8 = new TextEncoder();

/** CONTEXT ‖ (uint32_be length ‖ UTF-8 value) for each field in the fixed order. */
export function canonicalBytes<P>(fields: EnvelopeFields<P>, schema: PayloadSchema<P>): Uint8Array {
  const values = [String(fields.v), fields.sender_id, fields.origin_class, fields.key_id, String(fields.issued_at), fields.nonce, ...schema.canonicalFields(fields.payload)];
  const parts: Uint8Array[] = [utf8.encode(schema.context)];
  for (const [i, value] of values.entries()) {
    if (!value.isWellFormed()) throw new SerializationRefusal(`lone surrogate in canonical field ${String(i)}`);
    const bytes = utf8.encode(value);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, bytes.length, false);
    parts.push(len, bytes);
  }
  return Buffer.concat(parts);
}

/** The envelope object as it goes on the wire. */
export function envelopeObject<P>(fields: EnvelopeFields<P>, schema: PayloadSchema<P>): Record<string, unknown> {
  return { v: fields.v, sender_id: fields.sender_id, origin_class: fields.origin_class, key_id: fields.key_id, issued_at: fields.issued_at, nonce: fields.nonce, [schema.key]: fields.payload };
}
