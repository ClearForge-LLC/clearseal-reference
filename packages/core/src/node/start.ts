// The core owns node assembly (CSR-WO-1007 §1.1; northstar N1, N2). startNode is the only public
// path from an edition's definitions to a serving node: it reads the edition's committed manifest
// file, builds the pin gate, the admission and the PinnedRegistry itself, and starts the transport.
// An edition hands it three values (its definitions, its manifest's path and its configuration
// schema) and assembles nothing: the gate, the registry, the verifier, the validation pool and the
// transport are the core's (architecture §4 *Core ↔ edition*).
//
// Configuration is read here, from the environment, as data with a schema (architecture §3.1): the
// core's own settings (PIN_STRICT, EXEC_TOOLS_FORBIDDEN, AUTH_*, CLEARSEAL_REQUEST_STATE_KEY) by their
// own readers, and the edition's variables through its configSchema. The schema names the variables'
// prefix ("x-clearseal-env-prefix") and which of them carries each transport setting
// ("x-clearseal-setting": "host", "port" or "resource-url"). A value outside the schema, an unknown
// variable with the edition's prefix included, refuses start (N4).

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
import { type RunningTransport, startTransport } from "../transport/server.ts";

/** What an edition hands the core: nothing else. */
export interface Edition {
  /** The edition's tools, each admitted only if the committed manifest pins it. */
  readonly definitions: readonly PinnableTool[];
  /** The committed manifest: an absolute path, or a `file:` URL, to a regular file. */
  readonly manifestPath: string | URL;
  /** The edition's configuration schema (JSON Schema 2020-12), with the annotations above. */
  readonly configSchema: Readonly<Record<string, unknown>>;
}

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

/**
 * The committed manifest's text: read once, from a regular file. The path must be absolute, or a
 * `file:` URL; anything else (a relative path, a data or http URL) refuses start. On POSIX the open
 * carries O_NOFOLLOW (a link at the leaf is refused by the kernel, in the open itself) and
 * O_NONBLOCK (a FIFO cannot make it wait); the descriptor is then fstat-ed, and anything but a
 * regular file refuses start; and a link anywhere on the way refuses start (on Linux, from the
 * descriptor's own path, so a swap between the check and the read is caught). The text is read from that descriptor, so what was checked is what is
 * read. On Windows there is no O_NOFOLLOW: a link at the leaf is refused by an lstat before the
 * open, and a link swapped in between the two is followed (the edition's OS cage, and the file's
 * ownership, are the boundary there).
 */
export function readManifestFile(manifestPath: string | URL): string {
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
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

/** The transport settings from the edition's variables, validated by its schema. */
export function readEditionConfig(schema: Readonly<Record<string, unknown>>, env: NodeJS.ProcessEnv): { host: string; port: number; resourceUrl: string } {
  const prefix = schema["x-clearseal-env-prefix"];
  if (typeof prefix !== "string" || !/^[A-Z][A-Z0-9]*_$/.test(prefix)) throw new NodeStartError('the configuration schema names its variables\' prefix in "x-clearseal-env-prefix" (upper case, ending in _)');
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

/**
 * Starts a node for an edition: its configuration from the environment, its committed manifest
 * from the file it names, the gate and the registry built here, the transport started. Refuses to
 * start (throws) on a configuration outside the schema, a manifest that is not a regular file or
 * does not parse, a drifted, unpinned or removed tool under the strict default, or missing AUTH_*
 * settings.
 */
export async function startNode(edition: Edition, options: StartNodeOptions = {}): Promise<RunningTransport> {
  if (typeof edition !== "object" || edition === null || !Array.isArray(edition.definitions) || typeof edition.configSchema !== "object" || edition.configSchema === null) {
    throw new NodeStartError("startNode takes an edition's definitions, manifestPath and configSchema");
  }
  const config = readEditionConfig(edition.configSchema, process.env);
  const text = readManifestFile(edition.manifestPath);
  const gate = PinGate.load(text);
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
  return startTransport({
    registry,
    serverInfo: SERVER_INFO,
    config: { host: config.host, port: config.port, resourceUrl: config.resourceUrl },
    validationPool: pool,
    ...(key === undefined ? {} : { requestStateKey: key }),
    ...(options.audit === undefined ? {} : { audit: options.audit }),
  });
}
