// NOT FOR PRODUCTION. Development keys for the audit store (CSR-WO-2002 §1.5): a digest key and an
// Ed25519 checkpoint signing key, written to a directory you name (never inside the repository), with
// the environment lines and the verify allowlist printed for you to copy. A production operator makes
// and holds these keys by their own process, keeps the signing key's public half in the allowlist
// with a validity window, and rotates by adding an entry with a new kid, never by editing one.
//
// Usage: node scripts/audit-dev-keys.mjs <absolute directory outside the repository>

import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.argv[2];
const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
if (dir === undefined || !isAbsolute(dir)) {
  console.error("usage: node scripts/audit-dev-keys.mjs <absolute directory outside the repository>");
  process.exit(2);
}
if (!relative(repo, resolve(dir)).startsWith("..")) {
  console.error("audit-dev-keys: refusing to write keys inside the repository");
  process.exit(2);
}
mkdirSync(dir, { recursive: true, mode: 0o700 });
const digestFile = join(dir, "audit-digest.key");
const signingFile = join(dir, "audit-signing.pem");
for (const f of [digestFile, signingFile]) {
  if (existsSync(f)) {
    console.error(`audit-dev-keys: ${f} exists; not overwriting a key`);
    process.exit(1);
  }
}
writeFileSync(digestFile, `${randomBytes(32).toString("base64url")}\n`, { mode: 0o600 });
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
writeFileSync(signingFile, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
const kid = `dev-${new Date().toISOString().slice(0, 10)}`;
const now = new Date();
const allowlist = [{ kid, key: publicKey.export({ format: "jwk" }).x, notBefore: now.toISOString(), notAfter: new Date(now.getTime() + 90 * 86_400_000).toISOString() }];
writeFileSync(join(dir, "audit-keys.json"), `${JSON.stringify(allowlist, null, 2)}\n`);
console.log(`# NOT FOR PRODUCTION — development audit keys in ${dir}
AUDIT_LOG=${join(dir, "audit.jsonl")}
AUDIT_ANCHOR=${join(dir, "audit-anchor.jsonl")}
AUDIT_DIGEST_KEY_FILE=${digestFile}
AUDIT_DIGEST_KEY_ID=${kid}-digest
AUDIT_SIGNING_KEY_FILE=${signingFile}
AUDIT_SIGNING_KEY_ID=${kid}
# verify with: npm run audit -- verify --log ${join(dir, "audit.jsonl")} --anchor ${join(dir, "audit-anchor.jsonl")} --keys ${join(dir, "audit-keys.json")}`);
