# FEEDBACK: CSR-WO-2000 (the capability obligation, enforced at registry construction)

Branch `wo/CSR-WO-2000`, cut from `main` at `9ce3fb4`, which carries the WO. `-1007` merged at
`cc9cd0b`. Parked as one unmerged pull request. Built on Node v24.21.0.

## Read this first

- **Built, spec first.**
  - `packages/core/src/capability/RULES.md` was written before the module. It quotes the
    standard's sentences at `66b640d` (§3 lines 105–110, §4 line 125), one rule each: CAP-1 to
    CAP-8. Each rule names its red-proof and its control-deletion row.
  - `capability/ladder.ts` is the pure obligation.
  - `pinning/registry.ts` gains four lines: the check, placed after the domain is parsed and
    beside N7's.
- **No flag-and-stop. The standard's text agrees with every rule in WO §1.2.** One addition,
  within §1.2's "at minimum":
  - Rule-of-Two's sentence names both rungs: "`untrusted_input_facing` AND (`state_change` |
    `arbitrary_exec`) ⇒ a human-in-loop obligation". §1.2 lists only `state_change`.
  - So an untrusted-facing `arbitrary_exec` tool also carries the obligation (CAP-3). It needs
    approval, because §3 line 109 bars containment for it.
  - Today it is always refused: first by `EXEC_TOOLS_FORBIDDEN` (default on), and with the flag off
    by CAP-3, since approval does not exist yet.
  - `-1002`'s two `arbitrary_exec` checks are unchanged, word for word, and still run first.
