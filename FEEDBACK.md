# FEEDBACK — CSR-WO-0000 (repository skeleton)

Branch `wo/CSR-WO-0000`, based on `main` at `e2417e2`. Parked as one unmerged pull request.

## Crossed or parked

**Nothing crossed. No flag-and-stop condition fired.** Type stripping ran the suite with no fallback;
no dependency needed an install script; no step needed a secret; no protected surface changed;
both actions pinned to a commit SHA. **The adversarial pass found one high-severity hole in the N5
gate: skipped or todo-only tests passed the wrapper. It is fixed and proven in this PR (finding 3,
commit `1187e09`).** Three things need a decision: finding 1 (ESLint 10), A4 (a policy on inline lint suppressions) and A21 (the core's export target before any port). None blocks this PR.

## Gates line

| Gate | Result |
|---|---|
| typecheck | root `tsc -p tsconfig.json` (the root JS, `checkJs`) then `tsc -p tsconfig.json` in `packages/core`: pass (TypeScript 6.0.3) |
| lint | `eslint --max-warnings 0 .`: pass, 0 problems |
| test count | exactly **1** test, 1 file, on the fresh clone and on both runners |
| CI red (deliberate, §3.3) | <https://github.com/ClearForge-LLC/clearseal-reference/actions/runs/36072741330>: commit `03e96d1`, `test (ubuntu-latest)` **failure**, `test (windows-latest)` **failure** |
| CI green (revert of the red) | <https://github.com/ClearForge-LLC/clearseal-reference/actions/runs/36072827446>: commit `28d3785`, both runners **success** |
| CI green (final code commit, after the adversarial fixes) | <https://github.com/ClearForge-LLC/clearseal-reference/actions/runs/36073428275>: commit `1187e09`, both runners **success**, `test: 1 file(s), 1 test(s) passed` on each |
| CI green (first push, before the red) | <https://github.com/ClearForge-LLC/clearseal-reference/actions/runs/36072640935>: commit `1e3c7b0`, both **success** |
| Windows path probe (§5.3) | <https://github.com/ClearForge-LLC/clearseal-reference/actions/runs/36072957091>: throwaway branch, both **success** |
| Protected surfaces | `git diff origin/main --stat -- docs README.md LICENSE NOTICE` is **empty** |
| Node in CI | `node --version` prints `v24.21.0` on both runners (setup-node reads `.node-version`) |

The commit that adds this file triggers its own CI run. It changes no source, and its result shows
on the PR's checks.

## Findings

Schema: `finding · where · type · recommendation · decision-needed`.

1. **ESLint 9 is out of support.** `npm ci` prints `npm warn deprecated eslint@9.39.5: This
   version is no longer supported.` The WO mandates ESLint 9, so 9.39.5 (the last 9.x) is pinned.
   · `package.json` devDependencies · risk · Rule on moving to ESLint 10. typescript-eslint 8.70.1
   already accepts `^10.0.0` as a peer, so it would be a one-line bump plus re-verification.
   · **decision-needed: yes**
2. **TypeScript 7 is excluded by typescript-eslint's peer range.** The latest `typescript` is 7.0.2,
   but typescript-eslint 8.70.1 declares `typescript >=4.8.4 <6.1.0`. I pinned 6.0.3, the newest
   version in range. `erasableSyntaxOnly` is present in 6.0. · `package.json` · note · Keep 6.0.x
   until typescript-eslint widens its range. Record this so no one "upgrades" into a peer conflict.
   · decision-needed: no
3. **`node --test` has three ways to pass while running nothing.** On Node 24.21.0: (a) a file that
   registers no tests is reported as one `test:pass` named after the file, and the aggregate
   summary reads `tests 1, pass 1`; (b) the CLI exits 0 on a glob that matches nothing; (c)
   **skipped and todo tests count toward `tests`**. So a file holding only `test.skip`/`test.todo`,
   a `{ skip: true }` option, or a runtime `t.skip()` before a throwing assertion all passed the
   first version of the wrapper. That is severity **high**, found by the adversarial pass. The
   wrapper now requires a per-file `test:summary` with `passed > 0` for **every** matched file, and
   `passed === tests` with zero cancelled, skipped and todo overall. The condition is written as
   the condition to *pass*, so a missing count compares false and fails closed (see finding 12).
   · `scripts/test.mjs:48-73` · bug (fixed in this PR, `1187e09`) · Keep both rules. Collapsing
   either to "the aggregate test count is non-zero" would silently reopen N5. · decision-needed: no
4. **`no-floating-promises` flags `node:test`'s own `test()` call** because it returns a promise.
   The single test is written `void test(...)`, which marks it deliberately unawaited. The rule
   stays at `error`. · `packages/core/test/index.test.ts:6` · note · Keep `void test(...)` as the
   house idiom; don't relax the rule for tests. · decision-needed: no
5. **The WO's lockfile-disagreement probe needs the right edit.** Changing the lock's copy of the
   root `devDependencies` (`packages[""]`) alone does **not** make `npm ci` fail (exit 0), because
   npm checks the *resolved* tree against `package.json`. Changing the resolved
   `node_modules/typescript` version to `6.0.2` does fail: `EUSAGE … lock file's typescript@6.0.2
   does not satisfy typescript@6.0.3`, exit 1. · WO §3.5 · note · If a later WO reuses this probe,
   specify the resolved-entry edit. · decision-needed: no
6. **The WO's install-script grep has a false positive.** It matches one line,
   `node_modules/fast-levenshtein/package.json:23: "grunt-npm-install": "~0.1.0"`, which is a
   *devDependency named* `…install`, not a script. The lockfile's `hasInstallScript` count is **0**,
   and a scan of every installed `package.json` finds **0** `preinstall`/`install`/`postinstall`
   scripts and **14** `prepare` scripts (npm does not run `prepare` for registry tarballs). So today
   `ignore-scripts=true` suppresses nothing. It guards the next dependency, not this tree.
   · WO §3.6 · note · Use `jq` over `package-lock.json` for `hasInstallScript` in future counts.
   · decision-needed: no
7. **CSR-WO-0001 inherits: the leak gate must allowlist `uses:` lines in `.github/workflows/`.**
   Every action pin is a 40-hex commit SHA (listing below), which a naive high-entropy or hex rule
   will flag. · `.github/workflows/ci.yml:18,21` · note · `-0001` should allowlist only the
   `uses: <owner>/<repo>@<40-hex> # vX.Y.Z` shape, not all of `.github/`. · decision-needed: no
8. **Base moved from what the WO text states.** The WO header and §8 kickoff say base `2b96f08`.
   Live `main` was `e2417e2`, the merge that added this WO and the §2.1 amendment, and it matches
   the kickoff message as sent. · `docs/work-orders/CSR-WO-0000.md` header · note · Expected; no
   action. · decision-needed: no
9. **Two small additions to §1.7's CI shape.** `fail-fast: false` on the matrix, so a red Ubuntu
   job can't cancel Windows before Windows shows its own red (§3.3 needs both observed failing).
   `persist-credentials: false` on checkout, so the job token isn't left in `.git/config` for later
   steps. · `.github/workflows/ci.yml:13,20` · note · Keep both. · decision-needed: no
10. **Two small additions to §1.3's tsconfig.** `allowImportingTsExtensions` is needed so the test
    can import `../src/index.ts` by the extension that type stripping requires at runtime; it is
    only legal with `noEmit`, which the WO mandates. `types: ["node"]` is set explicitly because
    the tests use `node:test`/`node:assert`. · `tsconfig.base.json` · note · Keep both.
    · decision-needed: no
11. **Lint didn't see the N5 gate itself (fixed).** Type-checked rules applied only to `**/*.ts`,
    so a floating promise in `scripts/test.mjs` linted clean (exit 0). This was medium severity,
    from the adversarial pass. A root `tsconfig.json` now type-checks `scripts/**/*.mjs` and
    `eslint.config.js` with `allowJs`/`checkJs` (same strict base), the root `typecheck` script runs
    it, and the type-checked lint block covers `.js`/`.mjs`. Proven: the planted floating promise
    now fails lint with `no-floating-promises`, exit 1. · `tsconfig.json`, `eslint.config.js:8`,
    `package.json:12` · bug (fixed in this PR) · Keep. A root tsconfig was not in §1.3's list; it
    is the smallest change that puts the gate script under the same checks as the code it gates.
    · decision-needed: no
12. **`@types/node` 24.13.6 omits `failed` from the `test:summary` counts type**, although the
    runtime emits it (probed: `"failed":1` on a failing file). A wrapper written as
    `failed + cancelled + … > 0` would compute `NaN` if the field were ever absent, and `NaN > 0`
    is false, so it would fail open. The check is written as `passed === tests && …`, which does not
    read `failed`. · `scripts/test.mjs:26-28` · risk (designed around) · When control code consumes
    runtime event shapes, write conditions that fail closed on a missing field. · decision-needed: no
13. **Commit identity.** Branch commits are authored as a role identity (`Claude (builder)`,
    following the `Claude (architect)` precedent on `main`), not a person's name. The
    `Claude-Session:` trailer a default attribution would add was left off because it carries a
    session identifier (N6). · commit metadata · note · Consider stating the builder commit
    identity in the WO template. · decision-needed: no

## What did not work, and why

- **Type stripping: worked first time, no fallback.** Node 24.21.0 ran `.ts` tests directly. **No
  `ExperimentalWarning` printed** on the fresh clone, on the Ubuntu runner, or on the Windows
  runner. No `tsx` or other transform was added.
- **The first `npm run check` failed lint** (finding 4). Fixed by `void test(...)`, not by
  relaxing the rule.
- **The first lockfile-disagreement edit didn't fail `npm ci`** (finding 5). A second, correct edit did.
- **The first wrapper let skipped and todo tests pass** (finding 3), and **lint didn't cover the
  wrapper** (finding 11). The adversarial pass caught both; both are fixed and proven red.
- **A builder slip, caught and repaired before any commit.** While restoring a planted
  floating-promise probe, I used `git checkout -- scripts/test.mjs`, which also discarded the
  uncommitted wrapper fix. I noticed it from `git status`, rewrote the file, and **re-ran the whole
  probe matrix against the rewritten file**. Every restore after that was from a byte-compared
  backup. The committed `1187e09` is the re-proven version.
- **The builder environment's default `node` is not 24.21.0**, so every local command ran on
  v24.21.0 installed through the environment's version manager (checksum verified by the
  installer). The pin was not loosened.

