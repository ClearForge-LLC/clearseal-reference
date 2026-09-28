#!/usr/bin/env node
// The node's entry (CSR-WO-1007b §1.1): `clearseal-node`, the only way a node starts. The order here is
// the control, and it is the whole point of this file:
//
//   1. capture every operator setting into a frozen snapshot   (node/settings.ts)
//   2. read the manifest, hash it, open the audit store, parse it   (PreparedNode.prepare)
//   3. only now import the edition the operator named in CLEARSEAL_EDITION
//   4. check what it exports, and start
//
// Nothing an edition runs at load time can change a setting read in step 1 or a manifest read in step
// 2. That is what `-1007a` left open: the operator named the manifest, but `startNode` read the name
// when it was called, which was after the edition's own `bin/` had imported the edition, so load-time
// code that assigned `process.env.CLEARSEAL_MANIFEST` chose the manifest that approved it.
//
// The edition is named, never pathed: CLEARSEAL_EDITION is a package name, resolved by the operator's
// own install. An edition cannot point the node at a file of its choosing, and this file imports
// nothing of the edition's before step 3.
//
// What this is not: a sandbox. Step 3 runs the edition's code in this process, so an edition that
// patches built-ins at load is hostile code already inside the node (architecture §4; the P2 hardening
// work order). The supply-boundary checker is the control that keeps such code from shipping.
//
// CSR-WO-1007c adds two things to the entry, both about the process around it:
//
//   0. before step 1, refuse a process started with a module-loading flag (`--import`, `-r`, a loader,
//      a config file that carries them, a snapshot, a package map), from NODE_OPTIONS or the command
//      line. Such a module runs before this file does, so it runs before the snapshot. That needs the
//      operator to set it, and a module that has already run could rewrite the evidence this reads, so
//      this is a refusal of an honest mistake, not a defence against code already inside;
//   and this file runs when npm's bin symlink names it: the `#!` line above makes the installed
//   `clearseal-node` a command, and the main-module check below compares real paths on both sides.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PreparedNode, startNode } from "./start.ts";
import { captureSettings, SettingsError } from "./settings.ts";

/** What an edition's package entry must export, and nothing else (CSR-WO-1007a §1.2). */
const EDITION_EXPORTS: readonly string[] = ["definitions", "configSchema"];

/** The edition's two values, from a module namespace the node has just imported. */
function editionFrom(name: string, mod: Record<string, unknown>): { definitions: never[]; configSchema: Record<string, unknown> } {
  const exported = Object.keys(mod).filter((k) => k !== "default");
  const extra = exported.filter((k) => !EDITION_EXPORTS.includes(k));
  if (extra.length > 0) throw new SettingsError(`${name} exports ${extra.join(", ")}: an edition exports its definitions and its configSchema, and nothing else`);
  const missing = EDITION_EXPORTS.filter((k) => !Object.hasOwn(mod, k));
  if (missing.length > 0) throw new SettingsError(`${name} does not export ${missing.join(", ")}: an edition exports its definitions and its configSchema`);
  return { definitions: mod["definitions"] as never[], configSchema: mod["configSchema"] as Record<string, unknown> };
}

/**
 * Flags that run a module, or code, in this process before the entry runs (CSR-WO-1007c §1.2), by the
 * name Node knows them by. Enumerated against Node 24.21.0's `node --help`, which lists every one, and
 * nodejs.org/docs/latest-v24.x/api/cli.html (the shipped node.1 omits some, --import among them):
 *   --import, --require / -r         preload an ES module / a CommonJS module;
 *   --loader / --experimental-loader  a customization-hooks module, loaded first;
 *   --experimental-config-file, --experimental-default-config-file
 *                                    a node.config.json whose `nodeOptions` can carry `import` and
 *                                    `require` (measured: its import runs, and it is not in execArgv);
 *   --snapshot-blob                  restores a startup snapshot: state built by code run elsewhere,
 *                                    and a deserialize-main function that runs in place of the entry;
 *   --experimental-package-map       a file that decides, exclusively, where every bare specifier
 *                                    resolves, so it chooses what the entry's own static imports load;
 *   -e / --eval, -p / --print, -pe   run a script that can import the entry itself, after running
 *                                    anything else first (measured: the entry is then the main module);
 *   --test, --test-reporter, --test-global-setup
 *                                    the test runner, which with --test-isolation=none runs its reporter,
 *                                    its global setup and other test files in this process first
 *                                    (measured: a reporter module runs, then the entry starts a node).
 * `--env-file` is not here: a NODE_OPTIONS in the file is applied, but it also lands in the environment
 * this reads, so it is refused by what it carries.
 */
