// The approval listener (CSR-WO-2001 §1.3; approval/RULES.md APR-5…APR-9). A second HTTP listener, on
// its own address and port, serving the approval routes and nothing else. The main listener serves no
// approval route (its router knows only the MCP endpoint, /health and the metadata document).
//
//   GET  /approval/link/<token>     the request, for a person to read; reading decides nothing
//   POST /approval/link/<token>     {"code", "decision"}: a person's decision, the code and the link both
//   GET  /approval/requests/<id>    the request, for a delegated approver (bearer, approval audience)
//   POST /approval/requests/<id>    {"decision"}: a delegated approver's decision
//
// Responses never carry the link or the code (APR-10).

import { lookup } from "node:dns/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { type AddressInfo, isIP } from "node:net";

import { addressKey, canonicalAddress, clientAddress, TrustedProxies } from "./address.ts";
import type { Decision, DecisionRefusal } from "./book.ts";
import type { ApprovalService } from "./service.ts";
import { RateLimiter } from "../rate-limit/limiter.ts";
import { JsonParseError, parseJsonStrict } from "../transport/json.ts";

export { canonicalAddress } from "./address.ts";

/** The approval listener would share the main listener's address and port (APR-7). */
export class ApprovalListenerError extends Error {
  override name = "ApprovalListenerError";
}

export interface RunningApprovalListener {
  readonly port: number;
  readonly url: string;
  /** Remote addresses the rate limit holds a bucket for now (APR-22; for tests and health). */
  addresses(): number;
  close(): Promise<void>;
}

const MAX_BODY = 4_096;

/** A decision refusal's HTTP status. */
const STATUS: Readonly<Record<DecisionRefusal | "unauthenticated", number>> = Object.freeze({
  unknown: 404,
  expired: 410,
  "link-expired": 410,
  "link-used": 410,
  "link-burned": 410,
  declined: 409,
  decided: 409,
  "self-approval": 403,
  "human-required": 403,
  "wrong-code": 403,
  unauthenticated: 401,
});

function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent || res.destroyed) return;
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(text)), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        resolve(undefined);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.once("end", () => resolve(Buffer.concat(chunks, size)));
    req.once("error", () => resolve(undefined));
  });
}

