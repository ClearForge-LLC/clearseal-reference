# The control-deletion job (N5)

A control that cannot fail is not a control. Every built control has a row in `controls.json`:
the §8 row it proves, a reviewed stub in `stubs/<id>.patch` that deletes or disables it, the test
files to run, and the specific tests that must fail. `scripts/control-deletion.mjs` applies each
stub to a throwaway copy of the tree and requires every named test to fail **by assertion**. It
runs as the `control-deletion` CI job on every push and pull request.

## The rule for the next builder

- **A work order that builds a control adds its row in the same pull request.** A work order that
  changes a control updates its row (the stub, the tests, the names) in the same pull request.
- **A stub that stops applying is fixed, never deleted to make the job pass.** The job names the
  row; regenerate the stub against the changed control so that it still deletes that control.
- **A named test that stops going red is a finding.** Either the control no longer works as its row
  says, or the test no longer tests it. Neither is fixed by removing the name.
- **A stub touches only the files its row lists under `touches`,** and those must be a package's
  source (`packages/*/src/**`) or one of the runner's named test-code controls (the
  supply-boundary checker). Never a `*.test.ts` file, a file of its own row's tests, or anything
  under `test/deletion/`. The runner reads what a stub changed from `git status` in the copy after
  applying it, not from the patch's headers, and refuses one that strays.
- **The copy isolates the source, not the process.** Third-party modules are symlinks into the
  real tree, and code running in the copy runs as you. A stub is reviewed code: the copy keeps the
  patch out of the real tree, not what patched code chooses to do at run time.
- **An assertion counts only if test code threw it.** The first stack frame outside Node must lie
  under `packages/*/test/`: an `AssertionError` thrown from a package's source is a crash, not the
  test's check.
- **RED proves the named assertions flipped, not that the control is gone.** A stub that trips the
  same assertion some other way (a changed message, a control made to crash) would also read RED.
  That the stub deletes exactly the control on its row is what the review of the stub is for: read
  it against the row's `control` line.
- **Name a test only if it discriminates.** It must pass on the unpatched tree, and fail by
  assertion under the stub, not by a crash, a timeout or a skip. The runner checks both.

## What keeps the job whole (CSR-WO-2008c)

`scripts/deletion-coverage.mjs`, run first in `npm test`, fails CI when the job stops covering what
it should:

- **Every test file runs in some row's baseline.** A `packages/*/test/**/*.test.ts` file is listed in
  a row's `tests`, or it is in `unlisted.json` with a one-line reason it proves no control.
- **Every built §8 row has a row.** A row's `section8` is the §8 title exactly; a built row that is no
  `packages/*/src` control is in `exempt.json` with the proof it has instead.
- **Every `CHECKS.md` check is named by exactly one row.** The row whose stub deletes the check lists
  its id in `checks`. A check no stub can delete (an absence) is in `exempt.json` as `{check, reason}`.

An exemption or an allowlist entry that goes stale (its file gone, or a row now covers it) is itself a
failure.

## Running it

```sh
npm run control-deletion                             # the self-test, then every row
node scripts/control-deletion.mjs --row drift-refused  # one row
node scripts/control-deletion.mjs --row drift-refused --show  # every test's outcome under that stub
node scripts/control-deletion.mjs --list             # the rows
```

The runner copies the working tree's tracked files (in CI, exactly the commit under test) into a
temporary directory, links third-party modules from the real tree, recreates the workspace links
inside the copy, and builds it. The unpatched copy must pass every row's tests before any stub
runs. Every temporary directory is removed when the run ends.

## Writing a stub

Make the smallest edit that deletes the control's decision, in the control's own file, as a unified
diff with `a/` and `b/` paths from the repository root. Keep the tree building: a stub that breaks
the build is refused, because it proves nothing about the control. `test/deletion/red-proofs/`
holds three rows built to be wrong (a no-op stub, a stale stub, a build-breaking stub); `--self-test`
requires the runner to fail each one for its own reason.
