// Compact JWS verification with node:crypto only: no JOSE library at runtime (CSR-WO-1003 §1.4).
// See CHECKS.md for the rules each function implements (K2, K3).

import { createPublicKey, type JsonWebKey, type KeyObject, verify as cryptoVerify } from "node:crypto";

export type Alg = "ES256" | "EdDSA" | "RS256";
export const KNOWN_ALGS: readonly Alg[] = ["ES256", "EdDSA", "RS256"];

export interface Jwk {
  kty?: unknown;
  crv?: unknown;
  alg?: unknown;
  use?: unknown;
  kid?: unknown;
  [k: string]: unknown;
}

/** K2: does this JWK fit this algorithm? A key that does not is never tried. */
export function keyFits(jwk: Jwk, alg: Alg): boolean {
  if (jwk.use !== undefined && jwk.use !== "sig") return false;
  if (jwk["key_ops"] !== undefined && !(Array.isArray(jwk["key_ops"]) && jwk["key_ops"].includes("verify"))) return false;
  if (jwk.alg !== undefined && jwk.alg !== alg) return false;
  if (alg === "ES256") return jwk.kty === "EC" && jwk.crv === "P-256";
  if (alg === "EdDSA") return jwk.kty === "OKP" && jwk.crv === "Ed25519";
  return jwk.kty === "RSA";
}

/** RS256 key bounds: the modulus in bits, and the smallest public exponent. */
export const RSA_MIN_BITS = 2048;
export const RSA_MAX_BITS = 8192;
export const RSA_MIN_EXPONENT = 65537n;

/** Is this RSA key one we will verify with? The exponent must be odd and at least 65537: with e = 1
 *  the PKCS#1 v1.5 encoding of a digest is its own signature, and anyone can forge one (red-team F3).
 *  The modulus must be 2048 to 8192 bits: shorter is weak, longer costs CPU an unauthenticated
 *  client chooses. */
export function rsaKeyUsable(key: KeyObject): boolean {
  const d = key.asymmetricKeyDetails;
  const bits = d?.modulusLength;
  const e = d?.publicExponent;
  if (bits === undefined || e === undefined) return false;
  return bits >= RSA_MIN_BITS && bits <= RSA_MAX_BITS && e >= RSA_MIN_EXPONENT && e % 2n === 1n;
}

/** A public key from a JWK, with only the public members passed on. Undefined if it will not import
 *  or, for RSA, fails rsaKeyUsable. */
export function importKey(jwk: Jwk, alg: Alg): KeyObject | undefined {
  const pub: Record<string, unknown> =
    alg === "ES256" ? { kty: "EC", crv: "P-256", x: jwk["x"], y: jwk["y"] } : alg === "EdDSA" ? { kty: "OKP", crv: "Ed25519", x: jwk["x"] } : { kty: "RSA", n: jwk["n"], e: jwk["e"] };
  try {
    const key = createPublicKey({ key: pub as unknown as JsonWebKey, format: "jwk" });
    if (alg === "RS256" && !rsaKeyUsable(key)) return undefined;
    return key;
  } catch {
    return undefined;
  }
}

/** K3: the signature over `signingInput`. */
export function verifySignature(alg: Alg, key: KeyObject, signingInput: string, signature: Buffer): boolean {
  const data = Buffer.from(signingInput, "ascii");
  try {
    if (alg === "ES256") return cryptoVerify("sha256", data, { key, dsaEncoding: "ieee-p1363" }, signature);
    if (alg === "EdDSA") return cryptoVerify(null, data, key, signature);
    return cryptoVerify("sha256", data, key, signature);
  } catch {
    return false;
  }
}

const B64URL = /^[A-Za-z0-9_-]*$/;

/** A base64url segment decoded, or undefined if it is not strictly base64url: unpadded, and
 *  canonical, so unused trailing bits must be zero and one token has one spelling. */
export function b64url(segment: string): Buffer | undefined {
  if (!B64URL.test(segment) || segment.length % 4 === 1) return undefined;
  const buf = Buffer.from(segment, "base64url");
  return buf.toString("base64url") === segment ? buf : undefined;
}
