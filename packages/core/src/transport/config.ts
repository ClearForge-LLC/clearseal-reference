// Transport configuration. Every limit the architecture requires (§5, *Transport hardening* and
// *Runtime validation and output caps*) is here by name, with its default. Nothing is inherited
// from a library default. Configuration is validated at startup: an invalid value refuses to
// start rather than running with a guess (N4).

/** The protocol revisions the transport serves, newest first. Asserted by a test from what
 *  `server/discover` actually answers (WO §1.13), never only from this constant. */
export const MODERN_VERSION = "2026-07-28";
export const LEGACY_VERSION = "2025-11-25";
export const SUPPORTED_VERSIONS: readonly string[] = [MODERN_VERSION, LEGACY_VERSION];

/** The legacy (`initialize`) path is marked for removal at the end of the protocol's deprecation
 *  window. The specification's deprecated-features registry gives no date for `2025-11-25`; this
 *  one was set by CSR-WO-1005 for the architect to confirm (SPEC-MAP D-5). A test fails from this
 *  date, so the path cannot be forgotten. */
export const LEGACY_PATH_REVIEW_BY = "2027-07-28";

export interface Limits {
  /** Request body cap in bytes. Default 1 MiB. Over → 413. */
  maxBodyBytes: number;
  /** Nesting depth of the parsed body. Default 64. Over → 400. */
  maxJsonDepth: number;
  /** Requests being handled at once. Default 32. Over → 503 with Retry-After. */
  maxInFlight: number;
  /** Per-call handler time. Default 30 s. Over → the call ends with a JSON-RPC error. */
  handlerTimeoutMs: number;
  /** Serialized result cap in bytes. Default 256 KiB. Over → the result is not sent. */
  maxResultBytes: number;
  /** A tool's inputSchema: nesting depth and total subschema count, checked at registration. */
  maxSchemaDepth: number;
  maxSchemaNodes: number;
  /** Lifetime of a sealed MRTR requestState. Default 10 min. */
  requestStateTtlMs: number;
  /** Argument validation runs in worker threads under this deadline (F2). Default 2 s, 2 workers. */
  validationTimeoutMs: number;
  validationWorkers: number;
  /** The verifier must answer within this time, or the request is refused 503 (F5). Default 5 s. */
  verifierTimeoutMs: number;
  /** Node's per-request receive deadline (headers and body), replacing its 300 s default. Default 30 s. */
  requestTimeoutMs: number;
}

export const DEFAULT_LIMITS: Readonly<Limits> = {
  maxBodyBytes: 1024 * 1024,
  maxJsonDepth: 64,
  maxInFlight: 32,
  handlerTimeoutMs: 30_000,
  maxResultBytes: 256 * 1024,
  maxSchemaDepth: 32,
  maxSchemaNodes: 2_000,
  requestStateTtlMs: 10 * 60_000,
  validationTimeoutMs: 2_000,
  validationWorkers: 2,
  verifierTimeoutMs: 5_000,
  requestTimeoutMs: 30_000,
};

export interface TransportConfig {
  /** The MCP endpoint path. Default "/mcp". */
  endpointPath: string;
  /** Bind address. Default loopback. */
  host: string;
  /** Port; 0 picks a free one. */
  port: number;
  /** `Host` header values accepted (host[:port], compared case-insensitively). Loopback by default,
   *  derived from the bound port when left empty. */
  allowedHosts: readonly string[];
  /** `Origin` values accepted when the header is present. Loopback by default, derived from the
   *  bound port when left empty. */
  allowedOrigins: readonly string[];
  /** The protected-resource identifier advertised in the 401 challenge and the RFC 9728 document.
   *  Derived from the bound address when left empty. */
  resourceUrl: string;
  /** Authorization servers listed in the RFC 9728 document (-1003 fills this). */
  authorizationServers: readonly string[];
  /** `server/discover` `instructions`. */
  instructions: string;
  /** Caching hints (CA-1): server/discover and tools/list. */
  discoverTtlMs: number;
  toolsListTtlMs: number;
  limits: Limits;
}

export const DEFAULT_CONFIG: Readonly<TransportConfig> = {
  endpointPath: "/mcp",
  host: "127.0.0.1",
  port: 0,
  allowedHosts: [],
  allowedOrigins: [],
  resourceUrl: "",
  authorizationServers: [],
  instructions: "A ClearSeal reference node. Tools are pinned before they are listed.",
  discoverTtlMs: 60_000,
  toolsListTtlMs: 60_000,
  limits: DEFAULT_LIMITS,
};

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Merges and validates. Throws ConfigError on any value that is not what its name says. */
export function resolveConfig(partial: Partial<Omit<TransportConfig, "limits">> & { limits?: Partial<Limits> } = {}): TransportConfig {
  const config: TransportConfig = { ...DEFAULT_CONFIG, ...partial, limits: { ...DEFAULT_LIMITS, ...partial.limits } };
  const positive = (name: string, v: number): void => {
    if (!Number.isSafeInteger(v) || v <= 0) throw new ConfigError(`${name} must be a positive integer`);
  };
  for (const [name, v] of Object.entries(config.limits)) positive(`limits.${name}`, v as number);
  for (const name of ["discoverTtlMs", "toolsListTtlMs"] as const) {
    if (!Number.isSafeInteger(config[name]) || config[name] < 0) throw new ConfigError(`${name} must be an integer >= 0`);
  }
  if (!config.endpointPath.startsWith("/") || config.endpointPath.includes("?")) throw new ConfigError("endpointPath must be an absolute path");
  if (!Number.isSafeInteger(config.port) || config.port < 0 || config.port > 65535) throw new ConfigError("port must be 0–65535");
  // Deeply frozen, over copies of the caller's lists: the running node's config, limits included,
  // cannot change after start, and the caller's own arrays are left as they were (CSR-WO-1006a,
  // -1006 A7).
  return Object.freeze({
    ...config,
    allowedHosts: Object.freeze([...config.allowedHosts]),
    allowedOrigins: Object.freeze([...config.allowedOrigins]),
    authorizationServers: Object.freeze([...config.authorizationServers]),
    limits: Object.freeze({ ...config.limits }),
  });
}
