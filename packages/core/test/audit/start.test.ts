// CSR-WO-2002 §1.5: the audit store wired through startNode, fail-closed (audit/RULES.md AU-5, AU-21 to
// AU-23). Each case is a real startNode call: refused before it binds, or started and asked to serve.

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { AuditConfigError } from "../../src/audit/files.ts";
import { verifyAudit } from "../../src/audit/verify.ts";
import { startNodeFromEnv } from "../../src/node/start.ts";
import { buildManifest, type PinnableTool, serializeManifest } from "../../src/pinning/manifest.ts";
import { AUDIENCE, ISSUER, TestIssuer } from "../auth/issuer.ts";
import { tag } from "../fixtures/tools.ts";
import { modern } from "../transport/helpers.ts";
import { auditKit, type AuditKit } from "./keys.ts";

const POSIX = process.platform !== "win32";
const DIR = mkdtempSync(join(tmpdir(), "clearseal-audit-start-"));
const CANARY = "argument-value-canary-7c1e";
const echo: PinnableTool = { name: "echo", description: "an echo", inputSchema: { type: "object", properties: { text: { type: "string" } } }, capability: tag("echo"), handler: (args) => Promise.resolve({ content: [{ type: "text", text: String(args["text"]) }] }) };
const configSchema = {
  type: "object",
  "x-clearseal-env-prefix": "AST_",
  properties: { AST_RESOURCE_URL: { type: "string", "x-clearseal-setting": "resource-url" }, AST_PORT: { type: "string", "x-clearseal-setting": "port", default: "0" } },
  required: ["AST_RESOURCE_URL"],
  additionalProperties: false,
};
const edition = { definitions: [echo], configSchema };
const MANIFEST = join(DIR, "manifest.json");
const AUDIT_KEYS = ["AUDIT_STORE", "AUDIT_LOG", "AUDIT_ANCHOR", "AUDIT_DIGEST_KEY_FILE", "AUDIT_DIGEST_KEY_ID", "AUDIT_SIGNING_KEY_FILE", "AUDIT_SIGNING_KEY_ID", "AUDIT_CHECKPOINT_ROWS", "AUDIT_CHECKPOINT_SECONDS"];
let issuer: TestIssuer;
const saved = { ...process.env };
const pastes: string[] = [];

before(async () => {
  writeFileSync(MANIFEST, serializeManifest(buildManifest([echo])));
  issuer = await TestIssuer.start();
  const ca = join(DIR, "ca.pem");
  writeFileSync(ca, issuer.ca);
  Object.assign(process.env, { CLEARSEAL_EDITION: "@clearseal/fixture", CLEARSEAL_MANIFEST: MANIFEST, AST_RESOURCE_URL: AUDIENCE, AUTH_ISSUER: ISSUER, AUTH_JWKS_URL: issuer.jwksUrl, AUTH_AUDIENCE: AUDIENCE, AUTH_JWKS_CA_FILE: ca });
});
after(async () => {
  await issuer.close();
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  rmSync(DIR, { recursive: true, force: true });
  console.log(pastes.join("\n"));
});

