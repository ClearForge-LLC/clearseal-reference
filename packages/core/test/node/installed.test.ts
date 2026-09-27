// CSR-WO-1007c §1.1: the installed command runs. The core and the teaching edition are packed and
// installed with npm into a temporary prefix, as an operator installs them, and `clearseal-node` is run
// by the path npm gives it (a symbolic link on POSIX, a `.cmd` shim on Windows) and as `node <link>`.
// Before this WO the command had no `#!` line, so a shell ran the JavaScript as a script, and its
// main-module check compared the link's path with the real one, so `node <link>` exited 0 and started
// nothing.
//
// The install is offline: the prefix gets a lockfile built from the repository's own entries for the
// core's dependencies, so `npm ci --offline` needs nothing the repository's own `npm ci` did not already
// put in npm's cache. Both packages must be built first (`npm run check` builds before it tests).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { after, before, describe, it } from "node:test";

import { cleanEnv, REPO, startProcess, TEACHING_CONFIG, unauthenticatedStatus } from "./process.ts";

const DIR = mkdtempSync(join(tmpdir(), "clearseal-installed-"));
const PACKS = join(DIR, "packs");
const PREFIX = join(DIR, "prefix");
const PACKAGES: readonly (readonly [string, string])[] = [["@clearseal/core", "packages/core"], ["@clearseal/teaching", "packages/teaching"]];
const pastes: string[] = [];

