# Capability obligation rules (CSR-WO-2000)

Written before `ladder.ts`, one rule per sentence of the standard. The source is the ClearSeal
standard's public edition at `66b640d` (`ClearSeal-Standard-v0.8.md`): §3 *Controls*, lines 105–110,
and §4 *Node applicability matrix*, line 125. Each sentence is quoted verbatim. Each rule names the
test that proves it can fail, and its control-deletion row in `test/deletion/controls.json`.

`ladder.ts` computes an **obligation** from a tool's frozen tag. The inputs are the rung and the
three booleans (`untrusted_input_facing`, `privacy_sensitive`, `elevated`). The obligation lists
the compensating controls the tag **requires** and the ones it **forbids**, and gives a one-line
reason per entry that names its rule. `PinnedRegistry`'s constructor checks every admitted tool
against its obligation, where N7 is checked, and refuses construction if one is unmet
(`ObligationError`). The error names the tool and the rule. The function is pure and total over all
4 × 2 × 2 × 2 = 32 combinations, and `test/capability/ladder.test.ts` enumerates every one.

Tests named below are in `packages/core/test/capability/ladder.test.ts` unless another file is
given.

## CAP-1 — the ladder and the orthogonal flag

> **Capability scoping = a four-rung danger ladder + orthogonal booleans.** Every tool carries a
> `capability_class` (`read_only` | `owned_state` | `state_change` | `arbitrary_exec`), an
> `untrusted_input_facing` boolean, and a narrow `scope`. The ladder and the boolean are
> **orthogonal axes** — any rung can be untrusted-input-facing. (§3, line 105)

**Rule.** The obligation is computed from the frozen tag's rung and booleans alone. Every rung
combines with either value of `untrusted_input_facing`, and no combination is refused *by the
combination itself*. A refusal always names a missing or forbidden control. `privacy_sensitive`
changes no obligation: §3 attaches no control to it.

**Enforced:** the registry computes and checks the obligation for every admitted tool.
**Red-proof:** "the registry checks every admitted tool against its obligation". It deletes the
check, and an untrusted `state_change` tool with no containment is then served.
**Row:** `obligation-enforced-at-construction`.

## CAP-2 — Rule-of-Two, `state_change`

> **Rule-of-Two:** `untrusted_input_facing` AND (`state_change` | `arbitrary_exec`) ⇒ a
> human-in-loop obligation, discharged by an elevated human confirmation **or** by demonstrable
> containment. (§3, line 107)

**Rule.** An untrusted-facing `state_change` tool requires containment **or** approval.
- *Containment* is a containment domain with at least one sink (CAP-8).
- *Approval* is `elevated: true` with an approval backend configured. No backend exists before
  CSR-WO-2001 (CAP-7), so today only containment discharges this rule.

**Refusal:** `tool "<name>": Rule-of-Two: an untrusted-input-facing state_change tool needs
containment (a non-empty containment_domain) or approval (elevated, with an approval backend); it
has neither`.
**Red-proof:** "Rule-of-Two refuses an untrusted state_change tool with no containment".
**Row:** `rule-of-two-state-change`.

## CAP-3 — Rule-of-Two, `arbitrary_exec`

> the same sentence as CAP-2, and: **`arbitrary_exec` is refused a domain at construction**, so an
> arbitrary-exec tool can never discharge Rule-of-Two by containment — by construction, not by
> policy. (§3, line 109)

**Rule.** An untrusted-facing `arbitrary_exec` tool requires approval. Containment cannot discharge
it.
- Today that tool is always refused. `EXEC_TOOLS_FORBIDDEN` (on by default, N7) refuses it first.
- With that flag off, this rule refuses it, because approval does not exist yet (CAP-7).
- CSR-WO-2000 §1.2 lists this rule only for `state_change`. The standard's sentence names both
  rungs, and §1.2 is a minimum, so it is implemented here and recorded in FEEDBACK.
- `-1002`'s two `arbitrary_exec` rules (no domain; refused while `EXEC_TOOLS_FORBIDDEN` is on) are
  unchanged and still run first.

**Refusal:** `tool "<name>": Rule-of-Two: an untrusted-input-facing arbitrary_exec tool needs
approval (elevated, with an approval backend); containment cannot discharge it (N7)`.
**Red-proof:** "Rule-of-Two refuses an untrusted arbitrary_exec tool, flag off, no approval".
**Row:** `rule-of-two-arbitrary-exec`.

## CAP-4 — `owned_state` auto-discharges Rule-of-Two

> **`owned_state` auto-discharges Rule-of-Two** — containment is proven structurally by the three
> clauses rather than promised. (§3, line 107)

**Rule.** An untrusted-facing `owned_state` tool needs neither containment nor approval. Its
recoverability basis (CAP-5) is the structural proof.
**Red-proof:** "owned_state auto-discharges Rule-of-Two: untrusted, no containment, admitted". If
the discharge is deleted, that tool is refused.
**Row:** `owned-state-auto-discharge`.

## CAP-5 — `owned_state` pins a one-line recoverability basis

> A tool claiming this rung MUST pin a one-line `recoverability_basis` (e.g.
> `"append-only + supersession"`); if the basis cannot be stated in one line, the tool is not
> `owned_state`. (§3, line 106)

