# FEEDBACK: CSR-WO-1005c (a validation's deadline starts when its worker is ready, and a receive timeout fires when it says)

Branch `wo/CSR-WO-1005c`, cut from `main` at `011e271` (contains `-2008c`'s merge `f6080e9` and the docs
PR that widened this WO). Built on Node v24.21.0 on Furnace, as `forge`; every commit's author and
committer is `clearforgekey[bot]`'s noreply address. Parked as one unmerged pull request.

## Read this first

- **The race is fixed in the pool, and no test waits for it.** F2's 500 ms settle is gone: its follow-up
  call goes straight after the timeout and passes. At a 40 ms deadline a call straight after a timeout
  answers 200 in every round: 3 of 3 idle, and 18 of 18 (6 copies × 3 rounds) on 2 cores under load,
  where `-2008b` measured 3 of 3 failing idle at that deadline.
- **Approach (a), by necessity and by measurement.** A slot is offered to `#pump` only once its worker
  is online and has acknowledged every schema it was sent; priming compiles carry negative ids. (b),
  starting the timer when the worker acknowledges a job, needs the worker to acknowledge a job, which
  it does not, and `schema-worker.ts` is protected. Priming, measured with the fixture's 13 schemas:
  71–85 ms idle, at most 453 ms on 2 cores under load.
- **Readiness has its own bound: 5 s** (about 11 times the worst loaded reading). A worker not ready
  within it is replaced and audited as `validation-worker-not-ready`. A queued job waits up to twice
  that for a ready worker (so a replacement gets its whole window), then is refused as a timeout is:
  400 -32602, fail closed. A job queued behind ready workers that are busy waits for them, as before.