/** Sets exactly these AUDIT_* variables (the rest unset). */
function auditEnv(vars: Record<string, string | undefined>): void {
  for (const k of AUDIT_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
}

async function refused(label: string, vars: Record<string, string | undefined>, rule: RegExp): Promise<void> {
  auditEnv(vars);
  try {
    const node = await startNodeFromEnv(edition, process.env, { audit: () => undefined });
    await node.close();
  } catch (err) {
    assert.ok(err instanceof AuditConfigError, `${label}: ${String(err)}`);
    assert.match(err.message, rule, label);
    assert.ok(!err.message.includes("maybe a key"), `${label}: a file's content is never quoted`);
    pastes.push(`AUDIT START ${label}: ${err.name}: ${err.message}`);
    return;
  }
  assert.fail(`${label}: the node started`);
}

void describe("startNode refuses to start without its audit configuration (AU-21, AU-22)", () => {
  void it("start is refused for each missing or invalid AUDIT_* setting", async () => {
    const kit = auditKit();
    const base = kit.env;
    await refused("no AUDIT_* at all", {}, /the audit store is not configured \(AUDIT_LOG, AUDIT_ANCHOR, AUDIT_DIGEST_KEY_FILE, AUDIT_DIGEST_KEY_ID, AUDIT_SIGNING_KEY_FILE, AUDIT_SIGNING_KEY_ID missing\)/);
    for (const k of Object.keys(base)) await refused(`${k} missing`, { ...base, [k]: undefined }, new RegExp(`${k} missing`));
    await refused("AUDIT_STORE neither jsonl nor seam-only", { ...base, AUDIT_STORE: "off" }, /AUDIT_STORE is "jsonl" \(the default\) or "seam-only"/);
    await refused("AUDIT_LOG relative", { ...base, AUDIT_LOG: "audit.jsonl" }, /AUDIT_LOG must be an absolute path/);
    await refused("AUDIT_LOG a directory", { ...base, AUDIT_LOG: kit.dir }, /AUDIT_LOG (is not a regular file|cannot be opened)/);
    await refused("AUDIT_ANCHOR the same file as AUDIT_LOG", { ...base, AUDIT_ANCHOR: base["AUDIT_LOG"] }, /name the same file/);
    await refused("AUDIT_DIGEST_KEY_FILE missing on disk", { ...base, AUDIT_DIGEST_KEY_FILE: join(kit.dir, "nope.key") }, /AUDIT_DIGEST_KEY_FILE cannot be opened \(ENOENT\)/);
    const short = join(kit.dir, "short.key");
    writeFileSync(short, Buffer.alloc(16, 1).toString("base64url"));
    await refused("AUDIT_DIGEST_KEY_FILE under 32 bytes", { ...base, AUDIT_DIGEST_KEY_FILE: short }, /at least 32 bytes/);
    await refused("AUDIT_DIGEST_KEY_ID malformed", { ...base, AUDIT_DIGEST_KEY_ID: "a b" }, /AUDIT_DIGEST_KEY_ID must match/);
    const rsa = join(kit.dir, "rsa.pem");
    writeFileSync(rsa, generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" }));
    await refused("AUDIT_SIGNING_KEY_FILE an RSA key", { ...base, AUDIT_SIGNING_KEY_FILE: rsa }, /the signing key is rsa, not Ed25519/);
    await refused("AUDIT_SIGNING_KEY_FILE not a key", { ...base, AUDIT_SIGNING_KEY_FILE: base["AUDIT_DIGEST_KEY_FILE"] }, /not a PEM private key/);
    // The adversarial pass (CSR-WO-2002 §5.5): the log and anchor never land on a key or the manifest;
    // seam-only never silently overrides a configured store; each key its own id; no patterned key.
    await refused("AUDIT_LOG the digest key file", { ...base, AUDIT_LOG: base["AUDIT_DIGEST_KEY_FILE"] }, /AUDIT_LOG is the same file as AUDIT_DIGEST_KEY_FILE/);
    await refused("AUDIT_LOG the signing key file", { ...base, AUDIT_LOG: base["AUDIT_SIGNING_KEY_FILE"] }, /AUDIT_LOG is the same file as AUDIT_SIGNING_KEY_FILE/);
    await refused("AUDIT_ANCHOR the manifest", { ...base, AUDIT_ANCHOR: MANIFEST }, /AUDIT_ANCHOR is the same file as CLEARSEAL_MANIFEST/);
    await refused("AUDIT_LOG the manifest", { ...base, AUDIT_LOG: MANIFEST }, /AUDIT_LOG is the same file as CLEARSEAL_MANIFEST/);
    await refused("AUDIT_STORE=seam-only with the store configured", { ...base, AUDIT_STORE: "seam-only" }, /AUDIT_STORE=seam-only while the store is configured/);
    await refused("the same id for both keys", { ...base, AUDIT_SIGNING_KEY_ID: base["AUDIT_DIGEST_KEY_ID"] }, /are the same: each key has its own id/);
    const zeros = join(kit.dir, "zeros.key");
    writeFileSync(zeros, Buffer.alloc(32).toString("base64url"));
    await refused("an all-zero digest key", { ...base, AUDIT_DIGEST_KEY_FILE: zeros }, /patterned key/);
    const twoPems = join(kit.dir, "two.pem");
    writeFileSync(twoPems, kit.signingPem + generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    await refused("two PEM blocks in the signing key file", { ...base, AUDIT_SIGNING_KEY_FILE: twoPems }, /more than one PEM block/);
    const notAnchor = join(kit.dir, "not-an-anchor.jsonl");
    writeFileSync(notAnchor, "not json at all, maybe a key\n");
    await refused("an AUDIT_ANCHOR whose last line is not a checkpoint (named, never quoted)", { ...base, AUDIT_ANCHOR: notAnchor }, /^AUDIT_ANCHOR's last line is not a checkpoint$/);
    await refused("AUDIT_CHECKPOINT_ROWS zero", { ...base, AUDIT_CHECKPOINT_ROWS: "0" }, /AUDIT_CHECKPOINT_ROWS must be an integer from 1 to 100000/);
    await refused("AUDIT_CHECKPOINT_SECONDS too large", { ...base, AUDIT_CHECKPOINT_SECONDS: "999999" }, /AUDIT_CHECKPOINT_SECONDS must be an integer from 1 to 86400/);
    if (POSIX) {
      const link = join(kit.dir, "link.key");
      symlinkSync(base["AUDIT_DIGEST_KEY_FILE"] as string, link);
      await refused("AUDIT_DIGEST_KEY_FILE a symbolic link", { ...base, AUDIT_DIGEST_KEY_FILE: link }, /AUDIT_DIGEST_KEY_FILE cannot be opened \(ELOOP\)/);
      const real = join(kit.dir, "real");
      mkdirSync(real);
      symlinkSync(real, join(kit.dir, "linked"));
      await refused("AUDIT_LOG through a linked directory", { ...base, AUDIT_LOG: join(kit.dir, "linked", "audit.jsonl") }, /AUDIT_LOG passes through a symbolic link/);
    }
  });

  void it("seam-only starts with its audit-unanchored row", async () => {
    auditEnv({ AUDIT_STORE: "seam-only" });
    const seen: string[] = [];
    const node = await startNodeFromEnv(edition, process.env, { audit: (e, f) => seen.push(`${e} ${JSON.stringify(f)}`) });
    await node.close();
    assert.match(seen[0] ?? "", /^audit-unanchored \{"mode":"seam-only"\}$/);
    assert.match(seen[1] ?? "", /^manifest-loaded /);
    pastes.push(`AUDIT START seam-only: ${seen.slice(0, 2).join(" | ")}`);
  });
});

void describe("with a store (AU-5, AU-23)", () => {
  let kit: AuditKit;
  const token = (): string => issuer.mint(TestIssuer.claims(Math.floor(Date.now() / 1000)));

  void it("manifest-loaded is the first row of the run", async () => {
    kit = auditKit();
    auditEnv(kit.env);
    const node = await startNodeFromEnv(edition);
    await node.close();
    const rows = readFileSync(kit.log, "utf8").trimEnd().split("\n").map((l) => JSON.parse(l) as { event: string; principal: string; seq: number });
    assert.equal(rows[0]?.event, "manifest-loaded");
    assert.equal(rows[0]?.principal, "node");
    assert.equal(rows[0]?.seq, 0);
    assert.equal(readFileSync(kit.anchor, "utf8").trimEnd().split("\n").length, 1, "close wrote the checkpoint");
  });

  void it("a call that reaches its handler writes one tool-call row with a keyed digest", async () => {
    kit = auditKit();
    auditEnv(kit.env);
    const node = await startNodeFromEnv(edition);
    try {
      const r = await modern(node, "tools/call", { name: "echo", arguments: { text: CANARY } }, { headers: { authorization: `Bearer ${token()}` } });
      assert.equal(r.status, 200, r.text);
      assert.ok(r.text.includes(CANARY), "the call itself ran with the value");
    } finally {
      await node.close();
    }
    const text = readFileSync(kit.log, "utf8");
    assert.ok(!text.includes(CANARY), "the value never reaches a row");
    const rows = text.trimEnd().split("\n").map((l) => JSON.parse(l) as { event: string; principal: string; fields: Record<string, string> });
    const calls = rows.filter((r) => r.event === "tool-call");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.fields["tool"], "echo");
    assert.equal(calls[0]?.fields["outcome"], "ok");
    assert.match(calls[0]?.fields["args"] ?? "", /^hmac-sha256:test-digest-1:[A-Za-z0-9_-]{43}$/);
    assert.ok(calls[0]?.principal !== undefined && calls[0].principal !== "unattributed", "the caller's principal");
    const report = verifyAudit(text, readFileSync(kit.anchor, "utf8"), kit.allowlist);
    assert.equal(report.exitCode, 0, JSON.stringify(report.findings));
    pastes.push(`AUDIT START tool-call row: ${text.trimEnd().split("\n").find((l) => l.includes('"tool-call"')) ?? ""}`);
  });
});
