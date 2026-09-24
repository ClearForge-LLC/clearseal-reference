# CSR-WO-0000 — Repository skeleton: workspaces, TypeScript, tests, lint, CI that can go red

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` (currently `2b96f08`; verify live HEAD).
**Branch:** `wo/CSR-WO-0000`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P0 — skeleton, gates, and spikes · **Phase exit gate:** CI is green on a pull request that
changes a source file; the leak gate's self-test exits non-zero on every planted shape (`-0001`);
the three P0 spikes are recorded in `docs/architecture.md` §2.3; `main` shows a required status check.
This work order delivers the first clause and the substrate for the rest.
**Grounds:** `docs/northstar.md` N5, N6, N8; `docs/architecture.md` §2.1 (Node version, proving
ground), §3.1 (the monorepo layout), §5 (rulings: language and SDK, Node version, visibility),
§6 (secrets by name); `docs/roadmap.md` P0. No code seams exist yet — this work order creates them.

> **What this is:** the smallest repository that builds, typechecks, lints, runs a test, and fails
> CI when a test fails — laid out as the monorepo `architecture.md` §3.1 describes, with one empty
> core package and no edition. It is NOT the leak gate (`CSR-WO-0001`), NOT any control, and NOT a
> place to start `packages/core` for real: the first line of a control lands in P1 on top of this.
> Why now: every later work order's proof runs on this substrate, and a substrate that cannot be
> seen to fail (N5) would make every later green meaningless.

**Cadence:** build. One PR, left unmerged for review.

## 1. Scope — numbered, specific

1. **Workspaces.** Root `package.json` with `"private": true`, `"type": "module"`,
   `"workspaces": ["packages/*"]`, `"engines": { "node": "24.21.0" }`, and scripts `typecheck`,
   `lint`, `test`, `check` (the three in sequence). Package manager is **npm** — the one already on
   the proving ground with Node 24.21.0; no second package manager is introduced.
2. **Version pins.** `.node-version` containing `24.21.0`. `.npmrc` containing exactly:
   `engine-strict=true`, `save-exact=true`, `ignore-scripts=true`, `fund=false`. Reason for
   `ignore-scripts`: install-time lifecycle scripts are the largest unreviewed execution surface a
   dependency tree carries; `npm test` and `npm run` still run our own scripts under this setting.
   `package-lock.json` is committed; CI installs with `npm ci`.
3. **TypeScript.** Root `tsconfig.base.json` (strict; `noUncheckedIndexedAccess`;
   `verbatimModuleSyntax`; `erasableSyntaxOnly`; `module`/`moduleResolution` `NodeNext`; `target`
   suited to Node 24; `noEmit`) extended by each package's `tsconfig.json`. `erasableSyntaxOnly`
   is deliberate: the suite runs on Node's built-in type stripping, which rejects enums, namespaces
   and parameter properties — so the compiler rejects them first.
4. **`packages/core`.** `package.json` with name `@clearseal/core`, `"type": "module"`, an
   `exports` map, `src/index.ts` exporting a single `PACKAGE_NAME` constant, and
   `test/index.test.ts` asserting it. Nothing else. No control, no stub of a control, no
   `canonicalFieldSet()` returning anything — a stub that returns a value is a fake control, and
   the architecture's traceability table says every control is *planned* until its red-proof
   exists.
5. **Test runner.** `node --test` over `packages/*/test/**/*.test.ts`, on the pinned Node's
   built-in type stripping. A wrapper script `scripts/test.mjs` runs it and **exits non-zero when
   zero tests ran** — `node --test` with no matching files exits zero, and a suite that passes by
   running nothing is the exact failure N5 names.
6. **Lint.** ESLint 9 flat config with `typescript-eslint` at the type-checked recommended level;
   `no-floating-promises` on as an error. Reason: this becomes a server; an unawaited promise in a
   gate is a fail-open. No formatter is added in this work order.
7. **CI.** `.github/workflows/ci.yml`: triggers `push` and `pull_request`; top-level
   `permissions: contents: read`; a `test` job on a matrix of `ubuntu-latest` and `windows-latest`;
   steps: checkout, setup-node from `.node-version` with npm cache, `npm ci`, `npm run check`.
   **Every action is pinned to a full commit SHA with the version in a trailing comment** — a tag
   is mutable, a SHA is not. (This produces 40-hex strings in the workflow file; `CSR-WO-0001`'s
   leak gate must allowlist `uses:` lines in `.github/workflows/`, and this work order's FEEDBACK
   must say so, so `-0001` inherits the fact rather than rediscovering it.)
8. **`.gitignore`** extended for `node_modules/`, `dist/`, `coverage/`, and `.eslintcache` if not
   already present. `.env` patterns are already there; leave them.
9. **`FEEDBACK.md`** at the repository root on this branch, per §6.

## 2. Invariants — restated by number from the northstar

The authoritative source is `docs/northstar.md` §4; these are the slice this work order touches.

- **N5** — every control ships with a negative test that proves it can go red, and CI runs it. No
  control exists yet, so the obligation here is on the *substrate*: CI must be shown to fail on a
  failing test (§5 item 1), and the runner must refuse to pass on zero tests (§1 item 5).
- **N6** — nothing in this repository identifies a deployment. No node name, hostname, home path,
  tunnel, topic, account identifier, or operator path in any file this work order adds — including
  the FEEDBACK, CI logs you paste into it, and commit messages. The gate that enforces this is
  `-0001`; until it lands, you are the gate.
- **N8** — secrets by name only. This work order needs no secret. If any step appears to, that is a
  flag-and-stop.

**Protected surfaces — must diff to empty on this branch:** `docs/northstar.md`,
`docs/architecture.md`, `docs/roadmap.md`, `README.md`, `LICENSE`, `NOTICE`. The README's status
line stays as it is: the project's status does not change until P0's gate passes.

**A change to an invariant is a decision, not a build step.** If this scope cannot be met without
contradicting one, park the branch and lead the FEEDBACK with it.

## 3. Tests / acceptance — what must be proven, not asserted

1. On a **fresh clone** (not the worktree that built it): `npm ci` then `npm run check` exits zero
   on the pinned Node, with output pasted into FEEDBACK showing typecheck, lint, and exactly one
   test passing.
2. `node --version` prints `v24.21.0` in the environment that produced item 1; if the builder
   environment has a different Node, say so and use the version manager of that environment to
   match — do not loosen the pin.
3. **CI can go red.** A commit on this branch that makes `test/index.test.ts` fail is pushed, the
   `test` job is observed failing on both runners, and the commit is then reverted with a follow-up
   commit (not force-pushed away — the red run is part of the evidence). Both run URLs go in
   FEEDBACK.
4. `scripts/test.mjs` exits non-zero when run with a glob that matches no files; paste the exit
   code.
5. `npm ci` fails when `package-lock.json` is edited to disagree with `package.json` (revert after).
6. `grep -rn "postinstall\|preinstall\|install\"" node_modules/*/package.json node_modules/@*/*/package.json`
   output is pasted into FEEDBACK — the count of dependencies that *wanted* to run an install
   script is recorded, so the review can see what `ignore-scripts` suppressed.
7. Both CI runners are green on the final commit of the branch.

## 4. Scope fence — what is NOT in this work order

- **The leak gate.** `CSR-WO-0001`. Do not start it, do not add a "quick" secret scan to CI.
- **Any control** — canonicalizer, manifest, verifier, gate. P1.
- **Any edition directory.** `packages/teaching`, `host-linux`, `host-windows`, `conformance` do
  not exist after this work order; `packages/core` alone.
- **`dev/`** — the authorization-server harness is P2.
- **The MCP SDK.** Installing it is the first spike (`CSR-WO-0100`), because which revision it
  serves is an unmeasured fact that spike records. Do not add it here "to save a step".
- **A formatter, a commit-lint, a changelog tool, a coverage threshold.** Each is a decision with a
  reason; none is made here.
- **Required status checks on `main`.** An administrative action the architect performs after
  merge; the builder's deploy key cannot and must not.
- **Any change to the steering documents.** Findings about them go in FEEDBACK.

## 5. Adversarial pass — try to break it before calling it done

Hand this to a fresh subagent if one is available; otherwise do it yourself, framed as an attack on
the finished branch. Every finding, fixed or not, goes into FEEDBACK with a severity.

1. Make the test fail; confirm CI is red (§3 item 3). Then make the test file **empty** — confirm
   the runner exits non-zero rather than passing on nothing.
2. Delete `.npmrc`; confirm `npm ci` behaves differently (scripts would run) and restore it. The
   point is to know the file is load-bearing, not decorative.
3. Run the suite on the Windows runner with a test that uses a path containing a forward slash and
   one that uses `path.join` — confirm both pass, or record which does not.
4. Change one action's pinned SHA to its tag; confirm the review would catch it (a `grep -n "uses:"`
   listing every pin belongs in FEEDBACK).
5. Introduce an unawaited promise in `src/index.ts`; confirm lint fails; remove it.
6. Add an `enum` to `src/index.ts`; confirm `tsc` rejects it under `erasableSyntaxOnly` and that
   `node --test` would also have rejected it; remove it.
7. Check every file added for anything N6 forbids, including the FEEDBACK and any pasted log.

## 6. Upward-feedback directive

Write `FEEDBACK.md` at the repository root on this branch. Schema per entry:
`finding · where (file:line) · type (note | risk | scope-question | bug) · recommendation · decision-needed (yes/no)`.
Lead with anything crossed or parked. Include: a **gates line** (typecheck, lint, test count, both CI
run URLs including the deliberately red one, protected-surface diff status); **what did not work and
why** (the type-stripping outcome on this Node in particular — whether a warning printed, whether a
fallback was needed); the install-script count from §3 item 6; the action-pin listing; and a
**"what was deliberately not built"** section restating §4 in your own words so the review cannot
assume something shipped that did not.

## 7. Flag-and-stop conditions

Park the branch and say so — do not route around:

- Built-in type stripping cannot run the suite on the pinned Node **and** the only fix is a runtime
  transform that also changes how production code would load (a test-only `tsx` devDependency is
  *not* a stop — add it, record it, move on).
- Any dependency that refuses to install under `ignore-scripts=true` and has no alternative.
- Any step that needs a secret, a token, or a credential of any kind.
- Any file that would carry something N6 forbids.
- A protected surface that must change to make CI pass.
- An action that cannot be pinned to a commit SHA.

## 8. Kickoff prompt

Sent to the builder session as one message, after `/goal` in its own turn.

`/goal` text:
> A branch `wo/CSR-WO-0000` off current `main` with a repository that installs with `npm ci`,
> passes `npm run check` (typecheck, lint, one test) on Node 24.21.0 on both an Ubuntu and a
> Windows CI runner, has been shown to go red in CI on a failing test, refuses to pass on zero
> tests, has every GitHub action pinned by commit SHA, contains no control and no edition, and is
> parked as a single unmerged pull request with `FEEDBACK.md` at the root. Stop at parked.

Kickoff:
> Sync first: `git fetch origin && git checkout -b wo/CSR-WO-0000 origin/main` — expected HEAD
> `2b96f08`; if it differs, the base moved and you say so before anything else.
> Cadence: **build** — no spike. Read `docs/work-orders/CSR-WO-0000.md` in full; it is the
> directive. `docs/northstar.md` §4 and `docs/architecture.md` §3.1, §5 are the source of truth it
> cites; read those sections too.
> Ratified and not up for relitigation, with reasons in the WO: npm workspaces (already on the
> proving ground); Node 24.21.0 exact (the proving ground's version, §2.1); `node --test` on
> built-in type stripping with `erasableSyntaxOnly` (zero runtime test dependencies for a security
> reference); `ignore-scripts=true` (install-time scripts are the largest unreviewed execution
> surface); actions pinned by SHA (tags are mutable). One empty core package; no control, no stub.
> Invariants in play: N5 — CI must be *shown* to fail and the runner must refuse to pass on zero
> tests; N6 — nothing that identifies a deployment in any file, log paste, or commit message; N8 —
> no secret anywhere; this WO needs none, so needing one is a stop. Protected surfaces diff to
> empty: the four steering documents, LICENSE, NOTICE.
> Flag-and-stop: §7 of the WO. Park rather than route around.
> Close with the gate: the adversarial pass in §5 (fresh subagent if available), then `FEEDBACK.md`
> per §6, then one PR to `main` left unmerged. Report back with the PR link and the two CI run
> URLs — the red one and the green one.
