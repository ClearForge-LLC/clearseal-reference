// The control-deletion job (CSR-WO-2008; northstar N5: a control that cannot fail is not a control).
//
// For every built control, test/deletion/controls.json names a reviewed stub (a patch that deletes
// or disables the control), the test files to run, and the specific tests that must fail. This
// runner:
//   1. copies the tracked tree (the working tree's tracked files; in CI, exactly the commit under
//      test) into a temporary directory, with its own workspace links, commits it there as a base,
//      and builds it;
//   2. runs every row's tests on that unpatched copy, and stops if any of them fails, is skipped,
//      or is missing: a red that was already red proves nothing;
//   3. for each row, copies the base again, applies the stub with `git apply`, checks what the stub
//      actually changed (from `git status` in the copy, not from the patch's headers), rebuilds if
//      it touched a package's source, runs the row's tests, and requires each named test to fail
//      BY ASSERTION;
//   4. deletes every temporary directory, and exits nonzero on any miss.
//
// How a failure is told apart. This file is also the test reporter the runner passes to
// `node --test` (its default export). A named test counts as red only when it failed as a
// `testCodeFailure` whose cause is an AssertionError (`ERR_ASSERTION`) thrown from test code (the
// first stack frame outside Node lies under packages/*/test/), and is not todo. A thrown
// error of any other kind, a `testTimeoutFailure`, a `hookFailure`, a skip or todo, and a test that
// never ran because its file did not load are each a miss, named as such. A stub that breaks the
// build is refused before any test runs.
//
// What RED proves, and what it does not. RED means the named assertions flipped when the stub was
// applied, on a tree where they passed without it. That the stub deletes the control, and not
// something else that trips the same assertion, is the manifest review's job: read the stub
// against its row's `control` line.
//
// What a stub may change. Only the files its row lists under `touches`; every such file must be a
// package's source (`packages/*/src/**`) or one of the named test-code controls below. Never a
// `*.test.ts` file, a file of its own row's tests, or anything under test/deletion/. What a stub
// changes is read from git (`git apply --numstat`, and `git status` after the apply), never from the
// patch's headers, so ignored paths, binary hunks and renames are all seen.
//
// The copy isolates the source, not the process. Third-party modules are symlinks into the real
// tree, and code running in the copy (a stub, a test) runs as the user: it could write through
// those links or anywhere else. Stubs are reviewed code; the copy protects the real tree from the
// patch, not from what patched code chooses to do.
//
// Sharding (CSR-WO-2008a). `--shard <i>/<n>` runs shard i of n (1-based): the manifest's rows at
// index k with k mod n = i - 1, in manifest order. The assignment depends only on the manifest, so
// the n shards partition it (every row in exactly one shard), and a run of all n is today's single
// run: each shard runs steps 1 to 4 over its own rows, its baseline before any of its stubs. Round
// robin by index, not balanced by cost: a cost would be a new field in every row, and rows added by one
// work order (which tend to cost alike) land in different shards anyway.
//
// Usage: node scripts/control-deletion.mjs [--self-test] [--row <id>... | --shard <i>/<n>] [--manifest <path>] [--list] [--show]
//   --self-test run the runner's own three red-proofs (test/deletion/red-proofs/) and exit
//   --row       run only these rows (repeatable)
//   --shard     run only shard i of n; a shard with no rows exits 0 and says so
//   --manifest  another manifest
//   --list      print the rows and exit
//   --show      also print every test outcome after each stub (for writing a row)

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
 * @property {string | undefined} origin  the file of the first stack frame outside Node itself
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
    const stack = get(cause, "stack");
    const frame = typeof stack === "string" ? /\((file:\/\/[^)\s]+?):\d+:\d+\)|at (file:\/\/\S+?):\d+:\d+/.exec(stack) : null;
    const frameUrl = frame === null ? undefined : (frame[1] ?? frame[2]);
    /** @type {TestLine} */
    const line = {
      outcome: event.type === "test:pass" ? "pass" : "fail",
      name: String(get(d, "name")),
      file: typeof get(d, "file") === "string" ? String(get(d, "file")) : "",
      skip: get(d, "skip") !== undefined && get(d, "skip") !== false,
      todo: get(d, "todo") !== undefined && get(d, "todo") !== false,
      failureType: typeof failureType === "string" ? failureType : undefined,
      assertion: get(cause, "code") === "ERR_ASSERTION" || causeName === "AssertionError",
      origin: frameUrl === undefined ? undefined : fileURLToPath(frameUrl),
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
/** Controls that live in test code rather than a package's source: the supply-boundary checker. */
const TEST_CODE_CONTROLS = ["packages/core/test/boundary/supply-boundary.ts", "packages/core/test/boundary/supply-boundary-child.ts"];

// The runner's own red-proofs: each manifest holds one row built to be wrong, and the runner must
// fail on it, for that reason. Run first in CI, so a runner that stopped telling red from green
// cannot report the real manifest green.
const SELF_TEST = [
  { file: "noop.json", expect: "stayed green" },
  { file: "stale.json", expect: "no longer applies" },
  { file: "breaks-the-build.json", expect: "no longer builds, so no test failed by assertion" },
];

// ── temporary directories and child processes, cleaned up on every exit ──────────────────────
/** @type {string[]} */
const temps = [];
/** @type {Set<import("node:child_process").ChildProcess>} */
const children = new Set();
function cleanup() {
  for (const child of children) {
    // Each child leads its own process group, so the test files it started go with it.
    try {
      if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  children.clear();
  for (const t of temps.splice(0)) fs.rmSync(t, { recursive: true, force: true });
}

/** @param {string} label */
function tempDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `clearseal-deletion-${label}-`));
  temps.push(dir);
  return dir;
}

