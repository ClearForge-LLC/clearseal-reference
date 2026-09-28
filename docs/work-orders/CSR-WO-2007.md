# CSR-WO-2007 — Tripwire and rate limit, as two controls: a read burst is recorded loudly and refused nothing; a principal over its budget is refused with `429` and nobody else is

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (must contain `-2008a`, merged `712d832`).
**Branch:** `wo/CSR-WO-2007`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P2 · **Phase exit gate (the clauses this WO owns):** §8 rows *Tripwire (read burst, loud, no
refusal)* and *Rate limit (per principal, refuses)* read *built* with their red-proofs named, each with
`-2008` rows.
**Grounds:** the ClearSeal standard at the pinned edition (`66b640d`) §8 #9 — cite the sentences you
implement; `docs/architecture.md` §5 *Tripwire and rate limit* (two controls, not one), §7.1 rows *A
prompt-injected model*, *A compromised or impostor client*, *A hostile authenticated principal*, *A
stolen bearer token*, §8 rows named above; §2.2 (the reference node's rate limiter is treated as unbuilt
— this is designed fresh).

> **What this is:** two controls the genesis draft had conflated. The **tripwire** watches for one
> principal reading unusually fast — the shape of a prompt-injected model sweeping everything it can
> see — and writes one loud audit event per burst. It refuses nothing, because a false alarm that
> refused would be a denial of service the node inflicted on itself. The **rate limit** is a
> per-principal budget: over it, that principal's requests are refused with `429` and `Retry-After`,
> and every other principal is untouched, because the refusal is bounded to the one doing the
> hammering. Both key on the verified principal (`sub`), so both sit after authentication. It is NOT
> caller entitlement (P6), NOT a global limiter (a node-wide flood is the transport's concurrency cap
> and the operator's edge), and NOT an alerting channel (the tripwire's event goes to the audit store;
> delivering it to a human is a notifier's job, later).

**Cadence:** build, spec-first: a `RULES.md` beside each module first, one rule per line with its
red-proof. One PR, left unmerged for review. **Adversarial discipline:** build each control and a
regression test for each documented case below; a fresh review subagent checks the diff against §1 and
§2. No open-ended attack pass (that is the external red team's).

## 1. Scope — numbered, specific

1. **Rate limit** (`packages/core/src/rate-limit/`): a per-principal budget — choose the algorithm (a
   token bucket is the default expectation), record why. It runs after authentication and before
   dispatch; every authenticated request counts, whatever its method. Over budget: HTTP `429`, a
   `Retry-After` header in whole seconds (rounded up, at least 1), a JSON-RPC error body in the era's
   shape, and one `rate-limited` audit row with the principal. Unauthenticated requests are refused by
   auth first and do not touch any principal's budget. Time comes from a monotonic clock, injectable
   for tests — never the wall clock.
2. **The limiter's memory is bounded.** State for principals is capped (a stated number); idle state
   is dropped when it can no longer affect a decision; what happens at the cap is chosen so that it can
   neither refuse an innocent principal nor reset a limited one's budget — choose, record why, prove.
3. **Tripwire** (`packages/core/src/tripwire/`): counts, per principal, `tools/call` requests that name
   a `read_only` tool and pass admission (choose whether refused calls count, record why). When one
   principal's count in a sliding window crosses the threshold, it writes **exactly one**
   `tripwire-read-burst` audit row (principal, count, window) for that burst, and re-arms only after a
   stated quiet period. It never refuses, delays or alters a call. Its memory is bounded as in §1.2.
4. **Settings.** Budget, refill, window, threshold, quiet period and the state caps are operator
   settings read in the `-1007b` snapshot (`node/settings.ts`), validated (a zero or negative value
   refuses start), with defaults that no honest single client hits and that the existing suite does
   not trip — state each default and why. The `process.env` inventory test names the new reads.
5. **Audit.** The two new events join `audit/RULES.md`'s event table and the policy: each field listed,
   no bare values (the principal is carried as every row carries it).
6. **Control-deletion rows** for §1.1–§1.3, and **`FEEDBACK.md`** per §6.

## 2. Invariants

- **N4**: a principal over budget is refused and the refusal recorded; a read burst is recorded.
- **The tripwire refuses nothing**: proven by a test that drives a burst and sees every call answered
  exactly as it would be with the tripwire removed.
- **One principal's limit never touches another's**: proven by test.
- **N5**: every rule has a red-proof and a `-2008` row.

**Protected surfaces (must diff to empty):** the four steering documents, `LICENSE`, `NOTICE`,
`spikes/**`, `docs/canonical-form.md`, `pinning/**`, `capability/**`, `containment/**`, `auth/**`,
`audit/**` except `RULES.md` and the event policy, `packages/core/test/boundary/**`, `.github/**`.
Working surface: the two new modules, `transport/server.ts` and `transport/dispatch.ts` where the two
controls are called (no change to any existing refusal), `node/settings.ts` for the new settings,
`index.ts` export lines, `.env.example`, `packages/teaching/README.md`, tests, `test/deletion/**`.

## 3. Tests / acceptance

1. `npm run check` green on both runners; both leak-gate modes exit 0; every control-deletion shard and
   the aggregate green.
2. Documented cases, each a test, each pasted:
   - principal A over budget → `429`, `Retry-After`, a `rate-limited` row; principal B at the same
     moment → served;
   - A's budget refills with the clock and A is served again;
   - a burst of `read_only` calls by A → exactly one `tripwire-read-burst` row, every call answered as
     without the tripwire; a second burst after the quiet period → a second row; continued reading
     inside one burst → no further rows;
   - calls to a non-`read_only` tool do not count toward the tripwire;
   - state caps: filling the limiter and the tripwire with many principals neither refuses a fresh
     honest principal nor resets a limited one;
   - each invalid setting refuses start with its name;
   - the defaults, run against the full P1 evidence suite, trip nothing.
3. Red-proofs for every rule: pasted.

## 4. Scope fence

- **Caller entitlement** (P6). **A global or unauthenticated limiter.**
- **Delivering alerts** (a notifier; the tripwire writes to the audit store only).
- **Adaptive or learned thresholds.** Fixed, operator-set numbers.
- **Any change to an existing refusal's status, message or order.**

## 5. Review pass

A fresh subagent reads the diff against §1 and §2: the limiter runs after auth and before dispatch on
every path; no path lets the tripwire refuse or delay; the memory bounds hold; the clock is monotonic
and injected; no setting is read outside the snapshot.

## 6. Upward-feedback directive

`FEEDBACK.md`: gates line, the pastes in §3, the choices in §1.1–§1.4 with reasons and every default
with its reason, the standard's sentences with their rules, review findings, what was not built.

## 7. Flag-and-stop conditions

- The standard's text at `66b640d` requires something §1 does not, or forbids something it allows —
  quote it and stop.
- Placing either control needs a change to an existing refusal or a protected module.
- A protected surface must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-2007` off current `main` where a per-principal rate limit after authentication
> refuses an over-budget principal with 429 and Retry-After while every other principal is served, a
> tripwire writes exactly one loud audit event per read burst and never refuses or alters a call, both
> keep bounded memory and use an injected monotonic clock, their settings are read in the snapshot and
> validated, every documented case in the WO is a test, control-deletion rows exist for every rule,
> `npm run check` is green on both runners, and the work is parked as one unmerged pull request. Stop at
> parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-2007 origin/main`. Node 24.21.0. Cadence:
> **build**, spec-first. Read `docs/work-orders/CSR-WO-2007.md` in full, the standard's §8 #9 at the
> pinned edition, and `docs/architecture.md` §5 *Tripwire and rate limit* and §7.1. Regression tests for
> the documented cases and a review subagent, no open-ended attack pass. Leak gate before every push,
> exit code checked directly. Report the PR link and the pastes.