/** npm's own CLI, run by this node: no shell, and the same on both runners. */
function npmCli(): string {
  const candidates = [process.env["npm_execpath"], join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), join(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")];
  const found = candidates.find((c) => c !== undefined && c.endsWith("npm-cli.js") && existsSync(c));
  assert.ok(found !== undefined, `npm's CLI is not beside ${process.execPath}`);
  return found;
}

function npm(args: readonly string[], cwd: string): string {
  return execFileSync(process.execPath, [npmCli(), ...args, "--no-audit", "--no-fund", "--ignore-scripts"], { cwd, env: cleanEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

interface LockEntry {
  version?: string;
  resolved?: string;
  integrity?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [k: string]: unknown;
}

/** The repository lockfile's entries for `name` as a dependency of `from`, and everything it needs. */
function closure(lock: Record<string, LockEntry>, from: string, name: string, out: Record<string, LockEntry>): void {
  for (let at = from; ; ) {
    const key = `${at === "" ? "" : `${at}/`}node_modules/${name}`;
    const entry = lock[key];
    if (entry !== undefined) {
      if (out[key] !== undefined) return;
      const keep = ["version", "resolved", "integrity", "license", "dependencies", "optionalDependencies", "peerDependencies", "peerDependenciesMeta", "engines", "bin", "os", "cpu"];
      out[key] = Object.fromEntries(keep.filter((k) => k in entry).map((k) => [k, entry[k]]));
      for (const dep of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies })) closure(lock, key, dep, out);
      return;
    }
    assert.ok(at !== "", `the repository's lockfile does not resolve ${name}`);
    const i = at.lastIndexOf("/node_modules/");
    at = i < 0 ? "" : at.slice(0, i);
  }
}

before(() => {
  mkdirSync(PACKS, { recursive: true });
  mkdirSync(PREFIX, { recursive: true });
  const lock = (JSON.parse(readFileSync(join(REPO, "package-lock.json"), "utf8")) as { packages: Record<string, LockEntry> }).packages;
  const deps: Record<string, string> = {};
  const packages: Record<string, LockEntry> = {};
  for (const [name, dir] of PACKAGES) {
    assert.ok(existsSync(join(REPO, dir, "dist")), `${dir}/dist is missing: build before this test (npm run check builds first)`);
    const before = new Set(readdirSync(PACKS));
    npm(["pack", "--pack-destination", PACKS], join(REPO, dir));
    const tgz = readdirSync(PACKS).find((f) => !before.has(f));
    assert.ok(tgz !== undefined, `npm pack wrote no tarball for ${name}`);
    const spec = `file:${relative(PREFIX, join(PACKS, tgz)).split("\\").join("/")}`;
    deps[name] = spec;
    const pj = JSON.parse(readFileSync(join(REPO, dir, "package.json"), "utf8")) as LockEntry & { peerDependencies?: Record<string, string>; bin?: Record<string, string> };
    packages[`node_modules/${name}`] = { version: pj.version, resolved: spec, integrity: `sha512-${createHash("sha512").update(readFileSync(join(PACKS, tgz))).digest("base64")}`, ...(pj.dependencies === undefined ? {} : { dependencies: pj.dependencies }), ...(pj.peerDependencies === undefined ? {} : { peerDependencies: pj.peerDependencies }), ...(pj.bin === undefined ? {} : { bin: pj.bin }) };
    for (const dep of Object.keys(pj.dependencies ?? {})) closure(lock, "", dep, packages);
  }
  writeFileSync(join(PREFIX, "package.json"), JSON.stringify({ name: "operator", private: true, dependencies: deps }, null, 2));
  writeFileSync(join(PREFIX, "package-lock.json"), JSON.stringify({ name: "operator", lockfileVersion: 3, requires: true, packages: { "": { name: "operator", dependencies: deps }, ...packages } }, null, 2));
  npm(["ci", "--offline"], PREFIX);
});

after(() => {
  rmSync(DIR, { recursive: true, force: true });
  console.log(pastes.join("\n"));
});

/** Starts it, sees it listen and answer, and stops it. */
async function listens(label: string, command: string, args: readonly string[], shell = false): Promise<void> {
  const node = await startProcess(command, args, cleanEnv({ ...TEACHING_CONFIG }), { cwd: PREFIX, shell });
  try {
    assert.ok(node.url !== undefined, `${label}: the node did not listen (exit ${String(node.code)}):\n${node.output}`);
    const status = await unauthenticatedStatus(node.url);
    assert.equal(status, 401, `${label}: ${node.url} answered ${String(status)}`);
    pastes.push(`INSTALLED ${process.platform} ${label}: clearseal-node listening on ${node.url}; an unauthenticated tools/list → ${String(status)}`);
  } finally {
    await node.stop();
  }
}

void describe("CSR-WO-1007c §1.1: the installed clearseal-node command starts a node", () => {
  void it("the built entry's first line is #!/usr/bin/env node, and npm installs it as the command", () => {
    const installed = join(PREFIX, "node_modules", "@clearseal", "core", "dist", "node", "cli.js");
    assert.equal(readFileSync(installed, "utf8").split("\n", 1)[0], "#!/usr/bin/env node");
    assert.ok(existsSync(join(PREFIX, "node_modules", ".bin", process.platform === "win32" ? "clearseal-node.cmd" : "clearseal-node")), "npm linked no clearseal-node command");
  });

  void it("run by its npm bin path, it listens", async () => {
    const bin = join(PREFIX, "node_modules", ".bin", "clearseal-node");
    if (process.platform === "win32") await listens("by its npm bin path (node_modules\\.bin\\clearseal-node.cmd)", `${bin}.cmd`, [], true);
    else await listens("by its npm bin path (node_modules/.bin/clearseal-node, a symbolic link)", bin, []);
  });

  void it("run as node <a link to it>, it listens", async () => {
    const entry = join(PREFIX, "node_modules", "@clearseal", "core", "dist", "node", "cli.js");
    if (process.platform !== "win32") {
      // npm's own link: exactly what the re-test ran.
      await listens("as node node_modules/.bin/clearseal-node", process.execPath, [join(PREFIX, "node_modules", ".bin", "clearseal-node")]);
      return;
    }
    // Windows: npm writes shims, not links, so the test makes one: a file link where the runner allows
    // it, and otherwise a junction to the entry's directory, which needs no privilege. Either way the
    // path the operator types is not the real one.
    const link = join(DIR, "clearseal-node.js");
    try {
      symlinkSync(entry, link, "file");
      await listens("as node <a file link to dist/node/cli.js>", process.execPath, [link]);
    } catch (err) {
      if ((err as { code?: unknown }).code !== "EPERM") throw err;
      const junction = join(DIR, "entry-junction");
      symlinkSync(dirname(entry), junction, "junction");
      await listens("as node <a junction to dist/node>/cli.js (file links need a privilege this runner lacks)", process.execPath, [join(junction, "cli.js")]);
    }
  });
});
