// The control-deletion job (CSR-WO-2008; northstar N5: a control that cannot fail is not a control).
//
// For every built control, test/deletion/controls.json names a reviewed stub (a patch that deletes
// or disables the control), the test files to run, and the specific tests that must fail. This
// runner:
//   1. copies the tracked tree (the working tree's tracked files; in CI, exactly the commit under
//      test) into a temporary directory, with its own workspace links, and builds it;
//   2. runs every row's tests on that unpatched copy, and stops if any of them fails, is skipped,
//      or is missing: a red that was already red proves nothing;
//   3. for each row, copies the base again, applies the stub with `git apply`, rebuilds if the stub
//      touched a package's source, runs the row's tests, and requires each named test to fail BY
//      ASSERTION;
//   4. deletes every temporary directory, and exits nonzero on any miss.
//
// How a failure is told apart. This file is also the test reporter the runner passes to
// `node --test` (its default export). A named test counts as red only when it failed with the
// runner's `testCodeFailure` and a cause that is an AssertionError (`ERR_ASSERTION`). A thrown error
// of any other kind, a `testTimeoutFailure`, a hook failure, a skip or todo (which the runner reports
// as a pass), and a test that never ran because its file did not load are each a miss, named as
// such. A stub that breaks the build is refused before any test runs.
//
// A stub that no longer applies fails the job and names its row. A stub may touch only the files
// its row declares as the control, never a test file (`*.test.ts`), a file of its own row's tests,
// or anything under test/deletion/.
//
// Usage: node scripts/control-deletion.mjs [--self-test] [--row <id>]... [--manifest <path>] [--list] [--show]
//   --self-test run the runner's own three red-proofs (test/deletion/red-proofs/) and exit
//   --row       run only these rows (repeatable)
//   --manifest  another manifest
//   --list      print the rows and exit
//   --show      also print every test outcome after each stub (for writing a row)

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * @typedef {object} Row
 * @property {string} id
 * @property {string} section8  the architecture §8 row it proves
 * @property {string} control   what the stub deletes, in one line
 * @property {string[]} touches the control's files: the only files the stub may change
 * @property {string} stub      the patch, relative to the manifest
 * @property {string[]} tests   the test files to run
 * @property {string[]} mustFail the tests that must fail by assertion
 */

/**
 * @typedef {object} TestLine
 * @property {"pass" | "fail"} outcome
 * @property {string} name
 * @property {string} file
 * @property {boolean} skip
 * @property {boolean} todo
 * @property {string | undefined} failureType
 * @property {boolean} assertion
 * @property {string | undefined} cause
 */

/**
 * @param {unknown} v
 * @param {string} key
 * @returns {unknown}
 */
const get = (v, key) => (typeof v === "object" && v !== null ? /** @type {Record<string, unknown>} */ (v)[key] : undefined);

/**
 * The reporter: one JSON line per finished test.
 * @param {AsyncIterable<{ type: string, data: unknown }>} source
 * @returns {AsyncGenerator<string>}
 */
export default async function* reporter(source) {
  for await (const event of source) {
    if (event.type !== "test:pass" && event.type !== "test:fail") continue;
    const d = event.data;
    const error = get(get(d, "details"), "error");
    const cause = get(error, "cause");
    const causeName = get(cause, "name");
    const causeMessage = get(cause, "message");
    const failureType = get(error, "failureType");
    /** @type {TestLine} */
    const line = {
      outcome: event.type === "test:pass" ? "pass" : "fail",
      name: String(get(d, "name")),
      file: typeof get(d, "file") === "string" ? String(get(d, "file")) : "",
      skip: get(d, "skip") !== undefined && get(d, "skip") !== false,
      todo: get(d, "todo") !== undefined && get(d, "todo") !== false,
      failureType: typeof failureType === "string" ? failureType : undefined,
      assertion: get(cause, "code") === "ERR_ASSERTION" || causeName === "AssertionError",
      cause: cause === undefined ? undefined : `${typeof causeName === "string" ? causeName : "Error"}: ${(typeof causeMessage === "string" ? causeMessage : "").split("\n")[0] ?? ""}`.slice(0, 200),
    };
    yield `${JSON.stringify(line)}\n`;
  }
}

