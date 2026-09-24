// Runs the suite on Node's built-in test runner and refuses to pass on nothing (N5).
//
// `node --test` exits zero when its glob matches no files, and it reports a test file that
// registers no tests as a single *passing* test named after the file. Either would let a suite
// pass by running nothing, so this wrapper fails when:
//   - the glob matches no files;
//   - any matched file produced no per-file summary, or a summary with zero tests;
//   - any test failed or was cancelled.
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

const perFile = new Map();
let total;

const stream = run({ files });
stream.on("test:summary", (data) => {
  if (data.file === undefined) {
    total = data.counts;
  } else {
    perFile.set(path.resolve(data.file), data.counts);
  }
});

for await (const chunk of stream.compose(spec)) {
  process.stdout.write(chunk);
}

const problems = [];
if (total === undefined) {
  problems.push("the runner produced no summary");
} else if (total.failed > 0 || total.cancelled > 0) {
  problems.push(`${total.failed} failed, ${total.cancelled} cancelled`);
}
let ran = 0;
for (const file of files) {
  const counts = perFile.get(file);
  if (counts === undefined || counts.tests === 0) {
    problems.push(`${path.relative(process.cwd(), file)} ran no tests`);
  } else {
    ran += counts.tests;
  }
}
if (ran === 0) {
  problems.push("zero tests ran");
}

console.log(`test: ${files.length} file(s), ${ran} test(s) ran`);
if (problems.length > 0) {
  for (const p of problems) console.error(`test: FAIL — ${p}`);
  process.exit(1);
}
