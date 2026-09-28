// The core owns node assembly (CSR-WO-1007 §1.1; northstar N1, N2). startNode is the only public
// path from an edition's definitions to a serving node: it reads the approved manifest file, builds
// the pin gate, the admission and the PinnedRegistry itself, and starts the transport. An edition
// hands it two values (its definitions and its configuration schema) and assembles nothing: the gate,
// the registry, the verifier, the validation pool and the transport are the core's (architecture §4
// *Core ↔ edition*).
//
// The operator names the manifest (CSR-WO-1007a §1.1): CLEARSEAL_MANIFEST, from the environment, is
// the only source of the manifest's path, and it is read into the settings snapshot before any edition
// module loads (CSR-WO-1007b; node/settings.ts, node/cli.ts). Nothing here reads `process.env`: every
// setting arrives in the snapshot, the edition's own variables included. The trust root for "what is approved" is the operator, never
// the edition being approved, so nothing an edition exports can choose it; a hostile edition's
// definitions fail to hash against the operator's manifest and are refused at start. The file is read
// once, and the SHA-256 in the manifest-loaded audit line is of the same bytes the gate parses.
//
// Configuration is data with a schema (architecture §3.1): the core's own settings (PIN_STRICT,
// EXEC_TOOLS_FORBIDDEN, AUTH_*, AUDIT_*, CLEARSEAL_REQUEST_STATE_KEY) are read by the snapshot, and the
// edition's variables from the snapshot's frozen copy of the environment, through its configSchema. The schema names the variables'
// prefix ("x-clearseal-env-prefix") and which of them carries each transport setting
// ("x-clearseal-setting": "host", "port" or "resource-url"). A value outside the schema, an unknown
// variable with the edition's prefix included, refuses start (N4).

import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PinGate } from "../pinning/gate.ts";
import { ManifestError, type PinnableTool } from "../pinning/manifest.ts";
import { PinnedRegistry } from "../pinning/registry.ts";
import { DEFAULT_LIMITS } from "../transport/config.ts";
import { compileSchema } from "../transport/schema.ts";
import { ValidationPool } from "../transport/schema-pool.ts";
import { renderAuditLine, type RunningTransport, startTransport } from "../transport/server.ts";
import { openAuditStore } from "../audit/config.ts";
import { captureSettings, NodeStartError, type Settings } from "./settings.ts";

export { NodeStartError, SettingsError, type Settings } from "./settings.ts";

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
  /** The audit seam; observes every row when a store is configured, and replaces the stderr line when
   *  one is not. For the core's own tests: a node's entry passes none. */
  audit?: (event: string, fields: Record<string, string | number>) => void;
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
 * Why the file a descriptor holds is not the file at the path it was opened through: two different
 * faults, told apart rather than guessed (CSR-WO-1007b §1.6). If the path still resolves to the file
 * that was opened, the difference is a link on the way. If it does not, the file was renamed, replaced
 * or removed between the open and the check, and saying "symbolic link" would send the operator looking
 * for something that is not there.
 */
export function manifestPathFault(real: string | undefined, path: string): string {
  let resolved: string | undefined;
  try {
    resolved = realpathSync(resolve(path));
  } catch {
    resolved = undefined;
  }
  if (resolved !== undefined && resolved === real) return "the manifest's path passes through a symbolic link: a node reads its committed manifest from a path with no link on the way";
  return "the manifest file changed while it was being opened (it was renamed, replaced or removed): a node reads one file, once";
}

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
      if (real !== resolve(path)) throw new ManifestError(manifestPathFault(real, path));
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

/**
 * A node prepared to start: the settings snapshot, the manifest read and parsed, the audit store open,
 * the audit seam ready. Everything here happens **before** the edition is imported (CSR-WO-1007b §1.1),
 * so no edition code can change a setting, a manifest or a store that has already been read.
 */
export class PreparedNode {
  readonly settings: Settings;
  /** The manifest's resolved path and the SHA-256 of the bytes the gate parsed. */
  readonly manifest: Readonly<{ path: string; sha256: string }>;
  readonly gate: PinGate;
  readonly audit: (event: string, fields: Record<string, string | number>) => void;
  readonly #store: ReturnType<typeof openAuditStore>;
  #running: RunningTransport | undefined;
  #stopping = false;

  private constructor(settings: Settings, manifest: Readonly<{ path: string; sha256: string }>, gate: PinGate, store: ReturnType<typeof openAuditStore>, audit: (event: string, fields: Record<string, string | number>) => void) {
    this.settings = settings;
    this.manifest = manifest;
    this.gate = gate;
    this.#store = store;
    this.audit = audit;
  }

  /** The store, for the transport's argument digester; undefined in the seam-only development mode. */
  get store(): ReturnType<typeof openAuditStore> {
    return this.#store;
  }

