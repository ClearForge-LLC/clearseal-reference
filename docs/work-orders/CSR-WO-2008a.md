# CSR-WO-2008a — The control-deletion job, sharded: the same proof in parallel, sized to grow with the manifest

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (must contain `-1007c`, merged `a2c6b9f`).
**Branch:** `wo/CSR-WO-2008a`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P2 · **Grounds:** `docs/northstar.md` N5; `docs/architecture.md` §8 row *Control-deletion
job*; the gate's ruling of 2026-09-27 (below).

> **What this is:** the control-deletion job runs every row serially on one runner. It was 45 rows at
> `-2008` and is 145 at `-1007c`; the job took 14½ minutes at 137 rows and grows with every WO, and
> every push waits on it. **The gate's ruling:** the job stays an optional check until the gate decides
> it should gate merges; it is designed now to scale, and engaged as needed. So: the runner learns to
> run one shard of the manifest, CI runs the shards in parallel, and one aggregate job keeps the name
> `control-deletion`, so that making it required later is a single settings change. What the job
> proves does not change: every row still runs against an unpatched baseline first, and every named
> test must still fail by assertion. It is NOT a change to any row, stub or control.

**Cadence:** build, small. One PR, left unmerged for review. Regression tests for the documented cases
below; a review subagent checks the diff against §1 and §2 (no open-ended attack pass).

## 1. Scope — numbered, specific

1. **`--shard <i>/<n>`** in `scripts/control-deletion.mjs`: runs only the rows assigned to shard `i` of
   `n` (1-based). Assignment is deterministic and depends only on the manifest (choose: by index, or
   balanced by a per-row cost the manifest records; record why). Each shard runs its own rows' baseline
   (step 2) before any stub, exactly as today. `--list` with `--shard` prints the shard's rows. A shard
   with no rows exits 0 and says so.
2. **Partition proven.** A test shows, for every `n` from 1 to 8 over the real manifest and over a
   synthetic one of 1, 7 and 200 rows: every row lands in exactly one shard, and the union is the
   manifest. Refused arguments, each a test: `0/4`, `5/4`, `2/0`, `a/b`, `2`.
3. **CI.** The `control-deletion` job becomes a matrix of `CONTROL_DELETION_SHARDS` shards (one number,
   in one place; start at 4 and record the measured wall time per shard), plus the runner's
   `--self-test` once, plus an aggregate job named **`control-deletion`** that needs every shard and
   the self-test and succeeds only if all of them succeeded. A cancelled or skipped shard fails the
   aggregate. Action pins stay commit digests; permissions stay `contents: read`.
4. **When to raise `n`.** A short note beside the number: the target is under five minutes per shard,
   and how to measure it from a run.
5. **`FEEDBACK.md`** per §6.

## 2. Invariants

- **N5**: the set of rows proven, and what each proof requires, is unchanged. A run of all shards is
  equivalent to today's single run.

**Protected surfaces (must diff to empty):** the four steering documents, `LICENSE`, `NOTICE`,
`spikes/**`, `docs/canonical-form.md`, `packages/**`, `test/deletion/controls.json` and its stubs.
Working surface: `scripts/control-deletion.mjs`, its tests and red-proofs, `.github/workflows/ci.yml`
(the control-deletion job only).

## 3. Tests / acceptance

1. `npm run check` green on both runners; both leak-gate modes exit 0; every shard and the aggregate
   green on the PR.
2. The partition test and the refused arguments: pasted.
3. Wall time per shard and of the aggregate, against today's 14½ minutes: pasted from the PR's run.
4. A deliberately broken row (in a throwaway commit, not merged) turns exactly its shard and the
   aggregate red: pasted.

## 4. Scope fence

- **Making the check required** (the gate's decision).
- **Any change to a row, a stub, or what counts as red.**
- **Running rows concurrently inside one runner** (a later option if shards alone stop scaling).

## 5. Review pass

A fresh subagent reads the diff against §1 and §2: the partition is total and disjoint, the baseline
still precedes every stub in every shard, a failed or cancelled shard cannot pass the aggregate.

## 6. Upward-feedback directive

`FEEDBACK.md`: gates line, the pastes in §3, the assignment choice in §1.1 with its reason, review
findings, what was not built.

## 7. Flag-and-stop conditions

- The aggregate cannot be made to fail on a cancelled or skipped shard.
- A protected surface must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-2008a` off current `main` where the control-deletion runner accepts --shard i/n
> with a deterministic, total and disjoint partition proven by test, CI runs the shards as a matrix
> sized by one number plus an aggregate job named control-deletion that fails if any shard fails or
> is cancelled, no row or stub changes, `npm run check` is green on both runners, and the work is
> parked as one unmerged pull request. Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-2008a origin/main`. Node 24.21.0. Cadence:
> **build**, small. Read `docs/work-orders/CSR-WO-2008a.md` in full. Regression tests for the documented
> cases and a review subagent, no open-ended attack pass. Leak gate before every push, exit code
> checked directly. Report the PR link and the pastes.
