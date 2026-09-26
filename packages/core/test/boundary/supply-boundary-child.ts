// The supply boundary's runtime rules, run in a fresh process for one edition (supply-boundary.ts
// starts it): the edition's own code cannot have patched this process's built-ins before the checks
// below captured them. Prints one line: a JSON array of findings.
//
// Usage: node supply-boundary-child.ts <edition dir>

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { types } from "node:util";

// Captured before any edition code runs.
const ownKeys = Reflect.ownKeys;
const getDescriptor = Object.getOwnPropertyDescriptor;
const getProto = Object.getPrototypeOf;
const isProxy = types.isProxy;
const hasInstanceOf = Function.prototype[Symbol.hasInstance];
const hasInstance = (fn: unknown, v: unknown): boolean => Boolean(Reflect.apply(hasInstanceOf, fn, [v]));
const functionToString = getDescriptor(Function.prototype, "toString")?.value as (this: unknown) => string;
const sourceOf = (f: unknown): string => String(Reflect.apply(functionToString, f, []));
const stringify = JSON.stringify;
const parse = JSON.parse;
const stdout = process.stdout.write.bind(process.stdout);
const objectKeys = Object.keys;
/** Built-in prototypes: their accessors (a URL's href) are the platform's, not the edition's. */
const BUILTIN_PROTOS = new Set<unknown>([Object.prototype, Function.prototype, Array.prototype, getProto(async function () {}), getProto(function* () {}), URL.prototype, Date.prototype, Map.prototype, Set.prototype, RegExp.prototype, Promise.prototype, Error.prototype, String.prototype, Number.prototype]);

interface Finding {
  file: string;
  rule: string;
  detail: string;
}

const dir = process.argv[2] as string;
const findings: Finding[] = [];

// The core as an edition sees it: its package entry. Loaded by a computed specifier so the core's own
// typecheck, which runs before the build, need not resolve it.
const CORE_ENTRY = "@clearseal/core";
const core = (await import(CORE_ENTRY)) as Record<string, unknown> & {
  PinGate: abstract new (...args: never[]) => object;
  PinnedRegistry: { isGenuine: (value: unknown) => boolean };
  parseManifest: (text: string) => unknown;
};
const coreValues = new Set<unknown>(Object.values(core).filter((v) => typeof v === "function" || (typeof v === "object" && v !== null)));
const isGenuine = core.PinnedRegistry.isGenuine;

