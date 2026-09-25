// CSR-WO-0102 spike: what the three envelope options share — the fixture key, the allowlist, the
// payload schema, and the three gates' decisions. Not product code; the provenance module is -2004.
//
// Every option runs the same stages in the same order:
//   structure  — the wire parses strictly and every field is exactly as the contract says;
//   gate 1     — "signature": key selected by kid from the allowlist, inside its validity window,
//                the signature verifies, the message is fresh, and its nonce is unseen;
//   gate 2     — "author": the sender is on the channel's author list and owns that key;
//   gate 3     — "effect": the requested effect is at or below the channel's floor.
// The first refusal wins and names its gate. A nonce is remembered only when a message is accepted.

import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";

// ---------- fixture key (fake, tests only; WO §1.1) ----------

/** The 32-byte seed as a byte pattern: eight 0x00, eight 0xd0, eight 0x0d, eight 0x00. */
export function fixtureSeed(): Uint8Array {
  return Uint8Array.from([...Array<number>(8).fill(0x00), ...Array<number>(8).fill(0xd0), ...Array<number>(8).fill(0x0d), ...Array<number>(8).fill(0x00)]);
}

// DER prefixes that wrap a raw Ed25519 seed (PKCS#8) and a raw public key (SPKI) for node:crypto.
const PKCS8_ED25519 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
const SPKI_ED25519 = Uint8Array.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);

export function privateKeyFromSeed(seed: Uint8Array): KeyObject {
  return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: "der", type: "pkcs8" });
}

export function publicKeyFromRaw(raw: Uint8Array): KeyObject {
  return createPublicKey({ key: Buffer.concat([SPKI_ED25519, raw]), format: "der", type: "spki" });
}

export function rawPublicKey(key: KeyObject): Uint8Array {
  const der = key.export({ format: "der", type: "spki" });
  return new Uint8Array(der.subarray(SPKI_ED25519.length));
}

export const FIXTURE_PRIVATE_KEY = privateKeyFromSeed(fixtureSeed());
export const FIXTURE_PUBLIC_KEY = createPublicKey(FIXTURE_PRIVATE_KEY);

// ---------- shared field rules (WO §1.1) ----------

export const ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
export const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;
export const MAX_TIME = 2 ** 53 - 1;
export const PAST_WINDOW = 300;
export const FUTURE_SKEW = 60;
/** The only origin class this spike accepts; the contract names no other. */
export const ORIGIN_CLASSES: readonly string[] = ["system"];

export function isTime(t: unknown): t is number {
  return typeof t === "number" && Number.isSafeInteger(t) && t >= 0 && t <= MAX_TIME;
}

// ---------- refusals ----------

export type Gate = "structure" | "signature" | "author" | "effect";

export type Verdict<T> = { accepted: true; message: T } | { accepted: false; gate: Gate; check: string; detail: string };

export function refuse(gate: Gate, check: string, detail = ""): { accepted: false; gate: Gate; check: string; detail: string } {
  return { accepted: false, gate, check, detail };
}

/** Thrown by a signer asked to serialize a string that UTF-8 cannot carry (a lone surrogate). */
export class SerializationRefusal extends Error {
  override name = "SerializationRefusal";
}

/** Throws on a lone surrogate anywhere in a JSON-shaped value; UTF-8 encoding would otherwise
 *  replace it with U+FFFD silently, and the bytes signed would not be the string given. */
export function assertWellFormed(value: unknown, where = "value"): void {
  if (typeof value === "string") {
    if (!value.isWellFormed()) throw new SerializationRefusal(`lone surrogate in ${where}`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => assertWellFormed(v, `${where}[${String(i)}]`));
  } else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      assertWellFormed(k, `${where} key`);
      assertWellFormed(v, `${where}.${k}`);
    }
  }
}

