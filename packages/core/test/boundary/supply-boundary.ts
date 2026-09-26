// The supply boundary (N1; architecture §4 *Core ↔ edition*, §5 *Where OS primitives live*;
// CSR-WO-1004 §1.5). An edition may export only the kinds in KINDS, each declared by name in its
// package.json ("clearseal": { "exports": { <export>: <kind> } }). Its source may use the core only
// through a short list of named imports, and may build none of the core's controls. The kinds and the
// allowed imports are data in this one place: the next edition extends them by argument.
//
// What this is and is not. The export rules run in a fresh child process per edition, so an edition
// cannot patch the checker's own built-ins. The source rules read the syntax tree; they are a strict
// allowlist, but a static reading of JavaScript is best effort, not a sandbox. The boundaries that
// hold at run time are the core's: the transport serves only a genuine PinnedRegistry (its brand),
// and a tool reaches out only through its cage, whose OS-level form is the edition's to supply.

import { execFileSync } from "node:child_process";
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
 *  yet, so nothing can be that kind today. */
export const KINDS: Readonly<Record<string, "checked" | null>> = Object.freeze({
  "tool-definitions": "checked",
  "manifest-path": "checked",
  "configuration-schema": "checked",
  "deploy-scaffold": "checked",
  cage: "checked",
  "approval-notifier": null,
  "audit-store": null,
});

/** The core's values an edition's source may import by name: what a deploy scaffold needs to admit
 *  its tools through the gate and start the transport. Type-only imports are unrestricted. */
export const CORE_IMPORTS: ReadonlySet<string> = new Set(["loadPinnedRegistry", "startTransport", "ValidationPool", "compileSchema", "DEFAULT_LIMITS", "requestStateKeyFromEnv"]);

/** The keys an edition may pass to startTransport and to loadPinnedRegistry. No verifier, no clock,
 *  no exec switch, no strictness override, no cage factory: those are the core's. */
export const TRANSPORT_OPTIONS: ReadonlySet<string> = new Set(["registry", "serverInfo", "config", "validationPool", "requestStateKey", "audit"]);
export const REGISTRY_OPTIONS: ReadonlySet<string> = new Set(["compile", "limits"]);

/** Node built-ins an edition's source may import: pure helpers with no reach outside the process. */
export const ALLOWED_BUILTINS: ReadonlySet<string> = new Set(["node:path", "node:url"]);
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

/** Globals that load code or reach out without an import: refused wherever they are referenced. */
const FORBIDDEN_GLOBALS = new Set(["eval", "Function", "fetch", "WebSocket", "XMLHttpRequest", "EventSource", "globalThis", "global", "require", "module", "Proxy", "Reflect"]);
/** process members that reach native code or other modules. process.env, .on and .exit are allowed. */
const FORBIDDEN_PROCESS = new Set(["getBuiltinModule", "binding", "_linkedBinding", "dlopen", "mainModule", "execve", "kill"]);
/** The core's controls by name: an edition that names one is building its own. */
const CONTROL_NAMES = new Set(["PinGate", "PinnedRegistry", "buildManifest", "serializeManifest", "parseManifest", "Admission"]);

const SKIP_TOP = new Set(["node_modules", "dist", "test"]);

/** The edition's source files: everything under its directory except the top-level test/, dist/
 *  and node_modules/. A symbolic link anywhere in the tree is itself a finding. */
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

function isLoadCall(e: ts.Expression, coreLocal: ReadonlyMap<string, string>): boolean {
  return ts.isCallExpression(e) && ts.isIdentifier(e.expression) && coreLocal.get(e.expression.text) === "loadPinnedRegistry";
}