const REPO = path.resolve(import.meta.dirname, "..");
const SELF = import.meta.filename;
const TSC = path.join(REPO, "node_modules", "typescript", "bin", "tsc");
const BUILT_PACKAGES = ["packages/core", "packages/teaching"];
const ROW_TIMEOUT_MS = 240_000;

// The runner's own red-proofs: each manifest holds one row built to be wrong, and the runner must
// fail on it, for that reason. Run first in CI, so a runner that stopped telling red from green
// cannot report the real manifest green.
const SELF_TEST = [
  { file: "noop.json", expect: "stayed green" },
  { file: "stale.json", expect: "no longer applies" },
  { file: "breaks-the-build.json", expect: "no longer builds, so no test failed by assertion" },
];

/** @type {string[]} */
const temps = [];
function cleanup() {
  for (const t of temps.splice(0)) fs.rmSync(t, { recursive: true, force: true });
}

/** @param {string} label */
function tempDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `clearseal-deletion-${label}-`));
  temps.push(dir);
  return dir;
}

/**
 * The files a patch changes, from its `---`/`+++` headers.
 * @param {string} text
 */
function patchedFiles(text) {
  /** @type {Set<string>} */
  const files = new Set();
  for (const line of text.split("\n")) {
    const m = /^(?:---|\+\+\+) (?:[ab]\/)?(.+?)\s*$/.exec(line);
    if (m !== null && m[1] !== undefined && m[1] !== "/dev/null") files.add(m[1]);
  }
  return [...files];
}

/**
 * Reasons a row's stub is not allowed, before it is ever applied.
 * @param {Row} row
 * @param {string} text
 */
function stubProblems(row, text) {
  /** @type {string[]} */
  const out = [];
  if (!/^@@ /m.test(text)) out.push("the stub has no hunk");
  for (const f of patchedFiles(text)) {
    if (!row.touches.includes(f)) out.push(`the stub touches ${f}, which the row does not declare as its control`);
    if (f.endsWith(".test.ts") || row.tests.includes(f)) out.push(`the stub touches a test file (${f})`);
    if (f.startsWith("test/deletion/")) out.push(`the stub touches the deletion job itself (${f})`);
  }
  return out;
}

/**
 * Reads and checks a manifest; the rows, or the problems.
 * @param {string} file
 * @returns {{ rows: Row[], problems: string[] }}
 */
function loadManifest(file) {
  /** @type {unknown} */
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const rows = get(parsed, "rows");
  /** @type {string[]} */
  const problems = [];
  if (!Array.isArray(rows) || rows.length === 0) problems.push("the manifest has no rows");
  /** @type {Set<unknown>} */
  const ids = new Set();
  /** @param {unknown} v */
  const strings = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && x !== "");
  /** @type {unknown[]} */
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) {
    const id = get(row, "id");
    const where = `row ${JSON.stringify(id)}`;
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(id)) problems.push(`${where}: id must be lower-case words joined by -`);
    if (ids.has(id)) problems.push(`${where}: duplicate id`);
    ids.add(id);
    for (const field of ["section8", "control", "stub"]) {
      const v = get(row, field);
      if (typeof v !== "string" || v === "") problems.push(`${where}: ${field} is required`);
    }
    for (const field of ["touches", "tests", "mustFail"]) if (!strings(get(row, field))) problems.push(`${where}: ${field} must be a non-empty list of strings`);
    const tests = get(row, "tests");
    if (Array.isArray(tests)) {
      for (const t of /** @type {unknown[]} */ (tests)) if (typeof t === "string" && !t.endsWith(".test.ts")) problems.push(`${where}: ${t} is not a test file`);
    }
  }
  return { rows: /** @type {Row[]} */ (list), problems };
}