/** True when no string (key or value) anywhere in a parsed JSON value holds a lone surrogate. */
export function wellFormedDeep(value: unknown): boolean {
  try {
    assertWellFormed(value);
    return true;
  } catch {
    return false;
  }
}

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Strict UTF-8 then JSON; undefined on either failure. No BOM stripping: a BOM is not JSON. */
export function parseJsonBytes(bytes: Uint8Array): unknown {
  let text: string;
  try {
    text = STRICT_UTF8.decode(bytes);
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The keys of `obj` are exactly `keys` (any order). Returns the first offending key, or null. */
export function exactKeys(obj: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of Object.keys(obj)) if (!keys.includes(k)) return `unknown field "${k}"`;
  for (const k of keys) if (!Object.hasOwn(obj, k)) return `missing field "${k}"`;
  return null;
}

/** Standard base64, canonical only: decoding then re-encoding must reproduce the input exactly
 *  (Buffer.from alone skips invalid characters and ignores bad padding). */
export function strictBase64(s: string, url: boolean): Uint8Array | undefined {
  const alphabet = url ? /^[A-Za-z0-9_-]*$/ : /^[A-Za-z0-9+/]*={0,2}$/;
  if (!alphabet.test(s)) return undefined;
  const bytes = Buffer.from(s, url ? "base64url" : "base64");
  return bytes.toString(url ? "base64url" : "base64") === s ? new Uint8Array(bytes) : undefined;
}

// ---------- payload schema (pluggable; the built-in one is the alert shape) ----------

export type Effect = "info" | "warn" | "critical" | "confirmed_attack";
export const EFFECT_ORDER: readonly Effect[] = ["info", "warn", "critical", "confirmed_attack"];

export interface PayloadSchema<P> {
  /** The envelope key the payload sits under. */
  key: string;
  /** Option A's 31-byte domain-separation prefix; a new schema or framing gets a new one. */
  context: string;
  /** The payload's field values in the fixed canonical order (option A). */
  canonicalFields: (p: P) => string[];
  /** Strict shape check: the payload, or why it is refused. */
  parse: (v: unknown) => { ok: true; payload: P } | { ok: false; why: string };
  /** The effect the payload requests, for gate 3. */
  effect: (p: P) => Effect;
}

export interface Alert {
  severity: Effect;
  text: string;
}

export const ALERT_SCHEMA: PayloadSchema<Alert> = {
  key: "alert",
  context: "ClearSeal/M6-alert-envelope/v1\x00",
  canonicalFields: (p) => [p.severity, p.text],
  parse: (v) => {
    if (!isPlainObject(v)) return { ok: false, why: "alert is not an object" };
    const bad = exactKeys(v, ["severity", "text"]);
    if (bad !== null) return { ok: false, why: `alert: ${bad}` };
    const { severity, text } = v;
    if (typeof severity !== "string" || !(EFFECT_ORDER as readonly string[]).includes(severity)) return { ok: false, why: "alert.severity" };
    if (typeof text !== "string") return { ok: false, why: "alert.text" };
    return { ok: true, payload: { severity: severity as Effect, text } };
  },
  effect: (p) => p.severity,
};

/** What a signer is asked to sign; every option carries exactly these. */
export interface SignInput<P = Alert> {
  v: number;
  sender_id: string;
  origin_class: string;
  key_id: string;
  issued_at: number;
  nonce: string;
  payload: P;
}

/** The body that options B and C carry: the envelope fields that are not their own metadata. */
export function bodyObject<P>(input: SignInput<P>, schema: PayloadSchema<P>): Record<string, unknown> {
  return { v: input.v, sender_id: input.sender_id, origin_class: input.origin_class, [schema.key]: input.payload };
}

export interface Body<P> {
  v: 1;
  sender_id: string;
  origin_class: string;
  payload: P;
}

/** Structure checks on a B or C body (A checks the same fields inline, plus its own three). */
export function parseBody<P>(v: unknown, schema: PayloadSchema<P>): { ok: true; body: Body<P> } | { ok: false; check: string; why: string } {
  if (!isPlainObject(v)) return { ok: false, check: "malformed", why: "body is not a JSON object" };
  if (!wellFormedDeep(v)) return { ok: false, check: "lone-surrogate", why: "a string holds a lone surrogate" };
  const bad = exactKeys(v, ["v", "sender_id", "origin_class", schema.key]);
  if (bad !== null) return { ok: false, check: bad.startsWith("unknown") ? "unknown-field" : "missing-field", why: bad };
  if (v["v"] !== 1) return { ok: false, check: "version", why: `v is ${JSON.stringify(v["v"])}` };
  const { sender_id, origin_class } = v;
  if (typeof sender_id !== "string" || !ID_RE.test(sender_id)) return { ok: false, check: "field", why: "sender_id" };
  if (typeof origin_class !== "string" || !ORIGIN_CLASSES.includes(origin_class)) return { ok: false, check: "field", why: "origin_class" };
  const p = schema.parse(v[schema.key]);
  if (!p.ok) return { ok: false, check: p.why.includes("unknown field") ? "unknown-field" : "field", why: p.why };
  return { ok: true, body: { v: 1, sender_id, origin_class, payload: p.payload } };
}

// ---------- allowlist and the three gates ----------

export interface KeyEntry {
  kid: string;
  /** The author this key belongs to. */
  sender_id: string;
  public_key: KeyObject;
  /** Validity window, epoch seconds, inclusive. Rotation appends an entry; it never edits one. */
  not_before: number;
  not_after: number;
}

export interface Allowlist {
  channel: string;
  keys: readonly KeyEntry[];
  authors: readonly string[];
}

/** Seen nonces with the time each stops mattering; pruned on every look. The store keeps the
 *  latest clock reading it has seen and never runs behind it: pruning at a later time and then
 *  checking at an earlier one would forget a nonce whose message is fresh again at that earlier
 *  time (a replay after the clock steps back; CSR-WO-0102 adversarial pass). */
export class NonceStore {
  readonly #seen = new Map<string, number>();
  #highWater = 0;
  /** The verifier's effective time: the given clock, or the latest reading seen, if later. */
  clock(now: number): number {
    this.#highWater = Math.max(this.#highWater, now);
    return this.#highWater;
  }
  has(nonce: string, now: number): boolean {
    const t = this.clock(now);
    for (const [n, until] of this.#seen) if (until < t) this.#seen.delete(n);
    return this.#seen.has(nonce);
  }
  remember(nonce: string, until: number): void {
    this.#seen.set(nonce, until);
  }
}

export interface VerifyContext {
  now: number;
  nonces: NonceStore;
}

/** Gate 1, first half: the one allowlist entry for this kid, inside its window now. */
export function selectKey(allowlist: Allowlist, kid: string, now: number): { ok: true; entry: KeyEntry } | { ok: false; check: string; why: string } {
  const matches = allowlist.keys.filter((k) => k.kid === kid);
  if (matches.length === 0) return { ok: false, check: "unknown-key", why: `no allowlist entry for kid "${kid}"` };
  if (matches.length > 1) return { ok: false, check: "ambiguous-key", why: `${String(matches.length)} entries for kid "${kid}"` };
  const entry = matches[0] as KeyEntry;
  if (now < entry.not_before || now > entry.not_after) return { ok: false, check: "key-window", why: `kid "${kid}" is outside its validity window` };
  return { ok: true, entry };
}

/** Gate 1, second half: the message was issued inside the window, and its nonce is unseen. */
export function freshAndUnseen(issuedAt: number, nonce: string, ctx: VerifyContext): { check: string; why: string } | null {
  if (issuedAt < ctx.nonces.clock(ctx.now) - PAST_WINDOW) return { check: "stale", why: `issued ${String(ctx.nonces.clock(ctx.now) - issuedAt)} s before the latest clock reading` };
  if (issuedAt > ctx.now + FUTURE_SKEW) return { check: "future", why: `issued ${String(issuedAt - ctx.now)} s ahead` };
  if (ctx.nonces.has(nonce, ctx.now)) return { check: "replay", why: "nonce already seen" };
  return null;
}

/** Gate 2: the sender is on this channel's author list, and the key that signed is the sender's. */
export function gateAuthor(allowlist: Allowlist, senderId: string, entry: KeyEntry): { check: string; why: string } | null {
  if (!allowlist.authors.includes(senderId)) return { check: "not-listed", why: `"${senderId}" is not an author on ${allowlist.channel}` };
  if (entry.sender_id !== senderId) return { check: "key-not-author's", why: `kid "${entry.kid}" belongs to another author` };
  return null;
}

/** Gate 3: the requested effect is at or below the channel's floor. */
export function gateEffect(effect: Effect, floor: Effect): { check: string; why: string } | null {
  return EFFECT_ORDER.indexOf(effect) <= EFFECT_ORDER.indexOf(floor) ? null : { check: "above-floor", why: `${effect} is above the floor ${floor}` };
}

/** Accept: remember the nonce for as long as the message could still be fresh. */
export function accept<T>(message: T, nonce: string, issuedAt: number, ctx: VerifyContext): Verdict<T> {
  ctx.nonces.remember(nonce, issuedAt + PAST_WINDOW);
  return { accepted: true, message };
}
