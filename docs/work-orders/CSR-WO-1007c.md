# CSR-WO-1007c — The node entry, finished: the installed command runs, preloads are refused, and the checker stops trusting a parse it could not complete

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (must contain the P1 exit record).
**Branch:** `wo/CSR-WO-1007c`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** follow-up to P1 (not an exit clause; P1 exited at `9421cce`).
**Grounds:** the H1 re-test #2 report against `9421cce` (M-1 and two Info items) and the `-1007b` review
ruling on install hooks, recorded in `docs/architecture.md` §10; §4 *Core ↔ edition*; §7.1 *A hostile
edition author*.

> **What this is:** four small items the phase-exit red team left, none of which broke the guarantee.
> The installed `clearseal-node` command does not start a node at all (no `#!` line, and a main-module
> check that compares a real path with the npm bin symlink's path), which is a usability defect that
> fails closed. A preload the process was started with (`NODE_OPTIONS=--import …`, `--require`,
> `--loader`) runs code before the settings snapshot; that needs the operator to set it, so it is not
> a break, but refusing it is cheap and makes the ordering guarantee unconditional. The checker ignores
> TypeScript parse errors, so a statement TypeScript misreads (`import source m from "X"`) hides its
> specifier from every import rule. And an edition shipping an install-time lifecycle script is code
> that runs before any node exists. It is NOT the P2 hardening WO (built-ins patched at load, C7, H7,
> `Function` via `.constructor`).

**Cadence:** build, small. One PR, left unmerged for review.

**Adversarial discipline for this WO (standing from here on):** build each control and a regression
test for each **documented** case below, written as "this input must be refused". Open-ended attack
discovery belongs to the external red team; do not run an open-ended adversarial subagent. A fresh
subagent **reviews** the diff against this WO's §1 and §2 instead: does each item hold for the cases
listed, and does anything in the diff contradict the WO.

## 1. Scope — numbered, specific

1. **The installed command runs.** `dist/node/cli.js` carries a `#!/usr/bin/env node` line (from the
   source or the build — choose, record why). The main-module check compares real paths on both sides
   (or uses a mechanism that holds through a symlink — choose, record why). Proof: a test installs the
   core into a temporary prefix with `npm`, runs `node_modules/.bin/clearseal-node` **by that path**
   with a valid operator configuration, and sees it listen; and the same with `node <symlink>`. Both
   runners.
2. **Preloads refused.** Before the snapshot, the entry refuses to start when the process was started
   with a module-loading flag — `--import`, `--require`/`-r`, `--loader`/`--experimental-loader`, or any
   other flag that runs a module before the entry (enumerate against Node 24's documentation; cite it)
   — whether it came from `NODE_OPTIONS` or the command line (`process.execArgv`). Other flags (memory
   limits, `--enable-source-maps`) are allowed. The refusal names the flag. Documented cases, each a
   test: `NODE_OPTIONS=--import <file>`, `NODE_OPTIONS=-r <file>`, `--import` on the command line,
   `--experimental-loader`, and one allowed flag starting normally.
3. **The checker refuses what it cannot parse.** Any syntactic diagnostic TypeScript reports for an
   edition file is a finding naming the file and the diagnostic. Documented cases: `import source m from
   "./m.wasm"` (M-1), an unterminated string, and a file that parses cleanly (no finding).
4. **Install hooks are a finding.** An edition whose `package.json` declares `preinstall`, `install`,
   `postinstall`, `prepare` or `preprepare` is a finding (enumerate npm's lifecycle scripts that run on
   install; cite them). The teaching edition passes. Operators still install with scripts disabled, as
   the teaching README says; the finding is so an edition that needs one is visible before install.
5. **Control-deletion rows** for §1.1–§1.4, and **`FEEDBACK.md`** per §6.

## 2. Invariants

- **N2**: every setting that decides what a node serves is read before any code but the core's runs.
- **N5**: every item has a red-proof and a `-2008` row.

**Protected surfaces (must diff to empty):** the four steering documents, `LICENSE`, `NOTICE`,
`spikes/**`, `docs/canonical-form.md`, `packages/core/src/**` except `node/**` and the build step for
§1.1, `.github/**`. Working surface: `node/**`, `packages/core/package.json` (bin and build only),
`packages/core/test/boundary/**`, `packages/core/test/node/**`, `packages/teaching/README.md`,
`test/deletion/**`.

## 3. Tests / acceptance

1. `npm run check` green on both runners; both leak-gate modes exit 0; `control-deletion` green.
2. The installed-command test output on both runners: pasted.
3. Each documented case in §1.2–§1.4 with its message: pasted.

## 4. Scope fence

- **Built-ins patched at load, C7, H7, `Function` via `.constructor`, SIGINT shutdown** (P2 hardening).
- **Any change to what the gate, registry, transport, auth or audit decide.**
- **Splitting the control-deletion job** (its own WO).

## 5. Review pass

A fresh subagent reads the diff against §1 and §2 and reports: each item's documented cases present
and red-proven; nothing outside the working surface changed; any claim in a code comment that the code
does not hold. Findings go in FEEDBACK with severity.

## 6. Upward-feedback directive

`FEEDBACK.md`: gates line, the pastes in §3, the choices in §1.1 with reasons, the flag enumeration in
§1.2 and the lifecycle list in §1.4 with their citations, review findings, what was not built.

## 7. Flag-and-stop conditions

- A module-loading flag cannot be detected from inside the entry before the snapshot (name it).
- A protected surface must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-1007c` off current `main` where the installed clearseal-node command starts a
> node by its npm bin path on both runners, the entry refuses to start when a module-loading flag was
> given through NODE_OPTIONS or the command line, the supply-boundary checker treats any parse error
> and any install-time lifecycle script as a finding, every documented case in the WO is a test,
> control-deletion rows exist for every item, `npm run check` is green on both runners, and the work is
> parked as one unmerged pull request. Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-1007c origin/main`. Node 24.21.0. Cadence:
> **build**, small. Read `docs/work-orders/CSR-WO-1007c.md` in full, including the adversarial
> discipline note under the cadence line: regression tests for the documented cases, and a review
> subagent instead of an open-ended attack pass. Leak gate before every push, exit code checked
> directly. Report the PR link and the pastes.
