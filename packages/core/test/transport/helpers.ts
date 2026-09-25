// Test harness for the transport. Nothing here ships: the bearer verifier and the fixture tools
// are registered only by the suite (WO §4). The bearer is random per run; its name, for a manual
// run, is CLEARSEAL_TEST_BEARER in .env.example, never valued (N8).

import { randomBytes } from "node:crypto";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";

import { compileSchema } from "../../src/transport/schema.ts";
import { PlaceholderRegistry, type Tool } from "../../src/transport/registry.ts";
import { startTransport, type RunningTransport, type TransportOptions } from "../../src/transport/server.ts";
import type { Verdict, Verifier } from "../../src/transport/verifier.ts";
import { DEFAULT_LIMITS, type Limits } from "../../src/transport/config.ts";

export const BEARER = randomBytes(24).toString("base64url");
export const PV = "io.modelcontextprotocol/protocolVersion";

/** Accepts exactly `Authorization: Bearer <BEARER>`. */
export class TestBearerVerifier implements Verifier {
  verify(headers: IncomingHttpHeaders): Promise<Verdict> {
    const auth = headers.authorization;
    if (auth === undefined) return Promise.resolve({ ok: false });
    return Promise.resolve(auth === `Bearer ${BEARER}` ? { ok: true, principal: { id: "test-principal" } } : { ok: false, error: "invalid_token" });
  }
}

export interface Gate {
  promise: Promise<void>;
  open: () => void;
}
export function gate(): Gate {
  let open = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

export const held = { gates: [] as Gate[] };

const text = (t: string): { content: { type: "text"; text: string }[] } => ({ content: [{ type: "text", text: t }] });

/** Fixture tools, registered only by tests. */
export function fixtureTools(): Tool[] {
  return [
    {
      name: "echo",
      description: "Returns its text.",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      handler: (args) => Promise.resolve(text(String(args["text"]))),
    },
    {
      name: "no_args",
      description: "Takes nothing.",
      inputSchema: { type: "object" },
      handler: () => Promise.resolve(text("ok")),
    },
    {
      name: "region_query",
      description: "A fixture declaring x-mcp-header on string, integer, boolean and nested properties.",
      inputSchema: {
        type: "object",
        properties: {
          region: { type: "string", "x-mcp-header": "Region" },
          limit: { type: "integer", "x-mcp-header": "Limit" },
          dry: { type: ["boolean", "null"], "x-mcp-header": "Dry" },
          scope: { type: "object", properties: { zone: { type: "string", "x-mcp-header": "Zone" } } },
          query: { type: "string" },
        },
        required: ["query"],
      },
      handler: (args) => Promise.resolve(text(JSON.stringify(args))),
    },
    {
      name: "slow",
      description: "Never returns until aborted.",
      inputSchema: { type: "object" },
      handler: (_args, ctx) =>
        new Promise((_, reject) => {
          ctx.signal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    },
    {
      name: "hold",
      description: "Returns when the test opens its gate.",
      inputSchema: { type: "object" },
      handler: async () => {
        const g = gate();
        held.gates.push(g);
        await g.promise;
        return text("released");
      },
    },
    {
      name: "big",
      description: "Returns `size` bytes of text.",
      inputSchema: { type: "object", properties: { size: { type: "integer", minimum: 0 } }, required: ["size"] },
      handler: (args) => Promise.resolve(text("x".repeat(Number(args["size"])))),
    },
    {
      name: "ask",
      description: "MRTR: asks for a name, then greets.",
      inputSchema: { type: "object" },
      handler: (_args, ctx) => {
        if (ctx.state === undefined) {
          return Promise.resolve({
            resultType: "input_required" as const,
            inputRequests: { who: { method: "elicitation/create", params: { mode: "form", message: "Name?", requestedSchema: { type: "object", properties: { name: { type: "string" } } } } } },
            state: { step: 1, tool: "ask" },
          });
        }
        return Promise.resolve(text(`state ${JSON.stringify(ctx.state)} responses ${JSON.stringify(ctx.inputResponses ?? {})}`));
      },
    },
    {
      name: "ask_other",
      description: "MRTR: a second tool whose state must not be accepted by `ask`.",
      inputSchema: { type: "object" },
      handler: (_args, ctx) =>
        Promise.resolve(ctx.state === undefined ? { resultType: "input_required" as const, state: { step: 1, tool: "ask_other" } } : text("other done")),
    },
    {
      name: "needs_sampling",
      description: "MRTR: asks for a sampling round.",
      inputSchema: { type: "object" },
      handler: () =>
        Promise.resolve({ resultType: "input_required" as const, inputRequests: { s: { method: "sampling/createMessage", params: { messages: [], maxTokens: 1 } } } }),
    },
  ];
}

export interface Started {
  t: RunningTransport;
  close: () => Promise<void>;
  audits: string[];
}

export async function start(opts: { limits?: Partial<Limits>; verifier?: Verifier | null; key?: Uint8Array | null; config?: TransportOptions["config"] } = {}): Promise<Started> {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const registry = new PlaceholderRegistry(compileSchema, limits);
  for (const tool of fixtureTools()) registry.register(tool);
  const audits: string[] = [];
  const t = await startTransport({
    registry,
    serverInfo: { name: "@clearseal/core", version: "0.0.0" },
    config: { ...opts.config, limits },
    ...(opts.verifier === null ? {} : { verifier: opts.verifier ?? new TestBearerVerifier() }),
    ...(opts.key === null ? {} : { requestStateKey: opts.key ?? randomBytes(32) }),
    audit: (event) => audits.push(event),
  });
  return { t, close: () => t.close(), audits };
}

export interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  json: unknown;
}

/** A raw HTTP request, so a test controls every header (Host, duplicates, chunking). */
export function raw(t: RunningTransport, opts: { method?: string; path?: string; headers?: Record<string, string | string[]>; body?: string | Buffer; chunked?: boolean }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | string[]> = { ...opts.headers };
    const req = httpRequest({ host: "127.0.0.1", port: t.port, method: opts.method ?? "POST", path: opts.path ?? "/mcp", headers, setHost: !Object.keys(headers).some((h) => h.toLowerCase() === "host") }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        let json: unknown;
        try {
          json = body === "" ? undefined : (JSON.parse(body) as unknown);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text: body, json });
      });
    });
    req.on("error", reject);
    if (opts.body !== undefined) {
      if (opts.chunked === true) {
        const b = Buffer.from(opts.body);
        const half = Math.floor(b.length / 2);
        req.write(b.subarray(0, half));
        req.end(b.subarray(half));
      } else {
        req.end(opts.body);
      }
    } else {
      req.end();
    }
  });
}