/** The decision a body asks for, and a code if it carries one; undefined if malformed. */
function parseDecision(bytes: Buffer | undefined): { decision: Decision; code?: string } | undefined {
  if (bytes === undefined) return undefined;
  let v: unknown;
  try {
    v = parseJsonStrict(bytes.toString("utf8"), 4);
  } catch (err) {
    if (err instanceof JsonParseError) return undefined;
    throw err;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  if (o["decision"] !== "approve" && o["decision"] !== "decline") return undefined;
  const code = o["code"];
  if (code !== undefined && (typeof code !== "string" || code.length > 32)) return undefined;
  return { decision: o["decision"], ...(typeof code === "string" ? { code } : {}) };
}

/** Every address a host names: an IP literal itself, a name what it resolves to; the name if neither. */
async function addressesOf(host: string): Promise<Set<string>> {
  const h = canonicalAddress(host);
  if (isIP(h) !== 0) return new Set([h]);
  try {
    return new Set((await lookup(h, { all: true })).map((a) => canonicalAddress(a.address)).concat(h));
  } catch {
    return new Set([h]);
  }
}

const WILDCARDS: ReadonlySet<string> = new Set(["0.0.0.0", "::"]);

/**
 * APR-23: whether two listen hosts can serve one address. Compared as addresses, case-insensitively and
 * after resolution, and a wildcard overlaps every address: refusing a pair that could not in fact
 * collide is the safe direction.
 */
export async function hostsOverlap(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([addressesOf(a), addressesOf(b)]);
  for (const v of x) if (WILDCARDS.has(v) || y.has(v)) return true;
  for (const v of y) if (WILDCARDS.has(v)) return true;
  return false;
}

/**
 * Starts the approval listener for `service`. Refuses to start on the main listener's address and port
 * (APR-7), before binding.
 */
export async function startApprovalListener(service: ApprovalService, main: { host: string; port: number }): Promise<RunningApprovalListener> {
  const { host, port, humanApprover } = service.settings;
  if (port !== 0 && port === main.port && (await hostsOverlap(host, main.host))) throw new ApprovalListenerError(`the approval listener cannot share the main listener's address and port (${host}:${String(port)}): the approval channel must be one the caller cannot reach`);
  let allowedHosts: string[] = [];
  const rates = { burst: service.settings.listenerRateBurst, refillPerMinute: service.settings.listenerRateRefillPerMinute, maxPrincipals: service.settings.listenerRateMaxAddresses };
  // APR-22, APR-26: a budget per address, charged only for a request that fails; and a budget per
  // approver, charged for a request whose credential verified. The core's own limiter, both.
  const addresses = new RateLimiter(rates, service.clock);
  const approvers = new RateLimiter(rates, service.clock);
  const trusted = new TrustedProxies(service.settings.trustedProxies);
  // A live link is a credential for its own request only, so the confirm-URL's budget is kept per
  // request: a leaked link can spend its own request's budget, never another's.
  const humanKey = (requestId: string): string => `human:${requestId}`;

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // APR-25, APR-28: the address the request is attributed to, and the key its budget is kept under.
    const address = addressKey(clientAddress(req.socket.remoteAddress ?? "", req.headersDistinct["x-forwarded-for"], trusted));
    const budget = addresses.peek(address);
    const limited = (retryAfterS: number): void => {
      res.setHeader("Retry-After", String(retryAfterS));
      send(res, 429, { error: "rate-limited" });
    };
    // APR-26: a request that fails is charged to its address; with that budget empty (when it arrived,
    // or now) it is answered 429.
    const fail = (status: number, body: unknown): void => {
      if (!budget.ok) {
        limited(budget.retryAfterS);
        return;
      }
      const t = addresses.take(address);
      if (!t.ok) limited(t.retryAfterS);
      else send(res, status, body);
    };
    const hosts = req.headersDistinct.host ?? [];
    if (hosts.length !== 1 || !allowedHosts.includes((hosts[0] ?? "").toLowerCase())) {
      fail(403, { error: "host-not-allowed" });
      return;
    }
    const m = /^\/approval\/(link|requests)\/([A-Za-z0-9_-]{1,128})$/.exec(req.url ?? "");
    if (m === null) {
      fail(404, { error: "not-found" });
      return;
    }
    const [, kind, key = ""] = m;
    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      fail(405, { error: "method" });
      return;
    }
    // APR-26: with the address budget empty, only a request that presents a credential (a link, or a
    // bearer) is looked at; anything else is 429 at once.
    if (!budget.ok && kind !== "link" && req.headers.authorization === undefined) {
      limited(budget.retryAfterS);
      return;
    }
    if (kind === "link") {
      // With the address budget empty, a link that was never issued is refused on a table lookup, and
      // counted, not written; a link that names a request but is spent is counted too, never a row each.
      if (!budget.ok && !service.book.hasLink(key)) {
        service.noteUnauthenticated();
        limited(budget.retryAfterS);
        return;
      }
      const d = service.book.describeLink(key);
      if (!budget.ok && "kind" in d) {
        service.noteUnauthenticated();
        limited(budget.retryAfterS);
        return;
      }
      if (req.method === "GET") {
        if ("kind" in d) {
          fail(STATUS[d.reason], { error: d.reason });
          return;
        }
        // A live link is a credential for its request: charged to that request's budget, not the address.
        const t = approvers.take(humanKey(d.requestId));
        if (!t.ok) limited(t.retryAfterS);
        else send(res, 200, { request: d, decide: "POST this URL with {\"code\": \"<the code you were sent>\", \"decision\": \"approve\" | \"decline\"}" });
        return;
      }
      const body = parseDecision(await readBody(req));
      if (body?.code === undefined) {
        fail(400, { error: "a decision and the code are required" });
        return;
      }
      const own = "kind" in d ? undefined : humanKey(d.requestId);
      const ownBudget = own === undefined ? undefined : approvers.peek(own);
      if (ownBudget !== undefined && !ownBudget.ok) {
        limited(ownBudget.retryAfterS);
        return;
      }
      const r = service.book.decideByLink(key, body.code, body.decision, humanApprover);
      if (r.kind === "decided") {
        if (own !== undefined) approvers.take(own);
        send(res, 200, { decided: body.decision });
        return;
      }
      // APR-22: a link that names no request: counted, not a row each.
      if (r.reason === "unknown") service.noteUnauthenticated();
      // A refused decision on a link and its right code (self-approval, a decline already made) is the
      // approver's own; every other refusal is a failure charged to the address.
      if (own !== undefined && (r.reason === "self-approval" || r.reason === "declined" || r.reason === "decided")) {
        approvers.take(own);
        send(res, STATUS[r.reason], { error: r.reason });
      } else fail(STATUS[r.reason], { error: r.reason });
      return;
    }
    // A delegated approver: its own bearer, for the approval audience (APR-9).
    const verifier = service.delegatedVerifier;
    if (verifier === undefined) {
      fail(404, { error: "no delegated approvers are configured" });
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    const verdict = await Promise.race([verifier.verify(req.headers), new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), 5_000)))]).finally(() => clearTimeout(timer));
    if (verdict === "timeout") {
      fail(503, { error: "authentication is unavailable" });
      return;
    }
    const approver = verdict.ok ? verdict.principal.id : "";
    if (!verdict.ok || approver === "") {
      // APR-22: counted into one row per window, not a row each.
      service.noteUnauthenticated();
      fail(401, { error: "unauthenticated" });
      return;
    }
    // APR-26: a verified approver is charged to its own budget, and served though its address's is empty.
    const t = approvers.take(`delegated:${approver}`);
    if (!t.ok) {
      limited(t.retryAfterS);
      return;
    }
    if (req.method === "GET") {
      const d = service.book.describe(key);
      if (d === undefined) send(res, 404, { error: "unknown" });
      else send(res, 200, { request: d });
      return;
    }
    const body = parseDecision(await readBody(req));
    if (body === undefined) {
      send(res, 400, { error: "a decision is required" });
      return;
    }
    const r = service.book.decideDelegated(key, approver, body.decision);
    if (r.kind === "decided") send(res, 200, { decided: body.decision });
    else send(res, STATUS[r.reason], { error: r.reason });
  };

  const server: Server = createServer({ requestTimeout: 10_000 }, (req, res) => {
    handle(req, res).catch(() => {
      send(res, 500, { error: "internal" });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const bound = (server.address() as AddressInfo).port;
  // The same check once both are bound: a main listener on port 0 is known only now.
  if (bound === main.port && (await hostsOverlap((server.address() as AddressInfo).address, main.host))) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new ApprovalListenerError("the approval listener cannot share the main listener's address and port");
  }
  const authority = `${host.includes(":") ? `[${host}]` : host}:${String(bound)}`;
  allowedHosts = [authority, `localhost:${String(bound)}`];
  if (service.settings.publicUrl !== "") allowedHosts.push(new URL(service.settings.publicUrl).host);
  allowedHosts = allowedHosts.map((h) => h.toLowerCase());
  service.setBase(`http://${authority}`);
  return Object.freeze({
    port: bound,
    url: `http://${authority}`,
    addresses: () => addresses.size,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          service.flushUnauthenticated();
          resolve();
        });
        server.closeAllConnections();
      }),
  });
}
