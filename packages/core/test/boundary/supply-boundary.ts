// The supply boundary (N1; architecture §4 *Core ↔ edition*, §5 *Where OS primitives live*;
// CSR-WO-1004 §1.5, CSR-WO-1007 §1.3, CSR-WO-1007a §1.2, §1.4). An edition may export only the kinds
// in KINDS, each declared by name in its package.json ("clearseal": { "exports": { <export>: <kind> } }).
// It assembles nothing and names no manifest: the core's startNode builds the gate, the registry and
// the transport from the edition's definitions and configuration schema, against the manifest the
// operator names in CLEARSEAL_MANIFEST. So its source rules are short enough to hold:
//   (a) imports from @clearseal/core are type-only, except startNode, in bin/ only, called as
//       startNode({ definitions, configSchema }) and in no other way;
//   (b) bin/ imports nothing but the core's startNode (and its types) and the edition's own package
//       entry, by its package name: no relative import (into dist/ or anywhere), no built-in, no other
//       package. So what bin/ starts is the entry the export check loads;
//   (c) `process` and `import.meta` are not referenced at all (by name, alias, destructuring,
//       parentheses or computed access);
//   (d) no property of a namespace import of the core is read, even a type-only one's;
//   (e) so process.getBuiltinModule, createRequire, loadEnvFile and every other process member are
//       unreachable: (c) removes process itself.
// The kinds and the one allowed value import are data in this one place.
//
// What this is and is not: DEFENSE IN DEPTH. Static reading of JavaScript is best effort against a
// hostile author, not a sandbox, and an author with arbitrary code in the node's process can defeat
// any check made from outside it (a module that detects the check, the Function constructor reached
// through `.constructor`, deferred to the P2 hardening WO). The runtime guarantee is the core's, and
// it does not depend on this checker: startNode admits only definitions that hash to the manifest the
// operator named (CSR-WO-1007a §1.1), the transport serves only a genuine PinnedRegistry, and a tool
// reaches out only through its cage. The export rules run in a fresh child process per edition, so an
// edition cannot patch the checker's own built-ins, and the child's report is authenticated by a nonce
// the loaded entry never sees (checkExports), so an entry that prints a result of its own is refused.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

export interface Finding {
  /** The file, relative to the edition's directory (or the entry, for an export). */
  file: string;
  rule: string;
  detail: string;
}

/** The kinds an edition may export. The structural check for each runs in the child
 *  (supply-boundary-child.ts); `null` marks a kind the architecture names but the core does not define
 *  yet, so nothing can be that kind today. A deploy scaffold is bin/ and its configuration, not an
 *  export (CSR-WO-1007 §1.2). */
export const KINDS: Readonly<Record<string, "checked" | null>> = Object.freeze({
  "tool-definitions": "checked",
  "configuration-schema": "checked",
  cage: "checked",
  "approval-notifier": null,
  "audit-store": null,
});

/** The one core value an edition imports, and where: startNode, in bin/ only. */
export const BIN_CORE_IMPORTS: ReadonlySet<string> = new Set(["startNode"]);
/** The keys startNode is given: the edition's three values, nothing else. */
export const START_NODE_KEYS: readonly string[] = ["definitions", "configSchema"];

/** Node built-ins an edition's source may import: pure helpers with no reach outside the process. */
export const ALLOWED_BUILTINS: ReadonlySet<string> = new Set(["node:path", "node:url"]);
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

/** Globals that load code or reach out without an import: refused wherever they are referenced. */
const FORBIDDEN_GLOBALS = new Set(["eval", "Function", "fetch", "WebSocket", "XMLHttpRequest", "EventSource", "globalThis", "global", "require", "module", "Proxy", "Reflect"]);
/** The core's controls by name: an edition that names one is building its own. */
const CONTROL_NAMES = new Set(["PinGate", "PinnedRegistry", "buildManifest", "serializeManifest", "parseManifest", "Admission", "loadPinnedRegistry", "startTransport"]);

/** Not read: dependencies and the edition's own tests. dist/ IS read (CSR-WO-1007a adversarial pass,
 *  F3): the package entry an edition's bin/ loads is usually dist/index.js, and code the checker never
 *  reads is code that runs unchecked, before startNode, in the node's process. */
