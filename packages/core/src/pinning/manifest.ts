// The pin manifest, manifest_version 1 (CSR-WO-1001 §1.1). A file the operator approved: one
// {name, tool_hash} entry per tool, sorted by name, and manifest_hash over exactly the object
// docs/canonical-form.md A9 defines, so a hand edit to any entry is detectable without a
// signature. generated_at and the build block are outside the hash. The build slots are present,
// nullable and not enforced; the schema says which control enforces each.
//
// The file is JSON. It is parsed by the transport's strict parser, which refuses duplicate keys,
// and validated against packages/core/schemas/manifest.schema.json by the core's own validator,
// with remote references off. Then the checks a schema cannot express run: the order, uniqueness,
// and the recomputed hash.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { CANONICAL_FORM_VERSION, canonicalBytes, toolHash } from "./canonical.ts";
import { JsonParseError, parseJsonStrict } from "../transport/json.ts";
import type { Tool } from "../transport/registry.ts";
import { compileSchema } from "../transport/schema.ts";

export const MANIFEST_VERSION = 1;

/** The capability tag: the seven pinned fields a tool carries beyond name, description and
 *  input_schema (ClearSeal v0.8 §3). Their meaning is enforced by the capability module (-1002);
 *  here they are hashed as given. */
export interface CapabilityTag {
  capability_class: string;
  untrusted_input_facing: boolean;
  scope: string;
  privacy_sensitive: boolean;
  recoverability_basis: string | null;
  elevated: boolean;
  containment_domain: string[] | null;
}

/** A tool as the node defines it for pinning. Only hashed fields are carried: it has no `title`
 *  or `annotations`, so nothing the manifest does not cover is ever served. */
export interface PinnableTool extends Omit<Tool, "title" | "annotations" | "description"> {
  description: string;
  capability: CapabilityTag;
}

/** The ten-field canonical input of a pinnable tool (A6). */
export function canonicalInput(tool: PinnableTool): Record<string, unknown> {
  return { name: tool.name, description: tool.description, input_schema: tool.inputSchema, ...tool.capability };
}

export interface ManifestEntry {
  name: string;
  tool_hash: string;
}

export interface BuildSlots {
  commit: string | null;
  distribution_digest: string | null;
  signature: string | null;
  kid: string | null;
  key_valid_from: string | null;
  key_valid_to: string | null;
}

export interface Manifest {
  manifest_version: number;
  canonical_form_version: number;
  generated_at: string;
  tools: ManifestEntry[];
  manifest_hash: string;
  build: BuildSlots;
}

/** RFC 3339 date-time, as the manifest carries it. Checked here, not in the schema: the validator
 *  refuses a pattern this long as a ReDoS risk. The string is bounded first, so the check is cheap. */
const RFC3339 = /^(?=.{20,35}$)[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;

export class ManifestError extends Error {
  override name = "ManifestError";
}

const EMPTY_BUILD: BuildSlots = { commit: null, distribution_digest: null, signature: null, kid: null, key_valid_from: null, key_valid_to: null };

const SCHEMA_URL = new URL("../../schemas/manifest.schema.json", import.meta.url);
let validateSchema: ((value: unknown) => boolean) | undefined;
function schemaValid(value: unknown): boolean {
  validateSchema ??= compileSchema(JSON.parse(readFileSync(SCHEMA_URL, "utf8")) as Record<string, unknown>);
  return validateSchema(value);
}

/** A9: manifest_hash over {canonical_form_version, tools: [{name, tool_hash}]} sorted by name. */
export function manifestHashOf(entries: readonly ManifestEntry[]): string {
  const object = { canonical_form_version: CANONICAL_FORM_VERSION, tools: entries.map((e) => ({ name: e.name, tool_hash: e.tool_hash })) };
  return createHash("sha256").update(canonicalBytes(object)).digest("hex");
}

/** A9 order: by name in UTF-16 code units, which is how < compares strings. */
const byName = (a: ManifestEntry, b: ManifestEntry): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Parses and checks a manifest. Every failure is a ManifestError naming what is wrong. */
export function parseManifest(text: string): Manifest {
  let value: unknown;
  try {
    value = parseJsonStrict(text, 64);
  } catch (err) {
    if (err instanceof JsonParseError) throw new ManifestError(`the manifest is not JSON (${err.kind})`);
    throw err;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ManifestError("the manifest is not an object");
  const record = value as Record<string, unknown>;
  const known = new Set(["manifest_version", "canonical_form_version", "generated_at", "tools", "manifest_hash", "build"]);
  const unknown = Object.keys(record).filter((k) => !known.has(k));
  if (unknown.length > 0) throw new ManifestError(`unknown top-level field(s): ${unknown.join(", ")}`);
  if (record["manifest_version"] !== MANIFEST_VERSION) throw new ManifestError("a manifest_version this implementation does not implement");
  if (record["canonical_form_version"] !== CANONICAL_FORM_VERSION) throw new ManifestError("a canonical_form_version this implementation does not implement");
  if (!schemaValid(record)) throw new ManifestError("the manifest does not match manifest.schema.json");
  const manifest = record as unknown as Manifest;
  if (!RFC3339.test(manifest.generated_at) || Number.isNaN(Date.parse(manifest.generated_at))) throw new ManifestError("generated_at is not an RFC 3339 date-time");
  for (let i = 1; i < manifest.tools.length; i++) {
    const order = byName(manifest.tools[i - 1] as ManifestEntry, manifest.tools[i] as ManifestEntry);
    if (order === 0) throw new ManifestError(`the tool ${manifest.tools[i]?.name ?? ""} appears twice`);
    if (order > 0) throw new ManifestError("tools are not sorted by name in UTF-16 code units (A9)");
  }
  if (manifestHashOf(manifest.tools) !== manifest.manifest_hash) throw new ManifestError("manifest_hash does not recompute: an entry was edited");
  return manifest;
}

/** The entries for a set of definitions: each name with its tool_hash, sorted by name. A repeated
 *  name, or a definition the canonical form refuses, is a ManifestError: approve never writes an
 *  ambiguous or unhashable manifest. */
export function entriesFor(tools: readonly PinnableTool[]): ManifestEntry[] {
  const entries = tools.map((t) => ({ name: t.name, tool_hash: toolHash(canonicalInput(t)) }));
  entries.sort(byName);
  for (let i = 1; i < entries.length; i++) {
    if (byName(entries[i - 1] as ManifestEntry, entries[i] as ManifestEntry) === 0) throw new ManifestError(`two definitions are named ${entries[i]?.name ?? ""}`);
  }
  return entries;
}

/** A new manifest for the given definitions (the approve path). */
export function buildManifest(tools: readonly PinnableTool[], now: Date = new Date()): Manifest {
  const entries = entriesFor(tools);
  return {
    manifest_version: MANIFEST_VERSION,
    canonical_form_version: CANONICAL_FORM_VERSION,
    generated_at: now.toISOString(),
    tools: entries,
    manifest_hash: manifestHashOf(entries),
    build: { ...EMPTY_BUILD },
  };
}

/** The manifest as file text: JSON, two-space indented, one trailing newline. */
export function serializeManifest(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
