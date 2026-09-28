# FEEDBACK: CSR-WO-2008a (the control-deletion job, sharded)

Branch `wo/CSR-WO-2008a`, cut from `main` at `dc43207`, where the WO lives. Parked as one unmerged pull
request. Built on Node v24.21.0. None of the §7 flag-and-stop conditions arose: the aggregate fails on
a cancelled or skipped shard, and no protected surface changed.

## Gates

- `npm run check` exits 0: 745 core and teaching tests, spike 0102 69, spike 0101 8, `test:subset` 4
  (unchanged from `main`: this WO changes no package).
- The partition test, `node scripts/test.mjs "scripts/control-deletion.test.mjs"`: 17 of 17. The
  runner's `--self-test` passes.
- All four shards run locally, one after another: 145 rows in all, each exactly once, **all red by
  assertion**, each shard's baseline green before its stubs (below).
- `node scripts/leak-gate.mjs --tree` and `--history` exit 0, run unpiped with the exit code checked
  directly, before every push.
- CI at `c5aea11`, both runs (push and pull request): `test (ubuntu-latest)` and `test
  (windows-latest)` green, every shard, the self-test, the plan and the aggregate `control-deletion`
  green, with `leak-gate`, `audit`, `sbom` and provenance green.
- Protected surfaces diff to empty against `dc43207` (`packages/**`, `test/deletion/**` including
  `controls.json` and every stub, the steering documents, `LICENSE`, `NOTICE`, `spikes/**`,
  `docs/canonical-form.md`). Changed: `scripts/control-deletion.mjs`, the new
  `scripts/control-deletion.test.mjs`, the control-deletion jobs of `.github/workflows/ci.yml`, this
  file and `CHANGELOG.md`.
- The minted token lived in a mode-0600 scratch file, was never written to git config or a remote
  URL, and was deleted after the pull request was opened.

## Read this first

- **A run of all shards proves what one run did.** Shard `i` of `n` holds the manifest's rows at index
  `k` with `k mod n = i - 1`. Each shard runs the same four steps over its own rows: copy, build, the
  baseline of every one of its rows' tests on the unpatched copy, then each stub. The rows proven, and
  what each proof requires, are unchanged; so is every row and stub.
- **One difference, recorded rather than hidden (review L3):** the baseline is one `node --test` call
  with the runner's 240-second limit. A full run put every test file in that one call; a shard puts only
  its own files. So a baseline that would time out in a full run can pass when sharded. That loosens a
  resource limit, not what a row proves.
