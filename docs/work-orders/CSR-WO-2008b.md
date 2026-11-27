# CSR-WO-2008b — The validation deadline gets a row that can fail it, and the job that runs it stays inside its own rule

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD; it must
contain `c17e696`, `-0002b` merged 2026-11-27, and the docs PR that adds this work order).
**Branch:** `wo/CSR-WO-2008b`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P2 · **Phase exit gate:** *"the control-deletion job is green, meaning every stub made the
suite fail"* (`docs/roadmap.md` P2). A control with no row is not counted by that sentence, so the gate
currently overstates what it proves.
**Grounds:** `docs/northstar.md` N5; `docs/architecture.md` §8 rows *Runtime input validation against
the pinned schema* and *Control-deletion job*; `test/deletion/README.md` (the rules for rows and
stubs); `-0002b`'s `FEEDBACK.md` on `main` (*Read this first*, *§2*, *Gates*, *Known*). Seams:
`packages/core/src/transport/schema-pool.ts` (the timer at `#pump`), `packages/core/test/transport/`
`adversarial.test.ts` (F2), `era-status.test.ts`, `corrections.test.ts`, `limits.test.ts`,
`costly-schema.test.ts`, `test/deletion/controls.json`, `test/deletion/stubs/`, `scripts/test.mjs`,
`.github/workflows/ci.yml` (`CONTROL_DELETION_SHARDS`).

> **What this is:** `-0002b` found that the validation deadline, an §8 control marked *built*, has no
> control-deletion row. F2 ran in shard 2 only because another row (`verifier-timeout`) lists its file.
> So when z-schema 12.7 made the fixture cheap, nothing named the deadline. The failure surfaced as a
> different row's baseline. `-0002b` also measured that F2 cannot tell a deadline at 300 ms from one at
> 9 s, because it asserts the 400 but not when it came. A 30-fold stretch, the pattern two other rows
> use, leaves F2 green. This work order gives the deadline a row whose stub F2 must go red under, makes
> F2 bound the call's duration, stops one test from measuring unswept heap, and resizes the job to its
> own five-minute rule. It is NOT a change to the deadline itself, to any other row's stub, or to the
> fixture's shape.

**Cadence:** build, small. One PR, left unmerged for review. A fresh-subagent attack on the finished
branch (§5), aimed at the new row and the new bound.

## 0. Already measured (`-0002b`, on `main`'s FEEDBACK, reproduced by the architect)

- `costly_schema` on z-schema 12.8.0: about 37 s cold and about 1.3–2.1 s warm. CI's warm timings were
  1,265 ms on Linux and 1,459 ms on Windows. F2 answers 400 at 318–340 ms.
- Stretching the timer ×1000 turned F2 and era-status red by assertion. A ×30 stretch left F2 green at
  `status=400 call=9034ms`.
- `limits.test.ts` *in-flight returns to 0 and heap growth stays small* calls `globalThis.gc?.()`
  without `--expose-gc`, so it measures unswept heap. Run alone, readings fall in two modes (about
  9 MB and about 11.7 MB), the 12.8 bump makes the higher mode usual, and one parallel-load run read
  17 MB against its 16 MiB bound. With `--expose-gc`, growth is about 1.1 MiB on both trees.
- Every shard took 316–345 s locally, and CI's longest was about 7 min 20 s (shard 3 on the PR run).
  `ci.yml` says to raise the shard count when a shard passes five minutes.

## 1. Scope — numbered, specific

1. **A `validation-deadline` row** in `test/deletion/controls.json`:
   - It points at the §8 row *Runtime input validation against the pinned schema*.
   - `touches` is `packages/core/src/transport/schema-pool.ts` only.
   - `tests` are `adversarial.test.ts`, `era-status.test.ts` and `corrections.test.ts`.
   - `mustFail` names F2 (by its title after §1.4), the era-status *validation over
     validationTimeoutMs* row, and the corrections *closing while a validation is in flight* test.
     Name only tests that actually go red under the stub. Drop any that does not and say why in
     FEEDBACK, because that is a finding about that test.
   - **The stub deletes the deadline:** no timer is armed, or it never fires. Prefer that over a
     stretch, because "deletes or disables" is the rule in `test/deletion/README.md` and a stretch
     claims less. If deleting it hangs a test instead of failing an assertion, stretch it past the
     cold cost (at least ×1000 at 300 ms) and record why. The `verifier-timeout` row is the precedent
     for that reason.
