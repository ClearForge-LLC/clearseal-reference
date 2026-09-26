// The operator path (CSR-WO-1001 §1.5): `npm run pin -- <diff|approve|verify> --definitions <module>
// --manifest <file> [--yes]`.
//
//   diff     one line per tool: unchanged | drifted (old → new) | new (unpinned) | removed.
//            Exits 1 when anything is not unchanged.
//   approve  prints the diff, and writes a new manifest from the current definitions only when
//            --yes is given. The flag is required, not a prompt, so the approval is in the shell
//            history. Never run at node start.
//   verify   loads the manifest and admits the definitions. Exits 0 only when every tool is admitted
//            and nothing is removed.
//
// The definitions module exports `definitions`, an array of PinnableTool. Hashes are printed as their
// first 12 hex digits: enough for a human to compare, and the manifest holds the full values.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { toolHash } from "./canonical.ts";
import { PinGate } from "./gate.ts";
import { buildManifest, canonicalInput, parseManifest, type PinnableTool, serializeManifest } from "./manifest.ts";

export type DiffStatus = "unchanged" | "drifted" | "new" | "removed";
export interface DiffLine {
  name: string;
  status: DiffStatus;
  old?: string;
  new?: string;
}

const short = (hash: string | undefined): string => (hash ?? "").slice(0, 12);

/** The diff between a manifest (or none) and the current definitions, sorted by name. */
export function diffManifest(manifestText: string | undefined, definitions: readonly PinnableTool[]): DiffLine[] {
  const pinned = new Map((manifestText === undefined ? [] : parseManifest(manifestText).tools).map((e) => [e.name, e.tool_hash]));
  const lines: DiffLine[] = [];
  const current = new Map<string, string>();
  for (const d of definitions) current.set(d.name, toolHash(canonicalInput(d)));
  for (const [name, hash] of current) {
    const old = pinned.get(name);
    if (old === undefined) lines.push({ name, status: "new", new: hash });
    else if (old === hash) lines.push({ name, status: "unchanged", new: hash });
    else lines.push({ name, status: "drifted", old, new: hash });
  }
  for (const [name, old] of pinned) if (!current.has(name)) lines.push({ name, status: "removed", old });
  return lines.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function formatDiff(lines: readonly DiffLine[]): string {
  return lines
    .map((l) => {
      if (l.status === "drifted") return `drifted    ${l.name}  ${short(l.old)} → ${short(l.new)}`;
      if (l.status === "new") return `new        ${l.name}  (unpinned) ${short(l.new)}`;
      if (l.status === "removed") return `removed    ${l.name}  ${short(l.old)}`;
      return `unchanged  ${l.name}  ${short(l.new)}`;
    })
    .join("\n");
}

interface Args {
  command: string;
  definitions: string;
  manifest: string;
  yes: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const [command = "", ...rest] = argv;
  let definitions = "";
  let manifest = "";
  let yes = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--yes") yes = true;
    else if (a === "--definitions") definitions = rest[++i] ?? "";
    else if (a === "--manifest") manifest = rest[++i] ?? "";
    else throw new Error(`unknown argument ${a ?? ""}`);
  }
  if (!["diff", "approve", "verify"].includes(command)) throw new Error("usage: pin <diff|approve|verify> --definitions <module> --manifest <file> [--yes]");
  if (definitions === "" || manifest === "") throw new Error("--definitions and --manifest are required");
  return { command, definitions, manifest, yes };
}

async function loadDefinitions(path: string): Promise<PinnableTool[]> {
  const mod = (await import(pathToFileURL(resolve(path)).href)) as { definitions?: unknown };
  if (!Array.isArray(mod.definitions)) throw new Error(`${path} does not export an array named definitions`);
  return mod.definitions as PinnableTool[];
}

/** Runs one command; returns the exit code. Output goes through `out`, errors through `err`. */
export async function runPin(argv: readonly string[], out: (line: string) => void = console.log, err: (line: string) => void = console.error): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return 2;
  }
  try {
    const definitions = await loadDefinitions(args.definitions);
    const exists = existsSync(args.manifest);
    const text = exists ? readFileSync(args.manifest, "utf8") : undefined;
    if (args.command === "verify") {
      if (text === undefined) {
        err(`no manifest at ${args.manifest}: a node without a manifest does not start`);
        return 1;
      }
      const admission = PinGate.load(text).admit(definitions);
      for (const r of admission.refused) out(`refused    ${r.name}  ${r.reason}${r.rule === undefined ? "" : ` (${r.rule})`}`);
      out(`verify: ${String(admission.admitted.length)} admitted, ${String(admission.refused.length)} refused`);
      return admission.refused.length === 0 ? 0 : 1;
    }
    const lines = diffManifest(text, definitions);
    if (!exists) out(`no manifest at ${args.manifest}: every tool is new`);
    out(formatDiff(lines));
    const changed = lines.some((l) => l.status !== "unchanged");
    if (args.command === "diff") return changed ? 1 : 0;
    if (!args.yes) {
      err("approve writes the manifest only with --yes, after the diff above has been read");
      return 2;
    }
    writeFileSync(args.manifest, serializeManifest(buildManifest(definitions)));
    out(`approved: ${args.manifest} written with ${String(definitions.length)} tool(s)`);
    return 0;
  } catch (e) {
    if (e instanceof Error) {
      err(`${e.name}: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await runPin(process.argv.slice(2));
}
