// Era selection, mirrored-header validation, and dispatch (SPEC-MAP SH-19…SH-39, VR-*, BI-8…BI-10,
// DS-*, TL-*, MR-*, LG-*). Called only after the transport has a principal (server.ts step 5).

import type { Limits, TransportConfig } from "./config.ts";
import { LEGACY_VERSION, MODERN_VERSION, SUPPORTED_VERSIONS } from "./config.ts";
import { checkParamHeaders, decodeHeaderValue, mismatch, singleHeader } from "./headers.ts";
import type { JsonValue } from "./json.ts";
import {
  type Classified,
  INTERNAL_ERROR,
  INVALID_PARAMS,
  isPlainObject,
  type JsonRpcRequest,
  METHOD_NOT_FOUND,
  MISSING_REQUIRED_CLIENT_CAPABILITY,
  Refusal,
  type RequestId,
  UNSUPPORTED_PROTOCOL_VERSION,
} from "./jsonrpc.ts";
import type { CallContext, RegisteredTool, ToolRegistry, ToolResult } from "./registry.ts";
import { openState, sealState } from "./request-state.ts";
import type { Principal } from "./verifier.ts";

const PV = "io.modelcontextprotocol/protocolVersion";
const CAPS = "io.modelcontextprotocol/clientCapabilities";
const SERVER_INFO = "io.modelcontextprotocol/serverInfo";
/** Methods whose name is mirrored into Mcp-Name, and the params field it comes from (SH-24). */
const NAMED: Readonly<Record<string, "name" | "uri">> = { "tools/call": "name", "resources/read": "uri", "prompts/get": "name" };
/** MRTR input request methods and the client capability each needs (MR-2, MR-8). */
const INPUT_CAPABILITY: Readonly<Record<string, string>> = { "elicitation/create": "elicitation", "sampling/createMessage": "sampling", "roots/list": "roots" };

export interface DispatchContext {
  headers: NodeJS.Dict<string[]>;
  principal: Principal;
  registry: ToolRegistry;
  limits: Limits;
  config: TransportConfig;
  serverInfo: { name: string; version: string };
  requestStateKey: Uint8Array | undefined;
  signal: AbortSignal;
  now: () => number;
  audit: (event: string, fields: Record<string, string | number>) => void;
}

export type Outcome =
  | { kind: "accepted" }
  | { kind: "refused"; refusal: Refusal; id?: RequestId }
  | { kind: "result"; body: { jsonrpc: "2.0"; id: RequestId; result: Record<string, unknown> } };

type Era = typeof MODERN_VERSION | typeof LEGACY_VERSION;

export async function dispatch(classified: Classified, ctx: DispatchContext): Promise<Outcome> {
  const versionHeader = singleHeaderOrRefuse(ctx.headers, "mcp-protocol-version", "MCP-Protocol-Version");
  if (classified.kind === "notification") {
    // SH-10, SH-11, SH-13, LG-5: the only notification accepted is the legacy handshake's.
    if (versionHeader.ok && versionHeader.value === LEGACY_VERSION && classified.message.method === "notifications/initialized") return { kind: "accepted" };
    return { kind: "refused", refusal: new Refusal(400, METHOD_NOT_FOUND, "This notification is not accepted") };
  }
  const request = classified.message;
  try {
    if (!versionHeader.ok) throw versionHeader.refusal;
    const era = selectEra(versionHeader.value, request);
    const params = request.params ?? {};
    const clientCapabilities = era === MODERN_VERSION ? checkModernMeta(params, era) : checkLegacyMeta(params, era);
    checkMirroredHeaders(request, ctx.headers, era);
    const result = await route(era, request, params, clientCapabilities, ctx);
    const body = { jsonrpc: "2.0" as const, id: request.id, result };
    if (Buffer.byteLength(JSON.stringify(body)) > ctx.limits.maxResultBytes) {
      ctx.audit("result-over-cap", { method: request.method, limit: ctx.limits.maxResultBytes });
      throw new Refusal(500, INTERNAL_ERROR, `The result exceeds ${String(ctx.limits.maxResultBytes)} bytes and was not sent`);
    }
    return { kind: "result", body };
  } catch (err) {
    if (err instanceof Refusal) return { kind: "refused", refusal: err, id: request.id };
    throw err;
  }
}

function singleHeaderOrRefuse(headers: NodeJS.Dict<string[]>, name: string, display: string): { ok: true; value: string | undefined } | { ok: false; refusal: Refusal } {
  try {
    return { ok: true, value: singleHeader(headers, name, display) };
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, refusal: err };
    throw err;
  }
}

/** SH-20…SH-23, VR-6, D-1. */
function selectEra(header: string | undefined, request: JsonRpcRequest): Era {
  if (header === undefined) {
    // D-1: under 2025-11-25 the header follows initialize; initialize itself carries none.
    if (request.method === "initialize") return LEGACY_VERSION;
    throw mismatch("MCP-Protocol-Version", "is missing");
  }
  if (!SUPPORTED_VERSIONS.includes(header)) {
    throw new Refusal(400, UNSUPPORTED_PROTOCOL_VERSION, "Unsupported protocol version", { supported: [...SUPPORTED_VERSIONS], requested: header });
  }
  return header as Era;
}

