# FEEDBACK: CSR-WO-0000a (skeleton corrections: lint major, suppression policy, built exports)

Branch `wo/CSR-WO-0000a`. It was cut from `main` at `b2651ec` (CSR-WO-0001 merged;
`scripts/leak-gate.mjs` present). It was rebased onto `068dd90` (the docs-only `-0001` as-built
amendment) before the PR opened, and force-pushed with a lease over the branch's only earlier push,
which had no PR. It is parked as one unmerged pull request. This file replaces `-0001`'s FEEDBACK
at the root; that one stays in history.

Built on **Node v24.21.0** (npm 11.19.0). The session's default `node` was a different version, so
every command ran with the version manager's 24.21.0 first on `PATH`. Every commit on the branch
carries the role identity as both author and committer (checked before each push), and
`node scripts/leak-gate.mjs --history` was clean before each push.

## Crossed or parked

**Nothing crossed. No §7 condition fired.**
- The lint major pins exactly, and its type-aware config still covers the root JavaScript.
- Enforcing the reason requirement needed no dependency (a script in `scripts/`).
- The consumer needs no build step.
- No protected surface changed.

**One finding needs a decision** (finding 2): the config migration made `no-undef` live on the root
JavaScript for the first time, which flagged `scripts/leak-gate.mjs`. As WO §4 requires, the gate
was **not edited**; the two Node globals it uses are declared in config instead.

## Gates line

| Gate | Result |
|---|---|
| `npm ci && npm run check` | exit 0 on the final code: typecheck, then lint plus the directive check, then build, then test (1 test, on source). Tail under §3.1 |
| §3.2 unawaited promise | **fails lint** in a scratch control-source file **and** in the root JavaScript (`no-floating-promises`, exit 1) |
| §3.3 suppression policy | **(a)** a directive in `packages/core/src/index.ts`, even correctly named *with* a reason, is ignored under `noInlineConfig`, and lint exits 1. **(b)** The same directive *without* a reason in `scripts/`: `npm run lint` exits 1 at `check-directives`. **(c)** *With* `-- reason`: exit 0 |
| §3.4 build | `packages/core/dist/index.js` and `index.d.ts` are produced; `dist/` shows only as ignored (`!!`), never in `git status` |
| §3.5 consumability | a packed tarball installs with `ignore-scripts=true` into a directory **outside any repository** and prints `@clearseal/core`, with **no build step on the consumer side**. Transcript below |
| §5.5 pack contents | 3 files: `dist/index.d.ts`, `dist/index.js`, `package.json`. No source, test, config, map or build-info file |
| §3.6 CI | <https://github.com/ClearForge-LLC/clearseal-reference/actions/runs/36092521997> on `663f22e`: `test (ubuntu-latest)`, `test (windows-latest)` and `leak-gate` all **success**. The pre-rebase push `2c130bf` was also green (run 36091956243). The final commit's run (this file) shows on the PR. **The `test` job's block is unchanged** (`ci.yml` has no diff) |
| §3.7 dependencies | before and after `npm ls --depth=0` below; only `eslint` and `@eslint/js` changed |
| Protected surfaces | `git diff origin/main...HEAD --stat -- docs README.md LICENSE NOTICE scripts/test.mjs scripts/leak-gate.mjs packages/core/src packages/core/test .github` is **empty** |
| Leak gate | `--self-test`, `--tree` and `--history` all exit 0 on the branch; the CI job is green |

### Versions, before and after

| Package | Before | After | Note |
|---|---|---|---|
| `eslint` | 9.39.5 (npm: "no longer supported") | **10.11.0** | current `latest`; 9.x is tagged `maintenance` |
| `@eslint/js` | 9.39.5 | **10.0.1** | its own 10.x line; peer `eslint ^10.0.0` |
| `typescript-eslint` | 8.70.1 | 8.70.1 | peer range already includes `eslint ^10.0.0` |
| `typescript` | 6.0.3 | 6.0.3 | unchanged (WO §4: no TypeScript major bump) |
| `@types/node` | 24.13.6 | 24.13.6 | unchanged |

