// The approval settings (CSR-WO-2001 §1.7; approval/RULES.md *Settings and defaults*). Read in the
// snapshot (`node/settings.ts`) from its frozen copy of the environment: there is no `process.env`
// default here, so this is never a second read of the environment. Each value is validated; anything
// invalid refuses start, naming the variable.

/** An approval setting that refuses start (N4), naming the variable. */
export class ApprovalConfigError extends Error {
  override name = "ApprovalConfigError";
}

export interface ApprovalSettings {
  /** `none` (the default: every elevated tool is refused at construction) or `listener`. */
  readonly backend: "none" | "listener";
  readonly host: string;
  readonly port: number;
  /** The base URL the notifier's link is built on; empty: the listener's own `http://host:port`. */
  readonly publicUrl: string;
  /** The delegated approvers' audience; empty: no delegated approvers. */
  readonly audience: string;
  /** The principal a confirm-URL decision is recorded as. */
  readonly humanApprover: string;
  readonly requestTtlSeconds: number;
  readonly grantTtlSeconds: number;
  /** The bounded wait (APR-13); 0: none. */
  readonly waitSeconds: number;
  readonly notifier: "stderr" | "webhook";
  readonly webhookUrl: string;
  readonly maxPending: number;
  readonly maxPendingPerPrincipal: number;
  /** APR-20: calls that may wait at once, per principal and in all; over either, pending at once. */
  readonly maxWaitingPerPrincipal: number;
  readonly maxWaiting: number;
  /** APR-22: the approval listener's per-address rate limit. */
  readonly listenerRateBurst: number;
  readonly listenerRateRefillPerMinute: number;
  readonly listenerRateMaxAddresses: number;
}

/** The defaults, each with its reason in approval/RULES.md. */
export const DEFAULT_APPROVAL: Readonly<ApprovalSettings> = Object.freeze({
  backend: "none",
  host: "127.0.0.1",
  port: 3031,
  publicUrl: "",
  audience: "",
  humanApprover: "operator",
  requestTtlSeconds: 600,
  grantTtlSeconds: 300,
  waitSeconds: 0,
  notifier: "stderr",
  webhookUrl: "",
  maxPending: 1_000,
  maxPendingPerPrincipal: 3,
  maxWaitingPerPrincipal: 1,
  // A quarter of the transport's default in-flight cap (32): waiting calls never take the slots other
  // calls need (APR-20).
  maxWaiting: 8,
  listenerRateBurst: 60,
  listenerRateRefillPerMinute: 60,
  listenerRateMaxAddresses: 10_000,
});

/** The bounded wait's ceiling: below the transport's 30 s handler timeout (APR-13). */
export const MAX_WAIT_SECONDS = 25;

const INTEGERS: Readonly<Record<string, { key: keyof ApprovalSettings; min: number; max: number }>> = Object.freeze({
  APPROVAL_LISTENER_PORT: { key: "port", min: 0, max: 65_535 },
  APPROVAL_REQUEST_TTL_SECONDS: { key: "requestTtlSeconds", min: 1, max: 86_400 },
  APPROVAL_GRANT_TTL_SECONDS: { key: "grantTtlSeconds", min: 1, max: 86_400 },
  APPROVAL_WAIT_SECONDS: { key: "waitSeconds", min: 0, max: MAX_WAIT_SECONDS },
  APPROVAL_MAX_PENDING: { key: "maxPending", min: 1, max: 100_000 },
  APPROVAL_MAX_PENDING_PER_PRINCIPAL: { key: "maxPendingPerPrincipal", min: 1, max: 100 },
  APPROVAL_MAX_WAITING_PER_PRINCIPAL: { key: "maxWaitingPerPrincipal", min: 1, max: 100 },
  APPROVAL_MAX_WAITING: { key: "maxWaiting", min: 1, max: 10_000 },
  APPROVAL_LISTENER_RATE_BURST: { key: "listenerRateBurst", min: 1, max: 1_000_000 },
  APPROVAL_LISTENER_RATE_REFILL_PER_MINUTE: { key: "listenerRateRefillPerMinute", min: 1, max: 6_000_000 },
  APPROVAL_LISTENER_RATE_MAX_ADDRESSES: { key: "listenerRateMaxAddresses", min: 1, max: 1_000_000 },
});

/** A principal as the audit writes one bare: no control character, at most 256 characters. */
const PRINCIPAL = /^[^\p{Cc}\p{Cs}\s]{1,256}$/u;