- **Behaviour change, §1.5:** both servers now sweep for timed-out requests every second (the
  transport every min(setting, 1 s), at least 100 ms apart). Before and after, measured:

  | server | setting | before (Node's 30 s sweep) | after |
  |---|---|---|---|
  | transport (test value) | 1 s | 30,004–30,011 ms | 2,001–2,003 ms |
  | approval listener | 10 s | 30,006–30,007 ms | 10,010–10,016 ms |
  | transport (production default) | 30 s | 30–60 s | 30–31 s |

  Cost: 0.020 % of a core at 200 open connections with a 1 s sweep (0.004 % at 30 s, 0.056 % at
  250 ms, 0.175 % at 100 ms). The tests now assert the 408 lands within the setting plus one sweep
  plus 500 ms, and wait 10 s and 20 s instead of 45 s.
- **Fences lifted by operator ruling** for §1.4's audit event, each one line: `node/start.ts` passes
  its audit sink to the pool, and `audit/policy.ts` and `audit/RULES.md` list the event.

## -2008c's findings, promoted

| -2008c finding | Durable home |
|---|---|
| 1: the sweep missed controls | needs-none: built in `-2008c` |
| 2: a receive timeout fires on the 30 s sweep | this WO §1.5 |
| 3: the H9 table cases asserted the reason first | needs-none: fixed in `-2008c` |
| 4: `CHECKS.md` clause ids | open: the architect's (no ruling yet) |
| 5: J6's stub stretches | needs-none |
| 6: `drift-refused` gained a name | needs-none: ratified at merge |
| 7: the Windows-only containment test | a later WO (ruled 2026-11-28; `-2008e`'s intent) |
| The five exemptions | needs-none: accepted (ruled 2026-11-28) |

## Findings

Schema: *finding · where · type · recommendation · decision-needed*.

1. **A fresh server's first call now waits for priming before its deadline starts.** · `schema-pool.ts`
   · behaviour · The timer used to start at once and silently included priming. Under 2-core load F2's
   first call took 857–969 ms with the fix, against its 900 ms bound, so F2 now makes one answered
   call before timing (a call, not a sleep). Production waits about 80 ms idle. Recommendation: none. ·
   *decision-needed: no*
2. **Two test seams in the pool.** · `ValidationPoolOptions` · `readyTimeoutMs` and `workerUrl`,
   defaulting to today's values, let the tests plant a worker that never answers, answers once, or
   exits. · *decision-needed: no*
3. **Six existing stubs regenerated.** · `validation-deadline` (its timer lines moved; it deletes the
   same three lines and is RED 2/2), `request-timeout` and `approval-listener-request-timeout` (their
   option line gained the sweep; each still deletes only `requestTimeout`, as §1.5 requires). And,
   caught by the first CI run (shards 2, 6 and 10 red, *no longer applies*), three whose context the
   ruled one-line audit edits moved: `startnode-reads-the-snapshot`, `audit-errname`,
   `audit-sink-digest`. Each deletes exactly the same lines as before (shown by diffing their `-`/`+`
   lines) and is RED. I had re-run only the pool and timeout rows locally; every one of the 316 stubs
   is now checked to apply with `git apply --check`. · *decision-needed: no*
4. **A setting under 100 ms sweeps every 100 ms.** · `server.ts` · Every limit must be a positive
   integer, so 0 cannot reach it; the floor keeps a tiny setting from a 1 ms tick. · *decision-needed:
   no*
5. **era-status keeps its `deadline` server** (§1.2): it reads better, with the deadline row alone on a
   300 ms server and `fast` keeping `handlerTimeoutMs` 100. · *decision-needed: no*

## Rows

New: `validation-ready-slot` (the stub lets `#pump` use an unready worker: the 40 ms test answers 400
in round 1), `validation-ready-rearm`, `validation-worker-exit`, `request-timeout-sweep`,
`approval-listener-sweep`. All eight pool and timeout rows in one invocation, after a green baseline
(6 files, 106 tests):

```
RED  validation-deadline | stub applied; 2/2 named test(s) red by assertion | 25168 ms
RED  request-timeout | stub applied; 1/1 named test(s) red by assertion | 12122 ms
RED  approval-listener-request-timeout | stub applied; 1/1 named test(s) red by assertion | 22067 ms
RED  validation-ready-slot | stub applied; 1/1 named test(s) red by assertion | 3273 ms
RED  request-timeout-sweep | stub applied; 1/1 named test(s) red by assertion | 12100 ms
RED  approval-listener-sweep | stub applied; 1/1 named test(s) red by assertion | 22034 ms
RED  validation-worker-exit | stub applied; 1/1 named test(s) red by assertion | 8653 ms
RED  validation-ready-rearm | stub applied; 1/1 named test(s) red by assertion | 3928 ms
```

(`validation-ready-rearm` first failed by a thrown error rather than an assertion; its test now asserts
the call's outcome, and it was re-run: RED.) The detector is green: 316 rows, all in `rows.lock`.

## Adversarial pass (WO §5)

A fresh subagent, in its own worktree at `a1979f6`, attacked the slot lifecycle with probes. **The
fail-closed invariant held on every path** (priming acks carry negative ids and cannot settle a job;
replies and late events from a replaced worker are inert; a job never reaches a worker lacking its
schema). What it found, and what was done:

1. **should-fix, fixed:** a schema registered after start re-primed a ready slot without re-arming the
   readiness bound, so a worker that then hung was skipped for ever (probe: every call refused, no
   event). Now `#armReady` covers both; test *a schema registered later on a ready worker that then
   hangs …*, red on the pre-fix pool.
2. **should-fix, fixed:** no `exit` handler, so a worker that exited quietly cost each job its full
   deadline. Now replaced at once; test *a ready worker that exits without an error …*, red on the
   pre-fix pool.
3. **note, fixed:** a worker that cannot compile a schema respawned in a loop; now it stays unready and
   is replaced once per readiness bound, audited.
4. **note, fixed:** the sweep floor (finding 4).
5. Checked and found fine: `close()` during priming; two timeouts back to back on a one-worker pool
   with a call queued behind them; the moment between ready and assignment (assignment is synchronous).

## Gates

- `npm run check` on Node v24.21.0, on Furnace: lint, typecheck and build green; the detector 21 of 21;
  core and teaching 950 of 951, the one failure being the canary (`warm=803ms`, `-2008d`'s); later
  stages by hand: spike 0102 69, spike 0101 8, `test:subset` 4. `control-deletion --self-test` passes.
- CI: the first run on `3ee3ef4` failed shards 2, 6 and 10 on the three stubs in finding 3, with every
  other job green and every shard under five minutes (114–245 s). The pull request's later runs are
  the evidence.
- Leak gate: `--self-test`, `--tree` and `--history` exit 0 before each push.
- Reduction pass (diff): −1 export (`READY_TIMEOUT_MS` is module-private) · 0 duplicates · 0 dead
  paths · 0 protected kept · 0 findings.
- Protected surfaces, against `011e271`: `src/**` changes only in `schema-pool.ts`, the two
  `createServer` option lines (with a comment line each) and the three ruled one-line audit edits;
  `scripts/**`, `.github/**` and the steering documents diff to empty; existing stubs change only as
  finding 3 says.

## Deliberately not built

- Any change to the deadline's value or default, the validator, the pool size, or the canary and heap
  test (`-2008d`).
- A worker change for approach (b) (`schema-worker.ts` is protected).
