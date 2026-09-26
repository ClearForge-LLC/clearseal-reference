# CSR-WO-2008 — The control-deletion job: every built control stubbed out in turn, the suite required to fail for each

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD; the
base must contain `-1006a`, merged `b5e1f92`).
**Branch:** `wo/CSR-WO-2008`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P2, pulled forward while the P1 exit red-team runs, because it touches no control.
**Phase exit gate (the clause this WO owns):** "the control-deletion job is green, meaning every
stub made the suite fail" — for every control built so far; later P2 WOs add their rows.
**Grounds:** `docs/northstar.md` N5 ("a control that cannot fail is not a control"); `docs/architecture.md`
§8 (traceability — every *built* row names its red-proof), §8 row *Control-deletion job*;
`docs/roadmap.md` P2 `-2008`; the mutant matrices in the `-1000` to `-1006a` FEEDBACK files.

> **What this is:** the machinery that makes N5 permanent. Every work order so far has proven its
> control can fail by deleting it by hand and pasting the red result into FEEDBACK — evidence that
> is true on the day it is written and silent afterwards. This WO turns that into a CI job: a
> manifest lists each built control, a small reviewed patch that stubs it out, and the tests that
> must go red; a runner applies each stub to a throwaway copy of the tree, runs those tests, and
> fails the job if any stub leaves them green — or if a stub no longer applies, so the manifest
> cannot rot. It is NOT a change to any control, NOT a general mutation-testing framework, and NOT
> a required check (making it required is a branch-protection change, the gate's to make).

**Cadence:** build. One PR, left unmerged for review.

## 1. Scope — numbered, specific

1. **The manifest** (`test/deletion/controls.json`, or `.ts` if types help — choose, record why):
   one row per built control, each naming the §8 row it proves, the stub (a patch file under
   `test/deletion/stubs/<id>.patch`), the test files to run, and the **specific test names that must
   fail**. Rows for at least every *built* §8 row and every P1 exit-gate clause: verify-before-register;
   drift refused; unpinned refused; the canonical form's hash; the subset invariant; the enumeration
   detector; `arbitrary_exec` refused a domain (N7); the cage's undeclared-reach refusal; the reach
   harness's verdict; the `read_only` mode rule; the regular-file rule; admitted-tool freezing;
   options captured at start; the handler without `this` and the cage facade; audience check;
   signature check; the RSA key rules; the outage `503`; `Origin`/`Host` checks; the body cap;
   schema validation with `additionalProperties: false`; the supply-boundary checker. Reuse the
   mutants the FEEDBACK files already describe wherever they exist.
2. **The runner** (`scripts/control-deletion.mjs`): for each row, copy the tree to a temporary
   directory (or a `git worktree` at `HEAD`), `git apply` the stub — a stub that does not apply
   cleanly **fails the job** and names the row — run the row's tests, and require that **each named
   test fails by assertion** (not by a typecheck error, a crash on import, or a timeout — record how
   that is told apart). First, the unpatched tree must pass the same tests; if it does not, the job
   fails before any stub runs. Output: one line per row — id, §8 row, stub applied, named tests red
   — and a nonzero exit on any miss. `--row <id>` runs one row for local use.
3. **CI job** `control-deletion` in `.github/workflows/ci.yml`, `ubuntu-latest`, after the build,
   pinned actions as the rest of the workflow is. It runs on every pull request. It is **not** added
   to the required checks; FEEDBACK states the command the gate would run to require it.
4. **Maintenance rule, written where the next builder will read it** (`test/deletion/README.md`):
   a WO that builds or changes a control adds or updates its row in the same PR; a stub that stops
   applying is fixed, never deleted to make the job pass.
5. **`FEEDBACK.md`** per §6, including the job's wall-clock time on CI.

## 2. Invariants

- **N5** — every built control is proven, continuously, able to fail.
- **No control changes.** This WO reads the controls; it edits none of them.

**Protected surfaces — must diff to empty:** the four steering documents, `LICENSE`, `NOTICE`,
`spikes/**`, `docs/canonical-form.md`, everything under `packages/*/src/**` and `packages/*/test/**`
except that a test may gain a stable name if a row needs one (list each in FEEDBACK). The working
surface is `test/deletion/**`, `scripts/control-deletion.mjs`, and the one new job in
`.github/workflows/ci.yml` — no other workflow change. Root `package.json` may gain one script.

## 3. Tests / acceptance

1. `npm run check` green on both runners; both leak-gate modes exit 0; the new job green on the PR.
2. The runner's full output pasted: one line per row, every row red for its named tests.
3. Three red-proofs of the runner itself: (a) a stub that changes nothing (the job fails: row stayed
   green); (b) a stub that no longer applies (the job fails, naming the row); (c) a stub that breaks
   compilation instead of the control (the job fails: not an assertion failure).
4. Wall-clock time of the job on CI.

## 4. Scope fence

- **Any change to a control, a test's assertions, or an existing workflow job.**
- **Making the job required.** The gate's decision; state the command.
- **Rows for controls not yet built** (approval, audit, ceiling, provenance, rate limit): their WOs
  add them.
- **A general mutation-testing tool** (Stryker or similar). Named, reviewed stubs only.

## 5. Adversarial pass

Fresh subagent; every attempt uses the operation that matters.

1. Make a row pass while its control is still deleted: a stub that also edits the test, a test that
   fails for an unrelated reason, a named test that is skipped rather than run, a test file that
   silently runs zero tests.
2. Make the runner touch the real working tree or leave temp copies behind.
3. Find a *built* §8 row with no manifest row, and a manifest row whose stub does not touch the
   control it names.

## 6. Upward-feedback directive

`FEEDBACK.md`: gates line, the pastes in §3, the choices in §1.1 and §1.2 with reasons, any §8 row
you could not stub honestly and why, adversarial findings with severity, what was not built.

## 7. Flag-and-stop conditions

- A control cannot be stubbed without editing a test's assertions.
- The job's CI time exceeds 15 minutes; stop and propose a split before optimizing.
- A protected surface must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-2008` off current `main` where a reviewed manifest names every built control
> with a stub patch and the specific tests that must fail, a runner applies each stub to a throwaway
> copy and fails if any named test stays green, fails by something other than an assertion, or if a
> stub no longer applies, a `control-deletion` CI job runs it on every pull request without being
> required, the runner's own three red-proofs exist, no control or test assertion is changed, `npm
> run check` is green on both runners, and the work is parked as one unmerged pull request. Stop at
> parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-2008 origin/main`. Node 24.21.0. Cadence:
> **build**. Read `docs/work-orders/CSR-WO-2008.md` in full, `docs/architecture.md` §8, and the
> mutant matrices in your own FEEDBACK history for `-1000` to `-1006a`. This reads controls and edits
> none; `.github/workflows/ci.yml` may gain exactly one job. The P1 exit red-team is running against
> `b5e1f92`: if it returns a finding, I will tell you — park this first, then take the fix. Leak gate
> before every push, exit code checked directly. Adversarial pass per §5 to a fresh subagent. Report
> the PR link and the pastes.