/** Checks the webhook URL (APR-16): absolute, `https`, no credentials. The reason if not. */
export function webhookUrlProblem(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "is not a URL";
  }
  if (url.protocol !== "https:") return "must be an https URL: the notification carries a one-time link and code";
  if (url.username !== "" || url.password !== "") return "must not carry credentials";
  return undefined;
}

/**
 * The approval settings from the snapshot's frozen environment. `nodeAudience` is AUTH_AUDIENCE, which
 * the approval audience must differ from (APR-9).
 */
export function approvalFromEnv(env: Readonly<Record<string, string | undefined>>): Readonly<ApprovalSettings> {
  const get = (name: string): string | undefined => {
    const v = env[name];
    return v === undefined || v === "" ? undefined : v;
  };
  const out: Record<string, unknown> = { ...DEFAULT_APPROVAL };
  const backend = get("APPROVAL_BACKEND");
  if (backend !== undefined) {
    if (backend !== "none" && backend !== "listener") throw new ApprovalConfigError(`APPROVAL_BACKEND must be none or listener (got ${JSON.stringify(backend.slice(0, 32))})`);
    out["backend"] = backend;
  }
  for (const [name, { key, min, max }] of Object.entries(INTEGERS)) {
    const raw = get(name);
    if (raw === undefined) continue;
    if (!/^(0|[1-9][0-9]*)$/.test(raw) || Number(raw) < min || Number(raw) > max) throw new ApprovalConfigError(`${name} must be a whole number from ${String(min)} to ${String(max)} (got ${JSON.stringify(raw.slice(0, 32))})`);
    out[key] = Number(raw);
  }
  const host = get("APPROVAL_LISTENER_HOST");
  if (host !== undefined) {
    if (!/^[A-Za-z0-9.:-]{1,255}$/.test(host)) throw new ApprovalConfigError("APPROVAL_LISTENER_HOST must be a host name or an address");
    out["host"] = host;
  }
  const publicUrl = get("APPROVAL_PUBLIC_URL");
  if (publicUrl !== undefined) {
    let url: URL | undefined;
    try {
      url = new URL(publicUrl);
    } catch {
      url = undefined;
    }
    if (url === undefined || (url.protocol !== "https:" && url.protocol !== "http:") || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") throw new ApprovalConfigError("APPROVAL_PUBLIC_URL must be an http or https URL with no credentials, query or fragment");
    out["publicUrl"] = publicUrl.replace(/\/+$/, "");
  }
  const audience = get("APPROVAL_AUDIENCE");
  if (audience !== undefined) {
    if (audience === get("AUTH_AUDIENCE")) throw new ApprovalConfigError("APPROVAL_AUDIENCE must differ from AUTH_AUDIENCE: a token the node accepts from callers must never decide an approval");
    out["audience"] = audience;
  }
  const human = get("APPROVAL_HUMAN_APPROVER");
  if (human !== undefined) {
    if (!PRINCIPAL.test(human)) throw new ApprovalConfigError("APPROVAL_HUMAN_APPROVER must be a principal name: 1 to 256 characters, no spaces or control characters");
    out["humanApprover"] = human;
  }
  const notifier = get("APPROVAL_NOTIFIER");
  if (notifier !== undefined) {
    if (notifier !== "stderr" && notifier !== "webhook") throw new ApprovalConfigError(`APPROVAL_NOTIFIER must be stderr or webhook (got ${JSON.stringify(notifier.slice(0, 32))})`);
    out["notifier"] = notifier;
  }
  const webhook = get("APPROVAL_WEBHOOK_URL");
  if (webhook !== undefined) {
    const problem = webhookUrlProblem(webhook);
    if (problem !== undefined) throw new ApprovalConfigError(`APPROVAL_WEBHOOK_URL ${problem}`);
    out["webhookUrl"] = webhook;
  }
  if (out["notifier"] === "webhook" && out["webhookUrl"] === "") throw new ApprovalConfigError("APPROVAL_WEBHOOK_URL is required when APPROVAL_NOTIFIER is webhook");
  // Review L5: a wait no shorter than the request's lifetime would outlive the request it waits for.
  if ((out["waitSeconds"] as number) >= (out["requestTtlSeconds"] as number)) throw new ApprovalConfigError("APPROVAL_WAIT_SECONDS must be shorter than APPROVAL_REQUEST_TTL_SECONDS");
  return Object.freeze(out as unknown as ApprovalSettings);
}