## Findings

Schema: `finding · where · type · recommendation · decision-needed`.

1. **ESLint 10 has no built-in way to require a directive's reason.** It parses `-- reason`, and
   offers `noInlineConfig`, `reportUnusedDisableDirectives` and `reportUnusedInlineConfigs`, but
   nothing that requires a description. So, per WO §1.2 and with no plugin,
   `scripts/check-directives.mjs` does it, run by `npm run lint`.
   - **Which comments count:** any comment whose trimmed text starts with `eslint-disable…`,
     `eslint` (rule configuration), `global`, `globals` or `exported`. `eslint-enable` only
     restores, so it needs no reason.
   - **What a reason is:** ESLint's own separator (whitespace, two or more dashes, whitespace),
     followed by text containing a letter or digit.
   - **How it reads files:** every `//` and every `/*` is treated as a comment start, overlapping,
     so a stray `/*` in a string or regex cannot hide a later directive. The cost is a false
     positive on a directive-like string, which fails closed.
   - **Which files:** tracked plus untracked-but-not-ignored, the set `eslint .` lints.

   · `scripts/check-directives.mjs` · note · None. · decision-needed: no
2. **`no-undef` is now live on the root JavaScript, and it flagged the leak gate.** I moved the
   config from the deprecated `tseslint.config()` to ESLint core's `defineConfig()`.
   `tseslint.config()` had pushed a block's `files` onto its extended configs, so
   typescript-eslint's "`no-undef` off" override silently applied to `.mjs` as well: `no-undef` was
   **off** for the root JavaScript before this WO. (ESLint 10 with the old config lints clean;
   measured.) `defineConfig()` intersects `files`, so the override is back to TypeScript only, and
   `no-undef` flagged 23 uses of `Buffer` and `performance` in `scripts/leak-gate.mjs`. Per WO §4,
   the gate is **not edited**. The config's JavaScript-globals block declares the Node globals the
   root JavaScript uses (`Buffer`, `console`, `performance`, `process`). · `eslint.config.js:25-32`
   · risk · Keep `no-undef` on (stricter; this is what was built), or switch it off for
   type-checked JavaScript, since `checkJs` already reports undefined names. ·
   **decision-needed: yes**
3. **`--max-warnings 0` is part of the suppression policy.** ESLint reports a directive that
   `noInlineConfig` ignores as a **warning** ("has no effect…"), not an error. §3.3(a) fails
   because the ignored directive leaves the real error standing and because of
   `--max-warnings 0`. The config comment now says so, so nobody drops the flag as style. ·
   `eslint.config.js:33-45`, `package.json` `lint` · risk · Keep the flag. · decision-needed: no
4. **Source imports keep the `.ts` extension; the build rewrites them to `.js`.** The WO says
   "`allowImportingTsExtensions` off there — built code imports `.js`". Tests run on source via type
   stripping, which needs `.ts` specifiers, so source must keep them. `tsconfig.build.json` sets
   `rewriteRelativeImportExtensions: true`. The adversarial pass verified it with a second source
   file: the built `.js` imports `./x.js`, the test on source passes, and a consumer installs and
   imports it. **`.d.ts` output keeps `./x.ts` specifiers.** TypeScript consumers still resolve
   the types (verified under `nodenext` and `bundler`); older consumer TypeScript is untested. ·
   `packages/core/tsconfig.build.json` · note · None now. · decision-needed: no
5. **CommonJS consumers work too.** `require()` of the built ESM loads on Node 24.21.0
   (`require(esm)`), so no README note was needed (WO §5.2). · note · None. · decision-needed: no
6. **The tarball carries no licence.** It holds `dist/` and `package.json` only: no `LICENSE`, no
   `NOTICE`, and no `license` field. The package is also still `"private": true`, which `npm pack`
   ignores and `npm publish` refuses. Both are for the release WO. · `packages/core/package.json` ·
   scope-question · `-0002` decides the release package's licence files, `license` field and
   `private` flag. · decision-needed: no (for `-0002`)
