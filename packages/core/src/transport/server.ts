// The core's own Streamable HTTP layer (CSR-WO-1005): one POST endpoint that serves `2026-07-28`
// natively and the legacy `2025-11-25` handshake as a pure function, with every limit enforced
// here. No SDK is imported. SPEC-MAP.md beside this file maps each normative statement to its code.
//
// The order of checks, first refusal wins:
//   1. route      raw origin-form target only (else 400); unknown path → 404; one Host header
//                 (else 400); /health and the RFC 9728 document are served bearer-free
//   2. method     not POST → 405 with Allow: POST
//   3. Host, Origin not allowed → 403 (DNS rebinding, SH-2…SH-4)
//   4. auth       the verifier, under a deadline, returns a principal, or 401 with a
//                 resource-metadata challenge (503 if it does not answer in time)
//   5. capacity   more than maxInFlight requests or handlers in progress → 503 with Retry-After
//   6. Accept, Content-Type, codings → 406 / 415 / 400
//   7. body       over maxBodyBytes → 413; not strict UTF-8, malformed, duplicate keys → 400 -32700;
//                 deeper than maxJsonDepth → 400 -32600
//   8. framing    batch, response, or malformed JSON-RPC → 400 -32600
//   9. era and headers: version header, _meta, Mcp-Method, Mcp-Name → 400 -32020 / -32022 / -32602
//  10. dispatch   unknown method → 404 -32601; tools/call → Mcp-Param-*, schema validation, the
//                 handler under a timeout, the result cap
// Authentication comes before the body is read, so an unauthenticated client never reaches the
// parser. Nothing is dispatched without a principal.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { type Limits, resolveConfig, SUPPORTED_VERSIONS, type TransportConfig } from "./config.ts";
import { dispatch, type DispatchContext } from "./dispatch.ts";
import { JsonParseError, parseJsonStrict } from "./json.ts";
import { classify, INTERNAL_ERROR, INVALID_REQUEST, PARSE_ERROR, Refusal, type RequestId } from "./jsonrpc.ts";
import { PinnedRegistry, PinRefusedError } from "../pinning/registry.ts";
import type { Principal, Verdict, Verifier } from "./verifier.ts";
import { JwtVerifier, jwtVerifierFromEnv } from "../auth/verifier.ts";

export interface TransportOptions {
  config?: Parameters<typeof resolveConfig>[0];
  /** The pinned registry: the only registry the transport serves, built only from the pin gate's
   *  admission (CSR-WO-1001, N2). Anything else is refused at start. */
  registry: PinnedRegistry;
  /** Defaults to the JwtVerifier configured from AUTH_* (CSR-WO-1003); without that configuration,
   *  and a configured resource URL, the transport refuses to start. */
  verifier?: Verifier;
  /** MRTR requestState key (CLEARSEAL_REQUEST_STATE_KEY). Without it, state is refused. */
  requestStateKey?: Uint8Array;
  /** The validation pool the registry's validators run in. Once handed over, the transport owns
   *  it: close() closes it, and resolves only after its workers have exited. An open pool's worker
   *  message ports keep a process alive despite unref() (CSR-WO-1005a, from -0101's finding). */
  validationPool?: { close(): Promise<void> };
  /** The audit seam (-2002). A log line until then. */
  audit?: (event: string, fields: Record<string, string | number>) => void;
  /** Server identity for serverInfo and /health: the package's name and version, nothing else. */
  serverInfo: { name: string; version: string };
  /** The clock, for tests. */
  now?: () => number;
}

export interface RunningTransport {
  readonly port: number;
  readonly url: string;
  readonly config: TransportConfig;
  /** Requests in progress now (for tests and health). */
  inFlight(): number;
  close(): Promise<void>;
}

const JSON_TYPE = "application/json";
const PRM_PATH = "/.well-known/oauth-protected-resource";

/** An access token offered other than in the Authorization header: an `access_token` query
 *  parameter, or a form-encoded body, which is the only body RFC 6750 carries one in. */
