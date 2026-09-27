# CSR-WO-2000 — Capability: the four-rung ladder, the orthogonal untrusted flag, Rule-of-Two as a computed obligation, and `owned_state`'s recoverability basis

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (must contain `-1007`, merged `cc9cd0b`).
**Branch:** `wo/CSR-WO-2000`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P2 · **Phase exit gate (the clauses this WO owns):** §8 rows *Four-rung ladder, orthogonal
untrusted flag, Rule-of-Two* and *`owned_state` with pinned recoverability basis* read *built* with
their red-proofs named, and each has a `-2008` control-deletion row.
**Grounds:** the ClearSeal standard at the pinned public edition (`66b640d`), §3 and §4 — cite the
sentences you implement; `docs/northstar.md` N4, N7; `docs/architecture.md` §3.2 (*capability*:
"Rule-of-Two obligation computed, never bypassed"), §3.3 *Teaching*, §7.1 (*A prompt-injected
model*), §8 rows named above.

> **What this is:** the rule that decides, at construction, whether a tool's declared shape is one
> the node may serve at all. Every tool already carries its capability tag in the hashed ten fields;
> today only `arbitrary_exec` is judged (N7, `-1002`). This WO judges the rest: the rung
> (`read_only` → `owned_state` → `state_change` → `arbitrary_exec`), the orthogonal
> `untrusted_input_facing` flag, and Rule-of-Two — a tool that faces untrusted input and changes
> state must carry a compensating control, containment or approval — computed from the tag as an
> **obligation** the registry enforces, not a lint a reader may skip. `owned_state` must pin a
> one-line recoverability basis, and no other rung may carry one. **Ruled, fail-closed:** approval
> does not exist until `-2001`, so until an approval backend is registered, **any `elevated` tool is
> refused at construction** ("elevated requires an approval backend; none is configured"), and
> `elevated` therefore cannot satisfy Rule-of-Two yet; `-2001` lifts that refusal when it lands. It
> is NOT the approval gate, NOT the capability ceiling (`-2003`), and NOT caller entitlement (P6).

**Cadence:** build, spec-first: list the standard's sentences in a `RULES.md` beside the module
before writing it, one rule per sentence, each with its negative test.

## 1. Scope — numbered, specific

1. **The obligation** (`packages/core/src/capability/ladder.ts`): a pure function from a frozen
   capability tag to a frozen obligation — which compensating controls the tag requires (containment,
   approval, a recoverability basis) and which it forbids — with a one-line reason per requirement
   naming the standard's clause. Pure and total over every combination of the four rungs and the
   three booleans; a table test enumerates them all.
2. **Enforced at construction.** The pinned registry checks every admitted tool's frozen tag against
   its obligation where N7 is checked today, and refuses construction naming the tool and the unmet
   obligation. Rules at minimum:
   - an untrusted-facing `state_change` tool with neither a non-null containment domain nor approval
     is refused (Rule-of-Two);
   - `owned_state` with a missing, empty, multi-line or over-long `recoverability_basis` is refused
     (choose the length bound, record why); any other rung with a non-null basis is refused;
   - `elevated: true` is refused while no approval backend is configured (the ruling above), with a
     message that says so;
   - `arbitrary_exec` keeps `-1002`'s rules unchanged.
   If the standard's text at `66b640d` requires anything these rules do not, or forbids anything they
   allow, **flag and stop** with the sentence quoted — do not decide it.
3. **The teaching edition** is unchanged in behaviour: `notes.read` (`read_only`, untrusted-facing)
   passes. Every fixture tool in the core's tests that the new rules refuse is listed in FEEDBACK
   with the rule; fix the fixture's tag only where the test is not about the tag, and say which.
4. **Control-deletion rows** (`test/deletion/controls.json`) for each rule, with stubs.
5. **`FEEDBACK.md`** per §6.

## 2. Invariants

- **N4** — a tool whose declared shape needs a control the node does not have is refused, never
  served on trust.
- **N5** — every rule has a red-proof and a `-2008` row.

**Protected surfaces — must diff to empty:** the four steering documents, `LICENSE`, `NOTICE`,
`spikes/**`, `docs/canonical-form.md`, `pinning/canonical.ts`, `pinning/gate.ts`,
`pinning/manifest.ts`, `capability/fields.ts`, `containment/**`, `auth/**`, `transport/**`,
`node/**`, `packages/core/test/boundary/**` (the P1 exit re-test is running against it), and
`packages/teaching/src/**`. Working surface: `capability/ladder.ts` and `RULES.md` (new),
`pinning/registry.ts` only where construction checks the obligation, tests, `test/deletion/**`.

## 3. Tests / acceptance

1. `npm run check` green on both runners; both leak-gate modes exit 0; `control-deletion` green.
2. The full obligation table (every rung × flag combination → obligation) — pasted.
3. Each construction refusal with its message — pasted.
4. Red-proofs for every rule — pasted.

## 4. Scope fence

- **The approval gate, grants, or any approval backend** (`-2001`).
- **The ceiling and windows** (`-2003`), **caller entitlement** (P6).
- **New teaching tools** (`-2005`).
- **Any change to the ten hashed fields or the canonical form.**

## 5. Adversarial pass

Fresh subagent; every attempt uses the operation that matters — getting a tool served whose tag
should have been refused.

1. Every tag combination the obligation table marks refused, through the real gate and registry.
2. A basis that is one line by `\n` but not by `\r`, U+2028, U+0085; a basis that is whitespace.
3. A containment domain that is non-null but empty (`[]`) satisfying Rule-of-Two: decide against the
   standard and state the rule.
4. An `elevated` tool reaching dispatch by any route.

## 6. Upward-feedback directive

`FEEDBACK.md`: gates line, the pastes in §3, every standard sentence with its rule, fixtures changed
and why, adversarial findings with severity, what was not built.

## 7. Flag-and-stop conditions

- The standard's text disagrees with a rule in §1.2.
- Enforcing the obligation needs a change to the gate, the fields module, or the transport.
- A protected surface must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-2000` off current `main` where a pure capability obligation computed from each
> tool's frozen tag is enforced at registry construction, an untrusted-facing state_change tool with
> no containment is refused under Rule-of-Two, owned_state requires a valid one-line recoverability
> basis and no other rung may carry one, any elevated tool is refused while no approval backend
> exists, every rule cites the pinned standard's sentence in RULES.md and has a red-proof and a
> control-deletion row, `npm run check` is green on both runners, and the work is parked as one
> unmerged pull request. Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-2000 origin/main`. Node 24.21.0. Cadence:
> **build**, spec-first. Read `docs/work-orders/CSR-WO-2000.md` in full, the standard's §3 and §4 at
> the pinned edition, and `docs/architecture.md` §3.2 and §8. The boundary checker and `node/**` are
> protected: the P1 exit re-test is running against them. If it returns a finding, park this first.
> Leak gate before every push, exit code checked directly. Adversarial pass per §5 to a fresh
> subagent. Report the PR link and the pastes.