/** BI-8, SH-21: the modern era's required per-request `_meta`. */
function checkModernMeta(params: Record<string, unknown>, era: Era): Record<string, unknown> {
  const meta = params["_meta"];
  if (!isPlainObject(meta)) throw new Refusal(400, INVALID_PARAMS, "params._meta is required");
  const version = meta[PV];
  if (typeof version !== "string") throw new Refusal(400, INVALID_PARAMS, `params._meta["${PV}"] is required`);
  const caps = meta[CAPS];
  if (!isPlainObject(caps)) throw new Refusal(400, INVALID_PARAMS, `params._meta["${CAPS}"] is required`);
  if (version !== era) throw mismatch("MCP-Protocol-Version", "does not match the request body");
  return caps;
}

/** The legacy era carries no per-request `_meta` version; one that is present must agree. */
function checkLegacyMeta(params: Record<string, unknown>, era: Era): Record<string, unknown> {
  const meta = params["_meta"];
  if (meta !== undefined && !isPlainObject(meta)) throw new Refusal(400, INVALID_PARAMS, "params._meta must be an object");
  if (isPlainObject(meta) && meta[PV] !== undefined && meta[PV] !== era) throw mismatch("MCP-Protocol-Version", "does not match the request body");
  return {};
}

/** SH-24, SH-25, SH-31, D-3. */
function checkMirroredHeaders(request: JsonRpcRequest, headers: NodeJS.Dict<string[]>, era: Era): void {
  const modern = era === MODERN_VERSION;
  const method = singleHeader(headers, "mcp-method", "Mcp-Method");
  if (method === undefined) {
    if (modern) throw mismatch("Mcp-Method", "is missing");
  } else if (method !== request.method) {
    throw mismatch("Mcp-Method");
  }
  const field = NAMED[request.method];
  if (field === undefined) return;
  const name = singleHeader(headers, "mcp-name", "Mcp-Name");
  if (name === undefined) {
    if (modern) throw mismatch("Mcp-Name", "is missing");
    return;
  }
  const bodyValue = request.params?.[field];
  if (typeof bodyValue !== "string" || decodeHeaderValue(name, "Mcp-Name") !== bodyValue) throw mismatch("Mcp-Name");
}

function serverMeta(ctx: DispatchContext): Record<string, unknown> {
  return { [SERVER_INFO]: { name: ctx.serverInfo.name, version: ctx.serverInfo.version } };
}

async function route(era: Era, request: JsonRpcRequest, params: Record<string, unknown>, caps: Record<string, unknown>, ctx: DispatchContext): Promise<Record<string, unknown>> {
  const notFound = (): never => {
    throw new Refusal(404, METHOD_NOT_FOUND, "Method not found");
  };
  if (era === MODERN_VERSION) {
    switch (request.method) {
      case "server/discover":
        return {
          resultType: "complete",
          supportedVersions: [...SUPPORTED_VERSIONS],
          capabilities: { tools: {} },
          instructions: ctx.config.instructions,
          ttlMs: ctx.config.discoverTtlMs,
          cacheScope: "public",
          _meta: serverMeta(ctx),
        };
      case "tools/list":
        checkNoCursor(params);
        return { resultType: "complete", tools: ctx.registry.list().map((t) => t.definition), ttlMs: ctx.config.toolsListTtlMs, cacheScope: "private", _meta: serverMeta(ctx) };
      case "tools/call":
        return callTool(era, params, caps, ctx);
      default:
        return notFound();
    }
  }
  switch (request.method) {
    case "initialize":
      // LG-1: a pure function of the request. No session is minted (D-2, SH-43).
      return {
        protocolVersion: LEGACY_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: ctx.serverInfo.name, version: ctx.serverInfo.version },
        instructions: ctx.config.instructions,
      };
    case "ping":
      return {};
    case "tools/list":
      checkNoCursor(params);
      return { tools: ctx.registry.list().map((t) => t.definition) };
    case "tools/call":
      return callTool(era, params, caps, ctx);
    default:
      return notFound();
  }
}

/** The list is never paginated, so any cursor is one this server did not issue. */
function checkNoCursor(params: Record<string, unknown>): void {
  if (params["cursor"] !== undefined) throw new Refusal(400, INVALID_PARAMS, "Invalid cursor");
}

class HandlerTimeout extends Error {}

