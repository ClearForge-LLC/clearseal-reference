// CSR-WO-2004 §1.2: signing through an isolated signer. This module never asks for a private key,
// never reads a key file and never holds key material: it hands canonical_bytes to a ProvenanceSigner
// and puts the 64 bytes it returns on the wire. Where the key lives (this process, another process,
// an OS keystore, hardware) is the signer's concern; see RULES.md PV-2 for the contract.

import { ALERT_SCHEMA, type Alert, canonicalBytes, type EnvelopeFields, envelopeObject, type PayloadSchema, SerializationRefusal } from "./envelope.ts";

/**
 * The signer contract (RULES.md PV-2). `kid` names the allowlist entry whose public key verifies what
 * `sign` returns. `sign` receives canonical_bytes exactly and resolves to the raw 64-byte Ed25519
 * signature over them (RFC 8032, pure Ed25519: no prehash, no context). It must not alter, hash or
 * frame the bytes, and it must reject rather than resolve on any failure.
 */
export interface ProvenanceSigner {
  readonly kid: string;
  sign(bytes: Uint8Array): Promise<Uint8Array>;
}

export class SignerError extends Error {
  override name = "SignerError";
}

/** What the caller supplies; `v` is 1 and `key_id` is the signer's `kid`. */
export interface MessageInput<P> {
  readonly sender_id: string;
  readonly origin_class?: string;
  readonly issued_at: number;
  readonly nonce: string;
  readonly payload: P;
}

const utf8 = new TextEncoder();

/** Throws SerializationRefusal on a lone surrogate anywhere in a JSON-shaped value. */
function assertWellFormed(value: unknown, where: string): void {
  if (typeof value === "string") {
    if (!value.isWellFormed()) throw new SerializationRefusal(`lone surrogate in ${where}`);
  } else if (Array.isArray(value)) {
    value.forEach((v: unknown, i) => {
      assertWellFormed(v, `${where}[${String(i)}]`);
    });
  } else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      assertWellFormed(k, `${where} key`);
      assertWellFormed(v, `${where}.${k}`);
    }
  }
}

/**
 * Signs one message and serializes it as Option A's wire. It checks only what it must to sign the
 * string given (no lone surrogate) and that the signer kept the contract (64 bytes back); field rules
 * are the verifier's, so a test can sign what a verifier must refuse.
 */
export async function signMessage<P = Alert>(input: MessageInput<P>, signer: ProvenanceSigner, schema: PayloadSchema<P> = ALERT_SCHEMA as unknown as PayloadSchema<P>): Promise<Uint8Array> {
  const fields: EnvelopeFields<P> = { v: 1, sender_id: input.sender_id, origin_class: input.origin_class ?? "system", key_id: signer.kid, issued_at: input.issued_at, nonce: input.nonce, payload: input.payload };
  const envelope = envelopeObject(fields, schema);
  assertWellFormed(envelope, "envelope");
  const signature: unknown = await signer.sign(canonicalBytes(fields, schema));
  if (!(signature instanceof Uint8Array) || signature.length !== 64) throw new SignerError("the signer did not return a 64-byte signature");
  return utf8.encode(JSON.stringify({ envelope, signature: Buffer.from(signature).toString("base64") }));
}