const isObject = (v: unknown): v is Record<PropertyKey, unknown> => typeof v === "object" && v !== null;
const isClass = (v: unknown): boolean => typeof v === "function" && /^class[\s{]/.test(sourceOf(v));
const TAG_FIELDS = ["capability_class", "untrusted_input_facing", "scope", "privacy_sensitive", "recoverability_basis", "elevated", "containment_domain"];

/** Each kind's structural check: undefined when the value is that kind, else what it should be. */
const CHECKS: Record<string, (v: unknown) => string | undefined> = {
  "tool-definitions": (v) => {
    if (!Array.isArray(v) || v.length === 0) return "a non-empty array of tool definitions";
    for (const t of v as unknown[]) {
      if (!isObject(t)) return "every element is an object";
      if (typeof t["name"] !== "string" || typeof t["description"] !== "string" || !isObject(t["inputSchema"]) || typeof t["handler"] !== "function") return `${String(t["name"])}: name, description, inputSchema and handler`;
      const cap = t["capability"];
      if (!isObject(cap) || !TAG_FIELDS.every((f) => Object.hasOwn(cap, f))) return `${String(t["name"])}: a capability tag with the seven fields`;
      if (cap["capability_class"] === "arbitrary_exec") return `${String(t["name"])}: not an arbitrary_exec tool (N7: an edition ships none)`;
      const extra = Object.keys(t).filter((k) => !["name", "description", "inputSchema", "capability", "handler"].includes(k));
      if (extra.length > 0) return `${String(t["name"])}: no members beyond a pinnable tool's (${extra.join(", ")})`;
    }
    return undefined;
  },
  "manifest-path": (v) => {
    if (!(v instanceof URL) && typeof v !== "string") return "a path or file URL";
    try {
      core.parseManifest(readFileSync(v, "utf8"));
    } catch (err) {
      return `a readable, valid manifest (${err instanceof Error ? err.message : "unreadable"})`;
    }
    return undefined;
  },
  "configuration-schema": (v) => {
    if (!isObject(v) || v["type"] !== "object") return "a JSON Schema object with type object";
    if (stringify(parse(stringify(v))) !== stringify(v)) return "plain JSON data";
    return undefined;
  },
  "deploy-scaffold": (v) => {
    if (typeof v !== "function") return "a function";
    if (isClass(v)) return "a function, not a class";
    const proto = (v as { prototype?: unknown }).prototype;
    if (isObject(proto) && ownKeys(proto).some((k) => k !== "constructor")) return "a function with no prototype methods";
    if (ownKeys(v).some((k) => !["length", "name", "prototype"].includes(String(k)))) return "a function with no properties of its own";
    return undefined;
  },
  cage: (v) => {
    if (!isClass(v)) return "a class implementing Cage";
    const members = ownKeys((v as { prototype: object }).prototype).filter((k) => k !== "constructor").map(String).sort();
    return stringify(members) === stringify(["connect", "open", "reached", "service"]) ? undefined : `exactly Cage's methods (open, connect, service, reached), not ${members.join(", ")}`;
  },
};

/** A control, or something that could hide one, anywhere in an exported value. Reads descriptors, so
 *  no getter runs; walks own keys (symbols included) and prototypes. */
function controlIn(v: unknown, seen = new Set<unknown>()): string | undefined {
  if ((!isObject(v) && typeof v !== "function") || seen.has(v)) return undefined;
  seen.add(v);
  if (isProxy(v)) return "a Proxy, whose members cannot be read";
  if (coreValues.has(v)) return "a value the core exports: an edition exports its own kinds, never the core's";
  if (hasInstance(core.PinGate, v)) return "a PinGate";
  if (isGenuine(v)) return "a PinnedRegistry";
  for (let o: object | null = v; o !== null && !BUILTIN_PROTOS.has(o); o = getProto(o) as object | null) {
    for (const key of ownKeys(o)) {
      const d = getDescriptor(o, key);
      if (d === undefined) continue;
      if (d.get !== undefined || d.set !== undefined) return `an accessor (${String(key)}), which can answer differently each time it is read`;
      if (key === "verify" && typeof d.value === "function") return "a verifier (a verify method)";
      if (key === "caller" || key === "callee" || key === "arguments") continue;
      const found = controlIn(d.value, seen);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

const pkg = parse(readFileSync(join(dir, "package.json"), "utf8")) as { exports?: unknown; clearseal?: { exports?: Record<string, string> } };
const exp = pkg.exports;
let entry: unknown;
if (typeof exp === "string") entry = exp;
else if (isObject(exp) && typeof exp["."] === "string") entry = exp["."];
else if (isObject(exp) && isObject(exp["."])) {
  const conditions = Object.keys(exp["."]);
  const extra = conditions.filter((c) => c !== "types" && c !== "default");
  if (extra.length > 0) findings.push({ file: "package.json", rule: "conditional-exports", detail: `exports["."] has conditions ${extra.join(", ")}: an edition has one entry, and what is checked is what loads` });
  entry = exp["."]["default"];
}
if (isObject(exp) && Object.keys(exp).some((k) => k !== ".")) findings.push({ file: "package.json", rule: "conditional-exports", detail: 'an edition exports one entry, "."' });

if (typeof entry !== "string") {
  findings.push({ file: "package.json", rule: "no-entry", detail: 'an edition has one entry, exports["."]' });
} else {
  const declared = pkg.clearseal?.exports ?? {};
  let mod: Record<string, unknown> = {};
  try {
    mod = (await import(pathToFileURL(join(dir, entry)).href)) as Record<string, unknown>;
  } catch (err) {
    findings.push({ file: entry, rule: "entry-unloadable", detail: `the entry does not load: ${err instanceof Error ? (err.message.split("\n")[0] ?? "") : "error"}` });
  }
  // A module namespace's string keys are its exports (its Symbol.toStringTag is not one).
  for (const name of objectKeys(mod)) {
    const value = mod[name];
    const add = (rule: string, detail: string): void => {
      findings.push({ file: entry, rule, detail: `export ${name}: ${detail}` });
    };
    const kind = declared[name];
    if (kind === undefined) {
      add("export-undeclared", "not declared in package.json clearseal.exports");
      continue;
    }
    if (kind === "approval-notifier" || kind === "audit-store") {
      add("kind-reserved", `"${kind}": the core defines no such interface yet`);
      continue;
    }
    const check = CHECKS[kind];
    if (check === undefined) {
      add("kind-unknown", `"${kind}" is not one of ${[...Object.keys(CHECKS), "approval-notifier", "audit-store"].join(", ")}`);
      continue;
    }
    const wrong = check(value);
    if (wrong !== undefined) add("kind-mismatch", `declared ${kind}, but it is not ${wrong}`);
    const control = controlIn(value);
    if (control !== undefined) add("control-exported", `carries ${control}`);
  }
}
stdout(`${stringify(findings)}\n`);
