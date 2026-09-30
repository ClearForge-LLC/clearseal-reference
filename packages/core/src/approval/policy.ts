// Who may decide an approval (CSR-WO-2001; approval/RULES.md APR-6). The standard at the pinned edition
// (`66b640d`) §3: "Rule-of-Two: untrusted_input_facing AND (state_change | arbitrary_exec) ⇒ a
// human-in-loop obligation, discharged by an elevated human confirmation or by demonstrable
// containment." So an approval that discharges CAP-2 or CAP-3 is decided by a human only; a delegated
// approver decides only approvals CAP-7 alone requires (the architect's ruling, 2026-09-28).

import type { CapabilityTag } from "../pinning/manifest.ts";
import { obligationOf, unmetObligations } from "../capability/ladder.ts";

/**
 * True when approval is what discharges a Rule-of-Two obligation for this tag: the requirements left
 * unmet with no approval backend include CAP-2 (an untrusted-facing state_change with no containment)
 * or CAP-3 (an untrusted-facing arbitrary_exec). Read from the pinned tag only.
 */
export function humanOnly(tag: CapabilityTag): boolean {
  return unmetObligations(tag, obligationOf(tag), "none").some((r) => r.rule === "CAP-2" || r.rule === "CAP-3");
}
