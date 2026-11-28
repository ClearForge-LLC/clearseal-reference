// CSR-WO-2004 §1.3: the verifier. A message passes structure, then three gates in a fixed order; the
// first refusal wins and names its gate and check (RULES.md PV-3…PV-5):
//   structure — a size cap before parsing, the core's strict parser, Option A's three encoding
//               decisions closed (duplicate keys, number forms, -0), exact keys, each field's pattern;
//   signature — the allowlist entry for `kid`, inside its window, Ed25519 over canonical_bytes
//               recomputed from the parsed fields, the message fresh, its nonce unseen and storable;
//   author    — the sender is on the channel's author list and owns that key;
//   effect    — the requested effect is one the floor ordering knows, at or below the channel's floor.
// A nonce is remembered only when a message is accepted, for the freshness window; at capacity a new
// message is refused, never evicted for (PV-7). Carried over from spikes/0102-envelope/option-a.ts.

import { verify as edVerify } from "node:crypto";

import { JsonParseError, parseJsonStrict } from "../transport/json.ts";
import { type Channel, checkChannel, loadAllowlist, type ProvenanceAllowlist, type ProvenanceKeyData } from "./allowlist.ts";
import { ALERT_SCHEMA, type Alert, canonicalBytes, EFFECT_ORDER, type EnvelopeFields, FUTURE_SKEW_S, ID_RE, isTime, keyProblem, NONCE_RE, ORIGIN_CLASSES, PAST_WINDOW_S, type PayloadSchema } from "./envelope.ts";

export type Gate = "structure" | "signature" | "author" | "effect";

export type ProvenanceVerdict<P> = { readonly accepted: true; readonly message: EnvelopeFields<P> } | { readonly accepted: false; readonly gate: Gate; readonly check: string };

/** The wire's size cap, checked before any decoding or parsing (FEEDBACK: how it was chosen). */
export const MAX_WIRE_BYTES = 16 * 1024;
/** The nesting bound handed to the strict parser: Option A's alert message is 3 deep. */
export const MAX_WIRE_DEPTH = 8;
/** Nonces remembered at most (FEEDBACK: how it was chosen). */
export const DEFAULT_MAX_NONCES = 10_000;

export interface VerifierOptions<P> {
  readonly allowlist: readonly ProvenanceKeyData[];
  /** One line per verdict: the sender, kid, gate and check of a refusal, or the sender, kid and effect
   *  of an accept. Never other message content. */
  readonly audit: (event: string, fields: Record<string, string | number>) => void;
  readonly schema?: PayloadSchema<P>;
  readonly maxNonces?: number;
}

/** Seen nonces, each with the last second its message can be fresh. The memory keeps the latest clock
 *  reading it has seen and never runs behind it: pruning at a later time and checking at an earlier one
 *  would forget a nonce whose message is fresh again at that earlier time (CSR-WO-0102 adversarial). */
class NonceMemory {
  readonly #seen = new Map<string, number>();
  readonly #max: number;
  #highWater = 0;
  constructor(max: number) {
    this.#max = max;
  }
  clock(now: number): number {
    this.#highWater = Math.max(this.#highWater, now);
    return this.#highWater;
  }
  seen(nonce: string, t: number): boolean {
    const until = this.#seen.get(nonce);
    return until !== undefined && until >= t;
  }
  /** True when a new nonce cannot be stored even after the expired ones are forgotten. */
  full(t: number): boolean {
    if (this.#seen.size < this.#max) return false;
    for (const [n, until] of this.#seen) if (until < t) this.#seen.delete(n);
    return this.#seen.size >= this.#max;
  }
  remember(nonce: string, until: number): void {
    this.#seen.set(nonce, until);
  }
}

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const INTEGER = /^-?(?:0|[1-9][0-9]*)$/;
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

/** Option A's open number decisions, closed (architecture §5): every number on the wire is written as
 *  an integer in shortest form (no fraction, no exponent), and `-0` is refused by name; a negative
 *  integer is left to the field that refuses it. Run on text the strict parser
 *  accepted, so every number token is well formed; strings are skipped with their escapes. */
function numberForm(text: string): "negative-zero" | "non-shortest-number" | null {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x22) {
      for (i++; text.charCodeAt(i) !== 0x22; i++) if (text.charCodeAt(i) === 0x5c) i++;
    } else if (c === 0x2d || (c >= 0x30 && c <= 0x39)) {
      NUMBER.lastIndex = i;
      const token = NUMBER.exec(text)?.[0] ?? "";
      if (Object.is(Number(token), -0)) return "negative-zero";
      if (!INTEGER.test(token)) return "non-shortest-number";
      i += token.length - 1;
    }
  }
  return null;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Canonical standard base64 of exactly 64 bytes, or undefined. */
function signatureBytes(s: unknown): Uint8Array | undefined {
  if (typeof s !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(s)) return undefined;
  const bytes = Buffer.from(s, "base64");
  return bytes.length === 64 && bytes.toString("base64") === s ? new Uint8Array(bytes) : undefined;
}

export class ProvenanceVerifier<P = Alert> {
  readonly #keys: ProvenanceAllowlist;
  readonly #audit: VerifierOptions<P>["audit"];
  readonly #schema: PayloadSchema<P>;
  readonly #nonces: NonceMemory;

