# FEEDBACK: CSR-WO-2008d (the heap test catches a per-request leak; the deadline fixture has margin)

Branch `wo/CSR-WO-2008d`, cut from `main` at `97c66c5` (contains `-1005c`'s merge). Built on Node
v24.21.0 on Furnace, as `forge`; every commit's author and committer is `clearforgekey[bot]`'s noreply
address. Parked as one unmerged pull request.

## Read this first

- **WO §7 hit, recorded as ruled: no bound separates an argument-only leak from honest growth on CI.**

  | reading of the statelessness test (4,000 requests after 1,000 warm) | Furnace | CI Linux | CI Windows |
  |---|---|---|---|
  | honest, the test itself | −150 to −8 KiB (25 runs) | 340 KiB (once), −8 KiB | −8, −119 KiB |
  | honest, 10-run probe in one process | — | −5,466 to +848 KiB | −5,269 to +807 KiB |
  | each request's arguments retained | 311–330 KiB (5 runs) | — | — |
  | arguments and dispatch context retained | 33,224–33,247 KiB | — | — |

  The argument-only leak (about 80 B a request) sits inside CI's honest spread, so **the bound is 4 MiB
  (operator ruling)**: about 1 KiB a request, against the 16 KiB the old test could see. It catches a
  retained dispatch context with about 5× headroom over CI's worst honest reading. The adversarial pass
  measured the floor: a 1,024 B pad per request reads 4,877–4,883 KiB (red), 512 B 2,657–2,825 KiB (green).
- **The full suite is green on Furnace, 5 of 5,** at load average 10.4–13.2. The canary read warm
  1,962–2,046 ms (at least 6.5 × 300 ms), F2 answered 400 at 322–330 ms, and the heap test −21 to −8 KiB.
- **The deadline tests still drive a real deadline.** `costlyArguments()` now sends 50,000 items (about
  575 KiB, under `maxBodyBytes`); the schema, its manifest entry and `maxSchemaNodes` are unchanged.

  | `costly_schema` warm validation | Furnace (under load) | CI Linux | CI Windows |
  |---|---|---|---|
  | 20,000 items (before) | 770–1,104 ms | 1,147–2,002 ms | 1,147–2,107 ms |
  | 50,000 items (now) | 1,885–2,904 ms | 3,230–3,314 ms | 4,296–5,109 ms |

- **The cold path scales with it.** `validation-deadline`'s row (which runs cold validations to
  completion under its stub) takes 64 s on Furnace (25 s before) and 89–118 s on CI (52 s before),
  under the runner's 240 s. It pushed its shard to 311 s at 16 shards. At 18 its shard (4/18) read
  230, 267 and 305 s across three runs, so **`CONTROL_DELETION_SHARDS` is 22 (operator rulings;
  `.github/**` was fenced)**: see *Gates* for the run at 22.

## How the heap test now measures (§1.1)

- 1,000 warm-up requests, then 4,000 measured in two halves; the test helper's own audit lines are
  cleared at each half, since they are the test's retention, not the transport's; three collection
  passes before, between and after.
- Measured, not guessed: one pass over all 4,000 spread −135 to +108 KiB on Furnace; with the
  collection between the halves, −150 to −23 KiB, always below the leak. Total growth, not the second
  half alone: the two halves are anticorrelated (one rises when the other falls).
- The red-proofs, planted by hand at `dispatch.ts`'s `const args = …` and reverted: arguments plus
  context red by assertion on Furnace; arguments alone 311–330 KiB, green under the ruled bound.
- To get CI's distribution, one push carried a temporary probe that ran the measurement 10 times per
  runner (allowlisted, then removed before the pull request was parked).

## -1005c's findings, promoted

| -1005c finding | Durable home |
|---|---|
| 1: a fresh server's first call waits for priming | needs-none (F2 makes one answered call first) |
| 2: two pool test seams | needs-none |
| 3: six stubs regenerated | needs-none (merged) |
| 4: the 100 ms sweep floor | needs-none |
| 5: era-status keeps its `deadline` server | needs-none |

## Findings

Schema: *finding · where · type · recommendation · decision-needed*.

1. **The statelessness test cannot see an argument-only leak on CI** (*Read this first*). · test
   strength · A measurement with less CI noise (a heap snapshot's object count, or many more requests)
   would; it is a new design, not a bound. · *decision-needed: yes*
2. **The canary times the validator on the main thread; the deadline tests time it in a worker**
   (adversarial pass). A worker-only slowdown or speedup would not show in the canary. · note ·
   *decision-needed: no*
3. **A validator that caches by an item's shape would make the fixture cheap**, since `required` never
   reads `k`'s value (adversarial pass). The canary would then fail as itself, naming the cause
   (*the deadline tests can no longer drive the deadline*), not leave F2 to fail with a 200. · note ·
   *decision-needed: no*
4. **The heap test exercises one tool with a short argument** (adversarial pass); a leak only on large
   arguments or on an error path is not exercised. · note · *decision-needed: no*

## Adversarial pass (WO §5)

A fresh subagent at `4ffbaab`: the leak floor (finding 1's numbers: 1,024 B red, 512 B green; a
`"x".repeat(K)` pad is a rope and barely registers, so it used real heap arrays), and the fixture
(findings 2–4). It also reported that `costlyArguments()` builds 20,000 items; at `4ffbaab` it builds
50,000 (checked), so that point is set aside.

## Gates

- `npm run check` on Furnace: green 5 of 5 (detector 21 of 21; core and teaching 951 of 951); spikes 69
  and 8, `test:subset` 4.
- Dependants re-proven with the new input: `validation-deadline` RED 2/2 (64 s), `validation-ready-slot`
  RED; F2 green (322–376 ms); era-status's and corrections' deadline tests green.
- CI at 18 shards: every job green on `4ffbaab` and `e6e5c21`, but validation-deadline's shard read
  230–305 s. At 22: every job green on `3bf0f8b` (runs 46117542085 and 46117545826, push and pull request); shard jobs 90–205 s and 91–250 s.
- Leak gate: `--self-test`, `--tree` and `--history` exit 0 before each push.
- Reduction pass (diff): nothing to remove (the temporary probe is gone; the triple collection is
  measured, not ornament).
- Protected surfaces, against `97c66c5`: `packages/*/src/**`, the steering documents, `scripts/**` and
  every stub diff to empty; `.github/**` is the shard number and its comment (ruled).

## Deliberately not built

- A heap measurement other than heap size (finding 1).
- Any change to the validator, the deadline, the pool or `maxSchemaNodes`.
