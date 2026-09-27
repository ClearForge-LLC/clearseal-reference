// The capability obligation (CSR-WO-2000; ClearSeal v0.8 §3; northstar N4, N7). A pure function from
// a tool's frozen capability tag to a frozen obligation: the compensating controls the tag requires,
// and the ones it forbids, each with a one-line reason naming its rule. The rules and the standard's
// sentences are in RULES.md beside this file. The pinned registry checks every admitted tool against
// its obligation at construction and refuses to build if one is unmet: an obligation, not a lint.
//
// What this is not: the approval gate (CSR-WO-2001), the capability ceiling (-2003), or caller
// entitlement (P6). It decides only whether a declared shape is one the node may serve at all.

import type { CapabilityTag } from "../pinning/manifest.ts";
import { CAPABILITY_CLASSES } from "./fields.ts";

/** The rules of RULES.md, and N7 (-1002), which the obligation records but -1002 checks first. */
export type RuleId = "CAP-2" | "CAP-3" | "CAP-4" | "CAP-5" | "CAP-6" | "CAP-7" | "N7";

/**
 * A compensating control:
 * - `containment`: a containment domain with at least one sink (CAP-8: `[]` is the same bound as
 *   null, and discharges nothing);
 * - `approval`: `elevated`, with an approval backend to confirm each call;
 * - `recoverability_basis`: a one-line basis (CAP-5);
 * - `approval_backend`: an approval backend configured on the node (CAP-7).
 */
export type Control = "containment" | "approval" | "recoverability_basis" | "approval_backend";

/** Met when any one of `anyOf` is present. */
export interface Requirement {
  readonly anyOf: readonly Control[];
  readonly rule: RuleId;
  readonly reason: string;
}

export interface Prohibition {
  readonly control: Control;
  readonly rule: RuleId;
  readonly reason: string;
}

export interface Obligation {
  readonly requires: readonly Requirement[];
  readonly forbids: readonly Prohibition[];
  /** Rules that would apply but are discharged by the tag itself (CAP-4), for the record. */
  readonly discharged: readonly { readonly rule: RuleId; readonly reason: string }[];
}

/** The four inputs the obligation is computed from: the rung and the three booleans. */
export type ObligationInput = Pick<CapabilityTag, "capability_class" | "untrusted_input_facing" | "privacy_sensitive" | "elevated">;

/**
 * Whether the node has an approval backend. None exists until CSR-WO-2001 registers one, so this is
 * "none", fail closed. It is a constant, not an option: an option would let a caller say
 * "configured" and serve an elevated tool with no gate behind it.
 */
export type ApprovalBackend = "none" | "configured";
export const APPROVAL_BACKEND: ApprovalBackend = "none";

/** The longest recoverability basis, in code points: one line a reviewer reads without wrapping
 *  (RULES.md CAP-5 records why 120). */
export const MAX_BASIS = 120;

/** Characters that break, hide or control a line: C0 and C1 controls (tab, LF, CR, NEL among them),
 *  format characters (bidi overrides, zero-width marks), the line and paragraph separators, lone
 *  surrogates, and what renders as nothing or as no agreed glyph: default-ignorable code points
 *  (Hangul fillers, variation selectors, the grapheme joiner), private-use and unassigned ones. */
const NOT_ONE_LINE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}\p{Cn}\p{Default_Ignorable_Code_Point}]/u;

/** A basis a reviewer can read says something: at least one letter or digit. */
const LEGIBLE = /[\p{L}\p{N}]/u;

const CLASSES: ReadonlySet<string> = new Set(CAPABILITY_CLASSES);

/** The obligation for a tag. Pure and total over the four rungs and the three booleans; any other
 *  input is a TypeError (the canonical form refuses it long before this runs). */
