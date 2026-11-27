# FEEDBACK: CSR-WO-2008b (a row that can fail the validation deadline)

Branch `wo/CSR-WO-2008b`, cut from `main` at `dbb96d5` and rebased onto its replacement `0116876`
(same tree, `648795d`) on the architect's interrupt. `dbb96d5` is not an ancestor
(`git merge-base --is-ancestor dbb96d5 HEAD` exits 1). `main` has since gained `cb6fefb` (docs only,
the -2003 work order, with no file in common), so the branch was not rebased again. Built on Node
v24.21.0 on Furnace, as `forge`. Parked as one unmerged pull request.

## Read this first: the §5 coverage sweep

A read-only subagent mapped every *built* §8 row to the deletion rows that fail it, sub-control by
sub-control. I spot-checked its gaps against `controls.json` and the source. **`-2008b` is not the
last of its kind.**

- **No red-proof at all (WO §7, reported to the operator before going on; ruled: continue and flag).**
  - **`requestTimeoutMs`**: the transport's request receive time, `server.ts:560`, default 30 s,
    SPEC-MAP "Node answers 408". It is part of the built *Transport hardening … timeouts* row.
  - The approval listener's `requestTimeout: 10_000` (`listener.ts:274`).
  - No test anywhere under `packages/*/test` names either one or a 408. A row cannot be written until
    a test exists. · *decision-needed: yes*
- **Built, tested, but no row**. These tests run in the job only because some other row lists their
  file, the pattern `-0002b` found by accident:
  - **Batch refusal** (`jsonrpc.ts:82`): tested in `refusals.test.ts`, `era-status.test.ts` and
    `refusal-audit.test.ts`. No row's `control` names it.
  - **415 Content-Type / Content-Encoding and 405** (`server.ts:404, 419, 482–485`): tested in
    `era-status.test.ts` and `adversarial.test.ts`.
  - Until this WO's row listed it, **`era-status.test.ts` ran in no row's baseline at all**, so its
    rows for these refusals never ran in the job.
  - **`x-mcp-header` annotation refusal** (`headers.ts:69–91`): `mirrored-param-headers` stubs only
    the `checkParamHeaders` call. The annotation tests run because that row lists the file.
  - **The core `tool.validate(args)` refusal** (`dispatch.ts:276, 285`): `schema-closed` deletes only
    `unevaluatedProperties: false`. No stub skips the validation itself.
  - **Legacy `initialize` returns no session header** (`dispatch.ts:149`). It is the second clause of
    *Stateless transport*'s red-proof. `eras.test.ts` asserts it, in the job only via
    `discover-versions`.
  - **The verifier checks beyond the eleven rows.** `auth/CHECKS.md` lists 33 checks, and 11 rows
    exist. Without a row: H4, H5, H7, H9, H10, K2, C4a, C5, C6, C7 (`verifier.ts:128–172`), H1, H3a
    (`server.ts:449–453`), the J-series cache and caps (`jwks.ts`), and G2's PRM document. The §8 row
    says "every check in CHECKS.md with its red-proof".
  - **The strict JSON parser** (`json.ts`: duplicate key, depth, lone surrogate) and MRTR's signed
    `requestState`. `json.test.ts` and `mrtr.test.ts` are listed by no row, so they never run in the
    job. Neither is a named §8 sub-control.
  - **Four transport test files are listed by no row:** `json.test.ts`, `costly-schema.test.ts`,
    `mrtr.test.ts` and `refusal-audit.test.ts`. `era-status.test.ts` was a fifth before this WO.
  - **Recommendation:** one WO for the rows, sized by the list above, plus the test for
    `requestTimeoutMs`. · *decision-needed: yes*
- **Outside the stub mechanism** (the leak gate, the supply-chain checks, the property tests, the job
  itself): each has its own self-test or none can apply. · *decision-needed: no*
- **Not swept:** each stub was not reread against its `control` line beyond those named. The audit's
  fourteen tampers and the canonicalizer's rules other than member order are unverified.

## -0002b's findings, promoted

