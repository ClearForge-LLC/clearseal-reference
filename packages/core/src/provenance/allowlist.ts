// CSR-WO-2004 §1.4: the provenance allowlist, plain data. Every entry carries a `kid` and a validity
// window (architecture §5, Key identity and rotation); rotation is adding an entry with a new window,
// never editing one. Loading refuses what would make a verdict ambiguous or a key unfit.

import { createPublicKey, type KeyObject } from "node:crypto";

import { type Effect, EFFECT_ORDER, ID_RE, isTime } from "./envelope.ts";

/** One allowlist entry as configured: the public key is SPKI, PEM text or a KeyObject. */
export interface ProvenanceKeyData {
  readonly kid: string;
  readonly sender_id: string;
  readonly publicKey: string | KeyObject;
  /** Validity window, epoch seconds, inclusive at both ends. */
  readonly notBefore: number;
  readonly notAfter: number;
}

/** A loaded entry: the key is an Ed25519 KeyObject. */
export interface ProvenanceKey {
  readonly kid: string;
  readonly sender_id: string;
  readonly publicKey: KeyObject;
  readonly notBefore: number;
  readonly notAfter: number;
}

/** A channel: who may author on it, and the highest effect a message on it may request. */
export interface Channel {
  readonly name: string;
  readonly authors: readonly string[];
  readonly floor: Effect;
}

export class AllowlistError extends Error {
  override name = "AllowlistError";
}

/** The loaded allowlist, by `kid`. Frozen: a verifier never sees an entry change. */
export type ProvenanceAllowlist = ReadonlyMap<string, ProvenanceKey>;

function keyOf(data: string | KeyObject, kid: string): KeyObject {
  let key: KeyObject;
  try {
    key = typeof data === "string" ? createPublicKey(data) : data;
  } catch {
    throw new AllowlistError(`kid "${kid}": the public key does not parse`);
  }
  if (key.type !== "public") throw new AllowlistError(`kid "${kid}": not a public key`);
  if (key.asymmetricKeyType !== "ed25519") throw new AllowlistError(`kid "${kid}": the key is not Ed25519 (PV-6)`);
  return key;
}

export function loadAllowlist(entries: readonly ProvenanceKeyData[]): ProvenanceAllowlist {
  const out = new Map<string, ProvenanceKey>();
  for (const e of entries) {
    if (typeof e.kid !== "string" || !ID_RE.test(e.kid)) throw new AllowlistError("an entry's kid does not match the contract's pattern");
    if (typeof e.sender_id !== "string" || !ID_RE.test(e.sender_id)) throw new AllowlistError(`kid "${e.kid}": sender_id does not match the contract's pattern`);
    if (!isTime(e.notBefore) || !isTime(e.notAfter)) throw new AllowlistError(`kid "${e.kid}": the window is not two epoch-second integers`);
    if (e.notBefore > e.notAfter) throw new AllowlistError(`kid "${e.kid}": the window is inverted`);
    if (out.has(e.kid)) throw new AllowlistError(`kid "${e.kid}" appears twice: rotation adds a new kid, never a second entry for one`);
    out.set(e.kid, Object.freeze({ kid: e.kid, sender_id: e.sender_id, publicKey: keyOf(e.publicKey, e.kid), notBefore: e.notBefore, notAfter: e.notAfter }));
  }
  return out;
}

/** A channel as configured, checked: a known floor and authors that match the contract's pattern. */
export function checkChannel(channel: Channel): Channel {
  if (typeof channel.name !== "string" || channel.name.length === 0) throw new AllowlistError("a channel needs a name");
  if (!EFFECT_ORDER.includes(channel.floor)) throw new AllowlistError(`channel "${channel.name}": the floor is not a known effect`);
  for (const a of channel.authors) if (typeof a !== "string" || !ID_RE.test(a)) throw new AllowlistError(`channel "${channel.name}": an author does not match the contract's pattern`);
  return Object.freeze({ name: channel.name, authors: Object.freeze([...channel.authors]), floor: channel.floor });
}
