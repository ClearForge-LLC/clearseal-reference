// Test-only audit keys and paths (CSR-WO-2002). Everything is generated at run time into a fresh
// temporary directory, so no key is ever committed (the leak gate refuses a private key in the tree).

import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { KeyEntry } from "../../src/audit/signer.ts";

export interface AuditKit {
  readonly dir: string;
  readonly log: string;
  readonly anchor: string;
  readonly keysFile: string;
  readonly digestKey: Buffer;
  readonly digestKid: string;
  readonly signingPem: string;
  readonly kid: string;
  readonly allowlist: KeyEntry[];
  /** The AUDIT_* settings for this kit, as an operator sets them. */
  readonly env: Record<string, string>;
}

/** A fresh kit: a digest key, an Ed25519 checkpoint key valid from a day ago for a year, and paths. */
export function auditKit(kid = "test-ckpt-1"): AuditKit {
  const dir = mkdtempSync(join(tmpdir(), "clearseal-audit-"));
  const digestKey = randomBytes(32);
  const digestFile = join(dir, "digest.key");
  writeFileSync(digestFile, `${digestKey.toString("base64url")}\n`, { mode: 0o600 });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signingPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const signingFile = join(dir, "signing.pem");
  writeFileSync(signingFile, signingPem, { mode: 0o600 });
  const now = Date.now();
  const allowlist: KeyEntry[] = [{ kid, key: String(publicKey.export({ format: "jwk" }).x), notBefore: new Date(now - 86_400_000).toISOString(), notAfter: new Date(now + 365 * 86_400_000).toISOString() }];
  const keysFile = join(dir, "keys.json");
  writeFileSync(keysFile, JSON.stringify(allowlist));
  const log = join(dir, "audit.jsonl");
  const anchor = join(dir, "anchor.jsonl");
  return {
    dir,
    log,
    anchor,
    keysFile,
    digestKey,
    digestKid: "test-digest-1",
    signingPem,
    kid,
    allowlist,
    env: { AUDIT_LOG: log, AUDIT_ANCHOR: anchor, AUDIT_DIGEST_KEY_FILE: digestFile, AUDIT_DIGEST_KEY_ID: "test-digest-1", AUDIT_SIGNING_KEY_FILE: signingFile, AUDIT_SIGNING_KEY_ID: kid },
  };
}