  constructor(options: VerifierOptions<P>) {
    this.#keys = loadAllowlist(options.allowlist);
    this.#audit = options.audit;
    this.#schema = options.schema ?? (ALERT_SCHEMA as unknown as PayloadSchema<P>);
    const max = options.maxNonces ?? DEFAULT_MAX_NONCES;
    if (!Number.isSafeInteger(max) || max < 1) throw new RangeError("maxNonces must be a positive integer");
    this.#nonces = new NonceMemory(max);
  }

  verify(wire: Uint8Array, channel: Channel, now: number): ProvenanceVerdict<P> {
    const ch = checkChannel(channel);
    if (!isTime(now)) throw new RangeError("now must be epoch seconds");
    const who: Record<string, string> = {};
    const refuse = (gate: Gate, check: string): ProvenanceVerdict<P> => {
      this.#audit("provenance-refused", { gate, check, ...who });
      return { accepted: false, gate, check };
    };

    // ---- structure ----
    if (wire.length > MAX_WIRE_BYTES) return refuse("structure", "too-large");
    let text: string;
    try {
      text = STRICT_UTF8.decode(wire);
    } catch {
      return refuse("structure", "malformed");
    }
    let outer: unknown;
    try {
      outer = parseJsonStrict(text, MAX_WIRE_DEPTH);
    } catch (err) {
      if (!(err instanceof JsonParseError)) throw err;
      return refuse("structure", err.kind === "syntax" ? "malformed" : err.kind);
    }
    const form = numberForm(text);
    if (form !== null) return refuse("structure", form);
    if (!isPlainObject(outer)) return refuse("structure", "malformed");
    const outerBad = keyProblem(outer, ["envelope", "signature"]);
    if (outerBad !== null) return refuse("structure", "unknown" in outerBad ? "unknown-field" : outerBad.missing === "signature" ? "unsigned" : "missing-field");
    const env = outer["envelope"];
    if (!isPlainObject(env)) return refuse("structure", "malformed");
    const envBad = keyProblem(env, ["v", "sender_id", "origin_class", "key_id", "issued_at", "nonce", this.#schema.key]);
    if (envBad !== null) return refuse("structure", "unknown" in envBad ? "unknown-field" : "missing-field");
    if (env["v"] !== 1) return refuse("structure", "version");
    const { sender_id, origin_class, key_id, issued_at, nonce } = env;
    if (typeof sender_id !== "string" || !ID_RE.test(sender_id)) return refuse("structure", "sender-id");
    who["sender"] = sender_id;
    if (typeof key_id !== "string" || !ID_RE.test(key_id)) return refuse("structure", "key-id");
    who["kid"] = key_id;
    if (typeof origin_class !== "string" || !ORIGIN_CLASSES.includes(origin_class)) return refuse("structure", "origin-class");
    if (!isTime(issued_at)) return refuse("structure", "issued-at");
    if (typeof nonce !== "string" || !NONCE_RE.test(nonce)) return refuse("structure", "nonce");
    const p = this.#schema.parse(env[this.#schema.key]);
    if (!p.ok) return refuse("structure", p.check);
    const sig = signatureBytes(outer["signature"]);
    if (sig === undefined) return refuse("structure", "signature-encoding");
    const fields: EnvelopeFields<P> = { v: 1, sender_id, origin_class, key_id, issued_at, nonce, payload: p.payload };

    // ---- gate 1: signature ----
    const entry = this.#keys.get(key_id);
    if (entry === undefined) return refuse("signature", "unknown-key");
    if (now < entry.notBefore || now > entry.notAfter) return refuse("signature", "key-window");
    // belt-and-suspenders: loadAllowlist admits only Ed25519 keys (PV-6); the algorithm is never taken from the message.
    if (entry.publicKey.asymmetricKeyType !== "ed25519") return refuse("signature", "key-type");
    if (!edVerify(null, canonicalBytes(fields, this.#schema), entry.publicKey, sig)) return refuse("signature", "bad-signature");
    const t = this.#nonces.clock(now);
    if (issued_at < t - PAST_WINDOW_S) return refuse("signature", "stale");
    if (issued_at > now + FUTURE_SKEW_S) return refuse("signature", "future");
    if (this.#nonces.seen(nonce, t)) return refuse("signature", "replay");
    if (this.#nonces.full(t)) return refuse("signature", "nonce-cache-full");

    // ---- gate 2: author ----
    if (!ch.authors.includes(sender_id)) return refuse("author", "not-listed");
    if (entry.sender_id !== sender_id) return refuse("author", "key-not-authors");

    // ---- gate 3: effect ----
    const effect = this.#schema.effect(p.payload);
    const rank = (EFFECT_ORDER as readonly string[]).indexOf(effect);
    if (rank === -1) return refuse("effect", "unknown-effect");
    if (rank > EFFECT_ORDER.indexOf(ch.floor)) return refuse("effect", "above-floor");

    this.#nonces.remember(nonce, issued_at + PAST_WINDOW_S);
    this.#audit("provenance-accepted", { sender: sender_id, kid: key_id, effect });
    return { accepted: true, message: fields };
  }
}