7. **The lockfile shrank.** 197 insertions and 356 deletions. ESLint 10 drops the legacy
   `eslintrc` chain (`@eslint/eslintrc`, `js-yaml`, `globals`, `import-fresh`, `chalk` and others)
   and adds a cache stack (`cacheable`, `@cacheable/*`, `hookified`, `qified`, `hashery`,
   `@keyv/*`). None has an install script (`hasInstallScript` count: 0), and all 98 `resolved`
   entries are the public registry. · `package-lock.json` · note · None. · decision-needed: no
8. **A reasoned file-wide `/* eslint-disable -- reason */` outside control source switches off
   every rule in that file**, including `no-floating-promises`, even in `scripts/test.mjs`, the N5
   gate. The policy as written allows it (it has a reason). · policy · scope-question · Rule
   whether a file-wide disable is acceptable in `scripts/`, or should be refused like control
   source. · **decision-needed: yes**
9. **Files that are gitignored but present locally** are linted by `eslint .` but skipped by the
   directive check. They cannot exist in a CI checkout. · `scripts/check-directives.mjs` · note ·
   Accept. · decision-needed: no
10. **`reportUnusedInlineConfigs` catches restatement, not irrelevance.** It is now an error, and
    fires on an inline config that restates a rule's configured severity (proven). An inline
    `off` for a rule that would report nothing on that file is not "unused" to ESLint, and still
    passes if it has a reason. · `eslint.config.js` · note · Review item. · decision-needed: no

## Adversarial pass (WO §5)

A fresh subagent ran it on its own clone, with no push rights. I reproduced its fail-open claim
before fixing it, and every fix below was re-proven red afterwards.

**WO §5 items:**

| # | Attack | Result |
|---|---|---|
| 1 | `enum` in a control-source file | `npm run typecheck` exit 2 (TS1294, erasable-only); `npm run build` exit 2. *Before the fix,* the failed build still wrote `dist/scratch.js`; now nothing is written (F4) |
| 2 | Import built `dist/index.js` | ESM, no flags: loads. CommonJS `require()`: **loads** on 24.21.0 (finding 5) |
| 3 | Delete `dist/`, run `npm test` | exit 0; 1 test passes on source |
| 4 | File-wide `/* eslint-disable */` in `packages/core/src/index.ts` | lint exit 1 (`noInlineConfig`, with `--max-warnings 0`; finding 3); the directive check also exits 1 |
| 5 | `npm pack --dry-run` | `dist/index.d.ts`, `dist/index.js`, `package.json` only |

**Findings and dispositions:**

| # | Sev. | Finding | Disposition |
|---|---|---|---|
| F1 | high | A `.mts` (or `.cts`) file in control source was **never linted**, yet it was type-checked, built and shipped: an unawaited promise there passed the whole gate. This predates this WO; lint's `files` came from `-0000` | **Fixed:** lint and every tsconfig cover `.mts`, `.cts` and `.cjs`. Re-proven: the same `.mts` now fails lint with `no-floating-promises` |
| F2 | low–med | `/* global x */` silenced `no-undef` with no reason and wasn't treated as a directive | **Fixed:** `global`, `globals` and `exported` are directives. Re-proven: checker exit 1 |
| F3 | low | `-- .` passed as a reason | **Fixed:** a reason needs a letter or digit. Re-proven |
| F4 | med | The build didn't empty `dist/`, and a failed build still emitted, so a stale or failed-build file could ship in the tarball (N1) | **Fixed:** the build removes `dist/` first (a Node one-liner, no dependency) and `noEmitOnError` is set. Re-proven: a stale file is gone after a build; a failed build leaves no `dist/` |
| F5 | pass | `check` fails when the build fails | None |
| F6 | low | `.d.ts` keeps `.ts` specifiers | Finding 4 |
| F7 | low | A directive in control source is only a warning | Finding 3 (documented in config) |
| F8 | low | Unused inline configs were unreported | **`reportUnusedInlineConfigs: "error"`**, with the limit in finding 10 |
| F9 | low | `.cjs` got no type-aware rules; `.cts`/`.tsx`/`.jsx` got no config | `.cjs`/`.cts`/`.mts` **fixed** with F1. `.tsx`/`.jsx` are not covered; none exist, and there's no `jsx` setting to build them. Recorded |
| F10 | low | Gitignored local files are skipped by the checker | Finding 9 |
| F11 | low | A reasoned file-wide disable in `scripts/` is allowed | **Decision:** finding 8 |
| F12 | low | The branch was one docs commit behind `main` | **Fixed:** rebased onto `068dd90` before the PR |
| F13 | med | FEEDBACK not yet written at the time of the pass | This file |
| F14 | note | `private: true` | Finding 6 |

