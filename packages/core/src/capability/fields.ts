// The capability module's field lists (docs/canonical-form.md A6). This is the ONE place they are
// written: the canonicalizer imports PINNED_FIELDS, and the subset test imports GATE_READ_FIELDS.
// Two copies of a security-critical list are two things that drift apart unseen, which is how the
// fleet's standard came to enumerate nine pinned fields while its reference node hashed ten.

/** The pinned tool object of ClearSeal v0.8: exactly the ten fields `tool_hash` covers. */
export const PINNED_FIELDS = [
  "name",
  "description",
  "input_schema",
  "capability_class",
  "untrusted_input_facing",
  "scope",
  "privacy_sensitive",
  "recoverability_basis",
  "elevated",
  "containment_domain",
] as const;

export type PinnedField = (typeof PINNED_FIELDS)[number];

/** The capability ladder's four rungs (A5). */
export const CAPABILITY_CLASSES = ["read_only", "owned_state", "state_change", "arbitrary_exec"] as const;

export type CapabilityClass = (typeof CAPABILITY_CLASSES)[number];

/**
 * Every field a gate decides on. The generating rule (A6, northstar N3): a gate must never decide
 * on a field the manifest does not hash, since anything a gate reads outside the hash changes the
 * outcome with zero pin drift. So this list must stay inside the canonicalizer's output, and
 * `test:subset` asserts it does. A gate that starts reading a new field adds it here first.
 *
 * - `input_schema`: the validation gate checks every call against it.
 * - `capability_class`, `untrusted_input_facing`, `scope`, `privacy_sensitive`: the capability
 *   ladder and Rule-of-Two.
 * - `recoverability_basis`: the `owned_state` claim.
 * - `elevated`: whether a call needs a human tap.
 * - `containment_domain`: the containment discharge of Rule-of-Two.
 */
export const GATE_READ_FIELDS: readonly PinnedField[] = [
  "input_schema",
  "capability_class",
  "untrusted_input_facing",
  "scope",
  "privacy_sensitive",
  "recoverability_basis",
  "elevated",
  "containment_domain",
];