const SKIP_TOP = new Set(["node_modules", "test"]);

/** The edition's source files: everything under its directory except the top-level test/ and
 *  node_modules/, dist/ included. A symbolic link anywhere in the tree is itself a finding. */
function sourceFiles(dir: string, findings: Finding[]): string[] {
  const out: string[] = [];
  const walk = (d: string, top: boolean): void => {
    for (const name of readdirSync(d)) {
      if (top && SKIP_TOP.has(name)) continue;
      const p = join(d, name);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) {
        findings.push({ file: relative(dir, p).split(sep).join("/"), rule: "symlink", detail: "a symbolic link in an edition's tree could lead anywhere; editions hold files" });
        continue;
      }
      if (st.isDirectory()) walk(p, false);
      else if (/\.(ts|mts|cts|js|mjs|cjs|tsx|jsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
    }
  };
  walk(dir, true);
  return out.sort();
}

const nameOf = (n: ts.PropertyName | ts.BindingName | undefined): string | undefined => (n !== undefined && (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)) ? n.text : undefined);

/** Is this identifier a reference (an expression), rather than a name being declared or a member
 *  being named? */
function isReference(id: ts.Identifier): boolean {
  const p = id.parent;
  if ((ts.isPropertyAccessExpression(p) && p.name === id) || (ts.isQualifiedName(p) && p.right === id)) return false;
  if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodSignature(p) || ts.isEnumMember(p)) && p.name === id) return false;
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p) || ts.isBindingElement(p) || ts.isFunctionExpression(p) || ts.isClassExpression(p)) && p.name === id) return false;
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isExportSpecifier(p) || ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return false;
  if (ts.isTypeReferenceNode(p) || ts.isExpressionWithTypeArguments(p) || ts.isTypeQueryNode(p)) return false;
  return true;
}