2. **F2 bounds the call.** Add one assertion: the 400 arrives within a bound of `validationTimeoutMs`.
   Choose the bound from measurement:
   - F2's `call=` on both CI runners and on this box, at least 10 runs each. Report min, median and
     max.
   - The bound must sit well above the slowest honest run.
   - It must turn F2 red under the ×30 stretch, `call≈9 s`. Prove that with the stretch applied by
     hand and reverted, as `-0002b` §2 did. That stretch does not become a row.
3. **The heap measurement measures retained heap.** Make `limits.test.ts`'s growth figure read heap
   after a real collection: `--expose-gc` for that file through `scripts/test.mjs` or its own
   `execArgv`, or a retained-heap measure. Your call; record why.
   - **The proof that it still catches a leak:** plant a retention by hand (keep every request's
     arguments in a module-level array), show the test red, then revert.
   - The 16 MiB bound does not move unless the new measurement justifies a tighter one. If it does,
     say so and leave the bound for the architect.
   - If the flag reaches every test file, show the full suite's count and time are unchanged.
4. **Titles and comments that `-0002b` left stale:**
   - F2's title says "a quadratic validation". The cost is items × branches now, so retitle it to say
     what it tests, e.g. "a validation slower than validationTimeoutMs". Update every `mustFail`
     string that names it.
   - `packages/core/src/transport/schema.ts:2` names z-schema 12.4.6; it is 12.8.0. Change only that
     comment; it is the only permitted `src/**` diff.
5. **The shard count.** Set `CONTROL_DELETION_SHARDS` so that every shard on CI finishes under five
   minutes with this WO's rows included, measured from this branch's CI run. Report every shard's wall
   time. The aggregate job's name and semantics are unchanged.
6. **The 20,000-item input, built in four places** (F2, era-status, corrections, the canary):
   - Fold it into one exported helper beside `fixtureTools()` only if the tests' titles, inputs and
     assertions stay byte-identical in effect. The same goes for the canary's repeated 300 ms.
   - If folding would change what any test asserts, leave it and say so. This is the reduction pass's
     work, not a feature.
7. **`FEEDBACK.md`** per §6. Promote-or-needs-none for `-0002b`'s findings first (the closing step of
   the prior WO, see §6).

## 2. Invariants

- **N5.** Every row still goes red by assertion. The new row is proven with `--row validation-deadline`
  and with its shard. `--self-test` still passes.
- **N6.** The leak gate runs before every push.
- The core keeps exactly one runtime dependency.
- **The deadline itself does not change.** `schema-pool.ts` diffs to empty, `validationTimeoutMs`'s
  default does not move, and the fixture's shape does not change.

**Protected surfaces, which must diff to empty:**
- the four steering documents, `LICENSE`, `NOTICE`, the governance files, `.npmrc`, `.node-version`;
- `packages/*/src/**`, except the one comment in §1.4;
- every existing row and stub in `test/deletion/`, except `mustFail` strings renamed by §1.4;
- `scripts/control-deletion.mjs`;
- `.github/**`, except the one number in §1.5.

`scripts/test.mjs` may change for §1.3 only.

## 3. Tests / acceptance — proven, not asserted

1. `node scripts/control-deletion.mjs --row validation-deadline` shows every named test red by
   assertion, after a green baseline.
2. F2 with the ×30 stretch applied by hand is red on the new bound. The stretch is reverted, and the
   diff to `src/**` is the §1.4 comment only.
3. The planted retention turns the heap test red. It is reverted.
4. `npm run check` is green on Node 24.21.0. Every shard is green locally and on CI, each under five
   minutes on CI (wall times in FEEDBACK).