## Acceptance evidence (WO §3)

**§3.1 and §3.2: fresh clone** (a new `git clone` of the branch, not the build worktree), at
`1187e09`, the final code commit:

```
$ node --version
v24.21.0
$ npm --version
11.19.0
$ npm ci
npm warn deprecated eslint@9.39.5: This version is no longer supported. Please see https://eslint.org/version-support for other options.

added 111 packages, and audited 113 packages in 812ms

found 0 vulnerabilities
npm ci exit=0
$ npm run check

> check
> npm run typecheck && npm run lint && npm run test

> typecheck
> tsc -p tsconfig.json && npm run typecheck --workspaces

> @clearseal/core@0.0.0 typecheck
> tsc -p tsconfig.json

> lint
> eslint --max-warnings 0 .

> test
> node scripts/test.mjs

✔ PACKAGE_NAME is the published package name (0.74543ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 85.2746
test: 1 file(s), 1 test(s) passed
check exit=0
```

**§3.3: CI goes red.** Commit `03e96d1` changed the assertion to expect `"deliberately-wrong"`.
Both runners failed on it (run 36072741330); excerpt from the failed-job logs:

```
test (ubuntu-latest)    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
test (ubuntu-latest)      actual: '@clearseal/core',
test (ubuntu-latest)      expected: 'deliberately-wrong',
test (ubuntu-latest)    test: FAIL — 1 failed, 0 cancelled
test (ubuntu-latest)    ##[error]Process completed with exit code 1.
test (windows-latest)   test: FAIL — 1 failed, 0 cancelled
test (windows-latest)     actual: '@clearseal/core',
test (windows-latest)     expected: 'deliberately-wrong',
test (windows-latest)   ##[error]Process completed with exit code 1.
```

