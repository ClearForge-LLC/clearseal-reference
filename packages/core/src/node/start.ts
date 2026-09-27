// The core owns node assembly (CSR-WO-1007 §1.1; northstar N1, N2). startNode is the only public
// path from an edition's definitions to a serving node: it reads the approved manifest file, builds
// the pin gate, the admission and the PinnedRegistry itself, and starts the transport. An edition
// hands it two values (its definitions and its configuration schema) and assembles nothing: the gate,
// the registry, the verifier, the validation pool and the transport are the core's (architecture §4
// *Core ↔ edition*).
//
// The operator names the manifest (CSR-WO-1007a §1.1): CLEARSEAL_MANIFEST, from the environment, is
// the only source of the manifest's path. The trust root for "what is approved" is the operator, never
// the edition being approved, so nothing an edition exports can choose it; a hostile edition's
// definitions fail to hash against the operator's manifest and are refused at start. The file is read
// once, and the SHA-256 in the manifest-loaded audit line is of the same bytes the gate parses.
//
// Configuration is read here, from the environment, as data with a schema (architecture §3.1): the
// core's own settings (PIN_STRICT, EXEC_TOOLS_FORBIDDEN, AUTH_*, CLEARSEAL_REQUEST_STATE_KEY) by their
// own readers, and the edition's variables through its configSchema. The schema names the variables'
// prefix ("x-clearseal-env-prefix") and which of them carries each transport setting
// ("x-clearseal-setting": "host", "port" or "resource-url"). A value outside the schema, an unknown
// variable with the edition's prefix included, refuses start (N4).

import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PinGate } from "../pinning/gate.ts";
import { ManifestError, type PinnableTool } from "../pinning/manifest.ts";
import { PinnedRegistry } from "../pinning/registry.ts";
import { DEFAULT_LIMITS } from "../transport/config.ts";
import { requestStateKeyFromEnv } from "../transport/request-state.ts";
import { compileSchema } from "../transport/schema.ts";
import { ValidationPool } from "../transport/schema-pool.ts";
import { renderAuditLine, type RunningTransport, startTransport } from "../transport/server.ts";
import { auditFromEnv, openAuditStore } from "../audit/config.ts";

/** What an edition hands the core: nothing else. Not the manifest: the operator names it. */
export interface Edition {
  /** The edition's tools, each admitted only if the operator's manifest pins it. */
  readonly definitions: readonly PinnableTool[];
  /** The edition's configuration schema (JSON Schema 2020-12), with the annotations above. */
  readonly configSchema: Readonly<Record<string, unknown>>;
}

/** The two keys an edition passes. Any other key, a manifest path above all, refuses start. */
const EDITION_KEYS: readonly string[] = ["definitions", "configSchema"];

/** Environment-variable prefixes that are the core's own: an edition's schema may not claim them. */
const CORE_PREFIXES: readonly string[] = ["CLEARSEAL_", "AUTH_", "PIN_", "EXEC_"];

export interface StartNodeOptions {
  /** The audit seam; defaults to the core's line on stderr. For the core's callers and tests: an
   *  edition's bin/ passes the three values and nothing else. */
  audit?: (event: string, fields: Record<string, string | number>) => void;
}

/** A node that refuses to start for its configuration or its edition's shape (N4). */
export class NodeStartError extends Error {
  override name = "NodeStartError";
}

/** The identity every node reports: the core's, not the edition's, so an edition cannot claim one. */
const CORE_VERSION: unknown = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: unknown }).version;
const SERVER_INFO: Readonly<{ name: string; version: string }> = Object.freeze({
  name: "clearseal-node",
  version: typeof CORE_VERSION === "string" ? CORE_VERSION : "0.0.0",
});

const SETTINGS = ["host", "port", "resource-url"] as const;
type Setting = (typeof SETTINGS)[number];

/** The manifest as read: the path opened, and its bytes, read once from one descriptor. */
export interface ManifestFile {
  readonly path: string;
  readonly bytes: Buffer;
}

/**
 * The approved manifest's bytes: read once, from a regular file. The path must be absolute, or a
 * `file:` URL; anything else (a relative path, a data or http URL) refuses start. On POSIX the open
 * carries O_NOFOLLOW (a link at the leaf is refused by the kernel, in the open itself) and
 * O_NONBLOCK (a FIFO cannot make it wait); the descriptor is then fstat-ed, and anything but a
 * regular file refuses start; and a link anywhere on the way refuses start (on Linux, from the
 * descriptor's own path, so a swap between the check and the read is caught). The text is read from that descriptor, so what was checked is what is
 * read. On Windows there is no O_NOFOLLOW: a link at the leaf is refused by an lstat before the
 * open, and a link swapped in between the two is followed (the edition's OS cage, and the file's
 * ownership, are the boundary there).
 */