Checker attacks that held: spacing and case variants, tabs, CRLF, a directive on a last line with
no newline, `--` with nothing after it, a `/*` inside a regex literal before a directive, a `//` in
a URL string before a directive, and inline rule configuration. ESLint 10 itself ignores `---`
separators, `/** eslint-disable */`, an upper-case `ESLINT-DISABLE`, and `/* eslint-env */`, which
is an error in 10.

## Acceptance evidence (WO §3)

**§3.1: `npm ci && npm run check`**, final code:

```
$ node --version
v24.21.0
$ npm ci
added 99 packages, and audited 101 packages in 838ms
found 0 vulnerabilities
npm ci exit=0
$ npm run check   (tail)
> @clearseal/core@0.0.0 build
> node -e "require('node:fs').rmSync('dist', { recursive: true, force: true })" && tsc -p tsconfig.build.json
> test
> node scripts/test.mjs
✔ PACKAGE_NAME is the published package name (0.727972ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 83.001014
test: 1 file(s), 1 test(s) passed
check exit=0
```

**§3.2 and §3.3: lint proofs** (each plant restored from a byte-compared backup):

```
### §3.2 unawaited promise, scratch control source file packages/core/src/scratch.ts
  2:1  error  Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` op
  2:1  error  Expected an assignment or function call and instead saw an expression                                                                                       
eslint exit=1

### §3.2 same, in the root JavaScript (scripts/scratch.mjs): type-aware lint covers it
  2:1  error  Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` op
  2:1  error  Expected an assignment or function call and instead saw an expression                                                                                       
eslint exit=1

### §3.3a reasoned directive in packages/core/src/index.ts: ignored under noInlineConfig
  2:1  warning  '// eslint-disable-next-line @typescript-eslint/no-unused-vars -- even with a reason' has no effect because you have 'noInlineConfig' setting in your conf
  3:7  error    'unused' is assigned a value but never used                                                                                                               
eslint exit=1

### §3.3b same directive WITHOUT a reason in scripts/: npm run lint fails at the directive check
> eslint --max-warnings 0 . && node scripts/check-directives.mjs
check-directives: scripts/scratch.mjs:1 directive without a "-- reason"
check-directives: 7 file(s), 1 directive(s) without a reason
npm run lint exit=1

### §3.3c same directive WITH a reason in scripts/: passes
> eslint --max-warnings 0 . && node scripts/check-directives.mjs
check-directives: 7 file(s), 0 directive(s) without a reason
npm run lint exit=0
```

**§3.4: build**

```
$ ls packages/core/dist
index.d.ts
index.js
$ git status --short --ignored packages/core
!! packages/core/dist/
$ git status --short
(no output: dist/ is ignored and nothing else changed)
```

**§3.5: consumability transcript** (the directories are placeholders for local scratch paths; the
tarball's 40-hex `shasum` is elided because the leak gate rightly refuses a bare 40-hex value in
this file):

