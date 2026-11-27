# CSR-WO-2008c — Every built control fails its own row, and a detector keeps it that way

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD; it must
contain `-2008b`'s merge and the docs PR that adds this work order).
**Branch:** `wo/CSR-WO-2008c`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P2 · **Phase exit gate:** *"the control-deletion job is green, meaning every stub made the
suite fail"* (`docs/roadmap.md` P2). `-2008b`'s coverage sweep showed that sentence covers fewer
controls than §8 claims, so this WO makes it true.
**Grounds:**
- `docs/northstar.md` N5; `docs/architecture.md` §8, every row marked *built*.
- `test/deletion/README.md`, the rules for rows and stubs.
- `-2008b`'s `FEEDBACK.md` on `main`, *Read this first: the §5 coverage sweep* (the list this WO
  works from; not restated in full here).
- Seams: `test/deletion/controls.json`, `test/deletion/stubs/`, `packages/core/src/transport/`
  (`server.ts`, `jsonrpc.ts`, `headers.ts`, `dispatch.ts`, `json.ts`, `mrtr*`),
  `packages/core/src/auth/` (`verifier.ts`, `jwks.ts`, `CHECKS.md`),
  `packages/core/src/approval/listener.ts`, `packages/core/test/**`.

> **What this is:** `-2008b` swept every *built* §8 row and found three kinds of gap.
> 1. Two controls have **no red-proof at all**: the transport's request receive timeout
>    (`requestTimeoutMs`, `server.ts:560`, a 408) and the approval listener's `requestTimeout`
>    (`listener.ts:274`).
> 2. About fifteen controls are **tested but have no row**. They ran in the job only because some
>    other row listed their file.
> 3. Four test files are **listed by no row**, so no stub ever runs them.
>
> This WO writes the missing tests, a row for every built control, and a **detector** that fails CI
> when a control or a test file falls out of the job again. It is NOT a change to any control's
> behaviour, NOT the validation-pool fix (`-1005c`), and NOT the heap or canary measurements
> (`-2008d`).

**Cadence:** build. One PR, left unmerged for review. Large but mechanical; the adversarial pass is
aimed at the stubs (§5).

## 1. Scope — numbered, specific

1. **The two missing red-proofs.**
   - A test that a request whose body never finishes arrives at `requestTimeoutMs` and is ended with
     408. Use a short test value. It must not touch the production default.
   - The same for the approval listener's 10 s receive timeout, through whatever seam lets a test set
     it short. If no seam exists, adding one is a change to `listener.ts`: make it a constructor
     option defaulting to today's 10 s, and nothing else.
   - A row for each.
2. **A row for every tested control with none.** From the sweep:
   - batch refusal;
   - 415 for Content-Type and for Content-Encoding, and 405;
   - the `x-mcp-header` annotation refusal;
   - the core `tool.validate(args)` refusal (a stub that skips validation itself, not only
     `unevaluatedProperties`);
   - the legacy `initialize` that returns no session header;
   - the strict JSON parser (duplicate key, depth, lone surrogate: one row per refusal, or one row
     whose stub removes the shared check, with the reason recorded);
   - MRTR's signed `requestState`.
   - Each row's stub deletes or disables exactly its control (README rules). Each `mustFail` names
     only tests that turn red by assertion.
3. **The verifier's checks.** §8 says "every check in `CHECKS.md` with its red-proof". 11 rows exist
   for 33 checks.
   - Give each check without one a row: H4, H5, H7, H9, H10, K2, C4a, C5, C6, C7, H1, H3a, the
     J-series cache and caps, and G2's PRM document.
   - Or merge checks into one row where a single stub honestly deletes them together, and record in
     `CHECKS.md` which row proves which check.
   - Every check ends up named by exactly one row.
4. **Every test file in a row's baseline.**
   - `json.test.ts`, `mrtr.test.ts` and `refusal-audit.test.ts` each appear in the `tests` of the rows
     §1.2 adds.
   - `costly-schema.test.ts` is a measurement, not a control. It joins an allowlist (§1.5) with its
     reason.
5. **The detector.** A test (`test/deletion/coverage.test.ts`, or under `scripts/`'s self-test if it
   belongs there; record why) that fails when either of these is true:
   - **(a)** a file matching `packages/*/test/**/*.test.ts` is listed by no row and is not on a short,
     reasoned allowlist (`test/deletion/unlisted.json`, each entry a path and one line of reason);
   - **(b)** an §8 row marked *built* in `docs/architecture.md` names no deletion row in a machine-
     readable index. Either `controls.json` rows carry `section8` already, or add the reverse map;
     choose by measurement of what stays maintainable.
   - Its own red-proof: a planted unlisted test file, and a planted *built* §8 row with no row, each
     turn it red.