/** The static rules, over every source file of the edition. */
export function checkSource(dir: string): Finding[] {
  const findings: Finding[] = [];
  const edition = realpathSync(dir);
  const ownName = packageName(dir);
  for (const file of sourceFiles(dir, findings)) {
    const rel = relative(dir, file).split(sep).join("/");
    const inBin = rel.startsWith("bin/");
    const add = (rule: string, detail: string): void => {
      findings.push({ file: rel, rule, detail });
    };
    const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    /** Local names bound to startNode (in bin/), to a type-only core import, and to a core namespace. */
    const startNodeLocal = new Set<string>();
    const typeOnly = new Set<string>();
    const namespaces = new Set<string>();

    const relativeSpecifier = (spec: string): void => {
      if (spec.includes("%")) {
        add("import-outside-exports", `"${spec}": an encoded specifier cannot be checked`);
        return;
      }
      let target: string;
      try {
        target = realpathSync(fileURLToPath(new URL(spec, pathToFileURL(file))));
      } catch {
        add("import-outside-exports", `"${spec}" does not resolve to a file in the edition`);
        return;
      }
      if (target !== edition && !target.startsWith(`${edition}${sep}`)) add("import-outside-exports", `"${spec}" resolves outside the edition (${relative(edition, target).split(sep).join("/")})`);
    };

    // First pass: imports and re-exports, so local names are known before they are used.
    for (const stmt of src.statements) {
      if (ts.isImportEqualsDeclaration(stmt) && ts.isExternalModuleReference(stmt.moduleReference)) add("core-import", "import = require(): an edition's imports are ES imports, checked by name");
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const spec = stmt.moduleSpecifier.text;
        const clause = stmt.importClause;
        // (b) bin/ imports the core's startNode and the edition's own entry, by name, and nothing else.
        if (inBin && spec !== "@clearseal/core") {
          if (ownName === undefined || spec !== ownName) add("bin-import", `"${spec}": bin/ imports only the core's startNode and the edition's own package entry by name${ownName === undefined ? " (package.json has no name)" : ` ("${ownName}")`}, so what it starts is the entry the export check loads`);
          continue;
        }
        if (spec === "@clearseal/core") {
          const bindings = clause?.namedBindings;
          if (clause?.isTypeOnly === true) {
            if (clause.name !== undefined) typeOnly.add(clause.name.text);
            if (bindings !== undefined && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
            if (bindings !== undefined && ts.isNamedImports(bindings)) for (const el of bindings.elements) typeOnly.add(el.name.text);
            continue;
          }
          if (clause?.name !== undefined) add("core-import", "a default import of the core: an edition imports only types from the core, and startNode in bin/");
          if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
            namespaces.add(bindings.name.text);
            add("core-import", `import * as ${bindings.name.text}: a namespace reaches every control; an edition imports only types from the core, and startNode in bin/`);
          }
          if (bindings !== undefined && ts.isNamedImports(bindings)) {
            for (const el of bindings.elements) {
              if (el.isTypeOnly) {
                typeOnly.add(el.name.text);
                continue;
              }
              const imported = (el.propertyName ?? el.name).text;
              if (BIN_CORE_IMPORTS.has(imported) && inBin) startNodeLocal.add(el.name.text);
              else add("core-import", `${imported}: an edition imports only types from the core, and ${[...BIN_CORE_IMPORTS].join(", ")} in bin/`);
            }
          }
        } else if (spec.startsWith("@clearseal/core/")) add("import-outside-exports", `"${spec}": the core is reached only through its package entry`);
        else if (spec.startsWith(".")) relativeSpecifier(spec);
        else if (BUILTINS.has(spec)) {
          if (!ALLOWED_BUILTINS.has(spec)) add("builtin-forbidden", `"${spec}": an edition reaches outside the process only through a tool's cage`);
        } else add("import-outside-exports", `"${spec}": an edition depends on the core's package entry and nothing else`);
      }
      if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier !== undefined && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const spec = stmt.moduleSpecifier.text;
        if (inBin) {
          add("bin-import", `re-exports from "${spec}": bin/ starts the node and exports nothing`);
          continue;
        }
        if (spec.startsWith(".")) relativeSpecifier(spec);
        else if (!stmt.isTypeOnly) add("core-reexport", `re-exports from "${spec}": an edition exports its own kinds, never the core's values`);
      }
    }

    /** Is this startNode reference the one allowed call: startNode({ definitions, configSchema })? */
    const isStartNodeCall = (id: ts.Identifier): boolean => {
      const call = id.parent;
      if (!ts.isCallExpression(call) || call.expression !== id || call.arguments.length !== 1) return false;
      const arg = call.arguments[0];
      if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return false;
      const keys: string[] = [];
      for (const p of arg.properties) {
        if (!ts.isShorthandPropertyAssignment(p) && !ts.isPropertyAssignment(p)) return false;
        if (ts.isComputedPropertyName(p.name)) return false;
        const k = nameOf(p.name);
        if (k === undefined) return false;
        keys.push(k);
      }
      return keys.length === START_NODE_KEYS.length && START_NODE_KEYS.every((k) => keys.includes(k));
    };

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) add("dynamic-import", "import(): an edition's imports are static and checked");
      // (c) import.meta, in any form: an edition names no file of its own, its manifest least of all.
      if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) add("import-meta", "import.meta: an edition refers to no file by its own location; the operator names the manifest (CLEARSEAL_MANIFEST)");
      // (d) a property of a core namespace, read in an expression.
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && ts.isIdentifier(node.expression) && namespaces.has(node.expression.text)) add("core-namespace-access", `${node.expression.text}${ts.isPropertyAccessExpression(node) ? `.${node.name.text}` : "[...]"}: an edition reads nothing from the core's namespace`);

      if (ts.isIdentifier(node) && isReference(node)) {
        const t = node.text;
        // (c) process, by any name: every alias starts from a reference to process itself.
        if (t === "process") add("process-referenced", "process: an edition reads nothing from the process; the core reads the configuration and starts the node");
        if (FORBIDDEN_GLOBALS.has(t)) add("forbidden-global", `${t}: code loading and network access go through the core and the cage`);
        if (CONTROL_NAMES.has(t)) add("control-constructed", `${t}: the core's gate, registry and transport are built by the core alone`);
        if (typeOnly.has(t)) add("type-import-as-value", `${t}: imported from the core as a type, used as a value`);
        if (startNodeLocal.has(t) && !isStartNodeCall(node)) add("start-node-call", `${t}: startNode is called once, as startNode({ ${START_NODE_KEYS.join(", ")} }), and never passed around`);
      }

      // No verifier: a member named verify in any form, and no member whose name cannot be read.
      const memberName = ts.isMethodDeclaration(node) || ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isShorthandPropertyAssignment(node) ? node.name : undefined;
      if (memberName !== undefined) {
        if (ts.isComputedPropertyName(memberName)) {
          const e = memberName.expression;
          if (ts.isStringLiteral(e) && e.text === "verify") add("control-constructed", "a verify member: an edition does not verify tokens");
          else if (!ts.isStringLiteral(e) && !ts.isNumericLiteral(e)) add("computed-member", "a member whose name is computed cannot be checked");
        } else if (nameOf(memberName) === "verify") add("control-constructed", "a verify member: an edition does not verify tokens");
      }
      if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === "verify") add("control-constructed", 'a ["verify"] member: an edition does not verify tokens');
      if (ts.isHeritageClause(node) && node.types.some((t) => /\bVerifier\b/.test(t.expression.getText(src)))) add("control-constructed", "implements Verifier: the verifier is the core's");
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  return findings;
}

