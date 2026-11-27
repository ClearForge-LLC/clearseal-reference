# CSR-WO-2008d — The heap test catches a per-request leak, and the deadline fixture has margin on a loaded builder

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD; it must
contain `-1005c`'s merge).
**Branch:** `wo/CSR-WO-2008d`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P2 · **Phase exit gate:** the control-deletion job proves what it claims
(`docs/roadmap.md` P2).
**Grounds:**
- `docs/northstar.md` N5.
- `docs/architecture.md` §8 *Transport hardening* (the statelessness red-proof).
- `-2008b`'s `FEEDBACK.md`, findings 2 and 3, and §1.3.
- Seams: `packages/core/test/transport/limits.test.ts` (*heap growth stays small*),
  `packages/core/test/transport/helpers.ts` (the audit lines it keeps),
  `packages/core/test/fixtures/tools.ts` (`costly_schema`, `COSTLY_BRANCHES`),
  `packages/core/test/fixtures/manifest.json`, `costly-schema.test.ts`.

> **What this is:** two measurements from `-2008b` that are honest but too coarse.
>
> **The heap test.** It now collects for real, but it can see only about 16 KiB retained per request.
> A leak of the arguments, or of the arguments plus the dispatch context, stays green at 1,000
> requests, because honest growth (the helper keeps every audit line) rises with the count and is the
> same size as the leak.
>
> **The canary.** It needs `costly_schema`'s warm validation to last 3 × 300 ms. It fails most runs
> on the builder box (load average about 10, `powersave`; 788–831 ms), so `npm run check` is red
> there on `main`. CI reads 1,147–2,107 ms. The fixture is near `maxSchemaNodes` (1,503 of 2,000).
>
> Neither is a control change.

**Cadence:** build, small. One PR, left unmerged for review.

## 1. Scope — numbered, specific

1. **The heap test measures a slope.**
   - Clear the helper's retained audit lines between phases, or measure them out.
   - Measure growth at n and at 2n requests after a real collection.
   - Assert on the difference, with a bound chosen from the honest distribution on both CI runners
     and the builder box. Report the distribution.
   - **Red-proofs**, each planted by hand in `dispatch.ts` and reverted: retaining the arguments per
     request, and retaining the arguments plus the dispatch context, each turn it red by assertion.
     Honest runs stay green 10 of 10 on each runner.
2. **The canary has margin on a loaded host.**
   - Give `costly_schema` a cost whose warm validation lasts at least 5 × 300 ms on the builder box
     under its normal load, and more on CI.
   - Do it without approaching `maxSchemaNodes`: for example, a larger input set, or a two-level shape
     whose cost multiplies.
   - Measure; do not guess.
   - The tests' assertions do not change. The deadline tests' inputs may change only through
     `costlyArguments()`.
   - Regenerate the manifest entry.
   - `npm run check` is green on the builder box 5 of 5, and the canary's CI lines are reported.
3. **Re-prove the dependants.** F2's bound, `validation-deadline`'s row, and the era-status and
   corrections deadline rows are all still red under their stubs and green honestly. Report the new
   cold and warm costs, which must not make a row's run approach the runner's 240 s row timeout.
4. **`FEEDBACK.md`** per §6.

## 2. Invariants

- **N5.** Every row is still red by assertion; the heap test's new red-proofs are shown.
- **N6.** The leak gate runs before every push.
- **No control changes.** `packages/*/src/**` diffs to empty.
- **Protected surfaces, which must diff to empty:** the steering documents, `scripts/**`, every stub,
  `.github/**`.

## 3. Tests / acceptance

§1.1's red-proofs, §1.2's 5-of-5 run, and §1.3's re-proofs, all with numbers.

## 4. Scope fence

- Any change to the validator, the deadline, the pool or the heap behaviour of `src/**`.
- A new row: the heap test is a red-proof of an existing §8 row, not a control.

## 5. Adversarial pass

A fresh subagent tries:
- a leak size the slope still misses, and reports the smallest one it catches;
- a validator change that would make the new fixture cheap again, and whether the canary then fails
  as itself.

## 5a. Reduction pass

Diff-sized.

## 6. Upward feedback

`FEEDBACK.md`, after promote-or-needs-none of `-1005c`'s.

## 7. Flag-and-stop

- No bound that separates honest growth from the argument leak on both runners.
- A fixture cost that would require changing `maxSchemaNodes` or any `src/**`.
- A secret or a deployment identifier anywhere in the diff.

## 8. Kickoff prompt

`/goal`:
> A request that leaks its arguments turns the statelessness test red, and the full suite is green on
> the builder's own box while the deadline tests still drive a real deadline. Parked as one unmerged
> PR from wo/CSR-WO-2008d.

Kickoff: sync from `main` (confirm `-1005c` is in it); cadence build, small. Read the WO, then
`-2008b`'s findings 2 and 3, which are your own measurements. Commit identity and push path as on
`-2008c`. Report the slope distribution, the smallest leak caught, and the canary's numbers on both
CI runners and the builder box.