5. F2's `call=` distribution and the chosen bound, from both CI runners' logs.

## 4. Scope fence — NOT in this work order

- Any change to the deadline, the validation pool, the fixture's shape or `maxSchemaNodes`. The
  fixture's ceiling (1,503 of 2,000 nodes) is recorded, not fixed.
- New rows for any control other than the validation deadline. If you find another *built* §8 control
  with no row, list it in FEEDBACK with `decision-needed: yes`. Do not build it.
- Making `control-deletion` a required check. That is the gate's call.
- z-schema 12.9.0 or any other version bump.
- `-2010` (the SDK v2 interop spike) and `-2003` (the ceiling).

## 5. Adversarial pass

A fresh subagent gets the diff, this WO and `test/deletion/README.md`, and none of your conclusions.
It attacks:
- **The stub.** Does it delete exactly the deadline, or does it trip F2 another way (a crash, a
  changed message)? Is the row RED for the right reason? Read the runner's assertion-origin rule.
- **The bound.** Could it flake on a slow Windows runner, or pass under a stretch smaller than ×30?
  Find the smallest stretch that F2 still passes, and report it.
- **The heap change.** Does the new measurement still see a leak of a realistic size (a retained
  object per request)? Did `--expose-gc` change any other test's behaviour?
- **Coverage.** Is there another *built* §8 control whose only red-proof runs because a different row
  lists its file? `-0002b` found one by accident. Look on purpose: for each §8 row marked *built*,
  name the deletion row that fails it, or report that none does.

Fix the reversible findings and record all of them.

## 5a. Reduction pass

Diff-sized (the `reduction-pass` skill). §1.6 is its main candidate. One line in FEEDBACK's gates.

## 6. Upward feedback

`FEEDBACK.md`, replacing `-0002b`'s, **after** promoting it:
- Each `-0002b` finding gets its durable home (this WO, the architecture's §10 row of 2026-11-27, a
  ClearProof note candidate for the cold/warm lesson) or `needs-none`.
- Then the standard schema per finding: `finding · where · type · recommendation · decision-needed`.
- A gates line, and a *deliberately not built* section.
- Lead with §5's coverage sweep. It decides whether `-2008b` is the last of its kind.

## 7. Flag-and-stop

- The stub cannot be made to fail F2, era-status and corrections by assertion. That means either the
  deadline is not what F2 tests, or the runner's origin rule rejects the failure. Stop and report.
- Any bound that is not flaky on CI also passes under the ×30 stretch, so no bound separates them on
  these runners. Stop: the fixture or the test needs a design decision.
- The heap fix requires a change to `scripts/control-deletion.mjs` or to any `src/**` beyond §1.4.
- A *built* §8 control turns out to have no working red-proof at all (not merely no row). Stop and
  report it before anything else.
- A secret or a deployment identifier anywhere in the diff.

## 8. Kickoff prompt

`/goal` (send `/goal` alone first, then this; confirm the `Goal set:` echo):
> The validation deadline can be shown to fail: a deletion row whose stub turns F2 red by assertion,
> and F2 itself red under a 30-fold stretch. The job still proves every row in under five minutes a
> shard. Parked as one unmerged PR from wo/CSR-WO-2008b; a row that goes red for any reason other than
> the deadline is not done.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-2008b origin/main`. Confirm `c17e696` and this
> WO's docs commit are in the base. Cadence: **build, small**. Read
> `docs/work-orders/CSR-WO-2008b.md` in full, then `-0002b`'s FEEDBACK on `main`: it is your own
> measurement, and §0 here restates it. What `-0002b` got right that this WO depends on: you
> reproduced the reviewer's warm-path finding before fixing it, and you made the canary fail as
> itself. Keep both habits for the bound in §1.2. Measure the distribution before choosing a number.
> The stub should delete the deadline, not stretch it, unless deletion hangs; that ruling is in §1.1.
> Flag-and-stop: WO §7. Leak gate before every push. Report the PR link, the §1.2 distribution and
> bound, the §5 coverage sweep, and the shard times.
