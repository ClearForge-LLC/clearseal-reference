// The settings snapshot (CSR-WO-1007b §1.1, §1.2; northstar N2; architecture §4 *Core ↔ edition*).
//
// Why a snapshot, and why it is taken first. Every setting that decides what a node serves is read
// here, once, into a frozen value. No node path reads `process.env` after this: the readers below keep a
// `= process.env` default for a caller outside this step, and what holds that dormant is not the source's
// shape but two tests — one rewrites the environment after the capture and shows every setting and the
// running node's own configuration unchanged, the other keeps an inventory of every read in the core's
// source and fails until a new one is named (test/node/cli.test.ts). The node's entry
// (`node/cli.ts`) takes this snapshot **before** it imports the edition, so an edition's module-load
// code cannot change a setting that has already been read. That ordering is the control: `-1007a` made
// the operator name the manifest, but the read still happened when `startNode` was called, after the
// edition's own `bin/` had imported the edition, so load-time code that assigned
// `process.env.CLEARSEAL_MANIFEST` chose the manifest that approved it (the H1 re-test's H-1).
//
// What this is not: a sandbox. An edition that patches the process's built-ins at load (hashing, JSON,
// prototypes) is hostile code already running inside the node, out of scope by architecture §4 and
// named in the P2 hardening work order. The snapshot closes the ordering hole, not that one.

import { type AuditMode, auditFromEnv } from "../audit/config.ts";
import { type JwtVerifier, jwtVerifierFromEnv } from "../auth/verifier.ts";
import { execToolsForbiddenFromEnv, pinStrictFromEnv } from "../pinning/registry.ts";
import { requestStateKeyFromEnv } from "../transport/request-state.ts";

/** A node that refuses to start for its configuration or its edition's shape (N4). */
export class NodeStartError extends Error {
  override name = "NodeStartError";
}

/** A node that refuses to start for a setting in the snapshot: a NodeStartError, named for its step. */
export class SettingsError extends NodeStartError {
  override name = "SettingsError";
}

/** The edition a node serves: a package name, resolved from the operator's own install. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/**
 * Every setting the node uses, read once and frozen. `env` is the frozen copy the edition's own
 * variables are read from later (through its `configSchema`), so even those come from the snapshot
 * and not from a `process.env` an edition may since have written.
 */
export interface Settings {
  /** A frozen copy of the environment as it was when the snapshot was taken. */
  readonly env: Readonly<Record<string, string>>;
  /** CLEARSEAL_EDITION: the package whose entry the node imports. */
  readonly editionName: string;
  /** CLEARSEAL_MANIFEST: the operator's approved manifest, an absolute path or a `file:` URL. */
  readonly manifestPath: string | URL;
  /** PIN_STRICT. */
  readonly pinStrict: boolean;
  /** EXEC_TOOLS_FORBIDDEN. */
  readonly execToolsForbidden: boolean;
  /** CLEARSEAL_REQUEST_STATE_KEY, as copied bytes; undefined when unset. */
  readonly requestStateKey: Uint8Array | undefined;
  /** The AUDIT_* configuration, with its key files already read and checked. */
  readonly audit: AuditMode;
  /** The AUTH_* verifier, constructed (and its CA file read) here. */
  readonly verifier: JwtVerifier;
}

/** CLEARSEAL_MANIFEST as a path or a `file:` URL. Required: the operator names the manifest. */
function manifestPathFrom(env: Readonly<Record<string, string>>): string | URL {
  const value = env["CLEARSEAL_MANIFEST"];
  if (value === undefined || value === "") throw new SettingsError("CLEARSEAL_MANIFEST is required: the operator names the approved manifest (an absolute path or a file: URL); a node without one does not start");
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value) || value.startsWith("file:")) {
    try {
      return new URL(value);
    } catch {
      throw new SettingsError("CLEARSEAL_MANIFEST is not a valid URL");
    }
  }
  return value;
}

/** CLEARSEAL_EDITION: a package name, never a path. A path would let the edition choose what loads. */
function editionNameFrom(env: Readonly<Record<string, string>>): string {
  const value = env["CLEARSEAL_EDITION"];
  if (value === undefined || value === "") throw new SettingsError("CLEARSEAL_EDITION is required: the package name of the edition this node serves");
  if (!PACKAGE_NAME.test(value)) throw new SettingsError(`CLEARSEAL_EDITION must be a package name, not a path or a URL (got ${JSON.stringify(value)}): the operator's install decides what it resolves to`);
  return value;
}

/**
 * Takes the snapshot. Every value the node decides on is read from `env` here and nowhere else, so
 * this is the one function whose caller's timing matters: the entry calls it before it imports any
 * edition code. Throws (refusing start) on any missing or invalid setting.
 */
export function captureSettings(env: NodeJS.ProcessEnv): Settings {
  // A frozen copy of our own: the caller's object can be written afterwards without changing this.
  const copy: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [k, v] of Object.entries(env)) if (typeof v === "string") copy[k] = v;
  const frozen = Object.freeze(copy);
  const key = requestStateKeyFromEnv(frozen);
  return Object.freeze({
    env: frozen,
    editionName: editionNameFrom(frozen),
    manifestPath: manifestPathFrom(frozen),
    pinStrict: pinStrictFromEnv(frozen),
    execToolsForbidden: execToolsForbiddenFromEnv(frozen),
    requestStateKey: key === undefined ? undefined : Object.freeze(Uint8Array.from(key)),
    audit: auditFromEnv(frozen),
    verifier: jwtVerifierFromEnv(frozen),
  });
}