- **The job named `control-deletion` is now the aggregate.** It needs the plan, the self-test and every
  shard, runs `always()`, and succeeds only if all three succeeded. Making it required stays one
  branch-protection setting, and it is still optional (the gate's ruling).

## Choices the WO left to me, with reasons

**§1.1, the assignment: round robin by index.** Row `k` goes to shard `k mod n + 1`. It depends only
on the manifest's order, so it is deterministic, and the n shards partition it by arithmetic. Balancing
by a per-row cost would have needed a cost field in every row, and `controls.json` is a protected
surface here. Round robin also spreads the rows one work order adds (which sit together at the end
and tend to cost alike) across shards: at 145 rows and 4 shards the sizes are 37, 36, 36, 36, and the
measured times below are within 10% of each other.

**§1.1, arguments.**
- `--shard` with `--row` is refused (they choose rows two ways). So is `--shard` given twice.
- `--self-test` now runs alone: before, it ran and ignored the rest of the line (review L1).
- A leading zero (`01/4`) and a missing value are refused (review I1, I2).
- An empty shard (`n` larger than the manifest) exits 0, says so, and builds nothing, with `--list` or
  without.

**§1.2, where the partition test runs.** `scripts/control-deletion.test.mjs`, run by CI's
`control-deletion-self-test` job through `scripts/test.mjs` (which refuses zero tests and skips). It is
not in `npm run check`: that would mean a line in the root `package.json`, which is outside this WO's
working surface. **For you:** adding `node scripts/test.mjs "scripts/control-deletion.test.mjs"` to
`npm test` would run it on both runners (review I8).

**§1.3, one number.** `CONTROL_DELETION_SHARDS: 4` is the plan job's environment. A matrix cannot
read an environment variable, so the plan job turns the number into `[1, 2, 3, 4]` (refusing anything
that is not a whole number from 1), and every shard's `--shard i/n` comes from the plan's outputs.
`fail-fast: false`, so one red shard does not cancel the others and a run names every miss.

**§1.3, the aggregate.** It passes `toJSON(needs)` through the environment and requires
`length == 3 and all(.result == "success")`. Checked with sample inputs: a failed, cancelled or
skipped shard; a failed plan (the shards are then skipped); a cancelled self-test; and an empty or
unparseable input all fail it. `always()` means it runs, and fails, when the workflow is cancelled,
and is never skipped: a skipped required check would count as passed.

## §3.2 The partition test and the refused arguments

```
PARTITION the real manifest (145 rows): n=1..8 total and disjoint; shard sizes at n=4: 37, 36, 36, 36
PARTITION a synthetic manifest of 1 row (1 rows): n=1..8 total and disjoint; shard sizes at n=4: 1, 0, 0, 0
PARTITION a synthetic manifest of 7 rows (7 rows): n=1..8 total and disjoint; shard sizes at n=4: 2, 2, 2, 1
PARTITION a synthetic manifest of 200 rows (200 rows): n=1..8 total and disjoint; shard sizes at n=4: 50, 50, 50, 50
REFUSED --shard 0/4: exit 2: control-deletion: --shard 0/4: shards are numbered from 1
REFUSED --shard 5/4: exit 2: control-deletion: --shard 5/4: there is no shard 5 of 4
REFUSED --shard 2/0: exit 2: control-deletion: --shard 2/0: n must be at least 1
REFUSED --shard a/b: exit 2: control-deletion: --shard a/b: expected <i>/<n>, shard i of n, as 2/4
REFUSED --shard 2: exit 2: control-deletion: --shard 2: expected <i>/<n>, shard i of n, as 2/4
REFUSED --shard 01/4: exit 2: control-deletion: --shard 01/4: write the numbers without a leading zero
REFUSED --shard : exit 2: control-deletion: --shard needs a value, <i>/<n>
```

It was red-proven by mutating `shardOf` on a committed tree: a duplicated row, a dropped row and a
time-dependent assignment each turn it red (6, 6 and 4 failures). The review pass tried four more
(off by one, floor and ceil chunking, a duplicate). Ceil chunking passes the partition checks, which
is correct because it is also a partition, and the `--list` test against the real command line
rejects it.

## §3.3 Wall time per shard

Locally, the four shards one after another on this machine (the full run took 727 s at 145 rows):

```
control-deletion: shard 1/4: 37 of the manifest's 145 row(s)
control-deletion: baseline green: 18 test file(s), 401 test(s) passed on the unpatched tree
control-deletion: shard 1/4: every stub made its named tests fail by assertion — 37 row(s), 186.3 s
control-deletion: shard 2/4: 36 of the manifest's 145 row(s)
control-deletion: baseline green: 22 test file(s), 434 test(s) passed on the unpatched tree
control-deletion: shard 2/4: every stub made its named tests fail by assertion — 36 row(s), 195.3 s
control-deletion: shard 3/4: 36 of the manifest's 145 row(s)
control-deletion: baseline green: 21 test file(s), 414 test(s) passed on the unpatched tree
control-deletion: shard 3/4: every stub made its named tests fail by assertion — 36 row(s), 202.1 s
control-deletion: shard 4/4: 36 of the manifest's 145 row(s)
control-deletion: baseline green: 20 test file(s), 490 test(s) passed on the unpatched tree
control-deletion: shard 4/4: every stub made its named tests fail by assertion — 36 row(s), 202.7 s
```

From the pull request's run, against today's 14½ minutes:

Both runs at `c5aea11` (job durations from the checks API, checkout and install included):

| Job | push run | pull-request run |
|---|---|---|
| `control-deletion-plan` | 0m03s | 0m03s |
| `control-deletion-self-test` | 0m45s | 0m43s |
| `control-deletion shard 1/4` | 4m12s | 3m07s |
| `control-deletion shard 2/4` | 4m26s | 4m29s |
| `control-deletion shard 3/4` | 3m12s | 4m13s |
| `control-deletion shard 4/4` | 4m36s | 2m59s |
| `control-deletion` (the aggregate) | 0m04s | 0m04s |
| **plan start to aggregate done** | **4m47s** | **4m41s** |

Against 14½ minutes for the single job at 137 rows. Every shard is under the five-minute target, but
the slowest is at 4m36s: at the current rate of growth, **raise `CONTROL_DELETION_SHARDS` to 5 or 6
within a work order or two.** Shards of the same rows vary by a minute or more between runs (runner
speed), so read the slowest shard across a couple of runs, not one.

## §3.4 A deliberately broken row

A throwaway commit, `c87560e` on the branch `throwaway/2008a-broken-row` (deleted after the run;
never merged, never part of this pull request), replaced the `drift-refused` row's stub with the
runner's own no-op red-proof patch. `drift-refused` is row index 2, so shard 3 of 4. That run:

```
control-deletion-plan          success
control-deletion-self-test     success
control-deletion shard 1/4     success
control-deletion shard 2/4     success
control-deletion shard 3/4     failure
control-deletion shard 4/4     success
control-deletion               failure
```

Shard 3/4's log:

```
control-deletion: shard 3/4: 36 of the manifest's 145 row(s)
control-deletion: baseline green: 21 test file(s), 414 test(s) passed on the unpatched tree
MISS drift-refused | Verify-before-register; drift and unpinned refused | stub applied; "an edited description drifts the tool: refused, the rest admitted" stayed green; "a changed capability tag drifts the tool (every pinned field is inside the hash)" stayed green; "strict (the default): a drifted tool stops the node before it binds, with the refusal logged once" stayed green | 4462 ms
control-deletion: shard 3/4: FAILED — 1 of 36 row(s) did not go red as named (246.4 s)
```

The aggregate's log:

```
control-deletion-plan: success
control-deletion-self-test: success
control-deletion-shard: failure
control-deletion: a job above did not succeed (failed, cancelled or skipped); the proof is incomplete
```

Exactly its shard went red, the other three stayed green (`fail-fast: false`), and the aggregate
failed.

## Review pass (WO §5)

A fresh subagent read the diff against §1 and §2. It found **no High or Medium**: the partition is
total, disjoint and deterministic; every shard runs its baseline before any stub; no failed,
cancelled or skipped shard, plan or self-test can let `control-deletion` pass or be skipped; scope is
clean. One slip on its side: a probe of `--shard 1/4 --self-test --list` ran the self-test (finding
L1). The self-test cleans up its own temporary copies and left the working tree unchanged.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| L1 | Low | `--self-test` ran and ignored everything else on the line | **fixed**: it runs alone; two tests |
| L2 | Low | the `--row`/twice tests asserted the message, not exit 2 | **fixed** |
| L3 | Low | a shard's baseline holds fewer files under the same 240 s limit | recorded above; not changed (what a row proves is the same) |
| I1 | Info | `01/04` was accepted | **fixed**: refused, with a test |
| I2 | Info | a missing value read as the string `undefined` | **fixed**: its own message, with a test |
| I3 | Info | "before anything runs" claimed more than a `--list` test shows | **fixed**: the titles say what is asserted (the refusal is in the argument loop, before the manifest loads) |
| I4 | Info | "a run of all shards is today's run" claimed more than `shardOf(rows, 1, 1)` shows | **fixed**: the title |
| I5 | Info | the CI note's "log ends with …" holds only on success | **fixed**: the note says where a shard's time is read |
| I6 | Info | FEEDBACK did not exist yet | this file |
| I7 | Info | the CHANGELOG entry was uncommitted at review time | committed |
| I8 | Info | the partition test runs only on Linux, not in `npm run check` | recorded above, for you |

## What was not built

- Making the check required (the gate's decision).
- Any change to a row, a stub or what counts as red.
- Running rows concurrently inside one runner.
- `test/deletion/README.md` still lists the runner's usage without `--shard`; it is outside the
  working surface. The runner's own header documents it.
