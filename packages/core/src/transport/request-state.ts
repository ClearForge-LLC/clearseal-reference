// MRTR `requestState` integrity (MR-4, MR-5). A state is produced and consumed only here: the
// transport seals what a handler returns, and opens what a client echoes back before the handler
// sees it. A state is attacker-controlled input until its MAC verifies (MR-4). The sealed payload
// binds the principal, the method, the tool name and an expiry (MR-5), so a state captured from
// one tool's call is refused on another's, by another principal, or after it lapses.
//
// The binding covers the arguments too (by digest). A state is not single-use within its TTL:
// that is -2001's to enforce where it matters (MR-6).
//
// Format: base64url(payload JSON) "." base64url(HMAC-SHA256(key, "clearseal/request-state/v1\0" ‖ payload JSON)).
// The key comes from the environment by name (CLEARSEAL_REQUEST_STATE_KEY, in .env.example, never
// valued). With no key configured, sealing throws and every incoming state is refused.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { type JsonValue, parseJsonStrict } from "./json.ts";
import { INVALID_PARAMS, isPlainObject, Refusal } from "./jsonrpc.ts";

export const REQUEST_STATE_KEY_ENV = "CLEARSEAL_REQUEST_STATE_KEY";
const CONTEXT = "clearseal/request-state/v1\0";
const MIN_KEY_BYTES = 32;

export interface StateBinding {
  principal: string;
  method: string;
  tool: string;
  /** Digest of the call's arguments (argumentsDigest): a state issued for one set of arguments is
   *  refused on another (MR-5, the "digest of its salient parameters"; adversarial finding F7). */
  args: string;
}

/** Canonical JSON of a JSON value: object keys sorted by UTF-16 code units, no whitespace. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function argumentsDigest(args: unknown): string {
  return createHash("sha256").update(canonicalJson(args)).digest("base64url");
}

interface Payload extends StateBinding {
  exp: number;
  state: JsonValue;
}

export class RequestStateKeyError extends Error {
  override name = "RequestStateKeyError";
}

/** The key from the environment, or undefined when unset. A key shorter than 32 bytes refuses to
 *  start rather than signing with a guessable key (N4). */
export function requestStateKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Uint8Array | undefined {
  const value = env[REQUEST_STATE_KEY_ENV];
  if (value === undefined || value === "") return undefined;
  const key = new TextEncoder().encode(value);
  if (key.length < MIN_KEY_BYTES) throw new RequestStateKeyError(`${REQUEST_STATE_KEY_ENV} must be at least ${String(MIN_KEY_BYTES)} bytes`);
  return key;
}

function mac(key: Uint8Array, payload: string): Buffer {
  return createHmac("sha256", key).update(CONTEXT).update(payload).digest();
}

export function sealState(key: Uint8Array | undefined, binding: StateBinding, state: JsonValue, now: number, ttlMs: number): string {
  if (key === undefined) throw new RequestStateKeyError(`a handler returned request state but ${REQUEST_STATE_KEY_ENV} is not set`);
  const payload: Payload = { ...binding, exp: now + ttlMs, state };
  const json = JSON.stringify(payload);
  return `${Buffer.from(json).toString("base64url")}.${mac(key, json).toString("base64url")}`;
}

const refused = (why: string): Refusal => new Refusal(400, INVALID_PARAMS, `requestState refused: ${why}`);

/** Verifies and opens a state, or throws a 400 / -32602 refusal. Never reveals which binding
 *  failed beyond a coarse reason. */
export function openState(key: Uint8Array | undefined, token: unknown, binding: StateBinding, now: number): JsonValue {
  if (typeof token !== "string") throw refused("not a string");
  if (key === undefined) throw refused("this server does not accept request state");
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0] ?? "") || !/^[A-Za-z0-9_-]+$/.test(parts[1] ?? "")) throw refused("malformed");
  const json = Buffer.from(parts[0] as string, "base64url").toString("utf8");
  const tag = Buffer.from(parts[1] as string, "base64url");
  const expected = mac(key, json);
  if (tag.length !== expected.length || !timingSafeEqual(tag, expected)) throw refused("integrity check failed");
  // Canonical encoding only: a second spelling of the same payload is not the one that was sealed.
  if (Buffer.from(json).toString("base64url") !== parts[0]) throw refused("malformed");
  let payload: unknown;
  try {
    payload = parseJsonStrict(json, 64);
  } catch {
    throw refused("malformed");
  }
  if (!isPlainObject(payload)) throw refused("malformed");
  const { principal, method, tool, args, exp } = payload;
  if (principal !== binding.principal || method !== binding.method || tool !== binding.tool || args !== binding.args) throw refused("issued for a different request");
  if (typeof exp !== "number" || now >= exp) throw refused("expired");
  return (payload["state"] ?? null) as JsonValue;
}