const CHILD = fileURLToPath(new URL("./supply-boundary-child.ts", import.meta.url));

/** The edition's package name, or undefined when package.json has none. */
function packageName(dir: string): string | undefined {
  try {
    const name = (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: unknown }).name;
    return typeof name === "string" && name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

/** The child's report line: its marker, then JSON { nonce, findings }. */
export const REPORT_MARKER = "clearseal-supply-boundary-report ";

const isFinding = (v: unknown): v is Finding =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).sort().join(",") === "detail,file,rule" && ["file", "rule", "detail"].every((k) => typeof (v as Record<string, unknown>)[k] === "string");

/**
 * The child's findings from its stdout, trusted only if authenticated. The nonce reaches the child on
 * stdin, which the child reads to its end before it loads anything of the edition's; the loaded entry
 * can print anything, but not a line carrying a nonce it never saw. Exactly one report line must carry
 * this nonce and a well-formed findings array; anything else (no line, two, a wrong nonce, a malformed
 * array, a non-zero exit) is a check-failed finding, never a clean result.
 */
export function parseReport(stdout: string, nonce: string): Finding[] | string {
  const lines = stdout.split("\n").filter((l) => l.startsWith(REPORT_MARKER));
  const ours: unknown[] = [];
  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line.slice(REPORT_MARKER.length));
    } catch {
      continue;
    }
    if (typeof value === "object" && value !== null && (value as { nonce?: unknown }).nonce === nonce) ours.push((value as { findings?: unknown }).findings);
  }
  if (ours.length !== 1) return `${String(ours.length)} authenticated report lines (${String(lines.length)} report-looking lines): the child's own report is missing or doubled`;
  const findings = ours[0];
  if (!Array.isArray(findings) || !findings.every(isFinding)) return "the authenticated report does not carry a well-formed findings array";
  return findings;
}

/** The runtime rules, run in a fresh node process for this edition alone. */
function checkExports(dir: string): Finding[] {
  const env = { ...process.env };
  delete env["NODE_TEST_CONTEXT"];
  const nonce = randomBytes(32).toString("hex");
  const failed = (detail: string): Finding[] => [{ file: "package.json", rule: "check-failed", detail: `the export check did not complete: ${detail}` }];
  let out: string;
  try {
    out = execFileSync(process.execPath, [CHILD, dir], { encoding: "utf8", env, input: nonce, stdio: ["pipe", "pipe", "pipe"] });
  } catch (err) {
    // An edition that crashes the check, or exits it early, is refused, not waved through.
    const e = err as { stderr?: string; message?: string };
    return failed((e.stderr ?? e.message ?? "").trim().split("\n")[0] ?? "");
  }
  const report = parseReport(out, nonce);
  return typeof report === "string" ? failed(report) : report;
}

/** Every finding for the edition in `dir`; none means it keeps to the boundary. */
export function checkEdition(dir: string): Finding[] {
  return [...checkSource(dir), ...checkExports(dir)];
}

/** Every package under packages/ other than the core. */
export function editions(packagesDir: string): string[] {
  return readdirSync(packagesDir)
    .filter((name) => name !== "core" && lstatSync(join(packagesDir, name)).isDirectory())
    .map((name) => join(packagesDir, name));
}
