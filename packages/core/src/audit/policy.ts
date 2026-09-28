// The event table (audit/RULES.md AU-4, AU-6, AU-7). Every row the store writes is shaped here: the
// principal is attached by the event's kind, and each field is written bare only if the table lists
// it and its value is of the listed kind. A listed field of the wrong kind becomes a keyed digest
// under its own name; fields the table does not list (and every field of an unknown event) become one
// keyed digest named `unlisted`, since a field's name could carry a value too. Nothing is dropped and
// nothing unlisted is bare.

import { DIGEST_FORM, type Digester } from "./digest.ts";

type Kind = "code" | "errname" | "int" | "tool" | "method" | "hex64" | "config" | "argdigest" | "digest" | "principal";
type PrincipalRule = "node" | "caller" | "caller-or-unauthenticated" | "unauthenticated";

interface EventRule {
  readonly principal: PrincipalRule;
  readonly fields: Readonly<Record<string, Kind>>;
}

const TOOL_FIELDS = { tool: "tool" } as const;

/** The table in RULES.md, as data. */
export const EVENTS: Readonly<Record<string, EventRule>> = Object.freeze({
  "manifest-loaded": { principal: "node", fields: { path: "config", sha256: "hex64" } },
  "audit-unanchored": { principal: "node", fields: { mode: "code" } },
  "manifest-refused": { principal: "node", fields: { path: "config", sha256: "hex64", reason: "errname" } },
  "pin-refused": { principal: "node", fields: { tool: "tool", reason: "code", rule: "code" } },
  "pin-non-strict": { principal: "node", fields: { admitted: "int", refused: "int" } },
  "auth-audience-differs": { principal: "node", fields: { audience: "config", resource: "config" } },
  "verifier-timeout": { principal: "unauthenticated", fields: { limitMs: "int" } },
  "verifier-contract": { principal: "unauthenticated", fields: { reason: "code" } },
  "auth-unavailable": { principal: "unauthenticated", fields: { reason: "code", retryAfterS: "int" } },
  "auth-refused": { principal: "unauthenticated", fields: { reason: "code" } },
  "http-refused": { principal: "caller-or-unauthenticated", fields: { status: "int", reason: "code" } },
  "rpc-refused": { principal: "caller", fields: { code: "int", method: "method" } },
  "transport-error": { principal: "caller-or-unauthenticated", fields: { reason: "errname" } },
  "result-over-cap": { principal: "caller", fields: { method: "method", limit: "int" } },
  "validation-timeout": { principal: "caller", fields: { tool: "tool", limitMs: "int" } },
  "validation-error": { principal: "caller", fields: TOOL_FIELDS },
  "containment-refused": { principal: "caller", fields: { tool: "tool", kind: "code", sink: "digest", fileType: "code" } },
  "handler-timeout": { principal: "caller", fields: { tool: "tool", limitMs: "int" } },
  "client-disconnect": { principal: "caller", fields: { tool: "tool", limitMs: "int" } },
  "handler-error": { principal: "caller", fields: TOOL_FIELDS },
  "legacy-input-required": { principal: "caller", fields: TOOL_FIELDS },
  "request-state-unsealable": { principal: "caller", fields: TOOL_FIELDS },
  "tool-call": { principal: "caller", fields: { tool: "tool", outcome: "code", args: "argdigest" } },
  "rate-limited": { principal: "caller", fields: { retryAfterS: "int" } },
  "tripwire-read-burst": { principal: "caller", fields: { count: "int", windowS: "int" } },
  "principal-state-full": { principal: "caller", fields: { control: "code", cap: "int" } },
  "approval-requested": { principal: "caller", fields: { request: "code", tool: "tool", args: "argdigest", human: "code" } },
  "approval-notified": { principal: "caller", fields: { request: "code", tool: "tool" } },
  "approval-notify-failed": { principal: "caller", fields: { request: "code", tool: "tool", reason: "code" } },
  "approval-approved": { principal: "caller", fields: { request: "code", tool: "tool", approver: "principal", via: "code" } },
  "approval-declined": { principal: "caller", fields: { request: "code", tool: "tool", approver: "principal", via: "code" } },
  "approval-redeemed": { principal: "caller", fields: { request: "code", tool: "tool", approver: "principal", args: "argdigest" } },
  "approval-expired": { principal: "caller", fields: { request: "code", tool: "tool", phase: "code" } },
  "approval-refused": { principal: "caller", fields: { request: "code", tool: "tool", kind: "code" } },
  "approval-decision-refused": { principal: "caller-or-unauthenticated", fields: { request: "code", tool: "tool", kind: "code", approver: "principal", via: "code" } },
  "audit-resumed": { principal: "node", fields: { fromSeq: "int", unanchored: "int" } },
});