async function callTool(era: Era, params: Record<string, unknown>, caps: Record<string, unknown>, ctx: DispatchContext): Promise<Record<string, unknown>> {
  const name = params["name"];
  if (typeof name !== "string") throw new Refusal(400, INVALID_PARAMS, "params.name is required");
  const tool = ctx.registry.get(name);
  if (tool === undefined) throw new Refusal(400, INVALID_PARAMS, "Unknown tool");
  const args = params["arguments"] ?? {};
  if (!isPlainObject(args)) throw new Refusal(400, INVALID_PARAMS, "params.arguments must be an object");
  const modern = era === MODERN_VERSION;
  if (modern) checkParamHeaders(tool.paramHeaders, args, ctx.headers);
  if (!tool.validate(args)) throw new Refusal(400, INVALID_PARAMS, `Invalid arguments for tool ${name}`);

  const callCtx: Omit<CallContext, "signal"> & { signal?: AbortSignal } = { principal: ctx.principal, protocolVersion: era, clientCapabilities: caps };
  if (modern) {
    const inputResponses = params["inputResponses"];
    if (inputResponses !== undefined) {
      if (!isPlainObject(inputResponses) || !Object.values(inputResponses).every(isPlainObject)) throw new Refusal(400, INVALID_PARAMS, "inputResponses must be an object of objects");
      callCtx.inputResponses = inputResponses;
    }
    if (params["requestState"] !== undefined) {
      callCtx.state = openState(ctx.requestStateKey, params["requestState"], { principal: ctx.principal.id, method: "tools/call", tool: name }, ctx.now());
    }
  }

  const result = await runHandler(tool, args, callCtx, ctx);
  return shapeResult(era, name, result, caps, ctx);
}

async function runHandler(tool: RegisteredTool, args: Record<string, unknown>, callCtx: Omit<CallContext, "signal">, ctx: DispatchContext): Promise<ToolResult> {
  const timeout = new AbortController();
  const signal = AbortSignal.any([ctx.signal, timeout.signal]);
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new HandlerTimeout());
    }, ctx.limits.handlerTimeoutMs);
  });
  try {
    return await Promise.race([tool.handler(args, { ...callCtx, signal }), deadline]);
  } catch (err) {
    if (err instanceof HandlerTimeout) {
      timeout.abort(new Error("handler timeout"));
      ctx.audit("handler-timeout", { tool: tool.definition.name, limitMs: ctx.limits.handlerTimeoutMs });
      throw new Refusal(500, INTERNAL_ERROR, "The tool call timed out");
    }
    if (err instanceof Refusal) throw err;
    ctx.audit("handler-error", { tool: tool.definition.name });
    throw new Refusal(500, INTERNAL_ERROR, "The tool call failed");
  } finally {
    clearTimeout(timer);
  }
}

function shapeResult(era: Era, name: string, result: ToolResult, caps: Record<string, unknown>, ctx: DispatchContext): Record<string, unknown> {
  if (!isPlainObject(result)) throw new Refusal(500, INTERNAL_ERROR, "The tool returned no result");
  if (result.resultType === "input_required") {
    if (era !== MODERN_VERSION) throw new Refusal(500, INTERNAL_ERROR, "The tool needs input, which the legacy revision cannot carry");
    const out: Record<string, unknown> = { resultType: "input_required" };
    if (result.inputRequests !== undefined) {
      const required: Record<string, Record<string, never>> = {};
      for (const request of Object.values(result.inputRequests)) {
        const capability = isPlainObject(request) ? INPUT_CAPABILITY[String(request.method)] : undefined;
        if (capability === undefined) throw new Refusal(500, INTERNAL_ERROR, "The tool returned an input request of an unknown kind");
        if (!Object.hasOwn(caps, capability)) required[capability] = {};
      }
      // BI-9, MR-8: never ask for what the client did not declare.
      if (Object.keys(required).length > 0) throw new Refusal(400, MISSING_REQUIRED_CLIENT_CAPABILITY, "The request needs a client capability that was not declared", { requiredCapabilities: required });
      out["inputRequests"] = result.inputRequests;
    }
    if (result.state !== undefined) {
      try {
        out["requestState"] = sealState(ctx.requestStateKey, { principal: ctx.principal.id, method: "tools/call", tool: name }, result.state, ctx.now(), ctx.limits.requestStateTtlMs);
      } catch {
        ctx.audit("request-state-unsealable", { tool: name });
        throw new Refusal(500, INTERNAL_ERROR, "The tool call failed");
      }
    }
    if (out["inputRequests"] === undefined && out["requestState"] === undefined) throw new Refusal(500, INTERNAL_ERROR, "The tool returned an empty input request");
    out["_meta"] = serverMeta(ctx);
    return out;
  }
  if (result.resultType !== undefined && result.resultType !== "complete") throw new Refusal(500, INTERNAL_ERROR, "The tool returned an unknown result type");
  if (!Array.isArray(result.content)) throw new Refusal(500, INTERNAL_ERROR, "The tool returned no content");
  const out: Record<string, unknown> = { content: result.content };
  if (result.structuredContent !== undefined) out["structuredContent"] = result.structuredContent;
  if (result.isError !== undefined) out["isError"] = result.isError;
  if (era === MODERN_VERSION) {
    out["resultType"] = "complete";
    out["_meta"] = serverMeta(ctx);
  }
  return out;
}

export type { JsonValue };