export const MODULE_LOADING_FLAGS: ReadonlySet<string> = new Set(["--import", "--require", "-r", "--loader", "--experimental-loader", "--experimental-config-file", "--experimental-default-config-file", "--snapshot-blob", "--experimental-package-map", "-e", "--eval", "-p", "--print", "-pe", "-ep", "--test", "--test-reporter", "--test-global-setup"]);

/**
 * NODE_OPTIONS as Node splits it: at a space outside double quotes, with \ escaping inside them. This
 * also splits at any other whitespace, where Node does not (it refuses such a token instead); that only
 * ever finds more tokens, so it can refuse more, never less.
 */
function nodeOptionsTokens(value: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let started = false;
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i] as string;
    if (quoted && c === "\\" && i + 1 < value.length) {
      token += value[++i] as string;
    } else if (c === '"') {
      quoted = !quoted;
      started = true;
    } else if (!quoted && /\s/.test(c)) {
      if (started) tokens.push(token);
      token = "";
      started = false;
    } else {
      token += c;
      started = true;
    }
  }
  if (started) tokens.push(token);
  return tokens;
}

/** A flag's name as Node matches it: before any `=`, with `_` read as `-` in a long option. */
function flagName(token: string): string {
  const name = token.split("=", 1)[0] as string;
  return name.startsWith("--") ? `--${name.slice(2).replaceAll("_", "-")}` : name;
}

/**
 * Every module-loading flag the process was started with, and where it came from. Any token that reads
 * as one counts, even in a value's position: a false refusal costs a restart, a missed one costs N2.
 */
export function moduleLoadingFlags(nodeOptions: string | undefined, execArgv: readonly string[]): string[] {
  const found: string[] = [];
  for (const [source, tokens] of [["NODE_OPTIONS", nodeOptionsTokens(nodeOptions ?? "")], ["the command line", execArgv]] as const) {
    for (const token of tokens) {
      const name = flagName(token);
      if (MODULE_LOADING_FLAGS.has(name)) found.push(`${name} (from ${source})`);
    }
  }
  return found;
}

/**
 * Starts the node the environment describes. Returns its URL; throws to refuse start. `execArgv` is the
 * command line's flags, before the script: the process's own unless a caller names them.
 */
export async function runNode(env: NodeJS.ProcessEnv, execArgv: readonly string[] = process.execArgv): Promise<{ url: string; close: () => Promise<void> }> {
  // 0: nothing but the core ran before this line (CSR-WO-1007c §1.2).
  const preloads = moduleLoadingFlags(env["NODE_OPTIONS"], execArgv);
  if (preloads.length > 0) throw new SettingsError(`the process was started with ${preloads.join(", ")}: a module-loading flag runs code before the node reads its settings; start clearseal-node without it`);
  // 1, 2: every setting and the manifest, before any edition code.
  const settings = captureSettings(env);
  const prepared = PreparedNode.prepare(settings);
  try {
    // 3: the edition, by name.
    let mod: Record<string, unknown>;
    try {
      mod = (await import(settings.editionName)) as Record<string, unknown>;
    } catch (err) {
      throw new SettingsError(`the edition ${settings.editionName} does not load: ${err instanceof Error ? (err.message.split("\n")[0] ?? "") : "error"}`);
    }
    // 4: its two values, and start.
    const t = await startNode(editionFrom(settings.editionName, mod), prepared);
    return { url: t.url, close: () => t.close() };
  } catch (err) {
    await prepared.close();
    throw err;
  }
}

/**
 * Is this file the process's main module? Compared by real path on both sides (CSR-WO-1007c §1.1): npm
 * installs `clearseal-node` as a symbolic link (a shim on Windows), and Node loads the main module by
 * its real path, so `import.meta.url` is not the path the operator typed through a link (unless
 * --preserve-symlinks-main, which this holds under too). `import.meta.main` would also hold, but it is
 * marked early development in Node 24.
 */
function isMain(): boolean {
  const script = process.argv[1];
  if (script === undefined) return false;
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  try {
    const node = await runNode(process.env);
    console.log(`clearseal-node listening on ${node.url}`);
  } catch (err) {
    console.error(`clearseal-node: ${err instanceof Error ? `${err.name}: ${err.message}` : "the node did not start"}`);
    process.exitCode = 1;
  }
}
