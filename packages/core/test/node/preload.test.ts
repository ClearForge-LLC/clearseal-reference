// CSR-WO-1007c §1.2: the entry refuses a process started with a module-loading flag. A preload runs
// before the entry, so it runs before the settings snapshot; refusing it makes "nothing but the core runs
// before the snapshot" hold for every way the process can be started, not only the honest one. Each
// documented case runs `clearseal-node` as a real process with a preload that really runs (it writes a
// marker file, synchronously, and prints PRELOAD RAN), and the refusal must name the flag and where it
// came from. The marker is the proof: a loader's hooks thread forwards its stdout asynchronously, so a
// printed line can come after the refusal, or be lost at exit.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, describe, it } from "node:test";

import { moduleLoadingFlags, runNode } from "../../src/node/cli.ts";
import { SettingsError } from "../../src/node/settings.ts";
import { cleanEnv, ENTRY_SOURCE, REPO, startProcess, TEACHING_CONFIG, unauthenticatedStatus } from "./process.ts";

const DIR = mkdtempSync(join(tmpdir(), "clearseal-preload-"));
const ESM = join(DIR, "preload.mjs");
const CJS = join(DIR, "preload.cjs");
const MARKER = join(DIR, "preload-ran");
const PRELOAD = `appendFileSync(${JSON.stringify(MARKER)}, "ran\\n");\nconsole.log("PRELOAD RAN");\n`;
writeFileSync(ESM, `import { appendFileSync } from "node:fs";\n${PRELOAD}`);
writeFileSync(CJS, `const { appendFileSync } = require("node:fs");\n${PRELOAD}`);
/** Paths as NODE_OPTIONS carries them on both runners: a file URL for --import, forward slashes, quoted. */
const ESM_URL = pathToFileURL(ESM).href;
const CJS_PATH = `"${CJS.split("\\").join("/")}"`;
const pastes: string[] = [];

after(() => {
  rmSync(DIR, { recursive: true, force: true });
  console.log(pastes.join("\n"));
});

/** Runs the entry with `flags` before it and `nodeOptions` in the environment, and stops it. */
async function run(label: string, flags: readonly string[], nodeOptions?: string): Promise<{ url: string | undefined; output: string; code: number | null; ran: boolean }> {
  rmSync(MARKER, { force: true });
  const env = cleanEnv({ ...TEACHING_CONFIG, ...(nodeOptions === undefined ? {} : { NODE_OPTIONS: nodeOptions }) });
  const node = await startProcess(process.execPath, [...flags, ENTRY_SOURCE], env, { cwd: REPO });
  try {
    const status = node.url === undefined ? undefined : await unauthenticatedStatus(node.url);
    const lines = node.output.split("\n").filter((l) => l.includes("PRELOAD RAN") || l.startsWith("clearseal-node"));
    pastes.push(`PRELOAD ${label}:\n  ${lines.join("\n  ")}${status === undefined ? `\n  exit ${String(node.code)}` : `\n  an unauthenticated tools/list → ${String(status)}`}`);
    return { url: node.url, output: node.output, code: node.code, ran: existsSync(MARKER) };
  } finally {
    await node.stop();
  }
}

/** A refusal: the preload ran, the node did not start, and the message names the flag and its source. */
function refused(r: { url: string | undefined; output: string; code: number | null; ran: boolean }, flag: RegExp): void {
  assert.equal(r.url, undefined, `a node started:\n${r.output}`);
  assert.ok(r.ran, "the preload did not run, so this case proves nothing");
  assert.equal(r.code, 1, r.output);
  assert.match(r.output, flag);
  assert.match(r.output, /a module-loading flag runs code before the node reads its settings; start clearseal-node without it/);
}

