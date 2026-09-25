// ESLint directive policy outside control source (CSR-WO-0000a §1.2 and the architect's review):
//   - honoured: only the line-scoped `eslint-disable-line` and `eslint-disable-next-line`, and
//     only with a `-- reason` description, e.g. `// eslint-disable-next-line rule -- reason`;
//   - forbidden, reason or not: file-wide and block-wide `eslint-disable` (and its `eslint-enable`
//     pair), inline rule configuration (`eslint` followed by rules), and `global`, `globals`,
//     `exported`. Their scope is an unknown set of findings at an unknown set of lines, which a
//     review cannot see.
// ESLint parses directive descriptions but cannot require them or restrict directive kinds, and a
// plugin would be a dependency; this check is the rule. Control source (packages/*/src) is stricter
// still: `noInlineConfig` there ignores and reports any directive at all. Run by `npm run lint`.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Every directive ESLint recognises, by the kind word that opens the comment. Longer kinds first.
const DIRECTIVE = /^(eslint-disable-next-line|eslint-disable-line|eslint-disable|eslint-enable|eslint|globals?|exported)(?:\s|$)/;
const LINE_SCOPED = new Set(["eslint-disable-next-line", "eslint-disable-line"]);
// ESLint's separator for a directive's description (whitespace, two or more dashes, whitespace),
// then a reason with at least one letter or digit: `-- .` is not a reason.
const REASON = /\s-{2,}\s+.*[A-Za-z0-9]/;

// Tracked files and untracked-but-not-ignored ones: the same set `eslint .` lints, so a new file
// is checked before it is ever added.
const patterns = ["*.ts", "*.mts", "*.cts", "*.js", "*.mjs", "*.cjs"];
const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...patterns], {
  encoding: "utf8",
}).split("\0").filter(Boolean);

// Every `//` and every `/*` is treated as a comment start, overlapping, without tracking strings:
// a stray `/*` in a string or regex cannot swallow a real directive after it. The cost is a false
// positive on a string that looks like a directive, which fails closed.
/** @type {[string, string][]} */
const COMMENT_FORMS = [["//", "\n"], ["/*", "*/"]];
let bad = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const [open, close] of COMMENT_FORMS) {
    for (let at = text.indexOf(open); at !== -1; at = text.indexOf(open, at + 1)) {
      const end = text.indexOf(close, at + 2);
      const body = text.slice(at + 2, end === -1 ? text.length : end).trim();
      const kind = DIRECTIVE.exec(body)?.[1];
      if (kind === undefined) continue;
      const where = `${file}:${String(text.slice(0, at).split("\n").length)}`;
      if (!LINE_SCOPED.has(kind)) {
        console.error(`check-directives: ${where} "${kind}" directive is forbidden: only line-scoped disables with a reason are allowed`);
        bad++;
      } else if (!REASON.test(body)) {
        console.error(`check-directives: ${where} "${kind}" without a "-- reason"`);
        bad++;
      }
    }
  }
}
console.log(`check-directives: ${String(files.length)} file(s), ${String(bad)} directive problem(s)`);
process.exitCode = bad === 0 ? 0 : 1;