/** The static rules, over every source file of the edition. */
export function checkSource(dir: string): Finding[] {
  const findings: Finding[] = [];
  const edition = realpathSync(dir);
  for (const file of sourceFiles(dir, findings)) {
    const rel = relative(dir, file).split(sep).join("/");
    const add = (rule: string, detail: string): void => {
      findings.push({ file: rel, rule, detail });
    };
    const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    /** Local names bound to the allowed core values, and to a registry from loadPinnedRegistry. */
    const coreLocal = new Map<string, string>();
    const registries = new Set<string>();

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

    const checkOptions = (obj: ts.Expression | undefined, allowed: ReadonlySet<string>, what: string): void => {
      if (obj === undefined) return;
      if (!ts.isObjectLiteralExpression(obj)) {
        add("options-not-literal", `${what}'s options are an object literal, so their keys can be read`);
        return;
      }
      for (const p of obj.properties) {
        if (ts.isSpreadAssignment(p)) {
          // Only a conditional of object literals with allowed keys: the `...(x ? {} : { k })` idiom.
          const e = ts.isParenthesizedExpression(p.expression) ? p.expression.expression : p.expression;
          const branches = ts.isConditionalExpression(e) ? [e.whenTrue, e.whenFalse] : [e];
          for (const b of branches) checkOptions(ts.isParenthesizedExpression(b) ? b.expression : b, allowed, what);
          continue;
        }
        const key = p.name !== undefined && !ts.isComputedPropertyName(p.name) ? nameOf(p.name) : undefined;
        if (key === undefined || !allowed.has(key)) add("option-forbidden", `${what} is given "${key ?? "(computed)"}": an edition may pass only ${[...allowed].join(", ")}`);
        if (what === "startTransport" && key === "registry") {
          const v = ts.isShorthandPropertyAssignment(p) ? p.name : ts.isPropertyAssignment(p) ? p.initializer : undefined;
          const ok = v !== undefined && ((ts.isIdentifier(v) && registries.has(v.text)) || isLoadCall(v, coreLocal));
          if (!ok) add("ungated-registry", "startTransport is given a registry that is not loadPinnedRegistry's: the gate is the only registration path");
        }
      }
    };

    // First pass: imports and re-exports, so local names are known before they are used.
    for (const stmt of src.statements) {
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const spec = stmt.moduleSpecifier.text;
        const clause = stmt.importClause;
        if (spec === "@clearseal/core") {
          if (clause?.isTypeOnly === true) continue;
          if (clause?.name !== undefined) add("core-import", "a default import of the core: import the allowed names");
          const bindings = clause?.namedBindings;
          if (bindings !== undefined && ts.isNamespaceImport(bindings)) add("core-import", `import * as ${bindings.name.text}: a namespace reaches every control; import the allowed names`);
          if (bindings !== undefined && ts.isNamedImports(bindings)) {
            for (const el of bindings.elements) {
              if (el.isTypeOnly) continue;
              const imported = (el.propertyName ?? el.name).text;
              if (!CORE_IMPORTS.has(imported)) add("core-import", `${imported}: an edition imports only ${[...CORE_IMPORTS].join(", ")} from the core`);
              else coreLocal.set(el.name.text, imported);
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
        if (spec.startsWith(".")) relativeSpecifier(spec);
        else if (!stmt.isTypeOnly) add("core-reexport", `re-exports from "${spec}": an edition exports its own kinds, never the core's values`);
      }
    }

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (callee.kind === ts.SyntaxKind.ImportKeyword) add("dynamic-import", "import(): an edition's imports are static and checked");
        if (ts.isIdentifier(callee) && coreLocal.get(callee.text) === "startTransport") checkOptions(node.arguments[0], TRANSPORT_OPTIONS, "startTransport");
        if (ts.isIdentifier(callee) && coreLocal.get(callee.text) === "loadPinnedRegistry") checkOptions(node.arguments[2], REGISTRY_OPTIONS, "loadPinnedRegistry");
      }
      if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.name.text !== "url") add("forbidden-global", `import.meta.${node.name.text}: only import.meta.url`);
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined && isLoadCall(node.initializer, coreLocal)) registries.add(node.name.text);
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left) && isLoadCall(node.right, coreLocal)) registries.add(node.left.text);

      if (ts.isIdentifier(node) && isReference(node)) {
        const t = node.text;
        if (FORBIDDEN_GLOBALS.has(t) && !coreLocal.has(t)) add("forbidden-global", `${t}: code loading and network access go through the core and the cage`);
        if (CONTROL_NAMES.has(t)) add("control-constructed", `${t}: the core's gate and registry are built by the core alone`);
        const core = coreLocal.get(t);
        const isCallee = ts.isCallExpression(node.parent) && node.parent.expression === node;
        const isNew = ts.isNewExpression(node.parent) && node.parent.expression === node;
        if ((core === "startTransport" || core === "loadPinnedRegistry") && !isCallee) add("core-aliased", `${t}: the core's entry points are called by name, never passed around or renamed`);
        if (core === "ValidationPool" && !isNew) add("core-aliased", `${t}: constructed, never passed around`);
        // A registry from loadPinnedRegistry is handed to startTransport and touched nowhere else.
        if (registries.has(t)) {
          const p = node.parent;
          const inTransportCall = (prop: ts.Node): boolean => ts.isObjectLiteralExpression(prop.parent) && ts.isCallExpression(prop.parent.parent) && prop.parent.parent.arguments[0] === prop.parent && ts.isIdentifier(prop.parent.parent.expression) && coreLocal.get(prop.parent.parent.expression.text) === "startTransport";
          const asOption = ((ts.isPropertyAssignment(p) && p.initializer === node && nameOf(p.name) === "registry") || (ts.isShorthandPropertyAssignment(p) && p.name.text === "registry")) && inTransportCall(p);
          const asAssignment = ts.isBinaryExpression(p) && p.left === node && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && isLoadCall(p.right, coreLocal);
          if (!asOption && !asAssignment) add("registry-touched", `${t}: an admitted registry goes to startTransport untouched`);
        }
      }
      if (ts.isShorthandPropertyAssignment(node) && registries.has(node.name.text) && node.name.text !== "registry") add("registry-touched", `${node.name.text}: an admitted registry goes to startTransport untouched`);
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "process" && FORBIDDEN_PROCESS.has(node.name.text)) add("forbidden-global", `process.${node.name.text}: reaches native code or another module`);
      if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "process") add("forbidden-global", "process[...]: a computed member of process cannot be checked");

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

/** The runtime rules, run in a fresh node process for this edition alone. */
function checkExports(dir: string): Finding[] {
  const env = { ...process.env };
  delete env["NODE_TEST_CONTEXT"];
  try {
    const out = execFileSync(process.execPath, [CHILD, dir], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(out.trim().split("\n").pop() ?? "[]") as Finding[];
  } catch (err) {
    // An edition that crashes the check, or prints over its result, is refused, not waved through.
    const e = err as { stderr?: string; message?: string };
    return [{ file: "package.json", rule: "check-failed", detail: `the export check did not complete: ${(e.stderr ?? e.message ?? "").trim().split("\n")[0] ?? ""}` }];
  }
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
