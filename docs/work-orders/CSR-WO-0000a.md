# CSR-WO-0000a — Skeleton corrections from review: supported lint major, suppression policy, built exports

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` after `CSR-WO-0001` has merged
(verify live HEAD; `scripts/leak-gate.mjs` must exist on the base — its job must stay green through
this change).
**Branch:** `wo/CSR-WO-0000a`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P0 · **Phase exit gate:** CI green on a pull request that changes a source file — this
work order changes what "green" means, so it re-proves it.
**Grounds:** `docs/northstar.md` N1, N5; `docs/architecture.md` §5 rows *How fleet ports consume
this* (amended) and *Test discipline*, §10 (the amendment recording the three rulings);
`docs/roadmap.md` reconciliation row for this id; the `-0000` FEEDBACK findings 1, A4 and A21.
Code seams: `package.json`, `eslint.config.js`, `tsconfig.base.json`, `packages/core/package.json`,
`packages/core/tsconfig.json`, `.github/workflows/ci.yml`.

> **What this is:** three corrections the `-0000` review ruled, small enough to be one refinement:
> the lint tool moves to a supported major; inline suppressions are forbidden in control source and
> allowed elsewhere only with a written reason; the core builds to `dist/` and exports from it so a
> consumer can actually install it. It is NOT a control, NOT a change to the test wrapper's
> guarantees, and NOT a publishing step. Why now: the first control (P1) lands on top of these
> files, and a lint baseline or an export shape changed after that is a churn every later WO pays.

**Cadence:** build. One PR, left unmerged for review.

## 1. Scope — numbered, specific

1. **Lint major.** Move `eslint` and `@eslint/js` to the current supported major (the builder
   measured that `typescript-eslint` 8.70.x accepts it as a peer). Re-verify that
   `no-floating-promises` still fires on a planted unawaited promise and that the type-aware
   config still covers the root JavaScript (the test wrapper). Record the versions in FEEDBACK.
2. **Suppression policy** in `eslint.config.js`: for `packages/*/src/**`,
   `linterOptions.noInlineConfig: true` — no directive of any kind in control source; a needed
   exception becomes a config entry with a comment saying why, which is a review item. Everywhere
   else, `linterOptions.reportUnusedDisableDirectives: "error"`, and a directive without a
   `-- reason` description fails (use the built-in support for directive descriptions; if enforcing
   the description needs a plugin, do not add one — write a ten-line check in `scripts/` instead
   and wire it into `npm run lint`).
3. **Built exports.** A `tsconfig.build.json` per package (extends the base; `noEmit: false`,
   `declaration: true`, `outDir: dist`, `rootDir: src`, `allowImportingTsExtensions` off there —
   built code imports `.js`). `packages/core/package.json` `exports` points at `./dist/index.js`
   with `types` at `./dist/index.d.ts`; `files` lists `dist/`. `npm run build` at the root builds
   every workspace; `npm run check` runs build before test. **Tests keep running on source** via
   type stripping — the built output is what ships, the source is what is proven, and a test that
   proves source but ships something else is a gap named in FEEDBACK if it ever opens.
4. **Consumability proof.** In a temporary directory outside the repository: `npm pack` the core,
   `npm init -y`, `npm install <tarball>` with `ignore-scripts=true`, and run a three-line script
   that imports `@clearseal/core` and prints `PACKAGE_NAME`. This is the consumption path the
   amended ruling names; it must succeed with no build step on the consumer side.
5. **CI**: the `check` script change is enough; no new job. The leak-gate job stays green.
6. **`FEEDBACK.md`** at the repository root on this branch, per §6.

## 2. Invariants — restated by number from the northstar

The authoritative source is `docs/northstar.md` §4.

- **N5** — the lint move must be *shown* to still catch an unawaited promise; the suppression
  policy must be *shown* to reject a bare directive in `packages/core/src`. Nothing here may
  weaken the test wrapper (`scripts/test.mjs` is a protected surface).
- **N1** — the build emits exactly what the source declares; no generated file may add an export
  the source lacks (`dist/` is gitignored and never committed).
- **N8** — nothing here needs a secret.

**Protected surfaces — must diff to empty:** `docs/northstar.md`, `docs/architecture.md`,
`docs/roadmap.md`, `README.md`, `LICENSE`, `NOTICE`, `scripts/test.mjs`, `scripts/leak-gate.mjs`,
`packages/core/src/**`, `packages/core/test/**`.

## 3. Tests / acceptance — what must be proven, not asserted

1. `npm ci && npm run check` exits zero on the pinned Node; paste the tail.
2. A planted `const p = Promise.resolve();` followed by `p;` in a scratch source file fails lint;
   paste the finding line; revert.
3. A planted `// eslint-disable-next-line` in `packages/core/src/index.ts` fails lint under
   `noInlineConfig`; a planted directive *without* a reason in `scripts/` fails; the same directive
   *with* `-- reason` passes; paste all three; revert.
4. `npm run build` produces `packages/core/dist/index.js` and `index.d.ts`; `dist/` does not appear
   in `git status`.
5. The consumability proof (§1 item 4) prints `@clearseal/core` from a directory outside the
   repository with `ignore-scripts=true`; paste the transcript.
6. Both CI jobs green on both runners on the final commit; the `test` job block unchanged.
7. Package-lock diff reviewed: paste `npm ls --depth=0` before and after.

## 4. Scope fence — what is NOT in this work order

- **Any control.** P1.
- **Changing the test wrapper's rules** or moving tests to run on built output.
- **Publishing, tagging, or a release workflow.** `-0002` and the architect.
- **A TypeScript major bump.** Pinned to the typescript-eslint peer range; recorded in `-0000`.
- **A formatter.** Still a separate decision.
- **Touching the leak gate.** If the lint change flags `scripts/leak-gate.mjs`, that is a finding
  for FEEDBACK with decision-needed, not an edit.

## 5. Adversarial pass — try to break it before calling it done

Fresh subagent if available.

1. Put an `enum` in a scratch source file; confirm both `tsc` (erasable-only) and the build reject
   it.
2. Import a built `dist/index.js` from a scratch ESM file on the pinned Node with no flags;
   confirm it loads. Then from a scratch CommonJS file; record whether it loads and say so in the
   README of the package if it does not (no shim — a fact, not a fix).
3. Delete `dist/` and run `npm test`; confirm tests still pass on source (they must not depend on
   the build).
4. Try to sneak a suppression into `packages/core/src` via a file-wide `/* eslint-disable */`;
   confirm `noInlineConfig` rejects it.
5. Check that `npm pack --dry-run` lists only `dist/`, `package.json`, `LICENSE`-adjacent files
   and no test, source, or config; paste the file list.

## 6. Upward-feedback directive

`FEEDBACK.md` at the repository root on this branch, schema as before. Include the gates line
(check output, the three lint proofs, the consumability transcript, pack file list, both CI URLs,
protected-surface diff), versions before and after, **what did not work and why**, and **what was
deliberately not built**.

## 7. Flag-and-stop conditions

- The lint major cannot be pinned or its type-aware config cannot cover the root JavaScript.
- Enforcing the suppression policy requires a new dependency (write the check instead; if that is
  impossible, stop).
- The consumability proof needs a build step on the consumer side.
- A protected surface must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-0000a` off current `main` on which lint runs on a supported major and still
> catches an unawaited promise, control source rejects any inline suppression and other files
> require a reason, the core builds to `dist/` and exports from it with tests still on source, a
> packed tarball installs and imports from outside the repository with `ignore-scripts=true`, both
> CI jobs are green, and the work is parked as one unmerged pull request with `FEEDBACK.md` at the
> root. Stop at parked.

Kickoff:
> Sync first: `git fetch origin && git checkout -b wo/CSR-WO-0000a origin/main` — confirm
> `scripts/leak-gate.mjs` exists on the base, else `-0001` has not merged and you stop. Cadence:
> **build**. Read `docs/work-orders/CSR-WO-0000a.md` in full; `docs/architecture.md` §5 (*How fleet
> ports consume this*, amended) and §10 are the source of truth. Ratified with reasons in the WO:
> supported lint major (your own finding); `noInlineConfig` in control source and `-- reason`
> elsewhere (a suppression in a control is a review item); `dist/` exports with tests on source
> (you measured that raw exports cannot be consumed). Protected: the steering documents, both
> scripts, `packages/core/src` and `test`. Flag-and-stop: WO §7. Adversarial pass to a fresh
> subagent, FEEDBACK, one PR left unmerged. Report the PR link and the consumability transcript.
