// CSR-WO-2004: the provenance module's public surface (RULES.md). Exported from the core as one
// namespace, `provenance`, so its names (Signer-like, KeyEntry-like) never collide with audit's.

export { type Channel, AllowlistError, checkChannel, loadAllowlist, type ProvenanceAllowlist, type ProvenanceKey, type ProvenanceKeyData } from "./allowlist.ts";
export { ALERT_CONTEXT, ALERT_SCHEMA, type Alert, canonicalBytes, type Effect, EFFECT_ORDER, type EnvelopeFields, FUTURE_SKEW_S, PAST_WINDOW_S, type PayloadSchema, SerializationRefusal } from "./envelope.ts";
export { type MessageInput, type ProvenanceSigner, SignerError, signMessage } from "./signer.ts";
export { DEFAULT_MAX_NONCES, type Gate, MAX_WIRE_BYTES, MAX_WIRE_DEPTH, ProvenanceVerifier, type ProvenanceVerdict, type VerifierOptions } from "./verify.ts";