- **Every `elevated` tool is refused, on every rung ("elevated requires an approval backend; none
  is configured").**
  - The backend is the constant `APPROVAL_BACKEND = "none"` in `ladder.ts`, not a registry option.
    An option would be a switch a caller could set to "configured", serving an elevated tool with no
    gate behind it.
  - `-2001` replaces the constant with its registered backend.
  - The pure function already computes the approval discharge. A test shows that with
    "configured", an untrusted elevated `state_change` tool's obligation is met. The registry never
    passes that value.
- **§5.3, decided against the standard: `[]` does not discharge Rule-of-Two (CAP-8).**
  - "It carries **the set itself, not a flag** … the set is *the bound*" (§3 line 109).
  - `[]` and null are the same bound: `parseDomain(null)` is the empty domain, and the cage is
    built identically from either.
  - If `[]` discharged Rule-of-Two where null does not, one spelling change, with the bound
    unchanged, would turn the control off. Containment is judged on the set's contents: at least
    one sink.
- **The basis bound is 120 code points (CAP-5).**
  - One line is a line a reviewer reads without wrapping, in the approval diff and in an audit
    line. 120 is the common review and terminal width.
  - The standard's own example is 26 code points.
  - It is counted in code points, so the count does not depend on the encoding.
  - "One line" refuses every character that breaks, hides or controls a line: Unicode Cc (tab, LF,
    CR, U+0085 among them), Cf (bidi overrides, zero-width marks), U+2028, U+2029 and lone
    surrogates. The canonical form already refuses lone surrogates (A3), before the registry.
  - After the adversarial pass, a basis must also be legible. That refuses default-ignorable,
    private-use and unassigned code points, and a basis with no letter or digit.
- **No fixture changed.** No existing test's tool is refused by the new rules, and `npm run check`
  was green with the check in and no test edited. The fixtures with non-default tags, and why each
  passes:
  - `gate.test.ts`'s `elevated: true` echo is only admitted, never built into a registry.
  - `subset.test.ts`'s untrusted, elevated `state_change` tag is only hashed.
  - The `state_change` writers in `containment/corrections.test.ts` are trusted
    (`untrusted_input_facing: false`).
  - `construction.test.ts`'s `arbitrary_exec` tools are trusted.
  - The teaching edition's `notes.read` (`read_only`, untrusted-facing, null basis, not elevated)
    passes, and its tests and P1 evidence are unchanged.
- **For the architect: `docs/architecture.md` §8 still reads "planned — P2" for both rows this WO
  owns.** The steering documents are protected here, so they are yours to mark *built*. The rows
  and their red-proofs:
  - *Four-rung ladder, orthogonal untrusted flag, Rule-of-Two*: CAP-1 to CAP-4, CAP-7 and CAP-8.
  - *`owned_state` with pinned recoverability basis*: CAP-5 and CAP-6.
- **`ObligationError` is not exported from the package index.** `index.ts` is outside this WO's
  working surface. A caller sees it by `name`. `-2001` may want it exported.

## Every standard sentence with its rule

| Rule | The standard at `66b640d` | Enforced as |
|---|---|---|
| CAP-1 | "Capability scoping = a four-rung danger ladder + orthogonal booleans … any rung can be untrusted-input-facing." (§3 l.105) | the obligation is computed from the frozen tag's rung and three booleans; no combination is refused by itself; `privacy_sensitive` changes nothing |
| CAP-2 | "Rule-of-Two: `untrusted_input_facing` AND (`state_change` \| `arbitrary_exec`) ⇒ a human-in-loop obligation, discharged by an elevated human confirmation **or** by demonstrable containment." (§3 l.107) | untrusted `state_change` needs a non-empty domain or approval |
| CAP-3 | the same sentence, and "`arbitrary_exec` is refused a domain at construction, so an arbitrary-exec tool can never discharge Rule-of-Two by containment" (§3 l.109) | untrusted `arbitrary_exec` needs approval |
| CAP-4 | "`owned_state` auto-discharges Rule-of-Two — containment is proven structurally by the three clauses rather than promised." (§3 l.107) | untrusted `owned_state` needs no containment or approval |
| CAP-5 | "A tool claiming this rung MUST pin a one-line `recoverability_basis` … if the basis cannot be stated in one line, the tool is not `owned_state`." (§3 l.106) | `owned_state`: basis present, not blank, one line, at most 120 code points |
| CAP-6 | "`recoverability_basis` (null unless `owned_state`)" (§3 l.108) | any other rung with a non-null basis, `""` included, is refused |
| CAP-7 | "`elevated` is pinned because the human-confirmation gate reads it" (§3 l.108); the confirmation tier "targets the spec's Multi-Round-Trip Requests / Tasks extension" (§3 l.110); the architect's ruling in the WO | any `elevated` tool is refused while `APPROVAL_BACKEND` is "none" |
| CAP-8 | "It carries **the set itself, not a flag** — a boolean would be a *claim* the manifest hashes; the set is *the bound*" (§3 l.109) | `[]` discharges nothing |
| N7 (unchanged) | "`arbitrary_exec` is refused a domain at construction" (§3 l.109) | `-1002`'s checks, recorded in the obligation for completeness |
| §4 | "A destructive operation on owned data … fails the recoverability clause and is not `owned_state`." (§4 l.125) | a classification rule for the tag's author; the registry cannot see a handler's effect, so what it enforces is CAP-5 (the stated basis, pinned and reviewed at approval) |

## §3.2 The full obligation table

This is printed by `ladder.test.ts`, which also asserts every row against RULES.md written out
independently.
- "Served today" means served with the best controls the rung allows: a valid basis on
  `owned_state`, and a domain on every rung but `arbitrary_exec`. Every "yes" and "no" is checked
  through the real gate and registry, and so is the same row with no controls at all.
- `arbitrary_exec` rows marked "yes" are served only with `EXEC_TOOLS_FORBIDDEN=false`. Under the
  default, N7 refuses every one of them.

| capability_class | untrusted | privacy | elevated | requires | forbids | discharged | served today |
|---|---|---|---|---|---|---|---|
| read_only | false | false | false | — | CAP-6 recoverability_basis | — | yes |
| read_only | false | false | true | CAP-7 approval_backend | CAP-6 recoverability_basis | — | no |
| read_only | false | true | false | — | CAP-6 recoverability_basis | — | yes |
| read_only | false | true | true | CAP-7 approval_backend | CAP-6 recoverability_basis | — | no |
| read_only | true | false | false | — | CAP-6 recoverability_basis | — | yes |
| read_only | true | false | true | CAP-7 approval_backend | CAP-6 recoverability_basis | — | no |
| read_only | true | true | false | — | CAP-6 recoverability_basis | — | yes |
| read_only | true | true | true | CAP-7 approval_backend | CAP-6 recoverability_basis | — | no |
| owned_state | false | false | false | CAP-5 recoverability_basis | — | — | yes |
| owned_state | false | false | true | CAP-7 approval_backend; CAP-5 recoverability_basis | — | — | no |
| owned_state | false | true | false | CAP-5 recoverability_basis | — | — | yes |
| owned_state | false | true | true | CAP-7 approval_backend; CAP-5 recoverability_basis | — | — | no |
| owned_state | true | false | false | CAP-5 recoverability_basis | — | CAP-4 | yes |
| owned_state | true | false | true | CAP-7 approval_backend; CAP-5 recoverability_basis | — | CAP-4 | no |
| owned_state | true | true | false | CAP-5 recoverability_basis | — | CAP-4 | yes |
| owned_state | true | true | true | CAP-7 approval_backend; CAP-5 recoverability_basis | — | CAP-4 | no |
| state_change | false | false | false | — | CAP-6 recoverability_basis | — | yes |
| state_change | false | false | true | CAP-7 approval_backend | CAP-6 recoverability_basis | — | no |
| state_change | false | true | false | — | CAP-6 recoverability_basis | — | yes |
| state_change | false | true | true | CAP-7 approval_backend | CAP-6 recoverability_basis | — | no |
| state_change | true | false | false | CAP-2 containment or approval | CAP-6 recoverability_basis | — | yes |
| state_change | true | false | true | CAP-7 approval_backend; CAP-2 containment or approval | CAP-6 recoverability_basis | — | no |
| state_change | true | true | false | CAP-2 containment or approval | CAP-6 recoverability_basis | — | yes |
| state_change | true | true | true | CAP-7 approval_backend; CAP-2 containment or approval | CAP-6 recoverability_basis | — | no |
| arbitrary_exec | false | false | false | — | CAP-6 recoverability_basis; N7 containment | — | yes |
| arbitrary_exec | false | false | true | CAP-7 approval_backend | CAP-6 recoverability_basis; N7 containment | — | no |
| arbitrary_exec | false | true | false | — | CAP-6 recoverability_basis; N7 containment | — | yes |
| arbitrary_exec | false | true | true | CAP-7 approval_backend | CAP-6 recoverability_basis; N7 containment | — | no |
| arbitrary_exec | true | false | false | CAP-3 approval | CAP-6 recoverability_basis; N7 containment | — | no |
| arbitrary_exec | true | false | true | CAP-7 approval_backend; CAP-3 approval | CAP-6 recoverability_basis; N7 containment | — | no |
| arbitrary_exec | true | true | false | CAP-3 approval | CAP-6 recoverability_basis; N7 containment | — | no |
| arbitrary_exec | true | true | true | CAP-7 approval_backend; CAP-3 approval | CAP-6 recoverability_basis; N7 containment | — | no |

## §3.3 Each construction refusal, with its message

Every one goes through `pinForTest`: an in-memory approved manifest, `PinGate.load`, `admit`, then
`new PinnedRegistry`. The error is `ObligationError`, and its `rules` name each unmet rule.

- untrusted state_change, containment null → tool "t": Rule-of-Two: an untrusted-input-facing state_change tool needs containment (a non-empty containment_domain) or approval (elevated, with an approval backend); it has neither
- untrusted state_change, containment [] → tool "t": Rule-of-Two: an untrusted-input-facing state_change tool needs containment (a non-empty containment_domain) or approval (elevated, with an approval backend); it has neither
- untrusted arbitrary_exec, EXEC_TOOLS_FORBIDDEN off → tool "t": Rule-of-Two: an untrusted-input-facing arbitrary_exec tool needs approval (elevated, with an approval backend); containment cannot discharge it (N7)
- owned_state, basis null → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is missing
- owned_state, basis "" → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is empty or whitespace
- owned_state, basis "   " → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is empty or whitespace
- owned_state, basis U+3000 only → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is empty or whitespace
- owned_state, basis 121 characters → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is longer than 120 characters
- owned_state, basis 121 astral characters → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is longer than 120 characters
- owned_state, basis with LF → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is not one line (a line break, control, format, invisible or unassigned character)
- owned_state, basis with CR → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is not one line (a line break, control, format, invisible or unassigned character)
- owned_state, basis with CRLF → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is not one line (a line break, control, format, invisible or unassigned character)
- owned_state, basis with U+2028 line separator → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is not one line (a line break, control, format, invisible or unassigned character)
- owned_state, basis with U+2029 paragraph separator → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is not one line (a line break, control, format, invisible or unassigned character)
- owned_state, basis with U+0085 next line → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is not one line (a line break, control, format, invisible or unassigned character)
- owned_state, basis with vertical tab → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is not one line (a line break, control, format, invisible or unassigned character)
- owned_state, basis with form feed → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is not one line (a line break, control, format, invisible or unassigned character)
- owned_state, basis with tab → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is not one line (a line break, control, format, invisible or unassigned character)
- owned_state, basis with NUL → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is not one line (a line break, control, format, invisible or unassigned character)
- owned_state, basis with DEL → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is not one line (a line break, control, format, invisible or unassigned character)
- owned_state, basis with U+202E right-to-left override → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is not one line (a line break, control, format, invisible or unassigned character)
- owned_state, basis with U+200B zero-width space → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is not one line (a line break, control, format, invisible or unassigned character)
- owned_state, basis with U+3164 Hangul filler → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is not one line (a line break, control, format, invisible or unassigned character)
- owned_state, basis with U+115F Hangul choseong filler → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is not one line (a line break, control, format, invisible or unassigned character)
- owned_state, basis with U+FFA0 halfwidth Hangul filler → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is not one line (a line break, control, format, invisible or unassigned character)
- owned_state, basis with U+034F grapheme joiner → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is not one line (a line break, control, format, invisible or unassigned character)
- owned_state, basis with U+17B4 Khmer vowel inherent → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is not one line (a line break, control, format, invisible or unassigned character)
- owned_state, basis with U+FE0F variation selector → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is not one line (a line break, control, format, invisible or unassigned character)
- owned_state, basis with U+E000 private use → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is not one line (a line break, control, format, invisible or unassigned character)
- owned_state, basis with U+FFFF noncharacter → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is not one line (a line break, control, format, invisible or unassigned character)
- owned_state, basis with U+0378 unassigned → tool "t": owned_state must pin a one-line recoverability_basis (§3): it is not one line (a line break, control, format, invisible or unassigned character)
- owned_state, basis U+2800 Braille blank → tool "t": owned_state must pin a one-line recoverability_basis (§3): it has no letter or digit
- owned_state, basis a lone combining acute → tool "t": owned_state must pin a one-line recoverability_basis (§3): it has no letter or digit
- owned_state, basis punctuation only → tool "t": owned_state must pin a one-line recoverability_basis (§3): it has no letter or digit
- owned_state, basis Braille blanks → tool "t": owned_state must pin a one-line recoverability_basis (§3): it has no letter or digit
- read_only, basis "append-only + supersession" → tool "t": recoverability_basis is null unless owned_state (§3); this tool is read_only
- read_only, basis "" → tool "t": recoverability_basis is null unless owned_state (§3); this tool is read_only
- state_change, basis "append-only + supersession" → tool "t": recoverability_basis is null unless owned_state (§3); this tool is state_change
- state_change, basis "" → tool "t": recoverability_basis is null unless owned_state (§3); this tool is state_change
- arbitrary_exec, basis "append-only + supersession" → tool "t": recoverability_basis is null unless owned_state (§3); this tool is arbitrary_exec
- arbitrary_exec, basis "" → tool "t": recoverability_basis is null unless owned_state (§3); this tool is arbitrary_exec
- elevated read_only → tool "t": elevated requires an approval backend; none is configured
- elevated read_only, privacy → tool "t": elevated requires an approval backend; none is configured
- elevated read_only, untrusted → tool "t": elevated requires an approval backend; none is configured
- elevated read_only, untrusted, privacy → tool "t": elevated requires an approval backend; none is configured
- elevated owned_state → tool "t": elevated requires an approval backend; none is configured
- elevated owned_state, privacy → tool "t": elevated requires an approval backend; none is configured
- elevated owned_state, untrusted → tool "t": elevated requires an approval backend; none is configured
- elevated owned_state, untrusted, privacy → tool "t": elevated requires an approval backend; none is configured
- elevated state_change → tool "t": elevated requires an approval backend; none is configured
- elevated state_change, privacy → tool "t": elevated requires an approval backend; none is configured
- elevated state_change, untrusted → tool "t": elevated requires an approval backend; none is configured
- elevated state_change, untrusted, privacy → tool "t": elevated requires an approval backend; none is configured
- elevated arbitrary_exec → tool "t": elevated requires an approval backend; none is configured
- elevated arbitrary_exec, privacy → tool "t": elevated requires an approval backend; none is configured
- elevated arbitrary_exec, untrusted → tool "t": elevated requires an approval backend; none is configured; Rule-of-Two: an untrusted-input-facing arbitrary_exec tool needs approval (elevated, with an approval backend); containment cannot discharge it (N7)
- elevated arbitrary_exec, untrusted, privacy → tool "t": elevated requires an approval backend; none is configured; Rule-of-Two: an untrusted-input-facing arbitrary_exec tool needs approval (elevated, with an approval backend); containment cannot discharge it (N7)

## §3.4 Red-proofs and control-deletion rows (N5)

Each rule's red-proof is a named test in `packages/core/test/capability/ladder.test.ts`. Each row's
stub disables the rule. `node scripts/control-deletion.mjs` then requires every named test to fail
by the test's own assertion, and it did for all thirteen:

| Row | Rule | Stub | Named tests red |
|---|---|---|---|
| `obligation-enforced-at-construction` | CAP-1 | the registry's `throw new ObligationError` never fires | every combination …; Rule-of-Two refuses an untrusted state_change … |
| `rule-of-two-state-change` | CAP-2 | the `state_change` branch never taken | the full table; Rule-of-Two refuses an untrusted state_change … |
| `rule-of-two-empty-domain` | CAP-8 | containment is "non-null" instead of "at least one sink" | an empty containment set does not discharge Rule-of-Two |
| `rule-of-two-arbitrary-exec` | CAP-3 | the `arbitrary_exec` branch never taken | the full table; Rule-of-Two refuses an untrusted arbitrary_exec … |
| `owned-state-auto-discharge` | CAP-4 | `owned_state` joins the `state_change` branch | the full table; owned_state auto-discharges Rule-of-Two … |
| `owned-state-basis-required` | CAP-5 | the basis requirement is not pushed | the full table; missing/empty/whitespace/over-long; line terminators |
| `owned-state-basis-not-blank` | CAP-5 | the blank check never fires | missing/empty/whitespace/over-long |
| `owned-state-basis-one-line` | CAP-5 | the one-line check never fires | line terminators |
| `owned-state-basis-legible` | CAP-5 | the letter-or-digit check never fires | no letter or digit |
| `owned-state-basis-length` | CAP-5 | the length check never fires | missing/empty/whitespace/over-long |
| `basis-only-on-owned-state` | CAP-6 | a basis is never "carried" | a basis on any other rung is refused |
| `elevated-needs-approval-backend` | CAP-7 | the elevated requirement is not pushed | the full table; any elevated tool is refused …; every combination … |
| `approval-backend-none` | CAP-7 | `APPROVAL_BACKEND` becomes "configured" | any elevated tool is refused … |

One row missed on its first run, and the fix was to the test.
- In `owned-state-auto-discharge`, the named test failed, but `assert.equal(err, undefined)`
  printed the refused error, stack included, in its diff. The job then attributed the failure to
  `registry.ts`.
- The tests now compare `"served"` against the refusal's text. With that change the row goes red
  by the test's own assertion.

## Adversarial pass (WO §5)

A fresh subagent ran it in its own worktree at `fa07075` (before the legibility fix). Every attempt
went through the real gate and registry (`pinForTest`, `loadPinnedRegistry`, or `PinGate.load`,
`admit` and `new PinnedRegistry`), and checked `registry.get`. It wrote its own "must refuse"
predicate from RULES.md. I spot-checked its findings against the code before adopting them. The
two it rated fixable here I reproduced first: the invisible bases (each accepted by `basisProblem`
at `fa07075`) and the gate's repeated `d.name` reads (`gate.ts`, `admit`).

| # | Attempt | Result | Severity | Disposition |
|---|---|---|---|---|
| X1 | §5.1 every combination: 4 rungs × 3 booleans × 6 domains × 4 bases × exec flag on, off and from the environment, 2,304 constructions | 0 served that the rules refuse; 0 refused that they allow. `EXEC_TOOLS_FORBIDDEN` is off only for exactly `"false"` (not `"FALSE"`, `"0"`, `""` or `"false "`) | none | — |
| X2 | §5.2 a basis broken by CR, U+2028, U+2029, U+0085, VT, FF, U+FEFF inside, ZWSP, bidi controls, tag characters or ZWJ | all refused (CAP-5, one line); a leading U+FEFF and a lone surrogate are refused earlier by the canonical form (A3) | none | — |
| X3 | §5.2 a whitespace basis: NBSP only, U+3000 only | refused (empty or whitespace) | none | — |
| X4 | §5.2 a *visually* blank basis: U+3164, U+115F, U+FFA0 (Hangul fillers), U+2800 (Braille blank), U+034F, U+17B4, U+FE0F, a lone U+0301; also private-use, noncharacter and unassigned code points | **served** at `fa07075` | Low | **fixed**: default-ignorable, private-use and unassigned code points are refused as not one line, and a basis needs a letter or digit. Each case is now a test, and the letter-or-digit check has its own row (`owned-state-basis-legible`) |
| X5 | §5.2 wide within 120 code points: `a` + 119 combining marks, 120 × U+FDFD, 120 astral emoji; strong RTL text reordering neutrals | served | Low | **kept, stated in RULES.md**. It only misleads a reviewer's eye. The tag's author can already write a false basis, and the basis is pinned as approved. A width rule (grapheme or East-Asian-width counting) is the architect's call |
| X6 | §5.3 `[]` for Rule-of-Two; `[""]`, `["fs:"]`, `["fs:/"]`, `["FS:/srv"]`; duplicates | `[]` refused (CAP-8); malformed ones refused by the domain parser; duplicates collapse to one real sink (A7) and are served | none | — |
| X7 | §5.3 broad but valid domains discharging Rule-of-Two: the 16 top-level roots (the whole file system less the literal `/`), `fs:/etc`, `host:localhost`, `host:com` | **served** | Medium (per the subagent) | **for the architect, not changed.** RULES.md CAP-2 and CAP-8 take "demonstrable containment" as "at least one valid sink", and the cage and reach harness enforce whatever set is pinned. Whether a set is *narrow enough* is a judgement about breadth: `parseDomain` refuses only `fs:/`, and `containment/**` is protected here. The standard's word is "demonstrable": the bound must be enforced (it is: the cage refuses every reach outside it, and the reach test fails a tool that exceeds it), not that it is small. So I read the rule as met and flag breadth, reviewed at approval where the domain is pinned, as a question for a later WO (a breadth rule, or the `-2003` ceiling) |
| X8 | §5.4 an `elevated` tool reaching dispatch: `loadPinnedRegistry`, `startNode`, `Reflect.construct` with a subclass, a spoofed Admission, mutation after admit, a getter or Proxy on the tag, assigning `APPROVAL_BACKEND` through the namespace or `defineProperty`, a second module instance (`ladder.ts?x=1`), prototype patches | all refused, or of no effect. `ladder.ts` is not reachable from the package's exports | none | — |
| X9 | §5.4 with `Array.prototype.some` or `Array.prototype[Symbol.iterator]` patched in the process before construction | **served**: the check reads the obligation through built-ins it does not capture | Low | **not changed.** It needs code already running in the node's process, which can do anything, including calling the handler itself. The supply boundary (editions import types only; no `process`) is the control against that code; the `.constructor` route in it is the known P2 item |
| X10 | outside the tag: a second definition whose `name` getter reads `"decoy"` first and `"t"` after | the gate's duplicate refusal is dodged; one tool admitted with the second definition's handler (the subagent measured `admitted=1 refused=0`, handler `"B"`) | Low–Medium | **for the architect: `gate.ts` is protected here.** `admit` reads `d.name` in the count, the seen-set and the lookup, apart from the one read in `canonicalInput`. The tag is unaffected, since both definitions must hash to the approved entry, but "duplicate names are never first-wins" becomes last-wins through a getter. The fix is one snapshot of each definition's name (or the whole definition) before counting. It belongs to the gate's WO or the P2 hardening WO |

Disagreement with RULES.md: the subagent agrees with CAP-1, 3, 4, 6 and 7. It argues that CAP-2
and CAP-8's "at least one sink" is weaker than "demonstrable" (X7). It also argued that CAP-5
missed invisible bases, which is now fixed (X4), and that it allows wide bases, which is kept (X5).
I record the X7 disagreement rather than average it. It is the architect's ruling.

## Gates

- `npm run check` exits 0: 640 core and teaching tests (626 before, plus the 14 in
  `capability/ladder.test.ts`), spike 0102 69, spike 0101 8, `test:subset` 4.
- `control-deletion`: 74 rows (61 before, 13 new), all red by assertion, on the final commit.
  `--self-test` passes.
- `node scripts/leak-gate.mjs --tree` exit 0; `--history` exit 0, run unpiped before every push
  with the exit code checked directly.
- CI: the pull request's checks, on both runners, with `control-deletion`.
- Protected surfaces diff to empty against `9ce3fb4`: the steering documents, `LICENSE`, `NOTICE`,
  `spikes/**`, the canonical form, `pinning/canonical.ts`, `gate.ts`, `manifest.ts`,
  `capability/fields.ts`, `containment/**`, `auth/**`, `transport/**`, `node/**`,
  `packages/core/test/boundary/**` and `packages/teaching/src/**`. The source changes are the new
  `capability/ladder.ts` and `RULES.md`, and four lines in `pinning/registry.ts`.
- `main` moved to `98c2fda` (the `-1007a` WO, docs only) while this was built. Nothing here touches
  it, so the branch was not rebased.
- The minted token lived in a mode-0600 scratch file, was never written to git config or a remote
  URL, and was deleted after the pull request was opened.

## What was not built

- The approval gate, grants and any approval backend (`-2001`). `APPROVAL_BACKEND` is the seam,
  and it is a constant.
- The capability ceiling and windows (`-2003`), and caller entitlement (P6).
- New teaching tools (`-2005`).
- No change to the ten hashed fields, the canonical form, the gate, the fields module, containment,
  auth, transport, `node/**`, the boundary checker or the teaching edition. All of those diff to
  empty against `main`.
- The §8 rows' *built* marking, which is in the protected architecture document (above).
- `privacy_sensitive` enforcement. §3 names the boolean, but no sentence at `66b640d` attaches a
  control to it, so it changes no obligation (CAP-1).
