// Test-only pinning helpers. Every registry a test builds goes through the same path a node uses:
// a manifest, PinGate.load, admit, then the PinnedRegistry constructor. For ad-hoc tools, the
// manifest is approved in memory by buildManifest, the function the CLI's approve calls.

import { buildManifest, type PinnableTool, serializeManifest } from "../../src/pinning/manifest.ts";
import { PinGate } from "../../src/pinning/gate.ts";
import { PinnedRegistry, type PinnedRegistryOptions } from "../../src/pinning/registry.ts";
import type { Limits } from "../../src/transport/config.ts";
import type { SchemaCompiler, Tool } from "../../src/transport/registry.ts";
import { tag } from "./tools.ts";

/** A transport Tool as a pinnable one: a description ("" if none) and a read-only tag. */
export function asPinnable(tool: Tool | PinnableTool): PinnableTool {
  if ("capability" in tool) return tool;
  return { name: tool.name, description: tool.description ?? "", inputSchema: tool.inputSchema, handler: tool.handler, capability: tag(tool.name) };
}

/** Approves the tools in memory and builds the registry from the gate's admission. */
export function pinForTest(tools: readonly (Tool | PinnableTool)[], compile: SchemaCompiler, limits: Pick<Limits, "maxSchemaDepth" | "maxSchemaNodes">, strict = true, extra: Pick<PinnedRegistryOptions, "execToolsForbidden" | "cageFor"> = {}): PinnedRegistry {
  const pinnable = tools.map(asPinnable);
  const gate = PinGate.load(serializeManifest(buildManifest(pinnable)));
  return new PinnedRegistry(gate.admit(pinnable), { compile, limits, strict, ...extra });
}
