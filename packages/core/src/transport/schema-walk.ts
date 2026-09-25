// A keyword-aware walk of a JSON Schema 2020-12 document. Every registration check (depth, size,
// `$ref`, `x-mcp-header`) uses it, so they all agree on what is a subschema and what is a name.
// Under `properties`, `patternProperties`, `$defs`, `definitions` and `dependentSchemas` the keys
// are names and the values are schemas, so a property called `$ref` or `const` is a name, not a
// keyword. `const`, `enum`, `default` and `examples` hold instance data only at keyword position.
// Any other object- or array-valued keyword is walked as a schema, including unknown ones: an
// unknown keyword that hides a `$ref` or an `x-mcp-header` is refused rather than ignored
// (fail closed; CSR-WO-1005 adversarial finding F6).

import { isPlainObject } from "./jsonrpc.ts";

const NAME_MAPS = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);
const DATA = new Set(["const", "enum", "default", "examples"]);

export interface SchemaVisit {
  node: Record<string, unknown>;
  /** Nesting depth in subschemas; the root is 0. */
  depth: number;
  /** The chain of `properties` names from the root when every step was `properties`; else null. */
  staticPath: string[] | null;
}

export function walkSchema(schema: unknown, visit: (v: SchemaVisit) => void): void {
  const walk = (node: unknown, depth: number, staticPath: string[] | null): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth, null);
      return;
    }
    if (!isPlainObject(node)) return;
    visit({ node, depth, staticPath });
    for (const [key, value] of Object.entries(node)) {
      if (DATA.has(key) || key === "$ref" || key === "$dynamicRef" || key === "x-mcp-header") continue;
      if (NAME_MAPS.has(key) && isPlainObject(value)) {
        for (const [name, sub] of Object.entries(value)) walk(sub, depth + 1, key === "properties" && staticPath !== null ? [...staticPath, name] : null);
      } else if (typeof value === "object" && value !== null) {
        walk(value, depth + 1, null);
      }
    }
  };
  walk(schema, 0, []);
}
