// CSR-WO-0101 spike: three approval transports on the core's own transport (packages/core, CSR-WO-1005).
// Not product code; nothing here executes anything (N7). Each tool only waits for a human and then
// returns a string saying which path it used and what the client did.
//
//   (a) approve_via_mrtr   elicitation carried inside a Multi Round-Trip Request: the first call
//                          returns input_required with an elicitation/create input request, and
//                          the core seals the state (HMAC, bound to principal, tool and arguments);
//                          the re-issued call carries the answer.
//   (b) approve_via_task   the Tasks extension, NOT offered on the core transport (see TASKS_NOT_OFFERED).
//   (c) approve_via_grant  the out-of-band grant: the first call issues a single-use code that
//                          expires, printed to the server log; a second call with the code redeems it.
//
// Bound to loopback only. The static bearer is read from CLEARSEAL_SPIKE_BEARER (named in
// .env.example, never valued); without it the server refuses to start.
//
//   CLEARSEAL_SPIKE_BEARER=... node spikes/0101-approval/server.ts

import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import { PinGate } from "../../packages/core/src/pinning/gate.ts";
import { buildManifest, serializeManifest } from "../../packages/core/src/pinning/manifest.ts";
import { PinnedRegistry } from "../../packages/core/src/pinning/registry.ts";
import {
  requestStateKeyFromEnv,
  type RunningTransport,
  startTransport,
  type Tool,
  type ToolResult,
  ValidationPool,
  DEFAULT_LIMITS,
  type Verdict,
  type Verifier,
} from "../../packages/core/src/transport/index.ts";

import { GrantStore } from "./grants.ts";

export const BEARER_ENV = "CLEARSEAL_SPIKE_BEARER";
export const MIN_BEARER_LENGTH = 32;
export const GRANT_TTL_MS = 120_000;
const PRINCIPAL = "spike-operator";

export const TASKS_NOT_OFFERED =
  "NOT OFFERED: the Tasks extension (io.modelcontextprotocol/tasks, ext-tasks schema v2) is implementable from its text, " +
  "but not on the core transport as merged: server/discover's capabilities are fixed (the extension cannot be advertised), " +
  'a "task" resultType is refused by the core, and tasks/get, tasks/update and tasks/cancel are not routed (404). ' +
  "Offering it needs a change to packages/core, which this spike may not make.";

/** Accepts exactly one static bearer, compared in constant time. A spike device: no OAuth, no AS. */
export class StaticBearerVerifier implements Verifier {
  readonly #expected: Buffer;
  constructor(bearer: string) {
    this.#expected = Buffer.from(`Bearer ${bearer}`);
  }
  verify(headers: IncomingHttpHeaders): Promise<Verdict> {
    const got = headers.authorization;
    if (got === undefined) return Promise.resolve({ ok: false });
    const b = Buffer.from(got);
    const ok = b.length === this.#expected.length && timingSafeEqual(b, this.#expected);
    return Promise.resolve(ok ? { ok: true, principal: { id: PRINCIPAL } } : { ok: false, error: "invalid_token" });
  }
}

export class StartRefused extends Error {
  override name = "StartRefused";
}

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

