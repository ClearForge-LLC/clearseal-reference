// Mirrored request headers (SH-24…SH-39): the Base64 sentinel, `Mcp-Method`, `Mcp-Name`, and the
// `x-mcp-header` → `Mcp-Param-{Name}` extension. Every failure is `400` with `-32020`
// (HeaderMismatch), and its message names the header, never the value: a mirrored value can be
// secret-shaped, and an error message is logged by everything on the path (N6).

import { HEADER_MISMATCH, isPlainObject, Refusal } from "./jsonrpc.ts";
import { walkSchema } from "./schema-walk.ts";

const SENTINEL_PREFIX = "=?base64?";
const SENTINEL_SUFFIX = "?=";
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function mismatch(header: string, why = "does not match the request body"): Refusal {
  return new Refusal(400, HEADER_MISMATCH, `Header mismatch: ${header} ${why}`);
}

/** The one value of a header, or undefined when absent. Sent more than once → refused, because
 *  Node would join the copies with ", " and a router may read either one. */
export function singleHeader(distinct: NodeJS.Dict<string[]>, name: string, display: string): string | undefined {
  const values = distinct[name.toLowerCase()];
  if (values === undefined) return undefined;
  if (values.length !== 1) throw mismatch(display, "is sent more than once");
  return values[0];
}

/** Visible ASCII, space and horizontal tab: what a plain (unencoded) header value may hold. */
const PLAIN_VALUE = /^[\x21-\x7e]([\x20-\x7e\t]*[\x21-\x7e])?$/;

/** Decodes a Base64-sentinel value (SH-31; the markers are case-sensitive), or checks a plain one.
 *  Returns the string to compare with the body, or throws a mismatch naming the header. */
export function decodeHeaderValue(raw: string, display: string): string {
  if (raw.length >= SENTINEL_PREFIX.length + SENTINEL_SUFFIX.length && raw.startsWith(SENTINEL_PREFIX) && raw.endsWith(SENTINEL_SUFFIX)) {
    const b64 = raw.slice(SENTINEL_PREFIX.length, raw.length - SENTINEL_SUFFIX.length);
    // Canonical standard Base64 only: decoding then re-encoding must reproduce the input, since
    // Buffer.from silently skips characters it does not know.
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw mismatch(display, "holds invalid Base64");
    const bytes = Buffer.from(b64, "base64");
    if (bytes.toString("base64") !== b64) throw mismatch(display, "holds invalid Base64");
    try {
      return STRICT_UTF8.decode(bytes);
    } catch {
      throw mismatch(display, "holds Base64 that is not UTF-8");
    }
  }
  if (!PLAIN_VALUE.test(raw)) throw mismatch(display, "contains invalid characters");
  return raw;
}

// ---- x-mcp-header (SH-26…SH-35, TL-6) ----

/** RFC 9110 `tchar`, one or more. */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const PRIMITIVES = new Set(["string", "integer", "boolean"]);

export interface ParamHeader {
  /** As annotated, for messages. */
  name: string;
  /** Lower-cased header name, `mcp-param-{name}`. */
  header: string;
  /** The chain of `properties` keys from the schema root. */
  path: string[];
  type: "string" | "integer" | "boolean";
}

export class AnnotationError extends Error {
  override name = "AnnotationError";
}

/** Reads every `x-mcp-header` annotation in a tool's inputSchema and checks each against the
 *  Schema Extension constraints. Throws AnnotationError with the reason when any is broken; the
 *  registry then refuses the tool. */
export function paramHeaders(inputSchema: unknown): ParamHeader[] {
  const found: ParamHeader[] = [];
  walkSchema(inputSchema, ({ node, staticPath: path }) => {
    if (!Object.hasOwn(node, "x-mcp-header")) return;
    const where = path === null ? "a non-static location" : `/${path.join("/")}`;
    if (path === null || path.length === 0) throw new AnnotationError(`x-mcp-header at ${where} is not on a property statically reachable through properties`);
    const name = node["x-mcp-header"];
    if (typeof name !== "string" || name === "") throw new AnnotationError(`x-mcp-header at ${where} is empty or not a string`);
    if (!TOKEN.test(name)) throw new AnnotationError(`x-mcp-header at ${where} is not an HTTP token`);
    const type = primitiveType(node["type"]);
    if (type === undefined) throw new AnnotationError(`x-mcp-header at ${where} is on a property whose type is not exactly one of integer, string, boolean`);
    const header = `mcp-param-${name.toLowerCase()}`;
    if (found.some((f) => f.header === header)) throw new AnnotationError(`x-mcp-header "${name}" is not case-insensitively unique`);
    found.push({ name, header, path, type });
  });
  return found;
}

/** `type` names exactly one primitive, optionally alongside "null". */
function primitiveType(type: unknown): ParamHeader["type"] | undefined {
  const types: unknown[] = typeof type === "string" ? [type] : Array.isArray(type) ? (type as unknown[]) : [];
  const nonNull = types.filter((t) => t !== "null");
  if (nonNull.length !== 1 || types.length > 2) return undefined;
  const t = nonNull[0];
  return typeof t === "string" && PRIMITIVES.has(t) ? (t as ParamHeader["type"]) : undefined;
}

/** The instance value at a chain of `properties` keys; undefined when any step is missing. */
function valueAt(args: unknown, path: readonly string[]): unknown {
  let v: unknown = args;
  for (const key of path) {
    if (!isPlainObject(v) || !Object.hasOwn(v, key)) return undefined;
    v = v[key];
  }
  return v;
}

const HEADER_INTEGER = /^-?(?:0|[1-9][0-9]*)(?:\.0+)?$/;

/** Checks each recognized `Mcp-Param-*` header against the call's arguments (SH-35, SH-38).
 *  Unrecognized `Mcp-Param-*` headers are ignored (SH-33). */
export function checkParamHeaders(annotations: readonly ParamHeader[], args: unknown, distinct: NodeJS.Dict<string[]>): void {
  for (const a of annotations) {
    const display = `Mcp-Param-${a.name}`;
    const raw = singleHeader(distinct, a.header, display);
    const value = valueAt(args, a.path);
    if (value === undefined || value === null) {
      // No value in the body: the header must not be there either (SPEC-MAP D-4).
      if (raw !== undefined) throw mismatch(display, "is present but the body has no value");
      continue;
    }
    if (raw === undefined) throw mismatch(display, "is missing");
    const got = decodeHeaderValue(raw, display);
    let ok: boolean;
    switch (a.type) {
      case "string":
        ok = typeof value === "string" && got === value;
        break;
      case "boolean":
        ok = typeof value === "boolean" && got === String(value);
        break;
      case "integer":
        ok = typeof value === "number" && Number.isSafeInteger(value) && HEADER_INTEGER.test(got) && Number(got) === value;
        break;
    }
    if (!ok) throw mismatch(display);
  }
}