/**
 * A child process, asynchronously, so a signal to the runner is handled between steps.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number }} [opts]
 * @returns {Promise<{ status: number | null, stdout: string, stderr: string, timedOut: boolean }>}
 */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    children.add(child);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    child.stdout.setEncoding("utf8").on("data", (c) => (stdout += String(c)));
    child.stderr.setEncoding("utf8").on("data", (c) => (stderr += String(c)));
    const timer =
      opts.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            try {
              if (child.pid !== undefined) process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL");
            } catch {
              // Already gone.
            }
          }, opts.timeoutMs);
    /** @param {number | null} status */
    const done = (status) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      children.delete(child);
      resolve({ status, stdout, stderr, timedOut });
    };
    child.on("close", done);
    child.on("error", (err) => {
      stderr += String(err);
      done(null);
    });
  });
}

/**
 * The files changed in a copy since its base commit, renames' both sides included.
 * @param {string} dir
 */
function changedFiles(dir) {
  const out = execFileSync("git", ["status", "--porcelain=v1", "-z", "-uall"], { cwd: dir }).toString();
  const parts = out.split("\0").filter(Boolean);
  /** @type {string[]} */
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = String(parts[i]);
    files.push(entry.slice(3));
    if (entry[0] === "R" || entry[0] === "C") files.push(String(parts[++i]));
  }
  return files;
}

/**
 * The paths a patch will change, as git itself parses it (the same parser `git apply` uses), so a
 * path git would otherwise not report (an ignored one, under node_modules/ or dist/, or behind a
 * .gitignore the patch adds) is still named. Renames give both sides.
 * @param {string} dir
 * @param {string} stubPath
 */
function patchPaths(dir, stubPath) {
  const out = execFileSync("git", ["apply", "--numstat", "-z", stubPath], { cwd: dir }).toString();
  const parts = out.split("\0");
  /** @type {string[]} */
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const fields = String(parts[i]).split("\t");
    if (fields.length < 3) continue;
    if (fields[2] !== "") files.push(String(fields[2]));
    else {
      files.push(String(parts[i + 1]), String(parts[i + 2]));
      i += 2;
    }
  }
  return files;
}

/**
 * Reasons what a stub changed is not allowed.
 * @param {Row} row
 * @param {string[]} files
 */
