// The canonical form, version 1 (docs/canonical-form.md, ratified 2026-09-26). The ONE
// canonicalizer: the pin side and the verify side (-1001) both import it; no copy of its logic
// exists anywhere else (N1). It is written from the specification, rule by rule. The rule ids
// (A1…A10) in comments and in every refusal point back to that text.
//
// It owns the bytes it hashes: the JCS layer (RFC 8785) is implemented here, with no
// dependency. Only two platform facilities are used, and both are the definitions JCS itself
// defers to:
// - String(number), which is ECMAScript's Number::toString;
// - the default Array sort, which compares UTF-16 code units.
//
// The vectors in packages/core/test/vectors/canonical-v1.json come from an independent Python
// oracle. This file is checked against them and never writes them (N3).

import { createHash } from "node:crypto";

import { CAPABILITY_CLASSES, GATE_READ_FIELDS, PINNED_FIELDS } from "../capability/fields.ts";
import { JsonParseError, parseJsonStrict } from "../transport/json.ts";

export const CANONICAL_FORM_VERSION = 1;

/** The largest accepted magnitude (A2): 2^53 − 1. */
const MAX_MAGNITUDE = Number.MAX_SAFE_INTEGER;

/** How deep any input may nest, counted in objects and arrays, on the text path and the value
 *  path alike. Version 1 of the specification sets no depth. This is an implementation limit, and
 *  the Python oracle has the same one, so a deep input is refused by both rather than crashing
 *  either (recorded in the WO's FEEDBACK for the architect's ruling). */
const MAX_NESTING = 512;

/** Every refusal the specification defines. `rule` names the rule that refuses. */
export class CanonicalRefusal extends Error {
  override name = "CanonicalRefusal";
  readonly rule: string;
  constructor(rule: string, message: string) {
    super(`${rule}: ${message}`);
    this.rule = rule;
  }
}

const refuse = (rule: string, message: string): never => {
  throw new CanonicalRefusal(rule, message);
};

// ---------------------------------------------------------------------------------------------
// A3 — strings are their code points as given, with no normalization. An unpaired surrogate is
// refused, and so is a string whose first code point is U+FEFF.

function checkString(s: string): void {
  if (s.charCodeAt(0) === 0xfeff) refuse("A3", "a string begins with U+FEFF");
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) refuse("A3", "a lone surrogate");
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      refuse("A3", "a lone surrogate");
    }
  }
}

// ---------------------------------------------------------------------------------------------
// A1 — RFC 8785. The serialization of strings: `"` and `\` escaped; U+0008, U+0009, U+000A, U+000C
// and U+000D as \b \t \n \f \r; every other code point below U+0020 as \u00 and two lower-case hex
// digits; everything else as is.

const SHORT_ESCAPES: Readonly<Record<number, string>> = { 0x08: "\\b", 0x09: "\\t", 0x0a: "\\n", 0x0c: "\\f", 0x0d: "\\r", 0x22: '\\"', 0x5c: "\\\\" };

function serializeString(s: string): string {
  checkString(s);
  let out = '"';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x20 && c !== 0x22 && c !== 0x5c) continue;
    out += s.slice(start, i) + (SHORT_ESCAPES[c] ?? `\\u${c.toString(16).padStart(4, "0")}`);
    start = i + 1;
  }
  return `${out}${s.slice(start)}"`;
}

// A2 — numbers by ECMAScript Number::toString (JCS's serialization of numbers). NaN, the
// infinities, negative zero, and any magnitude over 2^53 − 1 are refused. Every double that large
// is an integer, so this is the prior's integer bound, and JCS's positive-exponent form never
// appears.
function serializeNumber(n: number): string {
  if (!Number.isFinite(n)) refuse("A2", "NaN or an infinity");
  if (Object.is(n, -0)) refuse("A2", "negative zero");
  if (Math.abs(n) > MAX_MAGNITUDE) refuse("A2", "a magnitude over 2^53 - 1");
  return String(n);
}

function isPlainObject(v: object): boolean {
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** The members of a plain object, each read once from its property descriptor. Only enumerable,
 *  string-keyed data properties can be JSON members: an accessor, a symbol key or a non-enumerable
 *  property is refused, never skipped, so that no value reaches the hash other than the ones
 *  serialized. */
function dataMembers(v: object): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const key of Reflect.ownKeys(v)) {
    const d = Reflect.getOwnPropertyDescriptor(v, key);
    if (typeof key !== "string" || d === undefined || d.enumerable !== true || !("value" in d)) return refuse("A1", "only enumerable data members with string names are JSON");
    out.push([key, d.value]);
  }
  return out;
}

/** The elements of an array, each read once; an array carrying anything besides its elements and
 *  its length, or a hole, is refused. */