function tokenElsewhere(target: string, contentTypes: readonly string[] | undefined): boolean {
  const q = target.indexOf("?");
  if (q !== -1 && new URLSearchParams(target.slice(q + 1)).has("access_token")) return true;
  return (contentTypes ?? []).some((c) => /^\s*application\/x-www-form-urlencoded\b/i.test(c));
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent || res.destroyed) return;
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    ...(body === undefined ? {} : { "Content-Type": JSON_TYPE }),
    "Content-Length": String(Buffer.byteLength(text)),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(text);
}

function refuse(res: ServerResponse, refusal: Refusal, id?: RequestId): void {
  send(res, refusal.status, refusal.body(id), { ...refusal.headers });
}

// Every HTTP-level refusal the transport sends writes exactly one audit line (CHECKS.md H1, red-team
// F1): its one-word reason, and the principal once known. An event that already wrote its own line
// (auth-refused, verifier-timeout, verifier-contract, transport-error) is marked and not written again.
// JSON-RPC errors that dispatch returns for a well-formed request are not HTTP-level refusals here:
// their status is the era's, and their audit events are dispatch's own.
const REASONS = new WeakMap<Refusal, string>();
const AUDITED = new WeakSet<Refusal>();

/** A refusal with its one-word audit reason. */
function refusal(status: number, code: number, message: string, reason: string, data?: unknown, headers: Record<string, string> = {}): Refusal {
  const r = new Refusal(status, code, message, data, headers);
  REASONS.set(r, reason);
  return r;
}

/** A refusal whose event has already been audited under its own name. */
function audited(r: Refusal): Refusal {
  AUDITED.add(r);
  return r;
}

/** Does the Accept header admit application/json (SH-7; narrower than the client MUST)? */
function acceptsJson(accept: string | undefined): boolean {
  if (accept === undefined) return false;
  return accept.split(",").some((part) => {
    const [range = "", ...params] = part.trim().toLowerCase().split(";");
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    if (q !== undefined && Number(q.slice(2)) === 0) return false;
    return range === JSON_TYPE || range === "application/*" || range === "*/*";
  });
}

function isJsonContentType(ct: string | undefined): boolean {
  if (ct === undefined) return false;
  const [type = "", ...params] = ct.toLowerCase().split(";").map((s) => s.trim());
  if (type !== JSON_TYPE) return false;
  return params.every((p) => p === "" || p === "charset=utf-8" || p === 'charset="utf-8"');
}

/** Reads the body under the byte cap. A declared Content-Length over the cap is refused before
 *  reading; a chunked body is cut off one byte past it. */
function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = req.headers["content-length"];
    if (declared !== undefined && Number(declared) > max) {
      reject(refusal(413, INVALID_REQUEST, `The request body exceeds ${String(max)} bytes`, "body-too-large", undefined, { Connection: "close" }));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > max) {
        req.off("data", onData);
        req.pause();
        reject(refusal(413, INVALID_REQUEST, `The request body exceeds ${String(max)} bytes`, "body-too-large", undefined, { Connection: "close" }));
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.once("end", () => resolve(Buffer.concat(chunks, size)));
    req.once("error", reject);
  });
}

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function parseBody(bytes: Buffer, limits: Limits): unknown {
  let text: string;
  try {
    text = STRICT_UTF8.decode(bytes);
  } catch {
    throw refusal(400, PARSE_ERROR, "Parse error: the body is not UTF-8", "body-not-utf8");
  }
  try {
    return parseJsonStrict(text, limits.maxJsonDepth);
  } catch (err) {
    if (err instanceof JsonParseError) {
      if (err.kind === "depth") throw refusal(400, INVALID_REQUEST, `The body is nested deeper than ${String(limits.maxJsonDepth)}`, "body-depth");
      if (err.kind === "duplicate-key") throw refusal(400, PARSE_ERROR, "Parse error: duplicate object key", "duplicate-key");
      if (err.kind === "lone-surrogate") throw refusal(400, PARSE_ERROR, "Parse error: lone surrogate escape", "lone-surrogate");
      throw refusal(400, PARSE_ERROR, "Parse error", "parse-error");
    }
    throw err;
  }
}

function hostAllowed(host: string | undefined, allowed: readonly string[]): boolean {
  return host !== undefined && allowed.includes(host.toLowerCase());
}