| -0002b finding | Durable home |
|---|---|
| Shard 2 failed because the fixture lost its cost (z-schema 12.7.0's `uniqueItems`) | architecture §10, row of 2026-11-27 |
| Three tests broke, not one; CI never showed two | this WO: the row lists `era-status.test.ts` and `corrections.test.ts`, so their baselines now run |
| z-schema's two costs per schema; fixture sized for the warm path | architecture §10, 2026-11-27 · **ClearProof note candidate**: "a deadline fixture must outlast the validator's warm path, not its first call" (architect to file) |
| No row for the validation deadline | this WO §1.1 (`validation-deadline`) |
| A ×30 stretch left F2 green | this WO §1.2 (F2's bound) |
| The heap test measured unswept heap | this WO §1.3 |
| Every shard over five minutes | this WO §1.5 |
| `schema.ts:2` names 12.4.6 | this WO §1.4 |
| F2's stale title; the input built four times; the repeated 300 ms | this WO §1.4, §1.6 |
| The fixture's ceiling (1,503 of 2,000 nodes) | `-2003` (WO §4) |
| SDK 1.32.2 serves what 1.30.1 did | needs-none: architecture §10, 2026-11-27 |
| z-schema 12.9.0 is out | needs-none: the dependency bot's next group |
| Seven transitive advisories | needs-none: landed in `c17e696` |

## Findings

Schema: *finding · where · type · recommendation · decision-needed*.

0. **A validation sent straight after a timeout counts the replacement worker's start-up against the
   deadline.** · `schema-pool.ts` `#replace` / `#pump` · product behaviour, found by this branch's CI ·
   - **What failed.** CI run 46070674723 failed shard 6/8's *baseline* on the unpatched tree: F2's
     original last assertion, *the replaced worker validates*.
   - **The mechanism.** `#replace` puts a fresh worker at the same slot index, and `#pump` takes slots
     in order. So the next job lands on the worker that is still starting and being re-primed with all
     13 schemas, under the same timer.
   - **Proven without load.** Idle, that follow-up `echo` takes 71–80 ms here, against a few ms on a
     warm worker. At a 40 ms deadline it answers 400 with a second `validation-timeout` in 3 of 3
     runs. With a 500 ms pause first it answers 200 in 4 ms, 3 of 3.
   - **Under load.** The adversarial pass, pinned to 2 cores, saw F2's echo fail in 11 of 18 runs.
     era-status *ST handler over handlerTimeoutMs*, the next row on the same 300 ms server, failed
     6 of 6.
   - **Why it surfaced now.** The new row puts `adversarial.test.ts` into shard 6's baseline, beside
     the other costly-schema files.
   - **Fixed test-side, as ruled by the operator.**
     - F2 waits 500 ms before the follow-up call. Its message now carries the status, the elapsed ms
       and the last audits.
     - era-status's deadline row has its own `deadline` server; `fast` keeps `handlerTimeoutMs` 100 at
       the default validation deadline.
     - Pinned to 2 cores after the fix: 6 of 6 green (F2 and era-status together).
   - **In production** the default deadline is 2 s against about 75 ms of start-up, but on a loaded
     host with a short deadline the slot can fail every request in turn: each timeout replaces the
     worker that would have answered the next one.
   - **Recommendation:** a pool WO, so that a job never waits on an unprimed slot, or its timer starts
     at ready. That changes the deadline, so §2 fences it here. · *decision-needed: yes*
1. **The corrections close-in-flight test does not discriminate the deadline.** ·
   `corrections.test.ts` *WO §5.1 closing while a validation is in flight* · test scope ·
   - Under the stub it stays green, because `close()` rejects the in-flight job and terminates its
     worker without the timer. Its server's 10 s deadline never fires inside its 150 ms window either.
   - It tests `close()`, not the deadline, and it was never meant to test the deadline.
   - Per §1.1 it is not named. The file stays in the row's `tests` as the WO set them: its baseline
     runs, and that is how `-0002b`'s hidden breakage would now surface.
   - Recommendation: drop the file from the row if that baseline is not wanted (+about 2 s per run).
   · *decision-needed: no*
2. **The heap test cannot see the WO's planted retention.** · `limits.test.ts` *heap growth stays
   small* · test strength · Measured at 1,000 requests, after a real collection:

   | plant, per request (in `dispatch.ts`, reverted) | growth | result |
   |---|---|---|
   | none | 1,013–1,105 KiB | green |
   | the arguments (the WO's plant) | 1,101–1,187 KiB | **green** |
   | the arguments and the dispatch context | 9,437–9,441 KiB | **green** |
   | the arguments and a 4,096-element array (about 32 KiB) | 33,587–33,630 KiB | red by assertion |

   - The test's floor is about 16 KiB retained per request. §3.3 ("the planted retention turns the
     heap test red") is **not met** as written.
   - The bound did not move (WO §1.3). The new measurement justifies a tighter one: about 4 MiB would
     catch the context plant, at 3.6 times the honest reading.
   - No bound catches an argument-sized leak at 1,000 requests. Honest growth rises with the count
     (about 1.1 MiB at 1,000, 1.6 at 3,000, 2.3 at 6,000; the test helper keeps every audit line), so
     the noise is the same size as the leak.
   - A slope measure (growth at 2n minus growth at n, with the helper's lines cleared) would see it.
   - Recommendation: the architect sets the bound, and decides whether to rebuild the test around a
     slope. · *decision-needed: yes*
3. **The canary fails most runs on Furnace, on `main`'s own canary and fixture.** ·
   `costly-schema.test.ts` · margin ·
   - It needs `warm=` over 900 ms.
   - Solo, it read 798–823 ms in 6 of 8 runs and passed in 2 (924 ms, 1,126 ms). These were measured
     before this branch touched the canary or the fixture.
   - All 3 full-suite runs failed (788, 805, 831 ms), so `npm run check` fails here on that one test.
   - The box: load average about 10 on 20 cores, governor `powersave`. `-0002b` recorded 1,881–2,064 ms
     and its architect 1,642 ms; I cannot tell on which machines.
   - CI is green: Linux reads 1,233–2,002 ms and Windows 1,147–2,107 ms across ten runs per runner.
   - F2 still drives the deadline, because the warm cost is at least 2.6 × 300 ms.
   - Lowering `MARGIN` would weaken a test to pass, and the fixture's shape is fenced (§4), so neither
     was done. It is the ceiling `-2003` meets.
   - Recommendation: rule on the margin or the fixture with `-2003`. · *decision-needed: yes*
4. **`reach.test.ts` failed once under heavy load.** · *cages never leak across concurrent calls* ·
   load-sensitive ·
   - Shard 6/8's local baseline failed it once (`call 0: -32603`). That was at load average 22: four
     shards ran at once, beside the adversarial agent and other sessions.
   - Straight after, it passed 6 of 6 alone, and shard 6/8 alone was green twice (136.7 s, 141.1 s).
   - Shard 6 holds this row's three costly-schema files, so the extra load is partly this WO's. It has
     not failed on CI.
   - Recommendation: if it recurs on CI, it gets its own WO. · *decision-needed: no*
5. **`ci.yml`'s comment beside the shard number is stale** ("Measured at 145 rows and 4 shards"). ·
   `.github/workflows/ci.yml:50` · docs · `.github/**` is protected except the number.
   - Recommendation: "238 rows and 10 shards, CSR-WO-2008b's FEEDBACK" at the next `.github` change.
   · *decision-needed: no*
6. **`main` was rewritten under this branch.** · `dbb96d5` → `0116876` · process · The leak gate's
   `--history` refused `dbb96d5`'s author email on `main`'s own CI run (46062945790). My first commit
   was also refused, for `forge`'s configured org-domain email. This branch's commits carry the
   `clearforgekey[bot]` noreply identity, as `main`'s do. Recommendation: set that identity in
   `forge`'s git config through `bootstrap-builders.sh`. · *decision-needed: yes* (furnace777)

## §1.1 The row

`validation-deadline` · §8 *Runtime input validation against the pinned schema; output size cap* ·
touches `packages/core/src/transport/schema-pool.ts` only.

- **The stub deletes the deadline.** It removes the three lines in `#pump` that arm `slot.timer`.
- **No hang.** The input is valid, so with no deadline the validation completes and answers 200.
- `node scripts/control-deletion.mjs --row validation-deadline --show`, after a green baseline (3
  files, 96 tests): `RED … 2/2 named test(s) red by assertion`, in 25–30 s (four runs, the last after the fix).
  - F2: `testCodeFailure, assertion`. Status 200 where 400 was expected: the first assertion, before
    the bound.
  - era-status *ST validation over validationTimeoutMs*: `testCodeFailure, assertion`. A 200
    `"validated"` result where `[400, -32602]` was expected.
  - corrections *closing while a validation is in flight*: **stayed green** (finding 1).
- **On CI** (shard 8/10, run 46076162716) the row takes 51,969 ms against the runner's 240 s
  `ROW_TIMEOUT_MS`. It is the slowest row in its shard; the next is 10.3 s.

## §1.2 F2's bound

The 400 must come within **3 × `validationTimeoutMs`** (900 ms). That assertion follows the status
and code checks, so a deleted deadline reads as "no 400" and a stretched one as "late 400". `call=`
distribution, from F2's own `VALIDATION-DEADLINE` line:

| where | runs | min | median | max |
|---|---|---|---|---|
| Furnace, F2 alone | 12 | 316 ms | 320 ms | 322 ms |
| Furnace, `npm run check` | 2 | 311 ms | — | 312 ms |
| CI `ubuntu-latest` (`npm run check`) | 10 | 321 ms | 332 ms | 346 ms |
| CI `windows-latest` (`npm run check`) | 10 | 329 ms | 343 ms | 385 ms |

The CI rows come from ten runs per runner, read with `gh run view --log`:
- seven runs of z-schema 12.8 trees before this branch: `b3fb254` (push and PR), `c17e696`,
  `011373c` (push and PR), `dbb96d5` and `dd136b7`;
- this branch's three: 46070674723, 46075532689 and 46076162716.

The pull request's own runs add more.

- **The slowest honest run is 385 ms (Windows), so the 900 ms bound sits 2.3 times above it.** The
  adversarial pass's loaded runs reached 552 ms, and the bound is never the first assertion to go
  under load.
- **×30, applied by hand to `schema-pool.ts` and reverted:** `call=9018ms`, red on the bound line:
  `the 400 came at 9018 ms, past 900 ms (3 × validationTimeoutMs): the deadline fired late`.
- **The largest stretch F2 still passes is ×2.9** (`call=888ms`); ×2.95 is red (adversarial pass).
  Mine: ×2 passes at 617 ms, ×3 is red at 916–917 ms. All of these were re-run after the settle
  step, which comes after the bound's assertion.
- After each stretch, `git diff -- packages/core/src` was empty except `schema.ts:2`.

## §1.3 The heap measurement

- **What changed.** `limits.test.ts` now collects for real, under any launcher.
  - It sets `--expose-gc` in-process (`v8.setFlagsFromString`) and takes `gc` from a fresh vm context.
    It fails if none is there.
  - That replaces a `globalThis.gc?.()` that silently did nothing.
- **Why in the file, not `scripts/test.mjs`.** The control-deletion runner launches `node --test`
  itself and is protected. `handler-timeout` lists `limits.test.ts`, so a flag passed only by
  `test.mjs` would leave the unswept reading in every shard baseline that runs that file: the
  `-0002b` failure. `node --test` gives each file its own process, so the flag reaches no other file.
- **Readings.**
  - Furnace: 1,013–1,105 KiB, alone and with `--expose-gc` passed in (`-0002b`: 1.1 MiB).
  - CI, on this branch's three runs: 1,063–1,109 KiB on Windows and 1,082–1,088 KiB on Linux.
  - Unswept, before: 10,274–11,116 KiB on CI, and 16,720 KiB on `dbb96d5`'s Windows run, which
    failed `main`'s CI.
- **Leak detection:** finding 2. The bound is unchanged.

## §1.4–§1.6

- **F2 retitled:** "a validation slower than validationTimeoutMs is abandoned at the deadline with 400
  -32602, and /health answers meanwhile". No existing `mustFail` named the old title; the new row
  uses the new one.
- **`schema.ts:2`:** "z-schema 12.8.0. It was chosen, at 12.4.6, by measurement". The 1,252-test
  measurement was taken on 12.4.6, so the line keeps that attribution. It is the only `src/**` diff.
- **Shards:** `CONTROL_DELETION_SHARDS` 4 → 10.
  - At 8 (run 46075532689) every shard finished under five minutes, but shard 6/8, with the new row,
    took 277 s. A shard's time varied by up to 45% between this branch's runs.
  - At 10 the slowest is 241 s. Every shard's time is under *Gates*.
- **era-status:** the deadline row moved to its own `deadline` server (finding 0). Its title, input
  and assertion are unchanged.
- **Fold (reduction):** `costlyArguments()` and `COSTLY_DEADLINE_MS` sit beside `fixtureTools()`.
  They replace four copies of the 20,000-item input and three of the 300 ms deadline (F2,
  era-status's fast server, the canary).
  - Titles, inputs and assertions are unchanged in effect.
  - The arguments are built before each timer starts, as before: F2's `t0` and the canary's
    `performance.now()`.

## Adversarial pass (WO §5)

A fresh Opus subagent, in its own worktree, had the diff (at `25e49f4`), the WO and the deletion
README, and none of my conclusions. What it found, and what was done:

1. **must-fix, fixed: shard 6/8's baseline race.** This is finding 0, found on its own as well. It
   also found era-status's exposure, which I had not. Both fixed as ruled.
2. **should-fix, recorded: the WO's leak plant stays green.** Finding 2. Its plants agree with mine:
   - the arguments: 1,106–1,192 KiB;
   - a cloned request: 2.4 MiB;
   - `{params, ctx}`: about 9.5 MiB;
   - an 8 KiB array: 9,137 KiB;
   - a 16 KiB array: red at 17.3 MiB.
3. **The heap measurement collects.** It is linear in what was planted (4 KiB per request read
   +5,358 KiB). With `gc` stubbed to a no-op it read 5.5–11.7 MiB, against about 1 MiB with the real
   one. Each file runs in its own process under both launchers, so no other test is affected.
4. **The stub is red for the right reason.** It deletes `setTimeout` from `#pump`, with no crash and
   no hang: era-status gets `200 "validated"` and F2 a status mismatch, in 29.8 s against the runner's
   240 s. No other test drives this deadline: the conformance and teaching tests use 2 s and never
   exceed it.
   - **It asked:** remove `corrections.test.ts` from `tests`, or say why it stays.
   - **It stays.** The WO set the row's tests, and that baseline is what now catches a fixture that
     goes cheap in that file, which is `-0002b`'s hidden failure.
5. **The bound, stretch by stretch** (2 runs each, applied by hand and reverted):

   | stretch | ×2 | ×2.5 | ×2.8 | ×2.9 | ×2.95 | ×3 | ×30 |
   |---|---|---|---|---|---|---|---|
   | `call=` | 616 ms | 767 ms | 857 ms | 887–888 ms | 901–902 ms | 917–918 ms | 9,016–9,018 ms |
   | F2 | pass | pass | pass | **pass (largest)** | **red (smallest)** | red | red, on the bound's assertion |

   - Honest runs: 315–320 ms alone; at most 423 ms under 20-core load; 440–552 ms with 6 copies on 2
     cores.
   - With 12 copies on 2 cores one run reached 920 ms, but 22 of those 24 runs had already failed
     `health < 200`. The bound is not the first assertion to go.
6. **The refactor is identical in effect.** Titles render the same ("3 × 300 ms"), and the arguments
   are built where they were: before `t0`, before the canary's timer, lazily per era, before
   corrections' 150 ms wait.
7. **Protected surfaces hold.** The stale comment in `ci.yml` is finding 5.

## Gates

- `npm run check` on Node v24.21.0, on Furnace:
  - lint, typecheck and build are green;
  - core and teaching pass 938 of 939, the one failure being the canary (finding 3: it fails most
    runs here, on `main`'s canary and fixture too);
  - `check` stops at that failure, so the later stages were run by hand: spike 0102 69, spike 0101 8,
    `test:subset` 4;
  - the counts are unchanged from `main`: 939 / 69 / 8 / 4.
- CI on `c508b0e` (run 46076162716): every job green, both `test` jobs included.
- `control-deletion --self-test`: passed (the no-op, stale and build-breaking red-proofs each fail
  the job).
- `--row validation-deadline`: RED, 2/2 named tests by assertion.
- Every shard, locally (three at a time, capped scope) and on CI (job wall time, including checkout,
  install and build):

  | shard (n=10) | rows | local runner | CI runner | CI job |
  |---|---|---|---|---|
  | 1/10 | 24 | 103.3 s | 201.6 s | 229 s (3 min 49 s) |
  | 2/10 | 24 | 100.6 s | 140.2 s | 162 s (2 min 42 s) |
  | 3/10 | 24 | 91.8 s | 136.9 s | 164 s (2 min 44 s) |
  | 4/10 | 24 | 88.0 s | 127.0 s | 154 s (2 min 34 s) |
  | 5/10 | 24 | 88.8 s | 169.0 s | 199 s (3 min 19 s) |
  | 6/10 | 24 | 109.8 s | 137.6 s | 157 s (2 min 37 s) |
  | 7/10 | 24 | 88.8 s | 107.1 s | 133 s (2 min 13 s) |
  | 8/10 (the new row) | 24 | 107.9 s | 210.3 s | 241 s (4 min 01 s) |
  | 9/10 | 23 | 81.0 s | 162.2 s | 189 s (3 min 09 s) |
  | 10/10 | 23 | 96.6 s | 128.4 s | 149 s (2 min 29 s) |

  Both columns are at `c508b0e`'s tree; CI is run 46076162716. All 238 rows are red by assertion, after
  a green baseline in each shard. The earlier run at n=8 (46075532689), job wall time: 161, 237, 225,
  258, 202, 277, 221 and 184 s.

- Leak gate: `--self-test`, `--tree` and `--history` exited 0 on each pushed head, run with the exit
  code checked.
- Reduction pass (diff): +7 net from the fold · 7 duplicates removed (3 copies of the 20,000-item
  input, 2 of the 300 ms deadline, F2's comment restating FEEDBACK's numbers, era-status's restatement
  of the start-up mechanism) · 1 dead path removed (the collector's `--expose-gc` branch, since the vm
  path works with or without the flag) · 0 protected kept · 1 finding (finding 1: `corrections.test.ts`
  stays in the row's `tests`).
- Protected surfaces, against `0116876`:
  - `git diff 0116876 -- ':(glob)packages/*/src/**'` is `schema.ts:2` only;
  - `schema-pool.ts` diffs to empty;
  - `.github/**` is the one number;
  - the 237 existing rows are byte-identical, and no existing stub or red-proof changed;
  - `scripts/**`, the steering documents, the governance files, `.npmrc`, `.node-version` and every
    `package.json` diff to empty;
  - the core's one runtime dependency is still `z-schema`.

## Deliberately not built

- Rows for the controls in *Read this first* (WO §4), and a test for `requestTimeoutMs`.
- A tighter heap bound or a slope test (finding 2): the architect's call.
- Any change to the canary's margin or the fixture (finding 3; §4).
- The stale shard comment in `ci.yml` (finding 5; protected).
- The F2 timer stretch as a row: the WO says it does not become one.

## Push

Two S25-minted tokens for `clearforgekey:clearseal-reference`, each spent only through
`~/bin/gh-write`. The first pushed `e17dac0` and was revoked straight after (`revoked (HTTP 204)`).
The second pushed `8011e07`, `c508b0e` and this commit and opened the pull request, and was revoked
after that. Every commit's author and committer is the `clearforgekey[bot]` noreply identity, as on
`main` (finding 6). The leak gate's `--self-test`, `--tree` and `--history` exited 0, exit code
checked, before each push.