export function readManifestFile(manifestPath: string | URL): ManifestFile {
  let path: string;
  if (manifestPath instanceof URL) {
    if (manifestPath.protocol !== "file:") throw new ManifestError(`the manifest path is a ${manifestPath.protocol} URL: a node reads its committed manifest from a file`);
    path = fileURLToPath(manifestPath);
  } else if (typeof manifestPath === "string" && isAbsolute(manifestPath)) {
    path = manifestPath;
  } else {
    throw new ManifestError("the manifest path must be absolute, or a file: URL");
  }
  const win = process.platform === "win32";
  if (win) {
    let link = false;
    try {
      link = lstatSync(path).isSymbolicLink();
    } catch {
      // The open below reports it.
    }
    if (link) throw new ManifestError("the manifest is a symbolic link: a node reads its committed manifest from a regular file");
  }
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | (win ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK));
  } catch (err) {
    const code = err instanceof Error && "code" in err ? String(err.code) : "error";
    throw new ManifestError(`the manifest cannot be read (${code}): a node without a manifest does not start`, { cause: err });
  }
  try {
    if (!fstatSync(fd).isFile()) throw new ManifestError("the manifest is not a regular file: a node reads its committed manifest from a regular file");
    // No link anywhere on the way, not only at the leaf: the file opened must be the file at the path
    // named. On Linux the descriptor's own path is read (so a directory swapped for a link between
    // the name and the open is caught too); on the other POSIX systems the path is resolved.
    if (!win) {
      let real: string | undefined;
      try {
        real = realpathSync(process.platform === "linux" ? `/proc/self/fd/${String(fd)}` : path);
      } catch {
        real = undefined;
      }
      if (real !== resolve(path)) throw new ManifestError("the manifest's path passes through a symbolic link: a node reads its committed manifest from a path with no link on the way");
    }
    return { path: resolve(path), bytes: readFileSync(fd) };
  } finally {
    closeSync(fd);
  }
}

/** The transport settings from the edition's variables, validated by its schema. */
export function readEditionConfig(schema: Readonly<Record<string, unknown>>, env: NodeJS.ProcessEnv): { host: string; port: number; resourceUrl: string } {
  const prefix = schema["x-clearseal-env-prefix"];
  if (typeof prefix !== "string" || !/^[A-Z][A-Z0-9]*_$/.test(prefix)) throw new NodeStartError('the configuration schema names its variables\' prefix in "x-clearseal-env-prefix" (upper case, ending in _)');
  if (CORE_PREFIXES.includes(prefix)) throw new NodeStartError(`the configuration prefix ${prefix} is the core's own: an edition's variables carry its own prefix`);
  const properties = schema["properties"];
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) throw new NodeStartError("the configuration schema has no properties");
  const roles = new Map<Setting, string>();
  for (const [name, def] of Object.entries(properties as Record<string, unknown>)) {
    if (!name.startsWith(prefix)) throw new NodeStartError(`the configuration variable ${name} does not carry the prefix ${prefix}`);
    const role = typeof def === "object" && def !== null ? (def as Record<string, unknown>)["x-clearseal-setting"] : undefined;
    if (role === undefined) continue;
    if (typeof role !== "string" || !(SETTINGS as readonly string[]).includes(role)) throw new NodeStartError(`${name}: "x-clearseal-setting" is one of ${SETTINGS.join(", ")}`);
    if (roles.has(role as Setting)) throw new NodeStartError(`two variables carry the ${role} setting`);
    roles.set(role as Setting, name);
  }
  const resourceVar = roles.get("resource-url");
  if (resourceVar === undefined) throw new NodeStartError("the configuration schema names no resource-url variable: a node does not start without its protected-resource URL");
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (k.startsWith(prefix) && v !== undefined && v !== "") vars[k] = v;
  const validate = compileSchema(schema);
  if (!validate(vars)) throw new NodeStartError(`the configuration does not match its schema: ${Object.keys(vars).sort().join(", ") || "(none set)"}`);
  /** The variable's value, else its schema's string default. */
  const value = (role: Setting): string | undefined => {
    const name = roles.get(role);
    if (name === undefined) return undefined;
    const def = (properties as Record<string, Record<string, unknown>>)[name]?.["default"];
    return vars[name] ?? (typeof def === "string" ? def : undefined);
  };
  const port = Number(value("port") ?? "0");
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new NodeStartError(`${roles.get("port") ?? "the port"} must be 0 to 65535`);
  return { host: value("host") ?? "127.0.0.1", port, resourceUrl: value("resource-url") ?? "" };
}

