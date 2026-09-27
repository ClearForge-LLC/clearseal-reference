// The Signer (CSR-WO-2002 §1.1; architecture §5 *Key identity and rotation*): a key id and a sign
// function, Ed25519 through node:crypto, no new dependency. The checkpoint signer uses it, and
// provenance (-2004) will reuse the interface. Verification keys live in an allowlist whose entries
// each carry a kid and a validity window, so rotation is an added entry, never an edited one.

import { createPrivateKey, createPublicKey, type KeyObject, sign as edSign, verify as edVerify } from "node:crypto";

import { parseCanonicalJson } from "../pinning/canonical.ts";
import { KID } from "./digest.ts";

export interface Signer {
  readonly kid: string;
  sign(bytes: Uint8Array): Uint8Array;
  /** The raw Ed25519 public key, base64url, when the signer knows it: the store checks its own last
   *  checkpoint with it at start (audit/RULES.md AU-24). */
  readonly publicKey?: string;
}

/** An Ed25519 signature in base64url: 64 bytes, exactly 86 characters, no padding, nothing else. One
 *  spelling per signature, so a checkpoint line has one spelling too. */
export const SIGNATURE_FORM = /^[A-Za-z0-9_-]{85}[AQgw]$/;
/** A raw Ed25519 public key in base64url: 32 bytes, exactly 43 characters. */
const PUBLIC_KEY_FORM = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

/** A signer over a PKCS#8 PEM Ed25519 private key. Anything else is refused. */
export function signerFromPem(kid: string, pem: string): Signer {
  if (!KID.test(kid)) throw new TypeError("a signing key id matches [A-Za-z0-9._-]{1,64}");
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: pem, format: "pem" });
  } catch {
    throw new TypeError("the signing key is not a PEM private key");
  }
  if (key.asymmetricKeyType !== "ed25519") throw new TypeError(`the signing key is ${String(key.asymmetricKeyType)}, not Ed25519`);
  if ((pem.match(/-----BEGIN /g) ?? []).length !== 1) throw new TypeError("the signing key file holds more than one PEM block: one key per file");
  const publicKey = String(createPublicKey(key).export({ format: "jwk" }).x);
  return Object.freeze({ kid, publicKey, sign: (bytes: Uint8Array): Uint8Array => edSign(null, bytes, key) });
}

/** One allowlist entry: a kid, its raw 32-byte Ed25519 public key in base64url, and its window. */
export interface KeyEntry {
  readonly kid: string;
  readonly key: string;
  readonly notBefore: string;
  readonly notAfter: string;
}

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/** A calendar-valid RFC 3339 time: the date and hour must exist (no 30 February, no hour 24). */
function validTime(t: unknown): t is string {
  if (typeof t !== "string" || !RFC3339.test(t) || Number.isNaN(Date.parse(t))) return false;
  const [y, m, d, h] = [t.slice(0, 4), t.slice(5, 7), t.slice(8, 10), t.slice(11, 13)].map(Number) as [number, number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d));
  return day.getUTCFullYear() === y && day.getUTCMonth() === m - 1 && day.getUTCDate() === d && h < 24;
}

/** Parses an allowlist: a non-empty JSON array of KeyEntry, each with exactly its four members, and
 *  no duplicate member anywhere. Throws naming the first bad entry. */
export function parseAllowlist(text: string): KeyEntry[] {
  let value: unknown;
  try {
    value = parseCanonicalJson(text);
  } catch (err) {
    throw new TypeError(`the key allowlist is not JSON with unique members (${err instanceof Error ? err.message : "unreadable"})`, { cause: err });
  }
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("the key allowlist is a non-empty JSON array");
  const seen = new Set<string>();
  return value.map((e: unknown, i) => {
    const where = `allowlist entry ${String(i)}`;
    if (typeof e !== "object" || e === null) throw new TypeError(`${where} is not an object`);
    if (Object.keys(e).sort().join(",") !== "key,kid,notAfter,notBefore") throw new TypeError(`${where} has members other than kid, key, notBefore and notAfter`);
    const { kid, key, notBefore, notAfter } = e as Record<string, unknown>;
    if (typeof kid !== "string" || !KID.test(kid)) throw new TypeError(`${where}: kid`);
    if (seen.has(kid)) throw new TypeError(`${where}: kid ${kid} appears twice (rotation adds an entry with a new kid)`);
    seen.add(kid);
    if (typeof key !== "string" || !PUBLIC_KEY_FORM.test(key)) throw new TypeError(`${where}: key is a raw 32-byte Ed25519 public key in base64url (43 characters, no padding)`);
    for (const [n, t] of [["notBefore", notBefore], ["notAfter", notAfter]] as const) {
      if (!validTime(t)) throw new TypeError(`${where}: ${n} is a calendar-valid RFC 3339 time`);
    }
    if (Date.parse(notBefore as string) > Date.parse(notAfter as string)) throw new TypeError(`${where}: notBefore is after notAfter`);
    return Object.freeze({ kid, key, notBefore: notBefore as string, notAfter: notAfter as string });
  });
}

/** The raw public key of a signer's private key, base64url: what an allowlist entry holds. */
export function publicKeyOf(pem: string): string {
  const jwk = createPublicKey(createPrivateKey({ key: pem, format: "pem" })).export({ format: "jwk" });
  return String(jwk.x);
}

/** Verifies an Ed25519 signature against an allowlist entry's key. */
export function verifyWith(entry: KeyEntry, bytes: Uint8Array, sig: Uint8Array): boolean {
  try {
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: entry.key }, format: "jwk" });
    return edVerify(null, bytes, key, sig);
  } catch {
    return false;
  }
}
