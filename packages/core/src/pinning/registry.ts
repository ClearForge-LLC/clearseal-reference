// The pinned registry (CSR-WO-1001 §1.3), the transport's one ToolRegistry. Its constructor takes
// the pin gate's Admission and nothing else. It checks at runtime that PinGate.admit issued the
// value, and the Admission's private brand makes the same demand at compile time. So no raw
// definition can be registered: verify-before-register is structural, not a convention (N2).
//
// Each admitted tool passes the transport's static registration checks, and its input_schema is
// compiled by the core's validator at construction, as before.

import { readFileSync } from "node:fs";

import { type Admission, isIssuedAdmission, PinGate, type PinRefusal } from "./gate.ts";
import { ManifestError, type PinnableTool } from "./manifest.ts";
import type { Limits } from "../transport/config.ts";
import { prepareTool, type PinningStatus, type RegisteredTool, type SchemaCompiler, type ToolRegistry } from "../transport/registry.ts";

export interface PinnedRegistryOptions {
  compile: SchemaCompiler;
  limits: Pick<Limits, "maxSchemaDepth" | "maxSchemaNodes">;
  /** PIN_STRICT: true (the default) stops the node on any refusal; false serves the admitted tools
   *  and leaves the refused ones absent. It never excuses a missing manifest: without a manifest
   *  there is no gate, and without an admission there is no registry. */
  strict: boolean;
}

export class PinnedRegistry implements ToolRegistry {
  readonly #tools: ReadonlyMap<string, RegisteredTool>;
  readonly pinning: PinningStatus;

  constructor(admission: Admission, options: PinnedRegistryOptions) {
    if (!isIssuedAdmission(admission)) throw new TypeError("a pinned registry is built only from PinGate.admit's Admission");
    const tools = new Map<string, RegisteredTool>();
    for (const tool of admission.admitted) {
      // Served exactly as hashed: name, description and schema (the tag is pinned, not served).
      tools.set(tool.name, prepareTool({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, handler: tool.handler }, options.compile, options.limits));
    }
    this.#tools = tools;
    const refusedNames = new Set(admission.refused.map((r) => r.name));
    this.pinning = Object.freeze({
      strict: options.strict,
      admitted: tools.size,
      refused: admission.refused,
      isRefused: (name: string) => refusedNames.has(name),
    });
  }

  list(): readonly RegisteredTool[] {
    return [...this.#tools.values()].sort((a, b) => (a.definition.name < b.definition.name ? -1 : a.definition.name > b.definition.name ? 1 : 0));
  }

  get(name: string): RegisteredTool | undefined {
    return this.#tools.get(name);
  }
}

/** Under the strict default, any refusal stops the node before it binds. */
export class PinRefusedError extends Error {
  override name = "PinRefusedError";
  readonly refused: PinningStatus["refused"];
  constructor(refused: PinningStatus["refused"]) {
    super(`the pin gate refused ${String(refused.length)} tool(s): ${refused.map((r) => `${r.name} (${r.reason}${r.rule === undefined ? "" : ` ${r.rule}`})`).join(", ")}; PIN_STRICT is on, so the node does not start`);
    this.refused = refused;
  }
}

/** PIN_STRICT from the environment: strict unless the value is exactly "false". */
export function pinStrictFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["PIN_STRICT"] !== "false";
}

/** The node's start-up path: read the manifest file, load the gate, admit the definitions, build
 *  the registry. A missing or unparseable manifest throws ManifestError whatever `strict` says. */
export function loadPinnedRegistry(manifestPath: string | URL, definitions: readonly PinnableTool[], options: PinnedRegistryOptions): PinnedRegistry {
  let text: string;
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch (err) {
    throw new ManifestError(`the manifest cannot be read (${err instanceof Error && "code" in err ? String(err.code) : "error"}): a node without a manifest does not start`);
  }
  return new PinnedRegistry(PinGate.load(text).admit(definitions), options);
}

export type { PinRefusal };