function changeProblems(row, files) {
  /** @type {string[]} */
  const out = [];
  if (files.length === 0) out.push("the stub changed no file");
  for (const f of files) {
    if (!row.touches.includes(f)) out.push(`the stub changed ${f}, which the row does not declare as its control`);
    if (f.endsWith(".test.ts") || row.tests.includes(f)) out.push(`the stub changed a test file (${f})`);
    if (f.startsWith("test/deletion/")) out.push(`the stub changed the deletion job itself (${f})`);
  }
  return out;
}

/**
 * Reads and checks a manifest; the rows, or the problems.
 * @param {string} file
 * @returns {{ rows: Row[], problems: string[] }}
 */
export function loadManifest(file) {
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
  /** A repository-relative path, inside the repository, with no climbing. @param {string} p */
  const inside = (p) => !path.isAbsolute(p) && !p.split(/[\\/]/).includes("..") && !p.includes("\\");
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
    for (const t of Array.isArray(tests) ? /** @type {unknown[]} */ (tests) : []) {
      if (typeof t !== "string") continue;
      if (!t.endsWith(".test.ts") || !t.startsWith("packages/") || !inside(t)) problems.push(`${where}: ${t} is not a test file under packages/`);
      else if (!fs.existsSync(path.join(REPO, t))) problems.push(`${where}: ${t} does not exist`);
    }
    const touches = get(row, "touches");
    for (const t of Array.isArray(touches) ? /** @type {unknown[]} */ (touches) : []) {
      if (typeof t !== "string") continue;
      const source = /^packages\/[^/]+\/src\//.test(t) || TEST_CODE_CONTROLS.includes(t);
      if (!source || !inside(t)) problems.push(`${where}: touches ${t}, which is neither a package's source nor a named test-code control`);
      else if (!fs.existsSync(path.join(REPO, t))) problems.push(`${where}: touches ${t}, which does not exist`);
    }
  }
  return { rows: /** @type {Row[]} */ (list), problems };
}

/**
 * A copy of the tracked tree, its own git repository with the copy committed as its base (so
 * `git apply` resolves paths inside it and `git status` says what a stub changed), third-party
 * modules linked from the real tree, and the workspace links recreated inside it, so
 * `@clearseal/core` in the copy is the copy's core, never the real one.
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
  const git = (/** @type {string[]} */ ...a) => execFileSync("git", ["-c", "user.name=control-deletion", "-c", "user.email=control-deletion@example.invalid", "-c", "commit.gpgsign=false", ...a], { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "base");
  return dir;
}

/**
 * Builds the packages a test may load through their `dist`; the reason if it fails.
 * @param {string} dir
 */
