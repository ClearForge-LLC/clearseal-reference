// Every ESLint directive that suppresses or reconfigures a rule must say why (CSR-WO-0000a §1.2):
// `// eslint-disable-next-line rule -- reason`. ESLint parses the `-- reason` description but has
// no built-in way to require it, and a plugin would be a dependency; this check is the rule.
// Control source (packages/*/src) is stricter still: `noInlineConfig` there ignores and reports
// any directive at all. Run by `npm run lint`; exits non-zero on a directive without a reason.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Directives that suppress or reconfigure. `eslint-enable` only restores, so it needs no reason.
const DIRECTIVE = /^(eslint-disable(?:-next-line|-line)?|eslint)(?:\s|$)/;
// ESLint's own separator for a directive's description: whitespace, two or more dashes, whitespace.
const REASON = /\s-{2,}\s+\S/;

// Tracked files and untracked-but-not-ignored ones: the same set `eslint .` lints, so a new file
// is checked before it is ever added.
const patterns = ["*.ts", "*.mts", "*.cts", "*.js", "*.mjs", "*.cjs"];
const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...patterns], {
  encoding: "utf8",
}).split("\0").filter(Boolean);

// Every `//` and every `/*` is treated as a comment start, overlapping, without tracking strings:
// a stray `/*` in a string or regex cannot swallow a real directive after it. The cost is a false
// positive on a string that looks like a reason-less directive, which fails closed.
/** @type {[string, string][]} */
const COMMENT_FORMS = [["//", "\n"], ["/*", "*/"]];
let bad = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const [open, close] of COMMENT_FORMS) {
    for (let at = text.indexOf(open); at !== -1; at = text.indexOf(open, at + 1)) {
      const end = text.indexOf(close, at + 2);
      const body = text.slice(at + 2, end === -1 ? text.length : end).trim();
      if (DIRECTIVE.test(body) && !REASON.test(body)) {
        console.error(`check-directives: ${file}:${String(text.slice(0, at).split("\n").length)} directive without a "-- reason"`);
        bad++;
      }
    }
  }
}
console.log(`check-directives: ${String(files.length)} file(s), ${String(bad)} directive(s) without a reason`);
process.exitCode = bad === 0 ? 0 : 1;