void describe("CSR-WO-1007c §1.2: a module-loading flag refuses start, and the refusal names it", () => {
  void it("NODE_OPTIONS=--import <file>", async () => {
    refused(await run(`NODE_OPTIONS=--import <file>`, [], `--import ${ESM_URL}`), /clearseal-node: SettingsError: the process was started with --import \(from NODE_OPTIONS\)/);
  });

  void it("NODE_OPTIONS=-r <file>", async () => {
    refused(await run(`NODE_OPTIONS=-r <file>`, [], `-r ${CJS_PATH}`), /clearseal-node: SettingsError: the process was started with -r \(from NODE_OPTIONS\)/);
  });

  void it("--import on the command line", async () => {
    refused(await run("node --import <file> clearseal-node", ["--import", ESM_URL]), /clearseal-node: SettingsError: the process was started with --import \(from the command line\)/);
  });

  void it("--experimental-loader", async () => {
    refused(await run("node --experimental-loader <file> clearseal-node", ["--experimental-loader", ESM_URL]), /clearseal-node: SettingsError: the process was started with --experimental-loader \(from the command line\)/);
  });

  void it("-e, a script that runs first and then imports the entry", async () => {
    const script = `await import(${JSON.stringify(ESM_URL)}); await import(${JSON.stringify(pathToFileURL(ENTRY_SOURCE).href)});`;
    refused(await run("node -e <run something, then import the entry> clearseal-node", ["-e", script]), /the process was started with -e \(from the command line\)/);
  });

  void it("an allowed flag, from either place, starts normally", async () => {
    const r = await run("NODE_OPTIONS=--max-old-space-size=256, node --enable-source-maps clearseal-node", ["--enable-source-maps"], "--max-old-space-size=256");
    assert.ok(r.url !== undefined, `the node did not start:\n${r.output}`);
    assert.doesNotMatch(r.output, /module-loading flag/);
  });

  void it("a NODE_OPTIONS that --env-file applies is refused by what it carries", async () => {
    const envFile = join(DIR, "operator.env");
    writeFileSync(envFile, `NODE_OPTIONS="--import ${ESM_URL}"\n`);
    refused(await run("node --env-file=<a file setting NODE_OPTIONS=--import> clearseal-node", [`--env-file=${envFile}`]), /the process was started with --import \(from NODE_OPTIONS\)/);
  });

  void it("a config file whose nodeOptions import a module is refused by its flag", async () => {
    const config = join(DIR, "node.config.json");
    writeFileSync(config, JSON.stringify({ nodeOptions: { import: [ESM_URL] } }));
    refused(await run("node --experimental-config-file=<nodeOptions.import> clearseal-node", [`--experimental-config-file=${config}`]), /the process was started with --experimental-config-file \(from the command line\)/);
  });
});

void describe("CSR-WO-1007c §1.2: the enumeration, as Node spells the flags", () => {
  const cases: [string, string | undefined, readonly string[], readonly string[]][] = [
    ["--import=<file>", "--import=./x.mjs", [], ["--import (from NODE_OPTIONS)"]],
    ["--require <file>", "--require ./x.cjs", [], ["--require (from NODE_OPTIONS)"]],
    ["-r <file>, on the command line", undefined, ["-r", "./x.cjs"], ["-r (from the command line)"]],
    ["--loader", undefined, ["--loader=./h.mjs"], ["--loader (from the command line)"]],
    ["--experimental_loader: Node reads _ as - in a long option", undefined, ["--experimental_loader", "./h.mjs"], ["--experimental-loader (from the command line)"]],
    ["a quoted token: Node unquotes it", '"--import=./x y.mjs"', [], ["--import (from NODE_OPTIONS)"]],
    ["--experimental-default-config-file", undefined, ["--experimental-default-config-file"], ["--experimental-default-config-file (from the command line)"]],
    ["--snapshot-blob", "--snapshot-blob ./s.blob", [], ["--snapshot-blob (from NODE_OPTIONS)"]],
    ["--experimental-package-map", "--experimental-package-map=./m.json", [], ["--experimental-package-map (from NODE_OPTIONS)"]],
    ["-e and --print", undefined, ["-e", "1", "--print=2"], ["-e (from the command line)", "--print (from the command line)"]],
    ["-pe, the combined short form", undefined, ["-pe", "1"], ["-pe (from the command line)"]],
    ["the test runner, its reporter and its global setup", "--test-reporter=./r.mjs", ["--test", "--test-isolation=none", "--test-global-setup=./s.mjs"], ["--test-reporter (from NODE_OPTIONS)", "--test (from the command line)", "--test-global-setup (from the command line)"]],
    ["both places at once", "--import ./a.mjs", ["-r", "./b.cjs"], ["--import (from NODE_OPTIONS)", "-r (from the command line)"]],
    ["memory, source maps, warnings and a title: allowed", '--max-old-space-size=256 --title "a -r b"', ["--enable-source-maps", "--no-warnings"], []],
    ["no flags at all", undefined, [], []],
  ];
  for (const [label, nodeOptions, execArgv, expected] of cases) {
    void it(label, () => {
      assert.deepEqual(moduleLoadingFlags(nodeOptions, execArgv), expected);
    });
  }

  void it("the check comes before the settings are read: a preload flag refuses even an empty configuration", async () => {
    await assert.rejects(() => runNode({}, ["--import", "./x.mjs"]), (err: unknown) => err instanceof SettingsError && /started with --import \(from the command line\)/.test(err.message));
    await assert.rejects(() => runNode({ NODE_OPTIONS: "-r ./x.cjs" }, []), (err: unknown) => err instanceof SettingsError && /started with -r \(from NODE_OPTIONS\)/.test(err.message));
  });
});
