// A transport with approval (CSR-WO-2001): three tools whose handlers record every entry, principals
// by bearer, an approval service on a fake monotonic clock with a memory notifier, and every audit row,
// every caller response and every approval-listener response kept, for the canary (APR-10).

import type { IncomingHttpHeaders } from "node:http";

import { ApprovalService } from "../../src/approval/service.ts";
import { MemoryNotifier } from "../../src/approval/notifier.ts";
import { type ApprovalSettings, DEFAULT_APPROVAL } from "../../src/approval/settings.ts";
import { DEFAULT_LIMITS } from "../../src/transport/config.ts";
import { APPROVAL_META } from "../../src/transport/dispatch.ts";
import type { Tool } from "../../src/transport/registry.ts";
import { compileSchema } from "../../src/transport/schema.ts";
import { type RunningTransport, startTransport } from "../../src/transport/server.ts";
import type { Verdict, Verifier } from "../../src/transport/verifier.ts";
import { pinForTest } from "../fixtures/pin.ts";
import { tag } from "../fixtures/tools.ts";
import { modernBody, modernHeaders, raw, type Reply } from "../transport/helpers.ts";
import { PrincipalVerifier } from "../transport/principals.ts";

/** Everything any rig saw, for the canary over the whole approval suite (APR-10). */
export const seen = { secrets: [] as string[], texts: [] as string[] };

/** Handler entries, by tool: a call that needs approval must never add one without a grant (N4). */
export type Entries = string[];

function tools(entered: Entries): Tool[] {
  const make = (name: string, capability: ReturnType<typeof tag>): Tool & { capability: ReturnType<typeof tag> } => ({
    name,
    description: `The ${name} fixture.`,
    inputSchema: { type: "object", properties: { target: { type: "string" } }, additionalProperties: false },
    capability,
    handler: (args) => {
      entered.push(`${name} ${String(args["target"])}`);
      return Promise.resolve({ content: [{ type: "text", text: `${name} ran on ${String(args["target"])}` }] });
    },
  });
  return [
    // CAP-7 alone: elevated, no Rule-of-Two obligation. A delegated approver may decide it.
    make("deploy", tag("deploy", { capability_class: "state_change", elevated: true })),
    // CAP-2 discharged by approval: untrusted-facing state_change with no containment. A human only (APR-6).
    make("publish", tag("publish", { capability_class: "state_change", untrusted_input_facing: true, elevated: true })),
    make("read", tag("read")),
  ];
}

/** "Bearer approver:<name>" is a delegated approver's token for the approval audience; nothing else is. */
export class ApproverVerifier implements Verifier {
  verify(headers: IncomingHttpHeaders): Promise<Verdict> {
    const m = /^Bearer approver:([a-z0-9-]{1,64})$/.exec(headers.authorization ?? "");
    return Promise.resolve(m === null ? { ok: false, error: "invalid_token" } : { ok: true, principal: { id: m[1] as string } });
  }
}

export interface Rig {
  t: RunningTransport;
  service: ApprovalService;
  notifier: MemoryNotifier;
  entered: Entries;
  rows: { event: string; fields: Record<string, string | number> }[];
  of: (event: string) => Record<string, string | number>[];
  clock: { now: () => number; advance: (ms: number) => void };
  /** A tools/call as `principal`, with an approval request id in `_meta` when given. */
  call: (principal: string, tool: string, target: string, requestId?: unknown) => Promise<Reply>;
  /** A request to the approval listener. */
  listener: (method: string, path: string, opts?: { body?: unknown; bearer?: string }) => Promise<{ status: number; json: unknown; text: string }>;
  close: () => Promise<void>;
}

export async function rig(opts: { settings?: Partial<ApprovalSettings>; listens?: boolean; delegatedVerifier?: Verifier | null } = {}): Promise<Rig> {
  let now = 1_000;
  const clock = { now: () => now, advance: (ms: number) => void (now += ms) };
  const rows: Rig["rows"] = [];
  const audit = (event: string, fields: Record<string, string | number>): void => {
    rows.push({ event, fields });
    seen.texts.push(`${event} ${JSON.stringify(fields)}`);
  };
  const notifier = new MemoryNotifier();
  const recording = { notify: (n: Parameters<MemoryNotifier["notify"]>[0]) => (seen.secrets.push(n.code, n.link.split("/").pop() ?? ""), notifier.notify(n)) };
  const settings: ApprovalSettings = { ...DEFAULT_APPROVAL, backend: "listener", port: 0, ...opts.settings };
  const delegated = opts.delegatedVerifier === null ? undefined : (opts.delegatedVerifier ?? new ApproverVerifier());
  const service = new ApprovalService({ settings, notifier: recording, clock: clock.now, audit, listens: opts.listens ?? true, ...(delegated === undefined ? {} : { delegatedVerifier: delegated }) });
  const entered: Entries = [];
  const t = await startTransport({
    registry: pinForTest(tools(entered), compileSchema, DEFAULT_LIMITS, true, { approvalBackend: "configured" }),
    serverInfo: { name: "@clearseal/core", version: "0.0.0" },
    verifier: new PrincipalVerifier(),
    monotonic: clock.now,
    approval: service,
    audit,
  });
  const call = async (principal: string, tool: string, target: string, requestId?: unknown): Promise<Reply> => {
    const meta = requestId === undefined ? {} : { [APPROVAL_META]: typeof requestId === "string" ? { requestId } : requestId };
    const r = await raw(t, { headers: { ...modernHeaders("tools/call", tool), authorization: `Bearer as:${principal}` }, body: JSON.stringify(modernBody("tools/call", { name: tool, arguments: { target } }, meta)) });
    seen.texts.push(r.text);
    return r;
  };
  const listener = async (method: string, path: string, o: { body?: unknown; bearer?: string } = {}): Promise<{ status: number; json: unknown; text: string }> => {
    if (t.approvalUrl === undefined) throw new Error("this rig has no approval listener");
    const res = await fetch(`${t.approvalUrl}${path}`, { method, headers: { ...(o.body === undefined ? {} : { "content-type": "application/json" }), ...(o.bearer === undefined ? {} : { authorization: `Bearer ${o.bearer}` }) }, ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }) });
    const text = await res.text();
    seen.texts.push(text);
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = undefined;
    }
    return { status: res.status, json, text };
  };
  return { t, service, notifier, entered, rows, of: (e) => rows.filter((r) => r.event === e).map((r) => r.fields), clock, call, listener, close: () => t.close() };
}

/** The approval answer a reply carries, from `_meta["clearseal/approval"]`. */
export function approvalOf(r: Reply): { status?: string; requestId?: string; retryAfterSeconds?: number } {
  const result = (r.json as { result?: { _meta?: Record<string, unknown> } } | undefined)?.result;
  return (result?._meta?.[APPROVAL_META] ?? {});
}

/** Whether a reply is the tool's own output. */
export function ran(r: Reply): boolean {
  const result = (r.json as { result?: { isError?: boolean; content?: { text?: string }[] } } | undefined)?.result;
  return r.status === 200 && result?.isError !== true && /ran on/.test(result?.content?.[0]?.text ?? "");
}
