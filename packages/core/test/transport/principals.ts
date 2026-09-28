// A transport for the CSR-WO-2007 controls: several principals, one read_only tool and one
// state_change tool, the fake monotonic clock the controls run on, and every audit row kept.

import type { IncomingHttpHeaders } from "node:http";

import { DEFAULT_LIMITS } from "../../src/transport/config.ts";
import type { Tool } from "../../src/transport/registry.ts";
import { compileSchema } from "../../src/transport/schema.ts";
import { startTransport, type RunningTransport, type TransportOptions } from "../../src/transport/server.ts";
import type { Verdict, Verifier } from "../../src/transport/verifier.ts";
import { pinForTest } from "../fixtures/pin.ts";
import { tag } from "../fixtures/tools.ts";
import { modernBody, modernHeaders, raw, type Reply } from "./helpers.ts";

/** `Authorization: Bearer as:<name>` authenticates as principal `<name>`; anything else is refused. */
export class PrincipalVerifier implements Verifier {
  verify(headers: IncomingHttpHeaders): Promise<Verdict> {
    const m = /^Bearer as:([a-z0-9-]{1,64})$/.exec(headers.authorization ?? "");
    return Promise.resolve(m === null ? { ok: false, error: "invalid_token" } : { ok: true, principal: { id: m[1] as string } });
  }
}

export const readTool: Tool & { capability: ReturnType<typeof tag> } = {
  name: "read",
  description: "Reads an item.",
  inputSchema: { type: "object", properties: { n: { type: "string" } }, additionalProperties: false },
  capability: tag("read"),
  handler: (args) => Promise.resolve({ content: [{ type: "text", text: `item ${String(args["n"])}` }] }),
};

export const writeTool: Tool & { capability: ReturnType<typeof tag> } = {
  name: "write",
  description: "Writes an item.",
  inputSchema: { type: "object", properties: { n: { type: "string" } }, additionalProperties: false },
  capability: tag("write", { capability_class: "state_change" }),
  handler: (args) => Promise.resolve({ content: [{ type: "text", text: `wrote ${String(args["n"])}` }] }),
};

export interface Rig {
  t: RunningTransport;
  /** Every audit row: the event and its fields. */
  rows: { event: string; fields: Record<string, string | number> }[];
  /** The rows of one event. */
  of: (event: string) => Record<string, string | number>[];
  clock: { now: () => number; advance: (ms: number) => void };
  close: () => Promise<void>;
}

export async function rig(options: Pick<TransportOptions, "rateLimit" | "tripwire"> & { audit?: TransportOptions["audit"] } = {}): Promise<Rig> {
  let now = 1_000;
  const clock = {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
  const rows: Rig["rows"] = [];
  const t = await startTransport({
    registry: pinForTest([readTool, writeTool], compileSchema, DEFAULT_LIMITS),
    serverInfo: { name: "@clearseal/core", version: "0.0.0" },
    verifier: new PrincipalVerifier(),
    monotonic: clock.now,
    ...(options.rateLimit === undefined ? {} : { rateLimit: options.rateLimit }),
    ...(options.tripwire === undefined ? {} : { tripwire: options.tripwire }),
    audit: (event, fields) => {
      rows.push({ event, fields });
      options.audit?.(event, fields);
    },
  });
  return { t, rows, of: (event) => rows.filter((r) => r.event === event).map((r) => r.fields), clock, close: () => t.close() };
}

/** A modern request as `principal`. */
export function as(t: RunningTransport, principal: string, method: string, params: Record<string, unknown> = {}, extra: { headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  const name = typeof params["name"] === "string" ? params["name"] : undefined;
  return raw(t, { headers: { ...modernHeaders(method, name), authorization: `Bearer as:${principal}`, ...extra.headers }, body: extra.body ?? JSON.stringify(modernBody(method, params)) });
}

/** A tools/call of `read` or `write` as `principal`. */
export const call = (t: RunningTransport, principal: string, tool: string, n: string): Promise<Reply> => as(t, principal, "tools/call", { name: tool, arguments: { n } });

/** What a reply said, without its request id: status, the headers a client acts on, and the body. */
export function answer(r: Reply): string {
  const body = r.json as Record<string, unknown> | undefined;
  const rest = Object.fromEntries(Object.entries(body ?? {}).filter(([k]) => k !== "id"));
  return JSON.stringify({ status: r.status, retryAfter: r.headers["retry-after"], type: r.headers["content-type"], body: body === undefined ? r.text : rest });
}