  /** Records the transport this node is serving on, so a failed audit row can close it. */
  hold(t: RunningTransport): RunningTransport {
    // Closing the node closes the store after the transport: its last rows, then a final checkpoint.
    this.#running = Object.freeze({
      port: t.port,
      url: t.url,
      config: t.config,
      inFlight: () => t.inFlight(),
      close: async (): Promise<void> => {
        try {
          await t.close();
        } finally {
          await this.#store?.close();
        }
      },
    });
    return this.#running;
  }

  /** Closes the store; for a start that failed after prepare. */
  async close(): Promise<void> {
    await this.#store?.close();
  }

  /**
   * Reads the manifest the snapshot names, opens the audit store, and parses the manifest. The
   * manifest-loaded row is written only after the parse succeeds (CSR-WO-1007b §1.6); a manifest that
   * is read but refused writes manifest-refused with the same path and hash, and start is refused.
   */
  static prepare(settings: Settings, options: StartNodeOptions = {}): PreparedNode {
    const file = readManifestFile(settings.manifestPath);
    const sha256 = createHash("sha256").update(file.bytes).digest("hex");
    // The log and the anchor are never the manifest (nor the key files: the store checks those).
    const manifestStat = statSync(file.path, { bigint: true });
    const store = openAuditStore(settings.audit, undefined, [{ setting: "CLEARSEAL_MANIFEST", identity: `${String(manifestStat.dev)}:${String(manifestStat.ino)}` }]);
    const stderr = (event: string, fields: Record<string, string | number>): void => {
      console.error(renderAuditLine(event, fields));
    };
    const prepared = { value: undefined as PreparedNode | undefined };
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
        const self = prepared.value;
        if (self === undefined || self.#running === undefined) throw err;
        if (!self.#stopping) {
          self.#stopping = true;
          void self.#running.close();
        }
        return;
      }
      options.audit?.(event, fields);
    };
    try {
      if (settings.audit.mode === "seam-only") audit("audit-unanchored", { mode: "seam-only" });
      let gate: PinGate;
      try {
        gate = PinGate.load(file.bytes.toString("utf8"));
      } catch (err) {
        // Read, hashed, and refused: the operator sees which file was rejected, and its hash.
        audit("manifest-refused", { path: file.path, sha256, reason: err instanceof Error ? err.name : "error" });
        throw err;
      }
      audit("manifest-loaded", { path: file.path, sha256 });
      const node = new PreparedNode(settings, Object.freeze({ path: file.path, sha256 }), gate, store, audit);
      prepared.value = node;
      return node;
    } catch (err) {
      void store?.close();
      throw err;
    }
  }
}

/**
 * Starts a node for an edition, from a prepared node: the edition's two values, the snapshot's
 * settings, the manifest already read and parsed. Refuses to start (throws) on a configuration outside
 * the edition's schema, or a drifted, unpinned or removed tool under the strict default.
 */
export async function startNode(edition: Edition, prepared: PreparedNode): Promise<RunningTransport> {
  if (typeof edition !== "object" || edition === null || !Array.isArray(edition.definitions) || typeof edition.configSchema !== "object" || edition.configSchema === null) {
    throw new NodeStartError("startNode takes an edition's definitions and configSchema");
  }
  const extra = Reflect.ownKeys(edition).filter((k) => typeof k !== "string" || !EDITION_KEYS.includes(k));
  if (extra.length > 0) throw new NodeStartError(`startNode takes an edition's definitions and configSchema, nothing else (not ${extra.map(String).join(", ")}): the operator names the manifest in CLEARSEAL_MANIFEST`);
  const { settings } = prepared;
  // The edition's own variables, from the snapshot's frozen copy: never from process.env (§1.2).
  const config = readEditionConfig(edition.configSchema, settings.env);
  const limits = DEFAULT_LIMITS;
  const pool = new ValidationPool({ workers: limits.validationWorkers, timeoutMs: limits.validationTimeoutMs });
  let registry: PinnedRegistry;
  try {
    registry = new PinnedRegistry(prepared.gate.admit(edition.definitions), { compile: pool.compile, limits, strict: settings.pinStrict, execToolsForbidden: settings.execToolsForbidden });
  } catch (err) {
    await pool.close();
    throw err;
  }
  const key = settings.requestStateKey;
  return prepared.hold(
    await startTransport({
      registry,
      serverInfo: SERVER_INFO,
      config: { host: config.host, port: config.port, resourceUrl: config.resourceUrl },
      validationPool: pool,
      verifier: settings.verifier,
      ...(key === undefined ? {} : { requestStateKey: key }),
      audit: prepared.audit,
      ...(prepared.store === undefined ? {} : { argumentDigest: prepared.store.digester.args }),
      // The snapshot's settings for the two CSR-WO-2007 controls, never a later read.
      rateLimit: settings.rateLimit,
      tripwire: settings.tripwire,
    }),
  );
}

/**
 * Captures the settings, prepares the node and starts it, in that order, for a caller that already
 * holds the edition's values: the core's own tests. A deployed node uses the entry (node/cli.ts), which
 * takes the snapshot before it imports the edition — the ordering this function cannot prove.
 */
export async function startNodeFromEnv(edition: Edition, env: NodeJS.ProcessEnv = process.env, options: StartNodeOptions = {}): Promise<RunningTransport> {
  const prepared = PreparedNode.prepare(captureSettings(env), options);
  try {
    return await startNode(edition, prepared);
  } catch (err) {
    await prepared.close();
    throw err;
  }
}
