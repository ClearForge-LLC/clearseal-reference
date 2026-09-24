// Runs the suite on Node's built-in test runner and refuses to pass on nothing (N5).
//
// `node --test` exits zero when its glob matches no files, it reports a test file that
// registers no tests as a single *passing* test named after the file, and it counts skipped
// and todo tests as passing. Each would let a suite pass by running nothing, so this wrapper
// fails when:
//   - the glob matches no files;
//   - any matched file produced no per-file summary, or a summary with zero passed tests;
//   - any test failed, was cancelled, was skipped, or is marked todo.
//
// Usage: node scripts/test.mjs [glob]   (default: packages/*/test/**/*.test.ts)

import { globSync } from "node:fs";
import path from "node:path";
import { run } from "node:test";
import { spec } from "node:test/reporters";

const pattern = process.argv[2] ?? "packages/*/test/**/*.test.ts";
const files = globSync(pattern).map((f) => path.resolve(f)).sort();

if (files.length === 0) {
  console.error(`test: no files match ${pattern} — refusing to pass on zero tests`);
  process.exit(1);
}

// No `failed` field here: @types/node omits it from the summary counts even though the
// runtime emits it. The check below needs only these, and it fails closed if any is missing.
/** @typedef {{ tests: number, passed: number, cancelled: number, skipped: number, todo: number }} Counts */

/** @type {Map<string, Counts>} */
const perFile = new Map();
/** Held in an object: a bare `let` assigned only in a callback narrows to `undefined`. */
const summary = { total: /** @type {Counts | undefined} */ (undefined) };

const stream = run({ files });
stream.on("test:summary", (data) => {
  if (data.file === undefined) {
    summary.total = data.counts;
  } else {
    perFile.set(path.resolve(data.file), data.counts);
  }
});

for await (const chunk of stream.compose(spec)) {
  process.stdout.write(chunk);
}

const problems = [];
const { total } = summary;
if (total === undefined) {
  problems.push("the runner produced no summary");
} else {
  // Every test must be counted as passed. Written as the condition to *pass* so that a missing
  // or non-numeric count compares false and fails, rather than slipping through as NaN.
  const { tests, passed, cancelled, skipped, todo } = total;
  const clean = tests > 0 && passed === tests && cancelled === 0 && skipped === 0 && todo === 0;
  if (!clean) {
    problems.push(
      `${passed} of ${tests} passed (${cancelled} cancelled, ${skipped} skipped, ${todo} todo)`,
    );
  }
}
let passed = 0;
for (const file of files) {
  const counts = perFile.get(file);
  if (counts === undefined || counts.passed === 0) {
    problems.push(`${path.relative(process.cwd(), file)} passed no tests`);
  } else {
    passed += counts.passed;
  }
}
if (passed === 0) {
  problems.push("zero tests passed");
}

console.log(`test: ${files.length} file(s), ${passed} test(s) passed`);
if (problems.length > 0) {
  for (const p of problems) console.error(`test: FAIL — ${p}`);
  process.exit(1);
}