export async function startTransport(options: TransportOptions): Promise<RunningTransport> {
  let config: TransportConfig;
  try {
    config = resolveConfig(options.config);
  } catch (err) {
    // A server refused at configuration still owns the pool it was handed (1005a adversarial F2).
    await options.validationPool?.close();
    throw err;
  }
  const { limits } = config;
  const now = options.now ?? Date.now;
  const audit = options.audit ?? ((event, fields) => console.error(`[audit-seam] ${event} ${JSON.stringify(fields)}`));

  // CSR-WO-1001 §1.4: the pin gate's decision is read before anything binds. Only a pinned
  // registry is served; every refusal is logged once at the audit seam; under the strict default
  // any refusal stops the node here.
  const registry: unknown = options.registry;
  if (!PinnedRegistry.isGenuine(registry)) {
    await options.validationPool?.close();
    throw new TypeError("the transport serves only a PinnedRegistry, built from the pin gate's admission");
  }
  const { pinning } = registry;
  for (const r of pinning.refused) audit("pin-refused", { tool: r.name, reason: r.reason, ...(r.rule === undefined ? {} : { rule: r.rule }) });
  if (pinning.refused.length > 0) {
    if (pinning.strict) {
      await options.validationPool?.close();
      throw new PinRefusedError(pinning.refused);
    }
    audit("pin-non-strict", { admitted: pinning.admitted, refused: pinning.refused.length });
  }
  let verifier: Verifier;
  try {
    verifier = options.verifier ?? jwtVerifierFromEnv();
    // G1: with the core's verifier, the resource URL comes from configuration, never inferred.
    if (verifier instanceof JwtVerifier && config.resourceUrl === "") throw new Error("the resource URL is not configured: the node does not start without it");
  } catch (err) {
    await options.validationPool?.close();
    throw err;
  }
  const issuers: readonly string[] = verifier instanceof JwtVerifier ? [verifier.issuer] : config.authorizationServers;
  let inFlight = 0;
  // Filled once the port is known (port 0 binds an ephemeral one).
  let allowedHosts: string[] = [];
  let allowedOrigins: string[] = [];
  let resourceUrl = "";

  // RFC 9728 §3.1: the metadata for a resource at a path lives at the well-known path plus that path.
  const challenge = (): Record<string, string> => ({ "WWW-Authenticate": `Bearer resource_metadata="${new URL(resourceUrl).origin}${PRM_PATH}${config.endpointPath}"` });

  /** Runs the verifier under its deadline. Dispatch needs ok === true and a non-empty principal
   *  id; anything else never dispatches (F4). */
  const authenticate = async (req: IncomingMessage): Promise<Principal> => {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        resolve("timeout");
      }, limits.verifierTimeoutMs);
    });
    let verdict: Verdict | "timeout";
    try {
      verdict = await Promise.race([verifier.verify(req.headers), deadline]);
    } finally {
      clearTimeout(timer);
    }
    if (verdict === "timeout") {
      audit("verifier-timeout", { limitMs: limits.verifierTimeoutMs });
      throw audited(new Refusal(503, INTERNAL_ERROR, "Authentication is unavailable; retry later", undefined, { "Retry-After": "1" }));
    }
    if (verdict.ok === true) {
      const id: unknown = (verdict.principal as Principal | undefined)?.id;
      if (typeof id === "string" && id !== "") return verdict.principal;
      audit("verifier-contract", { reason: "ok without a principal" });
      throw audited(new Refusal(500, INTERNAL_ERROR, "Internal error"));
    }
    audit("auth-refused", { reason: verdict.reason ?? "refused" });
    const header = challenge();
    if (verdict.error !== undefined) header["WWW-Authenticate"] = `${header["WWW-Authenticate"] ?? ""}, error="${verdict.error}"`;
    // RFC 6750: a malformed request is 400, a missing or failed token 401; both carry the challenge.
    if (verdict.error === "invalid_request") throw audited(new Refusal(400, INVALID_REQUEST, "Bad Request", undefined, header));
    throw audited(new Refusal(401, INVALID_REQUEST, "Unauthorized", undefined, header));
  };

  /** A refusal sent before the pipeline's try block: audited here, then sent with no body. */
  const refuseEarly = (res: ServerResponse, status: number, reason: string, headers: Record<string, string> = {}): void => {
    audit("http-refused", { status, reason });
    send(res, status, undefined, headers);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // 1. route, on the raw request target: no dot-segment or percent normalization (F14), and
    //    only origin-form ("/..."), so the Host check always sees the authority used (F9).
    const target = req.url ?? "";
    if (!target.startsWith("/")) {
      refuseEarly(res, 400, "request-target");
      return;
    }
    const path = target.split("?", 1)[0] ?? "";
    const isEndpoint = path === config.endpointPath;
    const isHealth = path === "/health";
    const isPrm = path === PRM_PATH || path === `${PRM_PATH}${config.endpointPath}`;
    if (!isEndpoint && !isHealth && !isPrm) {
      refuseEarly(res, 404, "not-found");
      return;
    }

    // Host exactly once (RFC 9112 §3.2) and allowed; Origin, when present, allowed (SH-2…SH-4).
    // On every route, /health and the metadata document included (F16).
    const hosts = req.headersDistinct.host ?? [];
    if (hosts.length !== 1) {
      refuseEarly(res, 400, "host-count");
      return;
    }
    const origins = req.headersDistinct.origin;
    const hostOk = hostAllowed(hosts[0], allowedHosts);
    const originOk = origins === undefined || (origins.length === 1 && allowedOrigins.includes((origins[0] ?? "").toLowerCase()));

    if (isHealth || isPrm) {
      if (req.method !== "GET") {
        refuseEarly(res, 405, "method", { Allow: "GET" });
        return;
      }
      if (!hostOk || !originOk) {
        refuseEarly(res, 403, hostOk ? "origin-not-allowed" : "host-not-allowed");
        return;
      }
      // The pinned counts only: the refused tools' names are in the start-up log, never here.
      if (isHealth) send(res, 200, { status: "ok", version: options.serverInfo.version, protocolVersions: [...SUPPORTED_VERSIONS], pinned: { admitted: pinning.admitted, refused: pinning.refused.length } });
      else send(res, 200, { resource: resourceUrl, authorization_servers: [...issuers], bearer_methods_supported: ["header"], scopes_supported: [] });
      return;
    }

    // 2. method
    if (req.method !== "POST") {
      refuseEarly(res, 405, "method", { Allow: "POST" });
      return;
    }

    const aborter = new AbortController();
    // The in-flight slot is taken after authentication (F1) and held until the response has closed
    // AND any handler it started has settled, so a timed-out or abandoned handler still counts (F3).
    let slotHeld = false;
    let responseClosed = false;
    let handlerSettled = true;
    // Known once authenticated, so a transport-level error after that names the caller too.
    let principalId: string | undefined;
    const release = (): void => {
      if (slotHeld && responseClosed && handlerSettled) {
        slotHeld = false;
        inFlight--;
      }
    };
    res.once("close", () => {
      responseClosed = true;
      if (!res.writableFinished) aborter.abort(new Error("client disconnected"));
      release();
    });

    try {
      // 3. Host, Origin
      if (!hostOk) throw refusal(403, INVALID_REQUEST, "Forbidden: Host is not allowed", "host-not-allowed");
      if (!originOk) throw refusal(403, INVALID_REQUEST, "Forbidden: Origin is not allowed", "origin-not-allowed");

      // 4. auth: one Authorization header at most, then the verifier (F10).
      if ((req.headersDistinct.authorization?.length ?? 0) > 1) throw refusal(400, INVALID_REQUEST, "Authorization is sent more than once", "duplicate-authorization");
      // RFC 6750: the token travels in the header only here. One offered in the query or a form
      // body as well is a second method, a malformed request, and it is never read.
      if (tokenElsewhere(target, req.headersDistinct["content-type"])) {
        audit("auth-refused", { reason: "token-elsewhere" });
        throw audited(new Refusal(400, INVALID_REQUEST, "The access token is accepted in the Authorization header only", undefined, { "WWW-Authenticate": `${challenge()["WWW-Authenticate"] ?? ""}, error="invalid_request"` }));
      }
      const principal = await authenticate(req);
      principalId = principal.id;

      // 5. capacity
      if (inFlight >= limits.maxInFlight) throw refusal(503, INTERNAL_ERROR, "The server is at capacity; retry later", "capacity", undefined, { "Retry-After": "1" });
      inFlight++;
      slotHeld = true;
      if (responseClosed) release();

      // 6. Accept, Content-Type, codings (F10, F11)
      if (!acceptsJson(req.headers.accept)) throw refusal(406, INVALID_REQUEST, "Not Acceptable: this server responds with application/json", "not-acceptable");
      const contentTypes = req.headersDistinct["content-type"] ?? [];
      if (contentTypes.length !== 1 || !isJsonContentType(contentTypes[0])) throw refusal(415, INVALID_REQUEST, "Unsupported Media Type: send application/json", "content-type");
      const coding = req.headers["content-encoding"];
      if (coding !== undefined && coding.trim().toLowerCase() !== "identity") throw refusal(415, INVALID_REQUEST, "Unsupported Media Type: content codings are not accepted", "content-coding");
      const te = req.headers["transfer-encoding"];
      if (te !== undefined && te.trim().toLowerCase() !== "chunked") throw refusal(400, INVALID_REQUEST, "Only the chunked transfer coding is accepted", "transfer-coding", undefined, { Connection: "close" });

      // 7. body; 8. framing
      const parsed = parseBody(await readBody(req, limits.maxBodyBytes), limits);
      let classified: ReturnType<typeof classify>;
      try {
        classified = classify(parsed);
      } catch (err) {
        if (err instanceof Refusal) REASONS.set(err, "framing");
        throw err;
      }

      // 9, 10: era, headers, dispatch
      const ctx: DispatchContext = {
        headers: req.headersDistinct,
        principal,
        registry: options.registry,
        limits,
        config,
        serverInfo: options.serverInfo,
        requestStateKey: options.requestStateKey,
        signal: aborter.signal,
        now,
        // Every call-scoped event carries the caller (CSR-WO-1003 §1.7), including a containment
        // refusal that fires after the handler has returned.
        audit: (event, fields) => {
          audit(event, { ...fields, principal: principal.id });
        },
        trackHandler: (running) => {
          handlerSettled = false;
          const settled = (): void => {
            handlerSettled = true;
            release();
          };
          running.then(settled, settled);
        },
      };
      const outcome = await dispatch(classified, ctx);
      if (outcome.kind === "accepted") send(res, 202, undefined);
      else if (outcome.kind === "refused") refuse(res, outcome.refusal, outcome.id);
      else send(res, 200, outcome.body);
    } catch (err) {
      if (err instanceof Refusal) {
        if (!AUDITED.has(err)) audit("http-refused", { status: err.status, reason: REASONS.get(err) ?? "refused", ...(principalId === undefined ? {} : { principal: principalId }) });
        refuse(res, err);
      } else {
        audit("transport-error", { reason: err instanceof Error ? err.name : "unknown", ...(principalId === undefined ? {} : { principal: principalId }) });
        refuse(res, new Refusal(500, INTERNAL_ERROR, "Internal error"));
      }
    }
  };

  const server: Server = createServer({ requestTimeout: limits.requestTimeoutMs }, (req, res) => {
    handle(req, res).catch(() => {
      audit("transport-error", { reason: "unhandled" });
      if (!res.headersSent) send(res, 500, undefined);
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, config.host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (err) {
    // A server that never started still owns its pool.
    await options.validationPool?.close();
    throw err;
  }
  const { port } = server.address() as AddressInfo;
  const authority = `${config.host.includes(":") ? `[${config.host}]` : config.host}:${String(port)}`;
  allowedHosts = (config.allowedHosts.length > 0 ? config.allowedHosts : [authority, `localhost:${String(port)}`]).map((h) => h.toLowerCase());
  allowedOrigins = (config.allowedOrigins.length > 0 ? config.allowedOrigins : [`http://${authority}`, `http://localhost:${String(port)}`]).map((o) => o.toLowerCase());
  resourceUrl = config.resourceUrl !== "" ? config.resourceUrl : `http://${authority}${config.endpointPath}`;

  return {
    port,
    url: `http://${authority}${config.endpointPath}`,
    config,
    inFlight: () => inFlight,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      await options.validationPool?.close();
    },
  };
}