/** Headers a conforming modern client sends. */
export function modernHeaders(method: string, name?: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${BEARER}`,
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
    ...(name === undefined ? {} : { "mcp-name": name }),
    ...extra,
  };
}

let nextId = 1;
export function modernBody(method: string, params: Record<string, unknown> = {}, meta: Record<string, unknown> = {}): Record<string, unknown> {
  return { jsonrpc: "2.0", id: nextId++, method, params: { ...params, _meta: { [PV]: "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {}, ...meta } } };
}

/** A conforming modern request. */
export function modern(t: RunningTransport, method: string, params: Record<string, unknown> = {}, opts: { name?: string; headers?: Record<string, string>; meta?: Record<string, unknown> } = {}): Promise<Reply> {
  const name = opts.name ?? (typeof params["name"] === "string" ? params["name"] : undefined);
  return raw(t, { headers: { ...modernHeaders(method, name), ...opts.headers }, body: JSON.stringify(modernBody(method, params, opts.meta)) });
}

export function legacyHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${BEARER}`, accept: "application/json, text/event-stream", "content-type": "application/json", ...extra };
}

/** What the test asserts about a refusal: status, content type, JSON-RPC code. */
export function shape(r: Reply): { status: number; type: string | undefined; code: unknown } {
  const body = r.json as { error?: { code?: unknown } } | undefined;
  return { status: r.status, type: r.headers["content-type"], code: body?.error?.code };
}

export const JSON_TYPE = "application/json";