export function obligationOf(tag: ObligationInput): Obligation {
  const cls: unknown = tag.capability_class;
  if (typeof cls !== "string" || !CLASSES.has(cls)) throw new TypeError("capability_class outside the four rungs");
  for (const flag of ["untrusted_input_facing", "privacy_sensitive", "elevated"] as const) {
    if (typeof tag[flag] !== "boolean") throw new TypeError(`${flag} must be true or false`);
  }
  const requires: Requirement[] = [];
  const forbids: Prohibition[] = [];
  const discharged: { rule: RuleId; reason: string }[] = [];
  if (tag.elevated) requires.push({ anyOf: ["approval_backend"], rule: "CAP-7", reason: "elevated requires an approval backend; none is configured" });
  if (cls === "owned_state") requires.push({ anyOf: ["recoverability_basis"], rule: "CAP-5", reason: "owned_state must pin a one-line recoverability_basis (§3)" });
  else forbids.push({ control: "recoverability_basis", rule: "CAP-6", reason: `recoverability_basis is null unless owned_state (§3); this tool is ${cls}` });
  if (cls === "arbitrary_exec") forbids.push({ control: "containment", rule: "N7", reason: "arbitrary_exec is refused a containment domain (N7)" });
  if (tag.untrusted_input_facing) {
    if (cls === "state_change") {
      requires.push({ anyOf: ["containment", "approval"], rule: "CAP-2", reason: "Rule-of-Two: an untrusted-input-facing state_change tool needs containment (a non-empty containment_domain) or approval (elevated, with an approval backend); it has neither" });
    } else if (cls === "arbitrary_exec") {
      requires.push({ anyOf: ["approval"], rule: "CAP-3", reason: "Rule-of-Two: an untrusted-input-facing arbitrary_exec tool needs approval (elevated, with an approval backend); containment cannot discharge it (N7)" });
    } else if (cls === "owned_state") {
      discharged.push({ rule: "CAP-4", reason: "Rule-of-Two is auto-discharged by owned_state's three clauses and its pinned basis" });
    }
  }
  return Object.freeze({
    requires: Object.freeze(requires.map((r) => Object.freeze({ ...r, anyOf: Object.freeze([...r.anyOf]) }))),
    forbids: Object.freeze(forbids.map((p) => Object.freeze(p))),
    discharged: Object.freeze(discharged.map((d) => Object.freeze(d))),
  });
}

/** Why a basis is not one valid line, or undefined when it is. */
export function basisProblem(basis: string | null): string | undefined {
  if (basis === null) return "it is missing";
  if (!/\S/u.test(basis)) return "it is empty or whitespace";
  if (NOT_ONE_LINE.test(basis)) return "it is not one line (a line break, control, format, invisible or unassigned character)";
  if (!LEGIBLE.test(basis)) return "it has no letter or digit";
  if ([...basis].length > MAX_BASIS) return `it is longer than ${String(MAX_BASIS)} characters`;
  return undefined;
}

/** Whether the tag, as pinned, carries a control. */
function present(control: Control, tag: CapabilityTag, backend: ApprovalBackend): boolean {
  switch (control) {
    case "containment":
      return tag.containment_domain !== null && tag.containment_domain.length > 0;
    case "approval":
      return tag.elevated && backend === "configured";
    case "recoverability_basis":
      return basisProblem(tag.recoverability_basis) === undefined;
    case "approval_backend":
      return backend === "configured";
  }
}

/** Whether a forbidden control is carried. Forbidding a field forbids any non-null value, so an
 *  empty basis or an empty domain is carried. */
function carried(control: Control, tag: CapabilityTag): boolean {
  switch (control) {
    case "containment":
      return tag.containment_domain !== null;
    case "recoverability_basis":
      return tag.recoverability_basis !== null;
    case "approval":
    case "approval_backend":
      return tag.elevated;
  }
}

export interface Unmet {
  readonly rule: RuleId;
  readonly reason: string;
}

/** Every unmet entry of the obligation, in order: empty when the tag may be served. */
export function unmetObligations(tag: CapabilityTag, obligation: Obligation, backend: ApprovalBackend): readonly Unmet[] {
  const unmet: Unmet[] = [];
  for (const r of obligation.requires) {
    if (r.anyOf.some((c) => present(c, tag, backend))) continue;
    const why = r.rule === "CAP-5" ? `: ${basisProblem(tag.recoverability_basis) ?? "it is not valid"}` : "";
    unmet.push(Object.freeze({ rule: r.rule, reason: `${r.reason}${why}` }));
  }
  for (const p of obligation.forbids) if (carried(p.control, tag)) unmet.push(Object.freeze({ rule: p.rule, reason: p.reason }));
  return Object.freeze(unmet);
}

/** A tool whose tag carries an obligation it does not meet; the registry refuses to build. */
export class ObligationError extends Error {
  override name = "ObligationError";
  readonly tool: string;
  readonly rules: readonly RuleId[];
  constructor(tool: string, unmet: readonly Unmet[]) {
    super(`tool "${tool}": ${unmet.map((u) => u.reason).join("; ")}`);
    this.tool = tool;
    this.rules = Object.freeze(unmet.map((u) => u.rule));
  }
}
