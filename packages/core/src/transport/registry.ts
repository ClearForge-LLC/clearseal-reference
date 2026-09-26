// The tool registry seam. The transport talks to a ToolRegistry; the one implementation is the
// pinned registry (pinning/registry.ts, CSR-WO-1001), built only from the pin gate's admission.
// prepareTool below is where every static check on a tool
// definition happens, so a tool that would break a rule at call time is refused before it is ever
// listed: its name (TL-5), an `inputSchema` that is an object schema in the 2020-12 dialect (TL-4,
// BI-14, BI-15), no `$ref` outside the schema's own document (BI-16, BI-17), bounded depth and
// size (BI-18), and valid `x-mcp-header` annotations (SH-27…SH-29).

import type { Limits } from "./config.ts";
import { AnnotationError, type ParamHeader, paramHeaders } from "./headers.ts";
import type { JsonValue } from "./json.ts";
import { isPlainObject } from "./jsonrpc.ts";
import { walkSchema } from "./schema-walk.ts";
import type { Principal } from "./verifier.ts";
import type { Cage, Reach } from "../containment/cage.ts";

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
  /** The only sanctioned route to files, network and services, built per call from the tool's
   *  pinned containment domain (CSR-WO-1002). */
  cage: Cage;
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
  validate: (args: unknown) => boolean | Promise<boolean>;
  paramHeaders: readonly ParamHeader[];
  /** A fresh cage for one call, built from the tool's pinned domain. Absent: an empty domain. */
  newCage?: (onRefused?: (reach: Reach) => void) => Cage;
}

/** What the pin gate decided, as the transport needs it: counts for /health, the refusals for the
 *  start-up log, and whether a refusal stops the node (CSR-WO-1001 §1.4). */
export interface PinningStatus {
  strict: boolean;
  admitted: number;
  refused: readonly { name: string; reason: string; rule?: string }[];
  /** True when the name is a tool the gate refused, so a call to it can say so. */
  isRefused(name: string): boolean;
}

export interface ToolRegistry {
  /** The tools currently available, in a deterministic order (TL-3). */
  list(): readonly RegisteredTool[];
  get(name: string): RegisteredTool | undefined;
  /** Present on a pinned registry. */
  readonly pinning?: PinningStatus;
}

/** Compiles a 2020-12 schema into a validator. Must never fetch or read anything. */
export type SchemaCompiler = (schema: Record<string, unknown>) => (value: unknown) => boolean | Promise<boolean>;

export class RegistrationError extends Error {
  override name = "RegistrationError";
}

const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const DIALECTS = new Set(["https://json-schema.org/draft/2020-12/schema", "https://json-schema.org/draft/2020-12/schema#"]);

/** Depth, node count, `$schema` below the root, and any `$ref`/`$dynamicRef` that is not a
 *  same-document fragment, found by the keyword-aware walk (a property named `$ref` is a name). */
function inspectSchema(schema: unknown, limits: Pick<Limits, "maxSchemaDepth" | "maxSchemaNodes">): void {
  let nodes = 0;
  walkSchema(schema, ({ node, depth }) => {
    nodes++;
    if (nodes > limits.maxSchemaNodes) throw new RegistrationError(`inputSchema has more than ${String(limits.maxSchemaNodes)} subschemas`);
    if (depth > limits.maxSchemaDepth) throw new RegistrationError(`inputSchema is nested deeper than ${String(limits.maxSchemaDepth)}`);
    if (depth > 0 && Object.hasOwn(node, "$schema")) throw new RegistrationError("inputSchema declares $schema below its root");
    for (const key of ["$ref", "$dynamicRef"]) {
      if (!Object.hasOwn(node, key)) continue;
      const value = node[key];
      if (typeof value !== "string" || !value.startsWith("#")) throw new RegistrationError(`inputSchema has a ${key} outside its own document; external references are never dereferenced`);
    }
  });
}

/** The schema actually validated: the registered one, with `unevaluatedProperties: false` at the
 *  root unless the schema already decides (SPEC-MAP D-7). The advertised schema is unchanged. */
function effectiveSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (Object.hasOwn(schema, "additionalProperties") || Object.hasOwn(schema, "unevaluatedProperties")) return schema;
  return { ...schema, unevaluatedProperties: false };
}

/** Every static check on one tool definition, then its compiled validator and parameter headers.
 *  Throws RegistrationError. Duplicate names are the pin gate's refusal, before this runs. */
export function prepareTool(tool: Tool, compile: SchemaCompiler, limits: Pick<Limits, "maxSchemaDepth" | "maxSchemaNodes">): RegisteredTool {
  if (!TOOL_NAME.test(tool.name)) throw new RegistrationError("tool name must be 1–128 characters of A–Z a–z 0–9 _ . -");
  const schema = tool.inputSchema;
  if (!isPlainObject(schema)) throw new RegistrationError("inputSchema must be a JSON Schema object");
  if (schema["type"] !== "object") throw new RegistrationError('inputSchema must have type "object"');
  if (Object.hasOwn(schema, "$schema") && !DIALECTS.has(schema["$schema"] as string)) throw new RegistrationError("inputSchema declares a dialect other than 2020-12, which this server does not support");
  inspectSchema(schema, limits);
  let headers: ParamHeader[];
  try {
    headers = paramHeaders(schema);
  } catch (err) {
    if (err instanceof AnnotationError) throw new RegistrationError(`tool "${tool.name}": ${err.message}`);
    throw err;
  }
  let validate: (v: unknown) => boolean | Promise<boolean>;
  try {
    validate = compile(effectiveSchema(schema));
  } catch (err) {
    throw new RegistrationError(`tool "${tool.name}": inputSchema does not compile as 2020-12: ${err instanceof Error ? err.message : String(err)}`);
  }
  const { handler, ...definition } = tool;
  return { definition, handler, validate, paramHeaders: headers };
}