export function approvalTools(grants: GrantStore, log: (line: string) => void, now: () => number = Date.now): Tool[] {
  const actionSchema = { type: "object", properties: { action: { type: "string", minLength: 1, maxLength: 200 } }, required: ["action"] };
  return [
    {
      name: "approve_via_mrtr",
      description: "Asks the human to approve `action` through an elicitation carried in a multi round-trip request, then returns what they answered. Executes nothing.",
      inputSchema: actionSchema,
      handler: (args, ctx) => {
        const action = String(args["action"]);
        if (ctx.state === undefined) {
          return Promise.resolve({
            resultType: "input_required",
            inputRequests: {
              approval: {
                method: "elicitation/create",
                params: {
                  mode: "form",
                  message: `Approve this action? ${action}`,
                  requestedSchema: { type: "object", properties: { approve: { type: "boolean", title: "Approve" } }, required: ["approve"] },
                },
              },
            },
            state: { askedAt: now() },
          });
        }
        const askedAt = typeof ctx.state === "object" && ctx.state !== null && !Array.isArray(ctx.state) ? Number(ctx.state["askedAt"]) : NaN;
        const waited = Number.isFinite(askedAt) ? `${String(now() - askedAt)} ms` : "unknown";
        const answer = ctx.inputResponses?.["approval"];
        if (answer === undefined) {
          // MRTR: a missing answer is asked again, not an error.
          return Promise.resolve({ resultType: "input_required", inputRequests: { approval: { method: "elicitation/create", params: { mode: "form", message: `Approve this action? ${action}`, requestedSchema: { type: "object", properties: { approve: { type: "boolean" } }, required: ["approve"] } } } }, state: { askedAt } });
        }
        const raw = JSON.stringify(answer);
        const a = answer as { action?: unknown; content?: { approve?: unknown } };
        if (a.action === "accept" && a.content?.approve === true) return Promise.resolve(text(`APPROVED via mrtr (elicitation in an input_required round trip): "${action}". Waited ${waited}. Raw answer: ${raw}`));
        return Promise.resolve(text(`REFUSED via mrtr: "${action}" was not approved. Waited ${waited}. Raw answer: ${raw}`, true));
      },
    },
    {
      name: "approve_via_task",
      description: "Would approve `action` through the Tasks extension; reports why that path is not offered here. Executes nothing.",
      inputSchema: actionSchema,
      handler: () => Promise.resolve(text(TASKS_NOT_OFFERED, true)),
    },
    {
      name: "approve_via_grant",
      description:
        "Out-of-band approval. Call with `action` alone: a one-time code is issued to the operator out of band and expires in 120 s. " +
        "Call again with the same `action` and the `code` to redeem it; a code works once. Executes nothing.",
      inputSchema: { type: "object", properties: { action: { type: "string", minLength: 1, maxLength: 200 }, code: { type: "string", maxLength: 32 } }, required: ["action"] },
      handler: (args, ctx) => {
        const action = String(args["action"]);
        const code = args["code"];
        if (typeof code !== "string") {
          const g = grants.issue(ctx.principal.id, "approve_via_grant", { action });
          log(`[approval-spike] GRANT issued: code ${g.code} for approve_via_grant action=${JSON.stringify(action)}; expires in ${((g.expiresAt - g.issuedAt) / 1000).toFixed(1)} s; single use`);
          return Promise.resolve(text(`PENDING via grant: a one-time code for "${action}" was issued out of band (not in this reply). Call approve_via_grant again with the same action and the code within ${String((g.expiresAt - g.issuedAt) / 1000)} s.`));
        }
        const r = grants.redeem(code, ctx.principal.id, "approve_via_grant", { action });
        if (!r.ok) {
          log(`[approval-spike] GRANT redemption refused: ${r.reason}`);
          return Promise.resolve(text(`REFUSED via grant: the code is ${r.reason === "expired" ? "expired" : r.reason === "bound-elsewhere" ? "not for this call" : "unknown or already used"}.`, true));
        }
        log(`[approval-spike] GRANT redeemed for approve_via_grant action=${JSON.stringify(action)} after ${String(now() - r.grant.issuedAt)} ms`);
        return Promise.resolve(text(`APPROVED via grant: "${action}". Redeemed ${String(now() - r.grant.issuedAt)} ms after it was issued.`));
      },
    },
  ];
}

export interface SpikeOptions {
  bearer: string | undefined;
  port?: number;
  /** Extra Host / Origin values beyond loopback (the operator's exposure; never written here). */
  extraHosts?: readonly string[];
  extraOrigins?: readonly string[];
  resourceUrl?: string;
  grantTtlMs?: number;
  log?: (line: string) => void;
  now?: () => number;
}