async function build(dir) {
  for (const pkg of BUILT_PACKAGES) {
    const cwd = path.join(dir, pkg);
    fs.rmSync(path.join(cwd, "dist"), { recursive: true, force: true });
    const r = await run(process.execPath, [TSC, "-p", "tsconfig.build.json"], { cwd });
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
 * @returns {Promise<{ events: TestLine[], error: string | undefined }>}
 */
async function runTests(dir, tests) {
  const env = { ...process.env };
  delete env["NODE_TEST_CONTEXT"];
  const r = await run(process.execPath, ["--test", `--test-reporter=${SELF}`, "--test-reporter-destination=stdout", ...tests], { cwd: dir, env, timeoutMs: ROW_TIMEOUT_MS });
  if (r.timedOut) return { events: [], error: `timed out after ${String(ROW_TIMEOUT_MS)} ms` };
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
 * Was an assertion thrown by test code (a package's test/ tree), not by the code under test? An
 * AssertionError can be made anywhere, named anything; where it was thrown is what tells the test's
 * own check apart from a crash in the source that happens to look like one.
 * @param {string} dir
 * @param {string | undefined} origin
 */
function isTestCode(dir, origin) {
  if (origin === undefined) return false;
  return /^packages\/[^/]+\/test\//.test(path.relative(dir, origin).split(path.sep).join("/"));
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

async function selfTest() {
  let ok = true;
  for (const { file, expect } of SELF_TEST) {
    const r = await run(process.execPath, [SELF, "--manifest", path.join(REPO, "test", "deletion", "red-proofs", file)]);
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
async function runRow(row, base, manifestDir, show) {
  const stubPath = path.resolve(manifestDir, row.stub);
  if (!fs.existsSync(stubPath)) return `stub ${row.stub} cannot be read`;
  const dir = tempDir(row.id);
  try {
    fs.cpSync(base, dir, { recursive: true, verbatimSymlinks: true });
    const check = await run("git", ["apply", "--check", "--whitespace=nowarn", stubPath], { cwd: dir });
    if (check.status !== 0) return `stub ${row.stub} no longer applies: ${check.stderr.trim().split("\n")[0] ?? ""}`;
    // What the stub changes: git's own parse of the patch (it names ignored paths too), and what
    // git status sees after the apply. Whatever the patch's headers claim, these are the truth.
    const planned = patchPaths(dir, stubPath);
    const applied = await run("git", ["apply", "--whitespace=nowarn", stubPath], { cwd: dir });
    if (applied.status !== 0) return `stub ${row.stub} no longer applies: ${applied.stderr.trim().split("\n")[0] ?? ""}`;
    const changed = [...new Set([...planned, ...changedFiles(dir)])];
    const refused = changeProblems(row, changed);
    if (refused.length > 0) return `stub refused: ${refused.join("; ")}`;
    if (changed.some((f) => BUILT_PACKAGES.some((p) => f.startsWith(`${p}/src/`)))) {
      const broken = await build(dir);
      if (broken !== undefined) return `stub applied, but the copy no longer builds, so no test failed by assertion: ${broken}`;
    }
    const result = await runTests(dir, row.tests);
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
      else if (hit.todo) bad.push(`"${name}" is todo`);
      else if (hit.failureType !== "testCodeFailure" || !hit.assertion) bad.push(`"${name}" failed, but not by assertion (${String(hit.failureType)}${hit.cause === undefined ? "" : `: ${hit.cause}`})`);
      else if (!isTestCode(dir, hit.origin)) bad.push(`"${name}" failed by an assertion thrown outside test code (${hit.origin === undefined ? "no stack" : path.relative(dir, hit.origin)}), not by the test's own check`);
    }
    return bad.length > 0 ? `stub applied; ${bad.join("; ")}` : undefined;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The shard argument, `<i>/<n>` with 1 <= i <= n: the pair, or why it is refused.
 * @param {string} arg
 * @returns {{ i: number, n: number } | string}
 */
export function parseShard(arg) {
  const m = /^(\d+)\/(\d+)$/.exec(arg);
  if (m === null) return `--shard ${arg}: expected <i>/<n>, shard i of n, as 2/4`;
  if (/^0\d|\/0\d/.test(arg)) return `--shard ${arg}: write the numbers without a leading zero`;
  const i = Number(m[1]);
  const n = Number(m[2]);
  if (!Number.isSafeInteger(i) || !Number.isSafeInteger(n)) return `--shard ${arg}: a number too large`;
  if (n < 1) return `--shard ${arg}: n must be at least 1`;
  if (i < 1) return `--shard ${arg}: shards are numbered from 1`;
  if (i > n) return `--shard ${arg}: there is no shard ${String(i)} of ${String(n)}`;
  return { i, n };
}

/**
 * The rows of shard i of n: those at index k with k mod n = i - 1, in manifest order.
 * @template T
 * @param {readonly T[]} rows
 * @param {number} i
 * @param {number} n
 * @returns {T[]}
 */
export function shardOf(rows, i, n) {
  return rows.filter((_, k) => k % n === i - 1);
}

const USAGE = "usage: node scripts/control-deletion.mjs [--self-test] [--row <id>... | --shard <i>/<n>] [--manifest <path>] [--list] [--show]";

/** @param {string[]} args */
async function main(args) {
  /** @type {string[]} */
  const only = [];
  let manifestPath = path.join(REPO, "test", "deletion", "controls.json");
  let list = false;
  let show = false;
  /** @type {{ i: number, n: number } | undefined} */
  let shard;
  // --self-test runs alone: it would otherwise run and ignore the rest of the line.
  if (args.includes("--self-test")) {
    if (args.length === 1) return selfTest();
    console.error(`control-deletion: --self-test runs alone\n${USAGE}`);
    return 2;
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--row") only.push(String(args[++i]));
    else if (a === "--shard") {
      if (shard !== undefined) {
        console.error(`control-deletion: --shard given twice\n${USAGE}`);
        return 2;
      }
      const value = args[++i];
      if (value === undefined) {
        console.error(`control-deletion: --shard needs a value, <i>/<n>\n${USAGE}`);
        return 2;
      }
      const parsed = parseShard(value);
      if (typeof parsed === "string") {
        console.error(`control-deletion: ${parsed}\n${USAGE}`);
        return 2;
      }
      shard = parsed;
    } else if (a === "--manifest") manifestPath = path.resolve(String(args[++i]));
    else if (a === "--list") list = true;
    else if (a === "--show") show = true;
    else {
      console.error(`control-deletion: unknown argument ${String(a)}\n${USAGE}`);
      return 2;
    }
  }
  if (shard !== undefined && only.length > 0) {
    console.error(`control-deletion: --shard and --row choose rows two ways; give one\n${USAGE}`);
    return 2;
  }
  const manifestDir = path.dirname(manifestPath);
  const { rows: all, problems } = loadManifest(manifestPath);
  for (const id of only) if (!all.some((r) => r.id === id)) problems.push(`--row ${id}: no such row`);
  if (problems.length > 0) {
    for (const p of problems) console.error(`control-deletion: ${p}`);
    return 1;
  }
  const rows = shard !== undefined ? shardOf(all, shard.i, shard.n) : only.length === 0 ? all : all.filter((r) => only.includes(r.id));
  const label = shard === undefined ? "" : `shard ${String(shard.i)}/${String(shard.n)}: `;
  if (shard !== undefined) {
    if (rows.length === 0) {
      console.log(`control-deletion: ${label}no rows (the manifest has ${String(all.length)}); nothing to run`);
      return 0;
    }
    console.log(`control-deletion: ${label}${String(rows.length)} of the manifest's ${String(all.length)} row(s)`);
  }
  if (list) {
    for (const r of rows) console.log(`${r.id} | ${r.section8} | ${r.control} | stub ${r.stub} | ${String(r.mustFail.length)} named test(s)`);
    return 0;
  }

  const started = Date.now();
  const base = makeBase();
  const baseBuild = await build(base);
  if (baseBuild !== undefined) {
    console.error(`control-deletion: the unpatched copy does not build: ${baseBuild}`);
    return 1;
  }

  // The unpatched tree must pass every row's tests, with every named test present and run.
  const allTests = [...new Set(rows.flatMap((r) => r.tests))].sort();
  const baseline = await runTests(base, allTests);
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
    const miss = await runRow(row, base, manifestDir, show);
    if (miss !== undefined) misses++;
    console.log(`${miss === undefined ? "RED " : "MISS"} ${row.id} | ${row.section8} | ${miss ?? `stub applied; ${String(row.mustFail.length)}/${String(row.mustFail.length)} named test(s) red by assertion`} | ${String(Date.now() - t0)} ms`);
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (misses > 0) {
    console.error(`control-deletion: ${label}FAILED — ${String(misses)} of ${String(rows.length)} row(s) did not go red as named (${secs} s)`);
    return 1;
  }
  console.log(`control-deletion: ${label}every stub made its named tests fail by assertion — ${String(rows.length)} row(s), ${secs} s`);
  return 0;
}

// Run only when executed, not when `node --test` loads this file as its reporter.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === SELF) {
  process.on("exit", cleanup);
  for (const sig of /** @type {const} */ (["SIGINT", "SIGTERM", "SIGHUP"])) {
    process.on(sig, () => {
      console.error(`control-deletion: ${sig}: stopping, and removing every temporary copy`);
      cleanup();
      process.exit(130);
    });
  }
  const code = await main(process.argv.slice(2));
  cleanup();
  process.exit(code);
}
