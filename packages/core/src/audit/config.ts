// The audit configuration (CSR-WO-2002 §1.5; audit/RULES.md AU-21, AU-22). The operator names the
// store; a node without it does not start. The one exception is AUDIT_STORE=seam-only, for
// development: today's stderr line, and a loud audit-unanchored row first.

import { closeSync, readFileSync } from "node:fs";

import { type Digester, ephemeralDigester, KID, keyedDigester } from "./digest.ts";
import { AuditConfigError, openOperatorFile } from "./files.ts";
import { type Signer, signerFromPem } from "./signer.ts";
import { FileAnchor, JsonLinesStore } from "./store.ts";

export { AuditConfigError };

export type AuditMode =
  | { readonly mode: "seam-only" }
  | {
      readonly mode: "store";
      readonly log: string;
      readonly anchor: string;
      readonly digester: Digester;
      readonly signer: Signer;
      readonly checkpointRows: number;
      readonly checkpointMs: number;
    };

/** The defaults, stated: 100 rows or 5 minutes bound the window a truncation can remove unseen. */
export const DEFAULT_CHECKPOINT_ROWS = 100;
export const DEFAULT_CHECKPOINT_SECONDS = 300;

/** Reads a key file: the same file checks as the manifest (AU-21). */
function readKeyFile(setting: string, path: string): string {
  const fd = openOperatorFile(setting, path, false);
  try {
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

function boundedInt(env: NodeJS.ProcessEnv, name: string, fallback: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^[1-9][0-9]{0,5}$/.test(raw) || Number(raw) > max) throw new AuditConfigError(`${name} must be an integer from 1 to ${String(max)}`);
  return Number(raw);
}

/** The audit configuration from the environment. Every missing or invalid setting refuses start,
 *  naming it; files are opened and checked here, so a node never starts on a store it cannot use. */
export function auditFromEnv(env: NodeJS.ProcessEnv): AuditMode {
  const store = env["AUDIT_STORE"];
  if (store === "seam-only") return { mode: "seam-only" };
  if (store !== undefined && store !== "" && store !== "jsonl") throw new AuditConfigError(`AUDIT_STORE is "jsonl" (the default) or "seam-only" (development), not ${JSON.stringify(store)}`);
  const required = ["AUDIT_LOG", "AUDIT_ANCHOR", "AUDIT_DIGEST_KEY_FILE", "AUDIT_DIGEST_KEY_ID", "AUDIT_SIGNING_KEY_FILE", "AUDIT_SIGNING_KEY_ID"];
  const missing = required.filter((k) => env[k] === undefined || env[k] === "");
  if (missing.length > 0) throw new AuditConfigError(`the audit store is not configured (${missing.join(", ")} missing): a node records every refusal and call, or does not start; AUDIT_STORE=seam-only is for development only`);
  const get = (k: string): string => env[k] as string;
  for (const k of ["AUDIT_DIGEST_KEY_ID", "AUDIT_SIGNING_KEY_ID"]) if (!KID.test(get(k))) throw new AuditConfigError(`${k} must match [A-Za-z0-9._-]{1,64}`);
  const digestText = readKeyFile("AUDIT_DIGEST_KEY_FILE", get("AUDIT_DIGEST_KEY_FILE")).trim();
  if (!/^[A-Za-z0-9_-]+$/.test(digestText)) throw new AuditConfigError("AUDIT_DIGEST_KEY_FILE must hold a base64url key");
  const digestKey = Buffer.from(digestText, "base64url");
  if (digestKey.length < 32) throw new AuditConfigError("AUDIT_DIGEST_KEY_FILE must hold at least 32 bytes (base64url)");
  let signer: Signer;
  try {
    signer = signerFromPem(get("AUDIT_SIGNING_KEY_ID"), readKeyFile("AUDIT_SIGNING_KEY_FILE", get("AUDIT_SIGNING_KEY_FILE")));
  } catch (err) {
    if (err instanceof AuditConfigError) throw err;
    throw new AuditConfigError(`AUDIT_SIGNING_KEY_FILE: ${err instanceof Error ? err.message : "unreadable"}`);
  }
  return {
    mode: "store",
    log: get("AUDIT_LOG"),
    anchor: get("AUDIT_ANCHOR"),
    digester: keyedDigester(get("AUDIT_DIGEST_KEY_ID"), digestKey),
    signer,
    checkpointRows: boundedInt(env, "AUDIT_CHECKPOINT_ROWS", DEFAULT_CHECKPOINT_ROWS, 100_000),
    checkpointMs: boundedInt(env, "AUDIT_CHECKPOINT_SECONDS", DEFAULT_CHECKPOINT_SECONDS, 86_400) * 1000,
  };
}

/** Opens the configured store, or undefined for seam-only. Throws AuditConfigError on any file problem. */
export function openAuditStore(config: AuditMode, now?: () => number): JsonLinesStore | undefined {
  if (config.mode === "seam-only") return undefined;
  const anchor = new FileAnchor(config.anchor);
  try {
    return new JsonLinesStore({ log: config.log, anchor, anchorText: anchor.existing, digester: config.digester, signer: config.signer, checkpointRows: config.checkpointRows, checkpointMs: config.checkpointMs, ...(now === undefined ? {} : { now }) });
  } catch (err) {
    anchor.close();
    throw err;
  }
}

export { ephemeralDigester };