/** CLEARSEAL_MANIFEST: the operator's manifest, an absolute path or a `file:` URL. Required. */
export function manifestPathFromEnv(env: NodeJS.ProcessEnv): string | URL {
  const value = env["CLEARSEAL_MANIFEST"];
  if (value === undefined || value === "") throw new NodeStartError("CLEARSEAL_MANIFEST is required: the operator names the approved manifest (an absolute path or a file: URL); a node without one does not start");
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value) || value.startsWith("file:")) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new NodeStartError("CLEARSEAL_MANIFEST is not a valid URL");
    }
    return url;
  }
  return value;
}

/**
 * Starts a node for an edition: its configuration from the environment, the manifest the operator
 * names in CLEARSEAL_MANIFEST, the gate and the registry built here, the transport started. Refuses to
 * start (throws) on a configuration outside the schema, a missing CLEARSEAL_MANIFEST, a manifest that
 * is not a regular file or does not parse, a drifted, unpinned or removed tool under the strict
 * default, missing AUTH_* settings, or a missing or invalid audit configuration (AUDIT_*; the
 * development exception is AUDIT_STORE=seam-only). Writes one manifest-loaded audit row, with the
 * file's path and SHA-256, before the gate admits anything: the first row of the run's chain.
 */
export async function startNode(edition: Edition, options: StartNodeOptions = {}): Promise<RunningTransport> {
  if (typeof edition !== "object" || edition === null || !Array.isArray(edition.definitions) || typeof edition.configSchema !== "object" || edition.configSchema === null) {
    throw new NodeStartError("startNode takes an edition's definitions and configSchema");
  }
  const extra = Reflect.ownKeys(edition).filter((k) => typeof k !== "string" || !EDITION_KEYS.includes(k));
  if (extra.length > 0) throw new NodeStartError(`startNode takes an edition's definitions and configSchema, nothing else (not ${extra.map(String).join(", ")}): the operator names the manifest in CLEARSEAL_MANIFEST`);
  const config = readEditionConfig(edition.configSchema, process.env);
  // The audit store is configured before anything else is read, so a node never starts unrecorded
  // (CSR-WO-2002 §1.5; audit/RULES.md AU-21, AU-22).
  const auditConfig = auditFromEnv(process.env);
  const file = readManifestFile(manifestPathFromEnv(process.env));
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const store = openAuditStore(auditConfig);
  const stderr = (event: string, fields: Record<string, string | number>): void => {
    console.error(renderAuditLine(event, fields));
  };
  let running: RunningTransport | undefined;
  let stopping = false;
  // With a store, every row goes to it, and options.audit (the core's tests) observes. Without one
  // (seam-only), options.audit replaces the stderr line, as before -2002. A row that cannot be written
  // stops the node: before start it refuses start; after, the transport is closed, so the node never
  // serves unrecorded (N4).
  const audit = (event: string, fields: Record<string, string | number>): void => {
    if (store === undefined) {
      (options.audit ?? stderr)(event, fields);
      return;
    }
    try {
      store.append(event, fields);
    } catch (err) {
      stderr("audit-store-failed", { event, reason: err instanceof Error ? err.name : "error" });
      if (running === undefined) throw err;
      if (!stopping) {
        stopping = true;
        void running.close();
      }
      return;
    }
    options.audit?.(event, fields);
  };
  try {
    if (auditConfig.mode === "seam-only") audit("audit-unanchored", { mode: "seam-only" });
    audit("manifest-loaded", { path: file.path, sha256 });
    const gate = PinGate.load(file.bytes.toString("utf8"));
    const key = requestStateKeyFromEnv();
    const limits = DEFAULT_LIMITS;
    const pool = new ValidationPool({ workers: limits.validationWorkers, timeoutMs: limits.validationTimeoutMs });
    let registry: PinnedRegistry;
    try {
      registry = new PinnedRegistry(gate.admit(edition.definitions), { compile: pool.compile, limits });
    } catch (err) {
      await pool.close();
      throw err;
    }
    const t = await startTransport({
      registry,
      serverInfo: SERVER_INFO,
      config: { host: config.host, port: config.port, resourceUrl: config.resourceUrl },
      validationPool: pool,
      ...(key === undefined ? {} : { requestStateKey: key }),
      audit,
      ...(store === undefined ? {} : { argumentDigest: store.digester.args }),
    });
    // Closing the node closes the store after the transport: its last rows, then a final checkpoint.
    running = Object.freeze({
      port: t.port,
      url: t.url,
      config: t.config,
      inFlight: () => t.inFlight(),
      close: async (): Promise<void> => {
        try {
          await t.close();
        } finally {
          await store?.close();
        }
      },
    });
    return running;
  } catch (err) {
    await store?.close();
    throw err;
  }
}
