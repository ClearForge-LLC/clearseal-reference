// Keyed digests (CSR-WO-2002 §1.2; architecture §5 *Audit argument digests*; audit/RULES.md AU-5 to
// AU-7). An HMAC-SHA256 under the operator's digest key, with the key id prefixed: equal inputs under
// the same key give equal digests, so rows still correlate, and nothing about a low-entropy value is
// recoverable without the key. Never a bare hash: a bare hash of a path or a name is reversible by
// dictionary.
//
// Arguments are digested through the core's existing canonical argument digest (argumentsDigest, the
// SHA-256 of the canonical argument JSON that the request-state binding uses), so the audit and the
// binding agree on what "the same arguments" means, and no transport file changes to share it.

import { createHmac, randomBytes } from "node:crypto";

import { argumentsDigest } from "../transport/request-state.ts";

/** A key id: what names a key in a digest, a checkpoint and an allowlist. */
export const KID = /^[A-Za-z0-9._-]{1,64}$/;

/** The shape of every keyed digest a row carries. */
export const DIGEST_FORM = /^hmac-sha256:[A-Za-z0-9._-]{1,64}:[A-Za-z0-9_-]{43}$/;

const ARGS_CONTEXT = "clearseal-audit-args-v1\n";
const FIELD_CONTEXT = "clearseal-audit-field-v1\n";

export interface Digester {
  readonly kid: string;
  /** The keyed digest of a call's arguments. */
  readonly args: (args: unknown) => string;
  /** The keyed digest of a field value, bound to its label so equal values under different labels differ. */
  readonly value: (label: string, value: unknown) => string;
}

/** A value's text for a digest, with its type, so distinct values never share one: NaN, the
 *  infinities, -0, undefined and null each have their own; a BigInt does not throw. */
function tagged(value: unknown): string {
  if (typeof value === "number") return `number:${Object.is(value, -0) ? "-0" : String(value)}`;
  if (typeof value === "bigint") return `bigint:${value.toString()}`;
  if (value === undefined) return "undefined";
  try {
    return `json:${JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? `${v.toString()}n` : v === undefined ? "(undefined)" : v))}`;
  } catch {
    // Unserializable (a cycle): its type alone, so the digest is still stable and still keyed.
    return `unserializable:${typeof value}`;
  }
}

/** A digester under the operator's key. The key is copied; the caller's buffer is not kept. */
export function keyedDigester(kid: string, key: Uint8Array): Digester {
  if (!KID.test(kid)) throw new TypeError("a digest key id matches [A-Za-z0-9._-]{1,64}");
  if (key.length < 32) throw new TypeError("a digest key is at least 32 bytes");
  const k = Buffer.from(key);
  const mac = (context: string, text: string): string => `hmac-sha256:${kid}:${createHmac("sha256", k).update(context).update(text, "utf8").digest("base64url")}`;
  return Object.freeze({
    kid,
    args: (args: unknown): string => mac(ARGS_CONTEXT, argumentsDigest(args)),
    value: (label: string, value: unknown): string => mac(FIELD_CONTEXT, `${label}\n${tagged(value)}`),
  });
}

/** A digester under a key made for this process and never stored: for a node without an audit store
 *  (the seam-only development mode, tests that start a transport directly). Rows still carry a keyed
 *  digest, never an argument; they correlate within the process and with nothing else. */
export function ephemeralDigester(): Digester {
  return keyedDigester("ephemeral", randomBytes(32));
}
