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
- **A stub touches only the files its row lists under `touches`,** never a `*.test.ts` file, a file
  of its own row's tests, or anything under `test/deletion/`. The runner refuses one that does.
- **Name a test only if it discriminates.** It must pass on the unpatched tree, and fail by
  assertion under the stub, not by a crash, a timeout or a skip. The runner checks both.

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