**Rule.** An `owned_state` tool's `recoverability_basis` must be one valid line. It is refused when
it is:
- null (missing);
- empty, or whitespace only;
- over **120 code points**;
- carrying any character that breaks, hides or controls a line: a C0 or C1 control (tab, `\n`,
  `\r` and U+0085 among them), a format character (Unicode Cf: bidi overrides, zero-width marks),
  U+2028, U+2029, or a lone surrogate;
- carrying a character that renders as nothing, or as no agreed glyph: a default-ignorable code
  point (Hangul fillers, variation selectors, the grapheme joiner), private use, or unassigned;
- carrying no letter or digit (a Braille blank, a lone combining mark, punctuation alone). A basis
  a reviewer cannot read states nothing.

**Why 120.**
- One line is a line a reviewer reads without wrapping, in the approval diff and in the audit line.
- 120 is the common review-tool and terminal width.
- The standard's own example is 26 code points, so 120 leaves room for a clause like "append-only +
  supersession; rebuilt from the event log".
- It is counted in code points, not UTF-16 units, so the count does not depend on the encoding.

**Refusal:** `tool "<name>": owned_state must pin a one-line recoverability_basis (§3): <why>`.
**Red-proofs:** "owned_state refuses a missing, empty, whitespace or over-long basis",
"owned_state refuses a basis broken by any line terminator or control" and "owned_state refuses a
basis with no letter or digit".
**Rows:** `owned-state-basis-required`, `owned-state-basis-not-blank`, `owned-state-basis-one-line`,
`owned-state-basis-length`, `owned-state-basis-legible`.

**Not refused, by choice (Low, from the adversarial pass):**
- A basis within 120 code points can still render wider than one line: combining marks stacked on
  one letter, or wide glyphs such as U+FDFD.
- Strong right-to-left text can reorder the neutral characters around it on screen.
Each can only mislead a reviewer's eye, and whoever writes the tag can already write a false basis.
The basis is pinned, so what the reviewer approved is what is served.

## CAP-6 — no other rung carries a basis

> `recoverability_basis` (null unless `owned_state`) (§3, line 108)

**Rule.** A `read_only`, `state_change` or `arbitrary_exec` tool whose basis is not null is refused.
That includes an empty string.
**Refusal:** `tool "<name>": recoverability_basis is null unless owned_state (§3); this tool is
<rung>`.
**Red-proof:** "a basis on any other rung is refused".
**Row:** `basis-only-on-owned-state`.

## CAP-7 — `elevated` needs an approval backend (architect's ruling, fail closed)

> `elevated` is pinned because the human-confirmation gate reads it (§3, line 108)
>
> **Human-in-loop rides standard rails.** An elevated-confirmation tier for catastrophic
> operations targets the spec's **Multi-Round-Trip Requests** / **Tasks** extension rather than a
> bespoke round-trip (§3, line 110)

**Rule.**
- `elevated: true` promises that every call is approved first. The gate is CSR-WO-2001's
  (`approval/RULES.md`). Without an approval backend configured in the settings snapshot
  (`APPROVAL_BACKEND`), any `elevated` tool is refused at construction, on any rung, exactly as before
  it existed: the registry's default is `DEFAULT_APPROVAL_BACKEND = "none"`.
- "configured" never serves an elevated tool with no gate behind it: the transport refuses to start
  when a registered tool needs approval and it was given no backend, and dispatch refuses such a call
  without one (APR-14).
- With a backend configured, approval discharges Rule-of-Two (CAP-2, CAP-3), and such an approval is
  decided only by a human (APR-6: the standard's §3 names a human confirmation).

**Refusal:** `tool "<name>": elevated requires an approval backend; none is configured`.
**Red-proof:** "any elevated tool is refused while no approval backend exists".
**Row:** `elevated-needs-approval-backend`.

## CAP-8 — an empty containment set discharges nothing

> It carries **the set itself, not a flag** — a boolean would be a *claim* the manifest hashes; the
> set is *the bound* (§3, line 109)

**Rule.** Containment discharges Rule-of-Two only with **at least one** sink.
- `[]` and null are the same bound: both mean no sink outside the process, and the cage is built
  identically from either (`parseDomain(null)` is the empty domain).
- If `[]` discharged Rule-of-Two where null does not, one spelling change with the bound unchanged
  would switch the control off. That turns the set back into a flag.
- So containment is judged on the set's contents, never on whether it is null.

**Refusal:** CAP-2's message, when the domain is `[]`.
**Red-proof:** "an empty containment set does not discharge Rule-of-Two".
**Row:** `rule-of-two-empty-domain`.

## Unchanged: N7 (`-1002`)

> **`arbitrary_exec` is refused a domain at construction** (§3, line 109)

`registry.ts` keeps its two checks, word for word and in the same place: a domain on
`arbitrary_exec` is refused, and so is any `arbitrary_exec` while `EXEC_TOOLS_FORBIDDEN` is on. The
obligation records "containment forbidden" for `arbitrary_exec` so the table is complete, but does
not enforce it a second time. Those checks keep their `-1002` tests and `-2008` rows.

## §4 — read, nothing further to enforce

> A destructive operation on owned data (clearing a workspace, deleting a memory) fails the
> recoverability clause and is not `owned_state`. (§4, line 125)

This is a classification rule for whoever writes the tag. The registry cannot see what a handler
does. What it can check is CAP-5: the claim must carry a stated one-line basis, and that basis is
pinned and reviewed at approval. The rest of §4 (the per-deployment matrix, the danger-tier order
for scoping effort) sets no construction rule.