The red commit ran the first version of the wrapper, so its failure line reads `1 failed,
0 cancelled`; the current wrapper words it `0 of 1 passed (…)`. It was reverted by the follow-up
commit `28d3785` (not force-pushed away). That commit is green on both runners (run 36072827446).

**§3.4: zero matched files.**

```
$ node scripts/test.mjs "nomatch/**/*.test.ts"
test: no files match nomatch/**/*.test.ts — refusing to pass on zero tests
exit=1
```

**§3.5: lockfile disagreement** (restored afterwards; `npm ci` then exit 0, tree clean):

```
-      "version": "6.0.3",
+      "version": "6.0.2",
npm error code EUSAGE
npm error `npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync. Please update your lock file with `npm install` before continuing.
npm error Invalid: lock file's typescript@6.0.2 does not satisfy typescript@6.0.3
npm ci exit=1
```

**§3.6: install-script grep**, verbatim, then the reconciliation (finding 6):

```
$ grep -rn "postinstall\|preinstall\|install\"" node_modules/*/package.json node_modules/@*/*/package.json
node_modules/fast-levenshtein/package.json:23:    "grunt-npm-install": "~0.1.0",
matching files: 1  (a devDependency name, not a script)
lockfile entries with hasInstallScript: 0
installed packages declaring pre/post/install: 0 · declaring prepare: 14
```

**§3.7:** both runners green on the final code commit `1187e09` (run 36073428275). The run on the commit that
adds this file shows on the PR.

## Action-pin listing (§5.4)

```
$ grep -n "uses:" .github/workflows/*.yml
.github/workflows/ci.yml:18:      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
.github/workflows/ci.yml:21:      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
```

Both tags are lightweight tags that point directly at those commits. They were resolved through the
GitHub API (`git/ref/tags/<tag>` → `object.type: commit`). Both actions declare `using: node24` at
the pinned SHA. The pinned `setup-node` supports `node-version-file` and `cache`.

## Adversarial pass (WO §5)

Delegated to a fresh subagent working on its own fresh clone of the branch at `28d3785`, framed
as an attack, with no push rights. I reproduced its top two findings myself before acting on them.
Its report said FEEDBACK.md was missing; that is expected, because this file lands in the
commit after the fixes. Every row below is from that pass, with my disposition.

**Fixed in this PR, and proven red afterwards** (on `1187e09`'s wrapper, each command's exit code):

| Shape planted in `packages/core/test/index.test.ts` | Exit | Wrapper says |
|---|---|---|
| only `test.skip(...)` | 1 | `0 of 1 passed (0 cancelled, 1 skipped, 0 todo)` |
| only `test.todo(...)` | 1 | `0 of 1 passed (0 cancelled, 0 skipped, 1 todo)` |
| only `test(..., { skip: true }, ...)` | 1 | `0 of 1 passed (… 1 skipped …)` |
| `t.skip()` then a throwing assertion | 1 | `0 of 1 passed (… 1 skipped …)` |
| one passing test plus one `test.skip` | 1 | `1 of 2 passed (… 1 skipped …)` |
| a failing assertion | 1 | `0 of 1 passed …` |
| import of `node:test` only, no tests | 1 | `… passed no tests`, `zero tests passed` |
| empty file | 1 | `… passed no tests` |
| glob matching nothing | 1 | `no files match … refusing to pass on zero tests` |
| floating promise appended to `scripts/test.mjs` (lint) | 1 | `@typescript-eslint/no-floating-promises` |

**Findings table.** Schema: `finding · where · severity · type · recommendation · disposition`.

| # | Finding | Where | Sev. | Type | Recommendation | Disposition |
|---|---|---|---|---|---|---|
| A1 | Skipped or todo-only tests passed the wrapper | `scripts/test.mjs` | high | bug | Require `passed === tests`, with no skip or todo | **Fixed** (finding 3) |
| A2 | FEEDBACK.md absent at the time of the pass | repo root | medium | scope-question | Add before parking | **Fixed** (this file) |
| A3 | Floating promise in `.mjs`/`.js` not linted, and the gate script is `.mjs` | `eslint.config.js` | medium | risk | Type-check the root JS | **Fixed** (finding 11) |
| A4 | `// eslint-disable-next-line` or a file-wide `/* eslint-disable */` gets past `no-floating-promises` (exit 0) | `eslint.config.js` | low | risk | `linterOptions.noInlineConfig` for `packages/*/src`, or a directive-policy rule, so exceptions are reviewable config | **Recommended, not built.** A policy on suppressions is a decision; decision-needed: yes |
| A5 | A failing `*.test.ts` outside the glob (e.g. under `src/`), or a `.test.mts`, is never run (exit 0). A new package with zero tests passes because core's test satisfies the global count | `scripts/test.mjs:18` | low | risk | Fail on any `*.test.*` outside the glob; require at least one test per workspace package | **Recommended, not built**; natural in the first P1 WO that adds a second package. decision-needed: no |
| A6 | `.mts`/`.cts` files escape both typecheck and lint | `packages/core/tsconfig.json:3`, `eslint.config.js:8` | low | risk | Include them, or ban the extensions | **Recommended, not built**. decision-needed: no |
| A7 | Nothing automated enforces SHA pins; swapping a pin back to `@v7.0.1` still leaves `check` green | `.github/workflows/ci.yml:18,21` | low | risk | `rg -n 'uses:' .github/workflows/ \| rg -v '@[0-9a-f]{40} # v'` catches it (exit 0 on the tampered tree, exit 1 on the clean one). Wire it into CI | **Recommended for `CSR-WO-0001`** (it already scans `.github/workflows/` and must treat `uses:` lines specially, per finding 7). Not built here: a new CI check is outside §1. decision-needed: no |
| A8 | Without `.npmrc`, `ignore-scripts` and `engine-strict` both read false. A planted root `postinstall` ran 0 times with the file and ran without it | `.npmrc` | note | note | Keep. The file is load-bearing (§5.2 satisfied) | No action |
| A9 | The §3.6 grep's single hit is a false positive | lockfile | note | note | See finding 6 | Recorded |
| A10 | `engine-strict` refuses a wrong Node at install time (system Node v18 and Node v24.16.0: `npm ci` exit 1, `notsup`), but an already-installed tree runs `check` on another Node (v24.16.0: exit 0) | `package.json:8-10` | low | note | Optionally have the wrapper assert `process.version` against `.node-version` | **Recommended, not built**. CI always installs fresh. decision-needed: no |
| A11 | `process.exit(0)` inside a test before its assertion | wrapper | note | note | None | Caught (exit 1) |
| A12 | Also correctly red: a second empty file beside a real one, a top-level throw, an empty `describe`, a late timer assertion, a floating rejection inside a test | wrapper | note | note | None | Caught (exit 1 each) |
| A13 | A test with no assertions passes, which is inherent to `node:test` | n/a | note | note | Consider `t.plan()` in control tests from P1 on | Recorded for P1 |
| A14 | `enum`, `namespace` and constructor parameter properties are each rejected twice: `tsc` TS1294 (exit 2), and at run time `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` (`node --test` exit 1, wrapper exit 1). An extensionless relative import fails the same two ways (TS2834 / `ERR_MODULE_NOT_FOUND`). `declare namespace` is allowed, which is correct because it erases. No type-stripping warning printed | `tsconfig.base.json` | note | note | None | §5.6 satisfied |
| A15 | A floating promise in `src/*.ts` or `test/*.ts` fails lint (exit 1) | `eslint.config.js` | note | note | None | §5.5 satisfied |
| A16 | `check` is sequential and stops at the first failure: a type error exits 2 before lint starts; a lint error exits 1 before test starts | `package.json` | note | note | None | OK |
| A17 | `npm ci` refuses a manifest/lock disagreement: an eslint bump in `package.json` only, or an undeclared dependency, each exit 1 | lockfile | note | note | None | §3.5 corroborated |
| A18 | A new package missing its `typecheck` script, or its tsconfig, fails `check`, which is the safe direction | root config | note | note | None | OK |
| A19 | Both pins are genuine: `git ls-remote` shows each tag at exactly the pinned SHA | `ci.yml` | note | note | None | §5.4 satisfied |
| A20 | No `concurrency` group and no `timeout-minutes`; `push` on all branches plus `pull_request` runs each PR commit twice | `ci.yml:3-5` | low | note | Add a concurrency group and a job timeout, or limit `push` to `main` | **Recommended, not built**; §1.7 specifies the triggers. decision-needed: no |
| A21 | The core's `exports` points at raw `.ts`. That works in the workspace, but Node won't strip types under `node_modules`, so it would fail as a git dependency (arch §5: "a git dependency pinned by commit") | `packages/core/package.json:6-8` | note | scope-question | Rule on the export target (build step, or a loader story) before the first port consumes the core | **decision-needed: yes** (not urgent; before any port) |
| A22 | `.gitignore` comment still says "see docs/northstar.md once it exists", which came from `main` | `.gitignore:9` | note | note | Tidy in a later docs change | Left as is (not this WO's line) |
| A23 | N6/N8 sweep of every non-doc tracked file and every branch commit (identity, host, path, IP, tunnel, session and token patterns): no hits. All 110 lockfile `resolved` entries are `https://registry.npmjs.org`, plus the one workspace link. The only 40-hex strings are the two action pins | tree and history | note | note | `-0001` still needs the `uses:` allowlist | §5.7 satisfied |

**§5.3 Windows paths** (done by me in CI, not by the subagent): a throwaway branch
`probe/CSR-WO-0000-paths` added two tests. One reads `${import.meta.dirname}/../src/index.ts` (forward
slashes), the other `path.join(import.meta.dirname, "..", "src", "index.ts")`. Both passed on
`windows-latest` and `ubuntu-latest` (run 36072957091, `test: 2 file(s), 3 test(s) ran` on each).
The branch was then deleted so the PR carries exactly one test. The run stays in the Actions history.
The glob in `scripts/test.mjs` also resolves on Windows: the same single test is found and run there.

**§5.7 (my own sweep, on the final tree including this file):** no deployment identifier, no path
outside the repository, no credential. Every CI excerpt above was trimmed to the job name and
message.

## What was deliberately not built

- **No leak gate, and no secret scan of any kind in CI.** That is `CSR-WO-0001` in its entirety.
  Until it lands, N6 is enforced by review alone.
- **No control, and no stub of one.** `@clearseal/core` exports exactly one string constant,
  `PACKAGE_NAME`, and nothing else: no canonicalizer, manifest, verifier, gate, or any function that
  returns a value pretending to be one. Every traceability row stays *planned*.
- **No edition.** `packages/` contains `core` only. No `teaching`, `host-linux`, `host-windows`, or
  `conformance`.
- **No `dev/`**, and no authorization-server harness.
- **No MCP SDK.** It is not installed; which revision it serves is `CSR-WO-0100`'s measurement.
- **No formatter, commit-lint, changelog tool, or coverage threshold.**
- **No required status check on `main`.** That is the architect's administrative action after merge.
- **No change to any steering document, README, LICENSE, or NOTICE.** The README's status line
  still says nothing is built; that changes when P0's gate passes, not here.
- **None of the adversarial pass's low-severity recommendations** (A4–A7, A10, A20): no inline-
  disable policy, no stray-test-file detector, no `.mts` coverage, no pin checker in CI, no runtime
  Node-version assertion, no concurrency group. Each is listed above with its owner.
- **No runtime test dependency.** The suite uses `node:test` and `node:assert` only; no `tsx`.
