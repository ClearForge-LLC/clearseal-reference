// The tool registry seam. The transport talks to a ToolRegistry; this WO ships a placeholder that
// -1001 replaces with verify-before-register. Registration is where every static check on a tool
// definition happens, so a tool that would break a rule at call time is refused before it is ever
// listed: its name (TL-5), an `inputSchema` that is an object schema in the 2020-12 dialect (TL-4,
// BI-14, BI-15), no `$ref` outside the schema's own document (BI-16, BI-17), bounded depth and
// size (BI-18), and valid `x-mcp-header` annotations (SH-27…SH-29).

import type { Limits } from "./config.ts";
import { AnnotationError, type ParamHeader, paramHeaders } from "./headers.ts";
import type { JsonValue } from "./json.ts";
import { isPlainObject } from "./jsonrpc.ts";
import type { Principal } from "./verifier.ts";

export type ContentBlock = Record<string, unknown> & { type: string };

export type ToolResult =
  | { resultType?: "complete"; content: ContentBlock[]; structuredContent?: unknown; isError?: boolean }
  | { resultType: "input_required"; inputRequests?: Record<string, { method: string; params?: Record<string, unknown> }>; state?: JsonValue };

export interface CallContext {
  principal: Principal;
  /** Aborted on timeout or client disconnect; a handler should stop work when it fires. */
  signal: AbortSignal;
  /** The era the call arrived on. */
  protocolVersion: string;
  /** Declared client capabilities (modern era; empty on the legacy era). */
  clientCapabilities: Record<string, unknown>;
  /** MRTR retry: the client's responses, passed through untouched (MR-9). */
  inputResponses?: Record<string, unknown>;
  /** MRTR retry: the state this server sealed, verified and opened. Never the raw token. */
  state?: JsonValue;
}

export interface ToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface Tool extends ToolDefinition {
  handler: (args: Record<string, unknown>, ctx: CallContext) => Promise<ToolResult>;
}

export interface RegisteredTool {
  definition: ToolDefinition;
  handler: Tool["handler"];
  validate: (args: unknown) => boolean;
  paramHeaders: readonly ParamHeader[];
}

export interface ToolRegistry {
  /** The tools currently available, in a deterministic order (TL-3). */
  list(): readonly RegisteredTool[];
  get(name: string): RegisteredTool | undefined;
}

/** Compiles a 2020-12 schema into a validator. Must never fetch or read anything. */
export type SchemaCompiler = (schema: Record<string, unknown>) => (value: unknown) => boolean;

export class RegistrationError extends Error {
  override name = "RegistrationError";
}

const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const DIALECTS = new Set(["https://json-schema.org/draft/2020-12/schema", "https://json-schema.org/draft/2020-12/schema#"]);
const DATA_KEYWORDS = new Set(["const", "enum", "default", "examples"]);

/** Depth, node count, and any `$ref`/`$dynamicRef` that is not a same-document fragment. */
function inspectSchema(schema: unknown, limits: Pick<Limits, "maxSchemaDepth" | "maxSchemaNodes">): void {
  let nodes = 0;
  const visit = (node: unknown, depth: number): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth);
      return;
    }
    if (!isPlainObject(node)) return;
    nodes++;
    if (nodes > limits.maxSchemaNodes) throw new RegistrationError(`inputSchema has more than ${String(limits.maxSchemaNodes)} subschemas`);
    if (depth > limits.maxSchemaDepth) throw new RegistrationError(`inputSchema is nested deeper than ${String(limits.maxSchemaDepth)}`);
    for (const [key, value] of Object.entries(node)) {
      if (DATA_KEYWORDS.has(key)) continue;
      if (key === "$ref" || key === "$dynamicRef") {
        if (typeof value !== "string" || !value.startsWith("#")) throw new RegistrationError(`inputSchema has a ${key} outside its own document; external references are never dereferenced`);
        continue;
      }
      if (key === "$schema" && depth > 0) throw new RegistrationError("inputSchema declares $schema below its root");
      visit(value, depth + 1);
    }
  };
  visit(schema, 0);
}

/** The schema actually validated: the registered one, with `unevaluatedProperties: false` at the
 *  root unless the schema already decides (SPEC-MAP D-7). The advertised schema is unchanged. */
function effectiveSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (Object.hasOwn(schema, "additionalProperties") || Object.hasOwn(schema, "unevaluatedProperties")) return schema;
  return { ...schema, unevaluatedProperties: false };
}

/** Placeholder until -1001: an in-memory registry with the static checks above. */
export class PlaceholderRegistry implements ToolRegistry {
  readonly #tools = new Map<string, RegisteredTool>();
  readonly #compile: SchemaCompiler;
  readonly #limits: Pick<Limits, "maxSchemaDepth" | "maxSchemaNodes">;

  constructor(compile: SchemaCompiler, limits: Pick<Limits, "maxSchemaDepth" | "maxSchemaNodes">) {
    this.#compile = compile;
    this.#limits = limits;
  }

  register(tool: Tool): void {
    if (!TOOL_NAME.test(tool.name)) throw new RegistrationError("tool name must be 1–128 characters of A–Z a–z 0–9 _ . -");
    if (this.#tools.has(tool.name)) throw new RegistrationError(`a tool named "${tool.name}" is already registered`);
    const schema = tool.inputSchema;
    if (!isPlainObject(schema)) throw new RegistrationError("inputSchema must be a JSON Schema object");
    if (schema["type"] !== "object") throw new RegistrationError('inputSchema must have type "object"');
    if (Object.hasOwn(schema, "$schema") && !DIALECTS.has(schema["$schema"] as string)) throw new RegistrationError("inputSchema declares a dialect other than 2020-12, which this server does not support");
    inspectSchema(schema, this.#limits);
    let headers: ParamHeader[];
    try {
      headers = paramHeaders(schema);
    } catch (err) {
      if (err instanceof AnnotationError) throw new RegistrationError(`tool "${tool.name}": ${err.message}`);
      throw err;
    }
    let validate: (v: unknown) => boolean;
    try {
      validate = this.#compile(effectiveSchema(schema));
    } catch (err) {
      throw new RegistrationError(`tool "${tool.name}": inputSchema does not compile as 2020-12: ${err instanceof Error ? err.message : String(err)}`);
    }
    const { handler, ...definition } = tool;
    this.#tools.set(tool.name, { definition, handler, validate, paramHeaders: headers });
  }

  list(): readonly RegisteredTool[] {
    return [...this.#tools.values()].sort((a, b) => (a.definition.name < b.definition.name ? -1 : a.definition.name > b.definition.name ? 1 : 0));
  }

  get(name: string): RegisteredTool | undefined {
    return this.#tools.get(name);
  }
}