function dataElements(v: unknown[]): unknown[] {
  const keys = Reflect.ownKeys(v);
  if (keys.length !== v.length + 1) refuse("A1", "an array with a hole or an extra property is not JSON");
  const out: unknown[] = [];
  for (let i = 0; i < v.length; i++) {
    const d = Reflect.getOwnPropertyDescriptor(v, String(i));
    if (d === undefined || !("value" in d)) return refuse("A8", "an array hole is not a JSON value");
    out.push(d.value);
  }
  return out;
}

function serialize(v: unknown, depth = 0): string {
  if (v === null) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") return serializeNumber(v);
  if (typeof v === "string") return serializeString(v);
  if (typeof v === "object" && depth >= MAX_NESTING) refuse("A1", `nested deeper than ${String(MAX_NESTING)} (an implementation limit)`);
  if (Array.isArray(v)) return `[${dataElements(v).map((x) => serialize(x, depth + 1)).join(",")}]`;
  if (typeof v === "object" && isPlainObject(v)) {
    // A1: members ordered by their names as UTF-16 code units, which is how < compares strings.
    const members = dataMembers(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const parts: string[] = [];
    for (const [name, value] of members) {
      // A8: a member whose value is not a JSON value is refused, never dropped.
      if (value === undefined) refuse("A8", `member "${name}" has no JSON value`);
      parts.push(`${serializeString(name)}:${serialize(value, depth + 1)}`);
    }
    return `{${parts.join(",")}}`;
  }
  return refuse("A1", `a ${typeof v} is not a JSON value`);
}

/** A1–A3: the canonical JSON text of a value (JCS). */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

/** A1–A3: the canonical bytes of a value, UTF-8. */
export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(serialize(value), "utf8");
}

/** Parses JSON text for canonicalization. A duplicate key is refused (A1); so is a lone
 *  surrogate escape (A3) and a number out of the double range (A2). Negative zero survives
 *  parsing as -0, so serialization refuses it (A2). */
export function parseCanonicalJson(text: string): unknown {
  try {
    return parseJsonStrict(text, MAX_NESTING);
  } catch (err) {
    if (!(err instanceof JsonParseError)) throw err;
    if (err.kind === "duplicate-key") return refuse("A1", "a duplicate key");
    if (err.kind === "lone-surrogate") return refuse("A3", "a lone surrogate");
    if (err.message.startsWith("number out of range")) return refuse("A2", "a number out of range");
    return refuse("A1", `not JSON text (${err.kind})`);
  }
}

// ---------------------------------------------------------------------------------------------
// A4 — the top-level description, and only it:
// 1. CR LF, then CR, become LF;
// 2. each line's trailing run of U+0020, U+0009, U+000C or U+000B is removed;
// 3. leading and trailing LF are removed.
// The trailing run is found by a scan from the line's end, not a regular expression, so a
// long run of spaces followed by other text costs linear time.

const LINE_TRAILING = new Set([0x20, 0x09, 0x0c, 0x0b]);

export function normalizeDescription(description: string): string {
  checkString(description);
  const lines = description.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const stripped = lines.map((line) => {
    let end = line.length;
    while (end > 0 && LINE_TRAILING.has(line.charCodeAt(end - 1))) end--;
    return line.slice(0, end);
  });
  const text = stripped.join("\n");
  let start = 0;
  let end = text.length;
  while (start < end && text.charCodeAt(start) === 0x0a) start++;
  while (end > start && text.charCodeAt(end - 1) === 0x0a) end--;
  return text.slice(start, end);
}

// ---------------------------------------------------------------------------------------------
// A5 — a tool name must match the whole of [a-z0-9][a-z0-9._-]{0,63}; it is refused, never
// rewritten. No m flag, so $ is the end of the string only (never "before a final newline").

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function checkToolName(name: unknown): string {
  if (typeof name !== "string" || !NAME.test(name)) return refuse("A5", "a tool name outside [a-z0-9][a-z0-9._-]{0,63}");
  return name;
}

// ---------------------------------------------------------------------------------------------
// A7 — a set-valued field: its distinct strings in UTF-16 order, case preserved, or null.

export function canonicalSet(value: unknown): string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) return refuse("A7", "a set must be an array of strings or null");
  const members = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const member: unknown = value[i];
    if (typeof member !== "string") return refuse("A7", "a set must be an array of strings or null");
    checkString(member);
    members.add(member);
  }
  return [...members].sort();
}

// ---------------------------------------------------------------------------------------------
// A6, A8 — the ten-field pinned object. Every field is present (null where it does not apply); a
// missing field or an extra one is refused; booleans are never coerced.

const PINNED: ReadonlySet<string> = new Set(PINNED_FIELDS);
const CLASSES: ReadonlySet<string> = new Set(CAPABILITY_CLASSES);

function booleanField(tool: Record<string, unknown>, field: string): boolean {
  const v = tool[field];
  if (typeof v !== "boolean") refuse("A6", `${field} must be true or false`);
  return v as boolean;
}

