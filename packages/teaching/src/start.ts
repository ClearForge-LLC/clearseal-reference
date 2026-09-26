// The deploy scaffold (CSR-WO-1004 §1.1): read the configuration, admit the edition's definitions
// through the core's pin gate, and start the core's transport. ClearSeal clauses: the only
// registration path is the core's (N1, N2: verify-before-register, the strict default); the verifier,
// the gate and the cage are the core's, never the edition's (architecture §4 *Core ↔ edition*).

import { DEFAULT_LIMITS, loadPinnedRegistry, requestStateKeyFromEnv, type RunningTransport, startTransport, ValidationPool } from "@clearseal/core";

import { readConfig } from "./config.ts";
import { DEFAULT_NOTES_ROOT, toolsFor } from "./notes.ts";

/** The committed, approved manifest (pins/teaching.json at the repository root). */
export const MANIFEST_URL = new URL("../../../pins/teaching.json", import.meta.url);

export interface StartOptions {
  /** The audit seam; defaults to the core's line on stderr. */
  audit?: (event: string, fields: Record<string, string | number>) => void;
}

/** Starts a teaching node from the environment. Refuses to start (throws) on a configuration
 *  outside its schema, a missing or unparseable manifest, a drifted or unpinned tool under the
 *  strict default, or missing AUTH_* settings. */
export async function start(options: StartOptions = {}): Promise<RunningTransport> {
  const config = readConfig(process.env);
  const root = config.notesRoot ?? DEFAULT_NOTES_ROOT;
  const limits = DEFAULT_LIMITS;
  const pool = new ValidationPool({ workers: limits.validationWorkers, timeoutMs: limits.validationTimeoutMs });
  let registry: ReturnType<typeof loadPinnedRegistry>;
  try {
    registry = loadPinnedRegistry(config.manifest ?? MANIFEST_URL, toolsFor(root), { compile: pool.compile, limits });
  } catch (err) {
    await pool.close();
    throw err;
  }
  const key = requestStateKeyFromEnv();
  return startTransport({
    registry,
    serverInfo: { name: "@clearseal/teaching", version: "0.0.0" },
    config: { host: config.host, port: config.port, resourceUrl: config.resourceUrl },
    validationPool: pool,
    ...(key === undefined ? {} : { requestStateKey: key }),
    ...(options.audit === undefined ? {} : { audit: options.audit }),
  });
}
