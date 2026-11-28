// The control-deletion coverage detector (CSR-WO-2008c §1.5). Pure functions over their inputs, so a
// test can plant a bad one; scripts/deletion-coverage.test.mjs runs them over the real repository.
//
// It fails when:
//   (a) a packages/*/test/**/*.test.ts file is in no row's `tests` and not in unlisted.json (and when
//       an unlisted.json entry names a missing file, a file a row also lists, or has no reason);
//   (b) a "built" row of docs/architecture.md §8 has no deletion row (`section8`) and is not exempt
//       (and when a row's `section8` names no §8 title, or an exemption names a row that is not
//       built or does have a deletion row);
//   (a') a file a row lists has no test any row names in `mustFail`: listed, it runs, but proves nothing;
//   (c) a CHECKS.md id is named by no row's `checks`, or by more than one (and when a `checks` entry
//       names an id not in CHECKS.md). An id no stub can delete, such as an absence, is exempt only by
//       an exempt.json entry {check, reason}, which goes stale when a row names the id.
// A table line it cannot read, and an empty input, are failures too: a parse that skips silently
// would let a control drop out with the detector still green.

import { existsSync, globSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");

/** @typedef {{ id: string, section8?: string, tests?: string[], mustFail?: string[], checks?: string[] }} Row */
/** @typedef {{ path: string, reason: string }} Unlisted */
/** @typedef {{ section8?: string, check?: string, control?: string, reason: string }} Exempt */
/** @typedef {{ title: string, status: string, built: boolean, ambiguous?: boolean }} Section8Row */

/** Backticks out, whitespace collapsed: the form in which §8 titles and `section8` are compared. @param {string} s */
export const normalise = (s) => s.replaceAll("`", "").replace(/\s+/g, " ").trim();

/**
 * The rows of the §8 table: title (first cell) and status (last cell). `built` is true when the
 * status cell leads with the word built, bold or not; planned, deferred and the rest are not.
 * @param {string} architecture
 * @returns {Section8Row[]}
 */
export function parseSection8(architecture) {
  const lines = architecture.split("\n");
  const start = lines.findIndex((l) => /^##\s+8\.\s/.test(l));
  if (start < 0) throw new Error("docs/architecture.md: no '## 8.' heading found");
  /** @type {Section8Row[]} */
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.trim().replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
    const first = cells[0] ?? "";
    if (first === "Control" || /^-+$/.test(first.replaceAll(":", ""))) continue;
    const status = (cells.at(-1) ?? "").trim();
    const built = /^(\*\*)?built\b/i.test(status);
    rows.push({ title: normalise(first), status, built, ambiguous: !built && /\bbuilt\b/i.test(status) });
  }
  return rows;
}

/**
 * Every check id in CHECKS.md: the first cell of a table row that is a letter, digits and an optional
 * lower-case suffix (H1, H3a, K2, C4a, J5, G2).
 * @param {string} checks
 * @returns {string[]}
 */
export function parseCheckIds(checks) {
  /** @type {string[]} */
  const ids = [];
  for (const line of checks.split("\n")) {
    const m = /^\|\s*([A-Z]\d+[a-z]?)\s*\|/.exec(line);
    if (m?.[1] !== undefined) ids.push(m[1]);
  }
  return ids;
}

/** Table lines whose first cell looks like a check id but is not one in the form parseCheckIds
 *  reads (`| **G6** |`, `| G7 (layer) |`): each would be a check the detector never saw.
 *  @param {string} checks */
export function unreadCheckLines(checks) {
  return checks.split("\n").filter((line) => {
    if (!line.trimStart().startsWith("|") || /^\|\s*([A-Z]\d+[a-z]?)\s*\|/.test(line)) return false;
    const first = line.trim().slice(1).split("|")[0] ?? "";
    return /\b[A-Z]\d+[a-z]?\b/.test(first);
  });
}

/** A test title as the source writes it: a template literal's text before its first `${` is a
 *  prefix every title it produces begins with.
 *  @param {string} source
 *  @returns {{ text: string, prefix: boolean }[]} */
export function titlesIn(source) {
  return [...source.matchAll(/\bit\((["'`])((?:\\.|(?!\1).)*)\1/g)].map((m) => {
    const raw = m[2] ?? "";
    const cut = m[1] === "`" ? raw.indexOf("${") : -1;
    return cut === -1 ? { text: raw, prefix: false } : { text: raw.slice(0, cut), prefix: true };
  });
}

/**
 * @param {{ rows: readonly Row[], testFiles: readonly string[], unlisted: readonly Unlisted[],
 *   exempt: readonly Exempt[], architecture: string, checksMd: string,
 *   exists?: (p: string) => boolean, titlesOf?: (p: string) => { text: string, prefix: boolean }[] }} input
 * @returns {{ failures: string[], section8: Section8Row[], checkIds: string[] }}
 */
export function detect({ rows, testFiles, unlisted, exempt, architecture, checksMd, exists = (p) => existsSync(path.join(ROOT, p)), titlesOf }) {
  /** @type {string[]} */
  const failures = [];
  if (testFiles.length === 0) failures.push("(a) no test files were found: the glob matched nothing, so nothing was checked.");

  // (a) test files
  const listed = new Set(rows.flatMap((r) => r.tests ?? []));
  const unlistedPaths = new Set(unlisted.map((u) => u.path));
  for (const f of testFiles) {
    if (!listed.has(f) && !unlistedPaths.has(f)) {
      failures.push(
        `(a) ${f}: a test file in no row's \`tests\` and not in test/deletion/unlisted.json. Add it to the \`tests\` of the row whose control it proves, or add {"path", "reason"} to test/deletion/unlisted.json if it is deliberately no control's proof.`,
      );
    }
  }
  for (const u of unlisted) {
    if (!exists(u.path)) {
      failures.push(`(a) test/deletion/unlisted.json names ${u.path}, which does not exist. Delete the entry or fix the path.`);
    }
    if (listed.has(u.path)) {
      failures.push(`(a) test/deletion/unlisted.json names ${u.path}, which a row also lists. Delete the unlisted.json entry.`);
    }
    if (typeof u.reason !== "string" || u.reason.trim() === "") {
      failures.push(`(a) test/deletion/unlisted.json entry ${u.path} has an empty reason. Give the one-line reason it is in no row.`);
    }
  }

  // (a') every listed file proves something: one of its tests is named by some row
  if (titlesOf !== undefined) {
    const named = rows.flatMap((r) => r.mustFail ?? []);
    for (const f of listed) {
      const titles = titlesOf(f);
      const proven = titles.some((t) => named.some((n) => (t.prefix ? n.startsWith(t.text) : n === t.text)));
      if (!proven) failures.push(`(a) ${f}: a row lists it, but no row names any of its tests in \`mustFail\`. Name a test of it that the row's stub turns red, or take it out of the row and give it a reason in test/deletion/unlisted.json.`);
    }
  }

  // (b) §8
  const section8 = parseSection8(architecture);
  if (!section8.some((s) => s.built)) failures.push("(b) docs/architecture.md §8: no row parsed as built, so nothing was checked.");
  for (const s of section8.filter((x) => x.ambiguous === true)) {
    failures.push(`(b) docs/architecture.md §8 row "${s.title}": its status mentions built but does not lead with it ("${s.status.slice(0, 40)}"). Write it as built, or as planned or deferred, so the detector can read it.`);
  }
  const titles = new Map(section8.map((s) => [s.title, s]));
  const rowTitles = new Set(rows.map((r) => (r.section8 === undefined ? "" : normalise(r.section8))));
  const exemptTitles = new Map(exempt.flatMap((e) => (e.section8 === undefined ? [] : [[normalise(e.section8), e]])));
  for (const s of section8) {
    if (s.built && !rowTitles.has(s.title) && !exemptTitles.has(s.title)) {
      failures.push(
        `(b) docs/architecture.md §8 row "${s.title}" is marked built and has no deletion row. Add a row in test/deletion/controls.json whose \`section8\` is exactly this title, or, if it is not a packages/*/src control, add it to test/deletion/exempt.json with the reason and the proof it has instead.`,
      );
    }
  }
  for (const r of rows) {
    if (r.section8 !== undefined && !titles.has(normalise(r.section8))) {
      failures.push(`(b) controls.json row "${r.id}" has \`section8\` "${r.section8}", which matches no §8 title in docs/architecture.md. Correct the title.`);
    }
  }
  for (const [title, e] of exemptTitles) {
    const s = titles.get(title);
    if (s === undefined) {
      failures.push(`(b) test/deletion/exempt.json names "${e.section8}", which matches no §8 title. Fix or delete the entry.`);
    } else if (!s.built) {
      failures.push(`(b) test/deletion/exempt.json exempts "${title}", but §8 does not mark it built (status: ${s.status.slice(0, 40)}). Delete the exemption.`);
    } else if (rowTitles.has(title)) {
      failures.push(`(b) test/deletion/exempt.json exempts "${title}", but a deletion row has it. Delete the exemption.`);
    }
    if (typeof e.reason !== "string" || e.reason.trim() === "") {
      failures.push(`(b) test/deletion/exempt.json entry "${title}" has an empty reason. Name the proof it has instead.`);
    }
  }

  // A control no stub can delete honestly (an absence, or a layer that only a message tells apart)
  // is recorded as {control, reason}; an entry that names nothing is malformed.
  for (const e of exempt) {
    const kinds = [e.section8, e.check, e.control].filter((k) => k !== undefined).length;
    if (kinds !== 1) failures.push(`(b) test/deletion/exempt.json: an entry must name exactly one of section8, check or control (${JSON.stringify(e).slice(0, 80)}).`);
    if (e.control !== undefined && (typeof e.reason !== "string" || e.reason.trim() === "")) failures.push(`(b) test/deletion/exempt.json entry for "${e.control}" has an empty reason. Say why no stub can delete it.`);
  }

  // (c) CHECKS.md ids
  const checkIds = parseCheckIds(checksMd);
  if (checkIds.length === 0) failures.push("(c) packages/core/src/auth/CHECKS.md: no check ids parsed, so nothing was checked.");
  for (const l of unreadCheckLines(checksMd)) failures.push(`(c) packages/core/src/auth/CHECKS.md: a table line looks like a check but its id is not in the form | H1 |: ${l.slice(0, 80)}`);
  const known = new Set(checkIds);
  for (const id of known) {
    if (checkIds.filter((x) => x === id).length > 1) {
      failures.push(`(c) packages/core/src/auth/CHECKS.md lists id ${id} more than once. Make ids unique.`);
    }
  }
  /** @type {Map<string, string[]>} */
  const namedBy = new Map([...known].map((id) => [id, []]));
  for (const r of rows) {
    for (const id of r.checks ?? []) {
      const by = namedBy.get(id);
      if (by === undefined) {
        failures.push(`(c) controls.json row "${r.id}" names check ${id}, which is not in packages/core/src/auth/CHECKS.md. Fix the id.`);
      } else {
        by.push(r.id);
      }
    }
  }
  const exemptChecks = new Map(exempt.flatMap((e) => (e.check === undefined ? [] : [[e.check, e]])));
  for (const [id, e] of exemptChecks) {
    if (!known.has(id)) failures.push(`(c) test/deletion/exempt.json exempts check ${id}, which is not in packages/core/src/auth/CHECKS.md. Fix or delete the entry.`);
    else if ((namedBy.get(id) ?? []).length > 0) failures.push(`(c) test/deletion/exempt.json exempts check ${id}, but a row names it. Delete the exemption.`);
    if (typeof e.reason !== "string" || e.reason.trim() === "") failures.push(`(c) test/deletion/exempt.json entry for check ${id} has an empty reason. Say why no stub can delete it.`);
  }
  for (const [id, by] of namedBy) {
    if (by.length === 0 && exemptChecks.has(id)) continue;
    if (by.length === 0) {
      failures.push(`(c) CHECKS.md check ${id} is named by no row's \`checks\`. Add "${id}" to the \`checks\` of the one row whose stub deletes it, or write that row.`);
    } else if (by.length > 1) {
      failures.push(`(c) CHECKS.md check ${id} is named by ${String(by.length)} rows (${by.join(", ")}). Keep it in exactly one \`checks\` array.`);
    }
  }

  return { failures, section8, checkIds };
}

/** The detector over the real repository. */
export function detectRepo() {
  /** @param {string} p */
  const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
  /** @param {string} p @returns {unknown} */
  const json = (p) => JSON.parse(read(p));
  const manifest = /** @type {{ rows: Row[] }} */ (json("test/deletion/controls.json"));
  const testFiles = globSync("packages/*/test/**/*.test.ts", { cwd: ROOT })
    .map((f) => f.split(path.sep).join("/"))
    .sort();
  return detect({
    rows: manifest.rows,
    testFiles,
    unlisted: /** @type {Unlisted[]} */ (json("test/deletion/unlisted.json")),
    exempt: /** @type {Exempt[]} */ (json("test/deletion/exempt.json")),
    architecture: read("docs/architecture.md"),
    checksMd: read("packages/core/src/auth/CHECKS.md"),
    titlesOf: (p) => titlesIn(read(p)),
  });
}