/** The canonical tool object, before serialization. */
export function canonicalToolObject(tool: unknown): Record<string, unknown> {
  if (typeof tool !== "object" || tool === null || Array.isArray(tool) || !isPlainObject(tool)) return refuse("A6", "a tool must be an object");
  // A snapshot of the fields, read once, so a field cannot read one way when checked and another
  // when hashed.
  const t: Record<string, unknown> = Object.fromEntries(dataMembers(tool));
  for (const field of PINNED_FIELDS) {
    if (!Object.hasOwn(t, field) || t[field] === undefined) refuse("A8", `the field ${field} is missing`);
  }
  for (const field of Object.keys(t)) {
    if (!PINNED.has(field)) refuse("A6", `the field ${field} is not one of the ten`);
  }
  const description = t["description"];
  const schema = t["input_schema"];
  const capabilityClass = t["capability_class"];
  const scope = t["scope"];
  const basis = t["recoverability_basis"];
  if (typeof description !== "string") return refuse("A6", "description must be a string");
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return refuse("A6", "input_schema must be an object");
  if (typeof capabilityClass !== "string" || !CLASSES.has(capabilityClass)) return refuse("A5", "capability_class outside the four rungs");
  if (typeof scope !== "string") return refuse("A6", "scope must be a string");
  if (basis !== null && typeof basis !== "string") return refuse("A6", "recoverability_basis must be a string or null");
  return {
    name: checkToolName(t["name"]),
    description: normalizeDescription(description),
    input_schema: schema,
    capability_class: capabilityClass,
    untrusted_input_facing: booleanField(t, "untrusted_input_facing"),
    scope,
    privacy_sensitive: booleanField(t, "privacy_sensitive"),
    recoverability_basis: basis,
    elevated: booleanField(t, "elevated"),
    containment_domain: canonicalSet(t["containment_domain"]),
  };
}

/** A6: the canonical bytes of a tool. */
export function canonicalToolBytes(tool: unknown): Buffer {
  return canonicalBytes(canonicalToolObject(tool));
}

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** A9: tool_hash, lower-case hex. */
export function toolHash(tool: unknown): string {
  return sha256(canonicalToolBytes(tool));
}

// ---------------------------------------------------------------------------------------------
// A9, A10 — the manifest hash covers {canonical_form_version, tools: [{name, tool_hash}] sorted by
// name}. A version this implementation does not implement is refused, and so is a repeated name.

export interface ManifestInput {
  canonical_form_version: unknown;
  tools: unknown;
}

/** A9: the canonical bytes of a manifest hash object. */
export function canonicalManifestBytes(input: ManifestInput): Buffer {
  const given: unknown = input;
  if (typeof given !== "object" || given === null || Array.isArray(given) || !isPlainObject(given)) return refuse("A9", "a manifest must be an object");
  const manifest = Object.fromEntries(dataMembers(given)) as Partial<ManifestInput>;
  if (manifest.canonical_form_version !== CANONICAL_FORM_VERSION) refuse("A10", "a canonical_form_version this implementation does not implement");
  if (!Array.isArray(manifest.tools)) return refuse("A9", "tools must be an array");
  const entries = (manifest.tools as unknown[]).map((tool) => {
    const canonical = canonicalToolObject(tool);
    return { name: canonical["name"] as string, tool_hash: sha256(canonicalBytes(canonical)) };
  });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (let i = 1; i < entries.length; i++) {
    if (entries[i]?.name === entries[i - 1]?.name) refuse("A9", "two tools with one name");
  }
  return canonicalBytes({ canonical_form_version: CANONICAL_FORM_VERSION, tools: entries });
}

/** A9: manifest_hash, lower-case hex. */
export function manifestHash(manifest: ManifestInput): string {
  return sha256(canonicalManifestBytes(manifest));
}

// ---------------------------------------------------------------------------------------------
// The subset invariant (A6, N3): every field a gate reads is inside the hash.

/** The fields the hash actually covers, read from the canonicalizer's own output rather than
 *  restated, so the answer comes from the same code that makes the hash. */
export function canonicalFieldSet(): ReadonlySet<string> {
  const representative = canonicalToolObject({
    name: "a",
    description: "",
    input_schema: {},
    capability_class: "read_only",
    untrusted_input_facing: false,
    scope: "",
    privacy_sensitive: false,
    recoverability_basis: null,
    elevated: false,
    containment_domain: null,
  });
  return new Set(Object.keys(representative));
}

/** The gate-read fields the hash does not cover. It takes the list as an argument so that a
 *  test can prove the check is able to go red; any name it returns is a hole. */
export function gateFieldsNotPinned(gateFields: readonly string[] = GATE_READ_FIELDS): string[] {
  const covered = canonicalFieldSet();
  return gateFields.filter((f) => !covered.has(f)).sort();
}
