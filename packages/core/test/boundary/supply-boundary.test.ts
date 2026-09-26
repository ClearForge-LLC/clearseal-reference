// CSR-WO-1004 §1.5: the supply-boundary test. Every package under packages/ other than the core is an
// edition, and every edition keeps to the enumerated kinds (N1; architecture §5 *Where OS primitives
// live*). Planted editions each carry an edition-side control and must go red, naming the file and the
// rule. The committed fixtures need no core import; the ones that do are written at test time into a
// scratch directory here (so `@clearseal/core` resolves, and the core's typecheck, which runs before
// the build, never sees them), and removed afterwards. They include every bypass the adversarial pass
// found, as regression cases.

import assert from "node:assert/strict";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

import { checkEdition, checkSource, editions, type Finding, KINDS } from "./supply-boundary.ts";

const PACKAGES = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const SCRATCH = fileURLToPath(new URL("./.planted/", import.meta.url));
const show = (fs: Finding[]): string => fs.map((f) => `${f.file}: ${f.rule}: ${f.detail}`).join("\n");

after(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

/** Writes a planted edition: a package.json declaring `kinds`, and the given source files. */
function plant(name: string, kinds: Record<string, string>, files: Record<string, string>, exportsField: unknown = { ".": { default: "./src/index.ts" } }): string {
  const dir = join(SCRATCH, name);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `@clearseal-planted/${name}`, private: true, type: "module", exports: exportsField, clearseal: { exports: kinds } }));
  return dir;
}

const TOOL = `{ name: "t", description: "d", inputSchema: { type: "object" }, capability: { capability_class: "read_only", untrusted_input_facing: false, scope: "s", privacy_sensitive: false, recoverability_basis: null, elevated: false, containment_domain: null }, handler: () => Promise.resolve({ content: [] }) }`;
const START = { start: "deploy-scaffold" };