/** transport-error's reason is an error's name, and a tool's code can name an error after its
 *  arguments: only the platform's own error names, and the transport's own word, are written bare. */
const ERROR_NAMES: ReadonlySet<string> = new Set(["unhandled", "unknown", "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError", "AggregateError", "AbortError", "TimeoutError", "Refusal"]);

/** The MCP methods the transport knows: a method name written bare is one of these. */
const METHODS: ReadonlySet<string> = new Set(["initialize", "notifications/initialized", "ping", "tools/list", "tools/call", "server/discover", "resources/list", "resources/read", "prompts/list", "prompts/get", "completion/complete", "logging/setLevel"]);

const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TOOL = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const HEX64 = /^[0-9a-f]{64}$/;
// No control character, and nothing a canonical string refuses (a lone surrogate).
const CONFIG = /^[^\p{Cc}\p{Cs}]{1,2048}$/u;
const PRINCIPAL = /^[^\p{Cc}\p{Cs}]{1,512}$/u;

function ofKind(kind: Kind, v: unknown): boolean {
  switch (kind) {
    case "code":
      return typeof v === "string" && CODE.test(v);
    case "errname":
      return typeof v === "string" && ERROR_NAMES.has(v);
    case "int":
      return typeof v === "number" && Number.isSafeInteger(v);
    case "tool":
      return typeof v === "string" && TOOL.test(v);
    case "method":
      return typeof v === "string" && METHODS.has(v);
    case "hex64":
      return typeof v === "string" && HEX64.test(v);
    case "config":
      return typeof v === "string" && CONFIG.test(v);
    case "argdigest":
      return typeof v === "string" && DIGEST_FORM.test(v);
    case "digest":
      return false;
    case "principal":
      return typeof v === "string" && PRINCIPAL.test(v);
  }
}

export interface Shaped {
  /** The event as written: its own name if the table lists it, else "unlisted" (the name goes into
   *  the unlisted digest, since an event name could carry a value too). */
  event: string;
  principal: string;
  fields: Record<string, string | number>;
}

/** Shapes one event's fields into a row's principal and fields. */
export function shapeRow(event: string, input: Readonly<Record<string, unknown>>, digester: Digester): Shaped {
  const rule: EventRule | undefined = Object.hasOwn(EVENTS, event) ? EVENTS[event] : undefined;
  const fields: Record<string, string | number> = {};
  // No prototype, so a member named __proto__ is kept as data, never dropped.
  const unlisted: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  if (rule === undefined) unlisted["event"] = event;
  let caller: string | undefined;
  for (const [name, value] of Object.entries(input)) {
    if (name === "principal" && rule !== undefined && rule.principal !== "node") {
      caller = typeof value === "string" && PRINCIPAL.test(value) ? value : digester.value("principal", value);
      continue;
    }
    const kind = rule !== undefined && Object.hasOwn(rule.fields, name) ? rule.fields[name] : undefined;
    if (kind === undefined) {
      unlisted[name] = value;
      continue;
    }
    fields[name] = ofKind(kind, value) ? (value as string | number) : digester.value(`${event}.${name}`, value);
  }
  if (Object.keys(unlisted).length > 0) fields["unlisted"] = digester.value(`${event}.unlisted`, unlisted);
  let principal: string;
  if (rule === undefined) principal = "unattributed";
  else if (rule.principal === "node") principal = "node";
  else if (rule.principal === "unauthenticated") principal = caller ?? "unauthenticated";
  else principal = caller ?? (rule.principal === "caller" ? "unattributed" : "unauthenticated");
  return { event: rule === undefined ? "unlisted" : event, principal, fields };
}
