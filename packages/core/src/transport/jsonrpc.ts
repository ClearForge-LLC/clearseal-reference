// JSON-RPC 2.0 shapes and the error codes this transport emits. Codes are the schema's
// (`schema/2026-07-28/schema.ts`), which wins over any page that disagrees (SPEC-MAP).

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;
export const HEADER_MISMATCH = -32020;
export const MISSING_REQUIRED_CLIENT_CAPABILITY = -32021;
export const UNSUPPORTED_PROTOCOL_VERSION = -32022;

export type RequestId = string | number;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: RequestId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcErrorBody {
  jsonrpc: "2.0";
  id?: RequestId;
  error: { code: number; message: string; data?: unknown };
}

/** A refusal: the HTTP status and the JSON-RPC error that go back. `id` is omitted when the
 *  request's id could not be read (BI-4). */
/** Refusals whose event has already been audited under its own name (auth-refused, handler-error,
 *  containment-refused and the rest), so the transport writes no second line for them. */
export const AUDITED_REFUSALS = new WeakSet<Refusal>();

/** Marks a refusal as audited, and returns it. */
export function audited(r: Refusal): Refusal {
  AUDITED_REFUSALS.add(r);
  return r;
}

export class Refusal extends Error {
  override name = "Refusal";
  readonly status: number;
  readonly code: number;
  readonly data: unknown;
  readonly headers: Readonly<Record<string, string>>;
  constructor(status: number, code: number, message: string, data?: unknown, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
    this.headers = headers;
  }
  body(id?: RequestId): JsonRpcErrorBody {
    const error: JsonRpcErrorBody["error"] = { code: this.code, message: this.message };
    if (this.data !== undefined) error.data = this.data;
    return id === undefined ? { jsonrpc: "2.0", error } : { jsonrpc: "2.0", id, error };
  }
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A request id is a string or an integer, never null (BI-2). */
export function isRequestId(v: unknown): v is RequestId {
  return typeof v === "string" || (typeof v === "number" && Number.isSafeInteger(v));
}

export type Classified =
  | { kind: "request"; message: JsonRpcRequest }
  | { kind: "notification"; message: JsonRpcNotification };

/** Classifies a parsed body as exactly one request or notification (SH-9, BI-1, BI-2), or throws
 *  the refusal. A batch, a response, or anything malformed is refused with -32600. */
export function classify(body: unknown): Classified {
  if (Array.isArray(body)) throw new Refusal(400, INVALID_REQUEST, "Batch requests are not supported");
  if (!isPlainObject(body)) throw new Refusal(400, INVALID_REQUEST, "The body is not a JSON-RPC message");
  if (body["jsonrpc"] !== "2.0") throw new Refusal(400, INVALID_REQUEST, 'jsonrpc must be "2.0"');
  const hasId = Object.hasOwn(body, "id");
  if (!Object.hasOwn(body, "method")) {
    const response = Object.hasOwn(body, "result") || Object.hasOwn(body, "error");
    throw new Refusal(400, INVALID_REQUEST, response ? "A JSON-RPC response is not accepted by the server" : "method is required");
  }
  for (const k of Object.keys(body)) {
    if (!["jsonrpc", "id", "method", "params"].includes(k)) throw new Refusal(400, INVALID_REQUEST, "The message has a member JSON-RPC does not define");
  }
  const { method, params } = body;
  if (typeof method !== "string" || method === "") throw new Refusal(400, INVALID_REQUEST, "method must be a non-empty string");
  if (params !== undefined && !isPlainObject(params)) throw new Refusal(400, INVALID_REQUEST, "params must be an object");
  if (!hasId) return { kind: "notification", message: { jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) } };
  const id = body["id"];
  if (!isRequestId(id)) throw new Refusal(400, INVALID_REQUEST, "id must be a string or an integer");
  return { kind: "request", message: { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) } };
}