```
$ npm pack -w @clearseal/core --pack-destination <pack-dir>     # in the repository, after npm run check
npm notice
npm notice 📦  @clearseal/core@0.0.0
npm notice Tarball Contents
npm notice 55B dist/index.d.ts
npm notice 47B dist/index.js
npm notice 416B package.json
npm notice Tarball Details
npm notice name: @clearseal/core
npm notice version: 0.0.0
npm notice filename: clearseal-core-0.0.0.tgz
npm notice package size: 418 B
npm notice unpacked size: 518 B
npm notice shasum: <40-hex elided>
npm notice total files: 3
npm notice
clearseal-core-0.0.0.tgz
$ cd <consumer-dir, outside any repository>
$ git rev-parse --is-inside-work-tree
fatal: not a git repository (or any of the parent directories): .git
$ printf "ignore-scripts=true\n" > .npmrc && npm init -y >/dev/null
$ npm config get ignore-scripts
true
$ npm install <pack-dir>/clearseal-core-0.0.0.tgz
added 1 package, and audited 2 packages in 350ms
found 0 vulnerabilities
$ find node_modules/@clearseal/core -type f
node_modules/@clearseal/core/dist/index.d.ts
node_modules/@clearseal/core/dist/index.js
node_modules/@clearseal/core/package.json
$ cat consume.mjs
import { PACKAGE_NAME } from "@clearseal/core";
console.log(PACKAGE_NAME);
$ node --version && node consume.mjs
v24.21.0
@clearseal/core
exit=0
```

**§5.5: pack file list**

```
$ npm pack -w @clearseal/core --dry-run
npm notice 55B dist/index.d.ts
npm notice 47B dist/index.js
npm notice 416B package.json
npm notice total files: 3
```

**§3.7: `npm ls --depth=0`**

```
before:
clearseal-reference@ <repo>
├── @clearseal/core@0.0.0 -> ./packages/core
├── @eslint/js@9.39.5
├── @types/node@24.13.6
├── eslint@9.39.5
├── typescript-eslint@8.70.1
└── typescript@6.0.3

after:
clearseal-reference@ <repo>
├── @clearseal/core@0.0.0 -> ./packages/core
├── @eslint/js@10.0.1
├── @types/node@24.13.6
├── eslint@10.11.0
├── typescript-eslint@8.70.1
└── typescript@6.0.3
```

## What did not work, and why

- **The first config migration made lint fail on the leak gate** (finding 2): 23 `no-undef` errors
  that had been silently switched off. Resolved in config, not in the protected file.
- **The directive check's first draft used one alternating regex.** That consumes text, so a stray
  `/*` could swallow a later directive, a fail-open by construction. It was rewritten as the
  overlapping superset scan before first use. It first scanned only tracked files, so a new file
  would have been missed until `git add`; that was fixed too.
- **The strict typecheck caught the checker's own types:** tuple pairs were inferred as arrays
  under `noUncheckedIndexedAccess`, fixed with a JSDoc tuple type.
- **My first §3.3 proofs named the wrong rule** (core `no-unused-vars` instead of
  `@typescript-eslint/no-unused-vars`). The directive then suppressed nothing, so "with a reason
  passes" wasn't actually shown. Re-run with the active rule, each proof has a single cause.
- **I assumed `reportUnusedInlineConfigs` meant "suppressed nothing".** It means "restates the
  configured severity" (finding 10). Verified, and recorded as such, not as a fix it isn't.
- **The adversarial pass found a fail-open that predates this WO** (F1: `.mts` never linted).

## What was deliberately not built

- **No control.** That is P1.
- **No change to the test wrapper's rules**, and tests do not run on built output.
  `scripts/test.mjs` is unchanged.
- **No publishing, tagging or release workflow**, and no licence files or `license` field in the
  package (finding 6). That is `-0002`.
- **No TypeScript major bump** (it's pinned to typescript-eslint's peer range) and **no formatter**.
- **No edit to the leak gate** (finding 2); `scripts/leak-gate.mjs` is unchanged.
- **No new CI job.** The `check` script change carries the build; `ci.yml` is unchanged.
- **No lint plugin and no new direct dependency.** The only dependency changes are the two lint
  packages' major.
- **No `.tsx`/`.jsx` support** (F9).