/**
 * A copy of the tracked tree, its own git repository (so `git apply` resolves paths inside it),
 * with third-party modules linked from the real tree and the workspace links recreated inside it,
 * so `@clearseal/core` in the copy is the copy's core, never the real one.
 */
function makeBase() {
  const dir = tempDir("base");
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: REPO }).toString().split("\0").filter(Boolean);
  for (const f of files) {
    const src = path.join(REPO, f);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.cpSync(src, path.join(dir, f), { verbatimSymlinks: true });
  }
  /**
   * @param {string} from
   * @param {string} to
   */
  const linkModules = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from)) {
      const real = path.join(from, entry);
      if (entry === "@clearseal") {
        fs.mkdirSync(path.join(to, entry));
        // The workspace links are relative (../../packages/core): recreated as they are, they
        // resolve inside the copy.
        for (const ws of fs.readdirSync(real)) fs.symlinkSync(fs.readlinkSync(path.join(real, ws)), path.join(to, entry, ws));
      } else {
        fs.symlinkSync(real, path.join(to, entry));
      }
    }
  };
  linkModules(path.join(REPO, "node_modules"), path.join(dir, "node_modules"));
  for (const pkgDir of ["packages", "spikes"]) {
    for (const p of fs.readdirSync(path.join(REPO, pkgDir))) {
      const nm = path.join(REPO, pkgDir, p, "node_modules");
      if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(dir, pkgDir, p, "node_modules"));
    }
  }
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

/**
 * Builds the packages a test may load through their `dist`; the reason if it fails.
 * @param {string} dir
 */
function build(dir) {
  for (const pkg of BUILT_PACKAGES) {
    const cwd = path.join(dir, pkg);
    fs.rmSync(path.join(cwd, "dist"), { recursive: true, force: true });
    const r = spawnSync(process.execPath, [TSC, "-p", "tsconfig.build.json"], { cwd, encoding: "utf8" });
    // tsc's own "file(l,c): error TSnnnn" form is reworded, so a CI problem matcher does not turn a
    // red-proof's expected build failure into an error annotation on a green run.
    if (r.status !== 0) return `the build of ${pkg} failed: ${`${r.stdout}${r.stderr}`.split("\n").slice(0, 3).join(" ").replace(/: error (TS\d+)/g, ": $1")}`;
  }
  return undefined;
}

/**
 * Runs test files in a copy: every finished test's line, or why it could not.
 * @param {string} dir
 * @param {string[]} tests
 * @returns {{ events: TestLine[], error: string | undefined }}
 */