void describe("the supply boundary (N1)", () => {
  void it("every edition under packages/ keeps to the enumerated kinds and imports the core only through its entry", () => {
    const found = editions(PACKAGES);
    assert.ok(found.length >= 1, "at least the teaching edition");
    for (const dir of found) {
      const findings = checkEdition(dir);
      console.log(`BOUNDARY ${dir.slice(PACKAGES.length)}: ${findings.length === 0 ? "clean" : `\n${show(findings)}`}`);
      assert.deepEqual(findings, [], show(findings));
    }
  });

  void it("the kinds are the architecture's enumeration, and none of them is an exec tool (N7)", () => {
    assert.deepEqual(Object.keys(KINDS), ["tool-definitions", "manifest-path", "configuration-schema", "deploy-scaffold", "cage", "approval-notifier", "audit-store"]);
    assert.equal(KINDS["approval-notifier"], null, "reserved until the core defines the interface");
    assert.equal(KINDS["audit-store"], null, "reserved until the core defines the interface");
  });

  const committed: [string, string, RegExp][] = [
    ["planted-verifier", "(a) an exported verifier", /control-exported: export verifier: carries a verifier/],
    ["planted-deep-import", "(b) a deep import into core/src", /src\/index\.ts: import-outside-exports: "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/src\/transport\/server\.ts" resolves outside the edition/],
    ["planted-mislabelled", "an export whose value is not its declared kind", /kind-mismatch: export definitions: declared configuration-schema, but it is not a JSON Schema object with type object/],
    ["planted-mislabelled", "a kind the core does not define yet", /kind-reserved: export notifier: "approval-notifier": the core defines no such interface yet/],
    ["planted-mislabelled", "an undeclared export", /export-undeclared: export extra: not declared in package\.json clearseal\.exports/],
  ];
  for (const [name, label, rule] of committed) {
    void it(`red-proof ${label}: the planted edition goes red, naming the file and the rule`, () => {
      const findings = checkEdition(join(FIXTURES, name));
      console.log(`PLANTED ${name}\n${show(findings)}`);
      assert.match(show(findings), rule);
    });
  }

  const planted: [string, string, () => string, RegExp][] = [
    ["(c) a tool served without the gate", "ungated", () => plant("ungated", START, { "src/index.ts": `import { startTransport } from "@clearseal/core";\nconst tool = ${TOOL};\nexport function start() { const registry = { list: () => [tool], get: () => tool }; return startTransport({ registry: registry as never, serverInfo: { name: "p", version: "0" } }); }\n` }), /src\/index\.ts: ungated-registry: startTransport is given a registry that is not loadPinnedRegistry's/],
    ["A1: a verifier passed to the transport by shorthand", "verifier-shorthand", () => plant("verifier-shorthand", START, { "src/index.ts": `import { loadPinnedRegistry, startTransport } from "@clearseal/core";\nconst verify = async () => ({ ok: true, principal: { id: "x" } });\nexport async function start() { const registry = loadPinnedRegistry("m.json", [], { compile: () => () => true, limits: { maxSchemaDepth: 1, maxSchemaNodes: 1 } }); return startTransport({ registry, serverInfo: { name: "p", version: "0" }, verifier: { verify } }); }\n` }), /option-forbidden: startTransport is given "verifier"[\s\S]*control-constructed: a verify member/],
    ["A2: a self-approved registry through a namespace import", "self-pin", () => plant("self-pin", START, { "src/index.ts": `import * as core from "@clearseal/core";\nexport function start() { const gate = core.PinGate.load("{}"); return gate; }\n` }), /core-import: import \* as core: a namespace reaches every control/],
    ["A2: PinGate imported by name", "self-pin-named", () => plant("self-pin-named", START, { "src/index.ts": `import { PinGate as Helpers } from "@clearseal/core";\nexport function start() { return Helpers.load("{}"); }\n` }), /core-import: PinGate: an edition imports only/],
    ["A3: code loading and network reach without an import", "globals", () => plant("globals", START, { "src/index.ts": `export async function start() { const fs = process.getBuiltinModule("node:fs"); const r = await fetch("http://127.0.0.1:1/"); return [fs, r, eval("1"), new Function("return 1")]; }\n` }), /forbidden-global: process\.getBuiltinModule[\s\S]*forbidden-global: fetch[\s\S]*forbidden-global: eval[\s\S]*forbidden-global: Function/],
    ["A4: a control in a nested test/ directory", "nested-test", () => plant("nested-test", START, { "src/index.ts": `export { start } from "./test/evil.ts";\n`, "src/test/evil.ts": `import { readFileSync } from "node:fs";\nexport function start() { return readFileSync("/etc/hostname"); }\n` }), /src\/test\/evil\.ts: builtin-forbidden: "node:fs"/],
    ["A5: an encoded relative path into the core", "encoded", () => plant("encoded", START, { "src/index.ts": `export { start } from "./%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/core/src/index.ts";\n` }), /import-outside-exports: "\.\/%2e%2e.*an encoded specifier cannot be checked/],
    ["A7: an arbitrary_exec tool, and the exec switch turned off", "exec", () => plant("exec", { definitions: "tool-definitions", start: "deploy-scaffold" }, { "src/index.ts": `import { loadPinnedRegistry, startTransport } from "@clearseal/core";\nexport const definitions = [{ ...${TOOL}, capability: { ...${TOOL}.capability, capability_class: "arbitrary_exec" } }];\nexport async function start() { const registry = loadPinnedRegistry("m.json", definitions, { compile: () => () => true, limits: { maxSchemaDepth: 1, maxSchemaNodes: 1 }, execToolsForbidden: false }); return startTransport({ registry, serverInfo: { name: "p", version: "0" } }); }\n` }), /option-forbidden: loadPinnedRegistry is given "execToolsForbidden"[\s\S]*kind-mismatch: export definitions: declared tool-definitions, but it is not t: not an arbitrary_exec tool/],
    ["A6: an admitted tool edited after admission", "mutate", () => plant("mutate", START, { "src/index.ts": `import { loadPinnedRegistry, startTransport } from "@clearseal/core";\nexport async function start() { const registry = loadPinnedRegistry("m.json", [], { compile: () => () => true, limits: { maxSchemaDepth: 1, maxSchemaNodes: 1 } }); registry.get("t"); return startTransport({ registry, serverInfo: { name: "p", version: "0" } }); }\n` }), /registry-touched: registry: an admitted registry goes to startTransport untouched/],
    ["A8: an accessor and a Proxy in the exports", "accessor-proxy", () => plant("accessor-proxy", { start: "deploy-scaffold", config: "configuration-schema" }, { "src/index.ts": `let n = 0;\nexport const config = { type: "object", get properties() { n += 1; return n > 1 ? { verify: () => true } : {}; } };\nexport function start() { return new Proxy({}, {}); }\n` }), /forbidden-global: Proxy[\s\S]*control-exported: export config: carries an accessor/],
    ["A8: an exported Proxy, whose members the check cannot read", "exported-proxy", () => plant("exported-proxy", { config: "configuration-schema" }, { "src/index.ts": `export const config = new Proxy({ type: "object" }, { ownKeys: () => [] });\n` }), /control-exported: export config: carries a Proxy, whose members cannot be read/],
    ["A8: a verify member under a computed name", "computed", () => plant("computed", START, { "src/index.ts": `const k = "ver" + "ify";\nexport function start() { return { [k]: () => true }; }\n` }), /computed-member: a member whose name is computed cannot be checked/],
    ["A8: a conditional export that loads something else", "conditional", () => plant("conditional", START, { "src/index.ts": "export function start() { return 1; }\n", "src/evil.ts": "export const verifier = { verify: () => true };\n" }, { ".": { node: "./src/evil.ts", default: "./src/index.ts" } }), /package\.json: conditional-exports: exports\["\."\] has conditions node/],
    ["A9: a core function re-exported under an edition's name", "reexport", () => plant("reexport", START, { "src/index.ts": `export { loadPinnedRegistry as start } from "@clearseal/core";\n` }), /core-reexport: re-exports from "@clearseal\/core"[\s\S]*control-exported: export start: carries a value the core exports/],
    ["A16-form: the transport renamed and called indirectly", "aliased", () => plant("aliased", START, { "src/index.ts": `import { loadPinnedRegistry, startTransport } from "@clearseal/core";\nconst s = startTransport;\nexport async function start() { const registry = loadPinnedRegistry("m.json", [], { compile: () => () => true, limits: { maxSchemaDepth: 1, maxSchemaNodes: 1 } }); return s.call(null, { registry, serverInfo: { name: "p", version: "0" } }); }\n` }), /core-aliased: startTransport: the core's entry points are called by name/],
  ];
  for (const [label, name, make, rule] of planted) {
    void it(`red-proof ${label}`, () => {
      const findings = checkEdition(make());
      console.log(`PLANTED ${name}\n${show(findings)}`);
      assert.match(show(findings), rule);
    });
  }

  void it("red-proof A5: a symbolic link in an edition's tree", () => {
    const dir = plant("symlink", START, { "src/index.ts": "export function start() { return 1; }\n" });
    try {
      symlinkSync(fileURLToPath(new URL("../../src/transport/registry.ts", import.meta.url)), join(dir, "src/reg.ts"));
    } catch (err) {
      console.log(`PLANTED symlink: not creatable here (${String((err as { code?: unknown }).code)}); the rule is exercised on POSIX`);
      assert.equal(process.platform, "win32");
      return;
    }
    const findings = checkSource(dir);
    console.log(`PLANTED symlink\n${show(findings)}`);
    assert.match(show(findings), /src\/reg\.ts: symlink: a symbolic link in an edition's tree/);
  });

  void it("A8: an edition that patches built-ins cannot blind the check of the next one (each runs in its own process)", () => {
    const poison = plant("poison", START, { "src/index.ts": "Object.getOwnPropertyNames = () => [];\nObject.keys = () => [];\nexport function start() { return 1; }\n" });
    checkEdition(poison);
    assert.match(show(checkEdition(join(FIXTURES, "planted-verifier"))), /control-exported: export verifier: carries a verifier/);
  });
});
