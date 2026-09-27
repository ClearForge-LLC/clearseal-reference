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

import { pathToFileURL } from "node:url";

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

/** Starts the node the environment describes. Returns its URL; throws to refuse start. */
export async function runNode(env: NodeJS.ProcessEnv): Promise<{ url: string; close: () => Promise<void> }> {
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const node = await runNode(process.env);
    console.log(`clearseal-node listening on ${node.url}`);
  } catch (err) {
    console.error(`clearseal-node: ${err instanceof Error ? `${err.name}: ${err.message}` : "the node did not start"}`);
    process.exitCode = 1;
  }
}