6. **The stale `ci.yml` comment** beside `CONTROL_DELETION_SHARDS` (`-2008b` finding 5): "Measured at
   238 rows and 10 shards, CSR-WO-2008b's FEEDBACK". Re-measure and re-size the shard count if the new
   rows push any shard past five minutes, and report every shard's CI wall time.
7. **`FEEDBACK.md`** per §6.

## 2. Invariants

- **N5.** Every new row is red by assertion after a green baseline (`--row <id>`); `--self-test`
  passes.
- **N6.** The leak gate runs before every push.
- **No control changes behaviour.**
  - `packages/*/src/**` diffs to empty, except a test seam that §1.1 needs. Such a seam must be a
    constructor option defaulting to today's value, and is the only allowed `src/**` diff.
  - Every existing test passes unchanged.
- **Protected surfaces, which must diff to empty:** the steering documents; `scripts/control-
  deletion.mjs` (a runner change is a flag-and-stop, §7); every existing stub (existing rows may gain
  `tests` entries); `.github/**` except the shard number and its comment.

## 3. Tests / acceptance — proven, not asserted

1. `--row <id>` is RED by assertion for every new row. Paste the one-line result per row.
2. The detector is green on the branch, and red under each of its two planted failures, both reverted.
3. Every `CHECKS.md` check is named by exactly one row (a test, or the detector, asserts it).
4. `npm run check` is green; every shard is green on CI and under five minutes.

## 4. Scope fence — NOT in this work order

- The validation pool's start-up race (`-1005c`).
- The heap test's sensitivity and the canary's margin (`-2008d`).
- Any change to a control's behaviour, a default, or an error code.
- Making `control-deletion` a required check (the gate's call).

## 5. Adversarial pass

A fresh subagent gets the diff, `test/deletion/README.md` and this WO. For every new row it asks:
- does the stub delete exactly the named control, or trip the test another way (a crash, a changed
  message, a broken import)?
- would a narrower stub that leaves the control half-working still go red?
- Then it hunts for any *built* §8 sub-control the sweep missed, and checks the detector's allowlist
  for an entry that hides a control.

## 5a. Reduction pass

Diff-sized. One line in FEEDBACK's gates.

## 6. Upward feedback

`FEEDBACK.md`, replacing `-2008b`'s after promoting it (promote-or-needs-none). Then:
- the standard schema per finding;
- gates;
- *deliberately not built*.
- Lead with any control §1.2 or §1.3 could not stub honestly.

## 7. Flag-and-stop

- A control that cannot be stubbed without changing `scripts/control-deletion.mjs`.
- A test seam that would change production behaviour or a default.
- A *built* control that turns out not to work as §8 says, beyond the two missing red-proofs.
- A secret or a deployment identifier anywhere in the diff.

## 8. Kickoff prompt

`/goal` (send `/goal` alone first, then this; confirm the `Goal set:` echo):
> Every control the architecture calls built can be shown to fail on its own row, and a test in CI
> goes red the day a control or a test file drops out of the deletion job again. Parked as one
> unmerged PR from wo/CSR-WO-2008c; a row that goes red for a reason other than its control is not
> done.

Kickoff:
> - **Sync:** `git fetch origin && git checkout -b wo/CSR-WO-2008c origin/main`, and confirm
>   `-2008b`'s merge is in the base.
> - **Cadence:** build.
> - **Read first:** `docs/work-orders/CSR-WO-2008c.md`, then `-2008b`'s FEEDBACK sweep on `main`.
>   It is your own list, and this WO works from it.
> - **What the last run got right, to keep:**
>   - You stopped on WO §7 when the sweep found controls with no red-proof, instead of writing rows
>     you could not prove.
>   - You measured the bound's stretch curve rather than picking a number.
>   - Treat each new stub the same way: prove it deletes exactly its control.
> - **Commit identity:** `clearforgekey[bot]`'s noreply address, as on `-2008b`.
> - **Pushing:** push and open the PR through `~/bin/gh-write` with an S25-minted token.
> - **Gates:** leak gate before every push. Flag-and-stop: WO §7.
> - **Report:** the PR link, the per-row RED lines, the detector's two red-proofs, and the shard times.
