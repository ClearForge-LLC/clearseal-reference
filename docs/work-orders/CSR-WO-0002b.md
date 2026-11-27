# CSR-WO-0002b — The dependency bot's backlog, landed from a branch the bot cannot close

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD; the
base must contain `6f442fd`, the actions group merged from #76 on 2026-11-27).
**Branch:** `wo/CSR-WO-0002b` — ours, not the bot's.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** maintenance (`docs/roadmap.md`, *Maintenance is a cadence, not a hope*).
**Grounds:** `docs/northstar.md` N5, N6; `docs/architecture.md` §2.3 and the *Served protocol
revisions* row (it records `z-schema` 12.4.6 as the core's one runtime dependency); `-0002a`; the
gate's ruling of 2026-11-27 (below). Seams: `package.json`, `package-lock.json`,
`packages/core/package.json`, the spikes' `package.json` files, `packages/core/test/**`.

> **What this is:** the npm group pull request has failed CI every week since 2026-10-02, and each
> week the bot closed it and opened a fresh one. A one-line fix was pushed onto the bot's branch on
> 2026-10-07 (`4d84f80a`, made #74 green) and was lost when the bot superseded #74 two days later;
> every pull request since has failed on the same line. The current one, #81, also fails
> `control-deletion` shard 2/4, and because lint runs first in `npm run check`, the test suite itself
> has not run against SDK 1.31 or later on CI. **The gate's ruling, 2026-11-27:** merge the actions
> group (#76, done), and land the npm side from a branch of our own, so the bot cannot drop it. This
> work order takes #81's versions, makes them pass, and parks. It is NOT a change to any control, and
> NOT a semver-major bump of anything (the `typescript` and `@types/node` ignore rules stand).

**Cadence:** build, small. One PR, left unmerged for review.

## 0. What is already measured (architect, 2026-11-27, from #81's CI at head `fa8dc081`)

- **Lint, both `test` jobs:** `packages/core/test/auth/verifier.test.ts:104` —
  `@typescript-eslint/no-unnecessary-type-assertion` on `.jwk as never`. The jwk is
  `Record<string, unknown>`, which already satisfies `node:crypto`'s `JsonWebKey`. The fix is the
  removal `4d84f80a` made.
- **Shard 2/4 is a baseline failure, not a stub miss.** The runner stopped before any stub: on the
  *unpatched* tree, `packages/core/test/transport/adversarial.test.ts` →
  *"F2 validation runs off the event loop under a deadline"* →
  *"a quadratic validation is abandoned at validationTimeoutMs with 400 -32602, and /health answers
  meanwhile"* fails `assert.equal(r.status, 400)`. Shard 2 is where that test's row lands; shards 1, 3
  and 4 pass. #80 (z-schema 12.5.0) passed shard 2; #81 moves `z-schema` to 12.8.0.
- **Inferred, unproven:** the `costly_schema` fixture (`uniqueItems` over 20,000 objects) is no
  longer costly under z-schema 12.8 — the validator likely stopped being quadratic there — so the
  call validates inside 300 ms and answers 200. The control (the deadline in `schema-pool.ts`, the
  `validation-timeout` audit) may be intact while the test can no longer drive it. §1.3 proves or
  refutes this before anything changes.

## 1. Scope — numbered, specific

1. **Versions.** Take exactly the ten bumps of #81 at `fa8dc081` (SDK 1.30.1 → 1.32.2, z-schema
   12.4.6 → 12.8.0, typescript-eslint 8.74.0, eslint 10.15.0, @types/node 24.19.2, fast-check 4.11.0,
   oidc-provider 9.15.1, http-message-signatures 1.1.1, jose 6.2.18, structured-headers 2.1.1) into
   the same files, regenerated with `npm install` under Node 24.21.0. Cherry-picking the bot's commit
   is fine; its `Signed-off-by` passes the gate (`-0002a`). If the bot opens a newer group PR while
   this is building, do not chase it: #81's set is the scope.
2. **Lint.** Remove `as never` at `verifier.test.ts:104`. No suppression, no config change.
3. **Shard 2 — measure, then fix.** (a) Run the test under 12.6.x, 12.7.x and 12.8.0 and record the
   `VALIDATION-DEADLINE` line each prints; name the release that changed it and quote its changelog
   line. (b) If the fixture lost its cost: give `costly_schema` an input schema whose validation cost
   12.8.0 cannot shortcut, measured to exceed the 300 ms deadline on both CI runners by a wide margin
   (record the uncapped time), and regenerate `test/fixtures/manifest.json`'s hash for it. The
   test's assertions do not change. (c) If instead the deadline itself no longer fires: **stop** (§7).
4. **Every shard and the full suite** green on the new versions: `npm run check` and
   `node scripts/control-deletion.mjs --shard i/4` for i = 1..4, plus `--self-test`.
5. **The SDK, 1.30.1 → 1.32.2.** Summarise both minor releases' changelogs for what this repository
   touches: the stateless transport, protocol revisions (re-probe what the SDK serves, as
   `-0100` did, and what `server/discover` answers), MRTR and elicitation, `_meta`, and OAuth/bearer
   auth — including the five advisories 1.32.x fixes. Say for each whether a test here covers it.
6. **Transitive advisories.** After §1.1, `npm audit` reports seven under the SDK (body-parser, zod,
   hono, @hono/node-server, fast-uri, qs, ip-address), each with a non-major fix. Refresh them in the
   lockfile only (`npm update <names>`); no `package.json` range moves for them. Paste `npm audit`
   before and after.
7. **`FEEDBACK.md`** per §6.

## 2. Invariants

- **N5** — no row, stub or control changes; every row still goes red by assertion. If the fixture
  changes, the row whose stub deletes the validation deadline must still turn that test red: show it
  with `--row` on that row.
- **N6** — leak gate before every push.
- The shipped core keeps exactly one runtime dependency (`z-schema`).

**Protected surfaces — must diff to empty:** the four steering documents, `LICENSE`, `NOTICE`,
`packages/*/src/**`, `scripts/**`, `test/deletion/**`, `.github/**`, `.npmrc`, `.node-version`,
the governance files.

## 3. Tests / acceptance

1. `npm run check` exits 0 on Node 24.21.0; test counts against `main`'s.
2. Each of the four shards and the self-test pass locally and in CI; the aggregate
   `control-deletion` is green.
3. The §1.3 table of `VALIDATION-DEADLINE` lines by z-schema version, and (if the fixture changed)
   its uncapped validation time on each runner.
4. The deadline row turned red with the new fixture (`--row`), pasted.
5. `npm audit` before and after §1.6.
6. All CI jobs green on the PR.

## 4. Scope fence

- Any semver-major bump, or any version beyond #81's set (§1.6's lockfile refresh aside).
- Any change to a control, a limit default (`validationTimeoutMs` stays 2,000; the test's 300 stays),
  or a test's assertions.
- Pushing to, commenting on, or closing the bot's pull request. When this merges, the bot closes #81
  as up to date by itself.
- The `audit` job's report-only setting, `dependabot.yml`, and `CODEOWNERS`.

## 5. Adversarial pass

1. A new fixture that is slow only on the builder's machine: show the CI log's
   `VALIDATION-DEADLINE` line on both runners.
2. A fixture slow because of something other than validation (parse, transport): the audit must say
   `validation-timeout`, as the test already asserts.
3. Run the deadline test with the 12.4.6 lockfile and the new fixture: it must still pass, so the
   fixture does not depend on a validator version.

## 6. Upward-feedback directive

`FEEDBACK.md`: gates line (counts, the four shard runs, self-test, CI links), the §1.3 table and
changelog quote, the §1.5 SDK summary with the re-probed revisions, the `npm audit` before and after,
and the standard entries. The architect updates `architecture.md` (the `z-schema` version in the
*Served protocol revisions* row, §2.3 if the served revisions moved) from it after review.

## 7. Flag-and-stop conditions

- §1.3(a) shows the deadline no longer fires on a costly validation (the control broke, not the
  fixture).
- No fixture exceeds the deadline under 12.8.0 without leaving the schema limits the registry
  enforces.
- The SDK re-probe shows the served revisions changed.
- A protected surface must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-0002b` off current `main` carrying exactly the ten version bumps of the bot's
> #81, with the unnecessary assertion at `verifier.test.ts:104` removed, the shard-2 baseline failure
> explained by measurement and fixed in the test fixture (or flagged per WO §7 if the deadline itself
> broke), every control-deletion shard and the full suite green, the SDK 1.31/1.32 changes summarised
> for this repository's surface, the seven transitive advisories refreshed in the lockfile, and the
> work parked as one unmerged pull request. Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-0002b origin/main`; confirm `6f442fd` is in
> the base. Cadence: **build, small**. Read `docs/work-orders/CSR-WO-0002b.md` in full, §0 first:
> the shard-2 failure is a baseline failure in the validation-deadline test, already located. Measure
> before fixing. Do not touch the bot's PR. Leak gate before every push. Flag-and-stop: WO §7. Report
> the PR link, the §1.3 table, and the four shard results.