export interface Spike {
  t: RunningTransport;
  grants: GrantStore;
  close: () => Promise<void>;
}

export async function startSpike(o: SpikeOptions): Promise<Spike> {
  if (o.bearer === undefined || !new RegExp(`^[A-Za-z0-9+/=_.~-]{${String(MIN_BEARER_LENGTH)},}$`).test(o.bearer)) {
    throw new StartRefused(`${BEARER_ENV} must be set to a bearer of at least ${String(MIN_BEARER_LENGTH)} base64 or base64url characters; refusing to start open`);
  }
  const port = o.port ?? 0;
  const loopbackHosts = (p: number): string[] => [`127.0.0.1:${String(p)}`, `localhost:${String(p)}`];
  // Loopback only, always. Extra hosts/origins let a request that arrives through the operator's
  // own means pass the DNS-rebinding check; the port must be fixed for the loopback entries.
  const extra = (o.extraHosts?.length ?? 0) > 0 || (o.extraOrigins?.length ?? 0) > 0;
  if (extra && port === 0) throw new StartRefused("extra hosts or origins need a fixed port");
  const log = o.log ?? ((line: string) => console.error(line));
  const now = o.now ?? Date.now;
  const grants = new GrantStore(o.grantTtlMs ?? GRANT_TTL_MS, now);
  const pool = new ValidationPool({ workers: 1, timeoutMs: DEFAULT_LIMITS.validationTimeoutMs });
  // CSR-WO-1001 D-1: the spike pins its own tools at start (an in-memory approve), so it runs on the pinned core.
  const tools = approvalTools(grants, log, now).map((t) => ({ ...t, description: t.description ?? "", capability: { capability_class: "read_only", untrusted_input_facing: false, scope: t.name, privacy_sensitive: false, recoverability_basis: null, elevated: false, containment_domain: null } }));
  const registry = new PinnedRegistry(PinGate.load(serializeManifest(buildManifest(tools))).admit(tools), { compile: pool.compile, limits: DEFAULT_LIMITS, strict: true });
  const t = await startTransport({
    registry,
    serverInfo: { name: "clearseal-spike-0101-approval", version: "0.0.0" },
    verifier: new StaticBearerVerifier(o.bearer),
    // The MRTR state key: from the environment if set, else a fresh random key for this process
    // only (never stored), so a restarted server refuses every earlier state.
    requestStateKey: requestStateKeyFromEnv() ?? randomBytes(32),
    now,
    config: {
      host: "127.0.0.1",
      port,
      ...(extra
        ? {
            allowedHosts: [...loopbackHosts(port), ...(o.extraHosts ?? [])],
            allowedOrigins: [...loopbackHosts(port).map((h) => `http://${h}`), ...(o.extraOrigins ?? [])],
          }
        : {}),
      ...(o.resourceUrl !== undefined && o.resourceUrl !== "" ? { resourceUrl: o.resourceUrl } : {}),
      instructions: "An approval-transport spike. Three tools; none executes anything.",
    },
  });
  return {
    t,
    grants,
    close: async () => {
      grants.close();
      await t.close();
      await pool.close();
    },
  };
}

const list = (v: string | undefined): string[] => (v ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");

if (import.meta.main) {
  try {
    const s = await startSpike({
      bearer: process.env[BEARER_ENV],
      port: Number(process.env["CLEARSEAL_SPIKE_PORT"] ?? "3999"),
      extraHosts: list(process.env["CLEARSEAL_SPIKE_ALLOWED_HOSTS"]),
      extraOrigins: list(process.env["CLEARSEAL_SPIKE_ALLOWED_ORIGINS"]),
      resourceUrl: process.env["CLEARSEAL_SPIKE_RESOURCE_URL"],
    });
    console.error(`[approval-spike] listening on ${s.t.url} (loopback only). Stop it when the run is over: Ctrl-C.`);
    const stop = (): void => {
      void s.close().then(() => process.exit(0));
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } catch (err) {
    console.error(`[approval-spike] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
}