function runTests(dir, tests) {
  const env = { ...process.env };
  delete env["NODE_TEST_CONTEXT"];
  const r = spawnSync(process.execPath, ["--test", `--test-reporter=${SELF}`, "--test-reporter-destination=stdout", ...tests], { cwd: dir, env, encoding: "utf8", timeout: ROW_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  if (r.error !== undefined) return { events: [], error: get(r.error, "code") === "ETIMEDOUT" ? `timed out after ${String(ROW_TIMEOUT_MS)} ms` : r.error.message };
  /** @type {TestLine[]} */
  const events = [];
  for (const line of r.stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      /** @type {unknown} */
      const parsed = JSON.parse(line);
      const e = /** @type {TestLine} */ (parsed);
      events.push({ ...e, file: path.relative(dir, e.file) });
    } catch {
      // Not a reporter line.
    }
  }
  return { events, error: undefined };
}

/**
 * The one line for a named test in these files; a string if it is missing or ambiguous.
 * @param {TestLine[]} events
 * @param {string[]} tests
 * @param {string} name
 * @returns {TestLine | string}
 */
function find(events, tests, name) {
  const hits = events.filter((e) => e.name === name && tests.includes(e.file));
  if (hits.length === 0) return "not run";
  if (hits.length > 1) return `ambiguous: ${String(hits.length)} tests are named this`;
  return hits[0] ?? "not run";
}

function selfTest() {
  let ok = true;
  for (const { file, expect } of SELF_TEST) {
    const r = spawnSync(process.execPath, [SELF, "--manifest", path.join(REPO, "test", "deletion", "red-proofs", file)], { encoding: "utf8" });
    const miss = `${r.stdout}${r.stderr}`.split("\n").find((l) => l.startsWith("MISS ")) ?? "(no MISS line)";
    const pass = r.status === 1 && miss.includes(expect);
    ok &&= pass;
    console.log(`${pass ? "self-test ok  " : "self-test FAIL"} ${file}: exit ${String(r.status)}; ${miss}`);
  }
  if (!ok) {
    console.error("control-deletion: --self-test FAILED — the runner did not fail a row built to be wrong, for its reason");
    return 1;
  }
  console.log("control-deletion: --self-test passed — a no-op stub, a stale stub and a build-breaking stub each fail the job");
  return 0;
}

/**
 * Runs one row's stub in its own copy of the base: undefined if every named test went red by
 * assertion, else what went wrong.
 * @param {Row} row
 * @param {string} base
 * @param {string} manifestDir
 * @param {boolean} show
 */
function runRow(row, base, manifestDir, show) {
  const stubPath = path.resolve(manifestDir, row.stub);
  /** @type {string} */
  let text;
  try {
    text = fs.readFileSync(stubPath, "utf8");
  } catch {
    return `stub ${row.stub} cannot be read`;
  }
  const refused = stubProblems(row, text);
  if (refused.length > 0) return `stub refused: ${refused.join("; ")}`;
  const dir = tempDir(row.id);
  try {
    fs.cpSync(base, dir, { recursive: true, verbatimSymlinks: true });
    const applied = spawnSync("git", ["apply", "--whitespace=nowarn", stubPath], { cwd: dir, encoding: "utf8" });
    if (applied.status !== 0) return `stub ${row.stub} no longer applies: ${applied.stderr.trim().split("\n")[0] ?? ""}`;
    if (patchedFiles(text).some((f) => BUILT_PACKAGES.some((p) => f.startsWith(`${p}/src/`)))) {
      const broken = build(dir);
      if (broken !== undefined) return `stub applied, but the copy no longer builds, so no test failed by assertion: ${broken}`;
    }
    const result = runTests(dir, row.tests);
    if (result.error !== undefined) return `stub applied; the tests did not finish: ${result.error}`;
    if (show) {
      for (const e of result.events) console.log(`  ${e.outcome}${e.skip ? " (skip)" : ""} ${e.file} :: ${e.name}${e.outcome === "fail" ? ` [${String(e.failureType)}${e.assertion ? ", assertion" : ""}${e.cause === undefined ? "" : `, ${e.cause}`}]` : ""}`);
    }
    /** @type {string[]} */
    const bad = [];
    for (const name of row.mustFail) {
      const hit = find(result.events, row.tests, name);
      if (typeof hit === "string") bad.push(`"${name}" ${hit === "not run" ? "did not run (a file that no longer loads, or a renamed test)" : hit}`);
      else if (hit.outcome === "pass") bad.push(`"${name}" stayed green${hit.skip ? " (skipped)" : ""}`);
      else if (!hit.assertion) bad.push(`"${name}" failed, but not by assertion (${String(hit.failureType)}${hit.cause === undefined ? "" : `: ${hit.cause}`})`);
    }
    return bad.length > 0 ? `stub applied; ${bad.join("; ")}` : undefined;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** @param {string[]} args */
function main(args) {
  /** @type {string[]} */
  const only = [];
  let manifestPath = path.join(REPO, "test", "deletion", "controls.json");
  let list = false;
  let show = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--self-test") return selfTest();
    if (a === "--row") only.push(String(args[++i]));
    else if (a === "--manifest") manifestPath = path.resolve(String(args[++i]));
    else if (a === "--list") list = true;
    else if (a === "--show") show = true;
    else {
      console.error(`control-deletion: unknown argument ${String(a)}\nusage: node scripts/control-deletion.mjs [--self-test] [--row <id>]... [--manifest <path>] [--list] [--show]`);
      return 2;
    }
  }
  const manifestDir = path.dirname(manifestPath);
  const { rows: all, problems } = loadManifest(manifestPath);
  for (const id of only) if (!all.some((r) => r.id === id)) problems.push(`--row ${id}: no such row`);
  if (problems.length > 0) {
    for (const p of problems) console.error(`control-deletion: ${p}`);
    return 1;
  }
  const rows = only.length === 0 ? all : all.filter((r) => only.includes(r.id));
  if (list) {
    for (const r of rows) console.log(`${r.id} | ${r.section8} | ${r.control} | stub ${r.stub} | ${String(r.mustFail.length)} named test(s)`);
    return 0;
  }

  const started = Date.now();
  const base = makeBase();
  const baseBuild = build(base);
  if (baseBuild !== undefined) {
    console.error(`control-deletion: the unpatched copy does not build: ${baseBuild}`);
    return 1;
  }

  // The unpatched tree must pass every row's tests, with every named test present and run.
  const allTests = [...new Set(rows.flatMap((r) => r.tests))].sort();
  const baseline = runTests(base, allTests);
  /** @type {string[]} */
  const baseProblems = [];
  if (baseline.error !== undefined) baseProblems.push(baseline.error);
  else {
    for (const t of allTests) if (!baseline.events.some((e) => e.file === t)) baseProblems.push(`${t} ran no tests`);
    for (const e of baseline.events) {
      if (e.outcome !== "pass") baseProblems.push(`${e.file}: "${e.name}" fails on the unpatched tree (${String(e.failureType)}${e.cause === undefined ? "" : `, ${e.cause}`})`);
      else if (e.skip || e.todo) baseProblems.push(`${e.file}: "${e.name}" is ${e.skip ? "skipped" : "todo"} on the unpatched tree`);
    }
    for (const row of rows) {
      for (const name of row.mustFail) {
        const hit = find(baseline.events, row.tests, name);
        if (typeof hit === "string") baseProblems.push(`row ${row.id}: named test "${name}" is ${hit} on the unpatched tree`);
      }
    }
  }
  if (baseProblems.length > 0) {
    for (const p of baseProblems) console.error(`control-deletion: BASELINE ${p}`);
    console.error("control-deletion: the unpatched tree does not pass the rows' tests; no stub was run");
    return 1;
  }
  console.log(`control-deletion: baseline green: ${String(allTests.length)} test file(s), ${String(baseline.events.length)} test(s) passed on the unpatched tree`);

  let misses = 0;
  for (const row of rows) {
    const t0 = Date.now();
    const miss = runRow(row, base, manifestDir, show);
    if (miss !== undefined) misses++;
    console.log(`${miss === undefined ? "RED " : "MISS"} ${row.id} | ${row.section8} | ${miss ?? `stub applied; ${String(row.mustFail.length)}/${String(row.mustFail.length)} named test(s) red by assertion`} | ${String(Date.now() - t0)} ms`);
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (misses > 0) {
    console.error(`control-deletion: FAILED — ${String(misses)} of ${String(rows.length)} row(s) did not go red as named (${secs} s)`);
    return 1;
  }
  console.log(`control-deletion: every stub made its named tests fail by assertion — ${String(rows.length)} row(s), ${secs} s`);
  return 0;
}

// Run only when executed, not when `node --test` loads this file as its reporter.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === SELF) {
  process.on("exit", cleanup);
  for (const sig of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
    process.on(sig, () => {
      cleanup();
      process.exit(130);
    });
  }
  const code = main(process.argv.slice(2));
  cleanup();
  process.exit(code);
}
