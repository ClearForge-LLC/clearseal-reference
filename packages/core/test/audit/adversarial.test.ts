// CSR-WO-2002 §5: the adversarial pass's findings, each now a red-proof (audit/RULES.md AU-1, AU-6,
// AU-16, AU-19, AU-20, AU-24). Every case runs through the real store and the real verifier.

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { before, describe, it } from "node:test";

import { canonicalJson } from "../../src/pinning/canonical.ts";
import { AuditConfigError } from "../../src/audit/files.ts";
import { keyedDigester } from "../../src/audit/digest.ts";
import { type KeyEntry, parseAllowlist, signerFromPem } from "../../src/audit/signer.ts";
import { JsonLinesStore, MemoryAnchor } from "../../src/audit/store.ts";
import { verifyAudit } from "../../src/audit/verify.ts";
import { auditKit, type AuditKit } from "./keys.ts";

const open = (kit: AuditKit, anchor = new MemoryAnchor(), anchorText: string | Uint8Array = anchor.text(), rows = 1000): JsonLinesStore =>
  new JsonLinesStore({ log: kit.log, anchor, anchorText, digester: keyedDigester(kit.digestKid, kit.digestKey), signer: signerFromPem(kit.kid, kit.signingPem), checkpointRows: rows, checkpointMs: 3_600_000 });
const text = (ls: readonly string[]): string => ls.map((l) => `${l}\n`).join("");

let kit: AuditKit;
let log: string[];
let anchor: string[];
before(async () => {
  kit = auditKit();
  const mem = new MemoryAnchor();
  const store = open(kit, mem, "", 3);
  for (let i = 0; i < 9; i++) store.append("tool-call", { tool: "notes.read", outcome: "ok", args: store.digester.args({ i }), principal: i === 4 ? "renée" : "alice" });
  store.append("auth-refused", { reason: "expired" });
  await store.close();
  log = readFileSync(kit.log, "utf8").trimEnd().split("\n");
  anchor = mem.lines;
});

void describe("the adversarial pass's findings, closed (CSR-WO-2002 §5)", () => {
  void it("a row's bytes altered into invalid UTF-8 are a finding, never a replacement character", () => {
    const bytes = readFileSync(kit.log);
    const i = bytes.indexOf(Buffer.from("renée", "utf8"));
    assert.ok(i > 0);
    const altered = Buffer.from(bytes);
    altered[i + 3] = 0xff; // the first byte of é
    const report = verifyAudit(altered, text(anchor), kit.allowlist);
    assert.equal(report.exitCode, 1);
    assert.match(report.findings[0]?.detail ?? "", /not valid UTF-8/);
    writeFileSync(kit.log, altered);
    assert.throws(() => open(kit, new MemoryAnchor(), text(anchor)), (e: unknown) => e instanceof AuditConfigError && /not valid UTF-8/.test(e.message));
    writeFileSync(kit.log, bytes);
  });

  void it("a final newline removed from a complete line never hides it from the checks", () => {
    const anchorNoNewline = text(anchor).slice(0, -1);
    const report = verifyAudit(text(log.slice(0, 9)), anchorNoNewline, kit.allowlist);
    assert.equal(report.exitCode, 1, JSON.stringify(report.findings));
    assert.ok(report.findings.some((f) => f.kind === "truncated-behind-checkpoint"), "the last checkpoint is still checked");
    const logNoNewline = text(log).slice(0, -1);
    const clean = verifyAudit(logNoNewline, text(anchor), kit.allowlist);
    assert.deepEqual(clean.findings.map((f) => f.kind), ["torn-final-line"], "a complete last row without its newline: checked, and reported");
    const forged = [...log];
    forged[9] = canonicalJson({ ...(JSON.parse(forged[9] as string) as object), principal: "mallory" });
    assert.equal(verifyAudit(text(forged).slice(0, -1), text(anchor), kit.allowlist).exitCode, 1, "an edited complete last row, newline removed: still tampering");
  });

  void it("a checkpoint's signature has one spelling, and a checkpoint covers at least one row", () => {
    const c = JSON.parse(anchor[0] as string) as Record<string, unknown>;
    for (const sig of [`${String(c["sig"])}==`, `${String(c["sig"]).slice(0, 40)}.${String(c["sig"]).slice(40)}`]) {
      const report = verifyAudit(text(log), text([canonicalJson({ ...c, sig }), ...anchor.slice(1)]), kit.allowlist);
      assert.equal(report.findings[0]?.kind, "malformed-checkpoint", sig);
    }
    const zero = verifyAudit(text(log), text([canonicalJson({ ...c, count: 0 }), ...anchor.slice(1)]), kit.allowlist);
    assert.equal(zero.findings[0]?.kind, "malformed-checkpoint");
  });

  void it("the allowlist is strict: unique members, exactly four, one key spelling, real dates, not empty", () => {
    const entry = kit.allowlist[0] as KeyEntry;
    const bad: [string, string][] = [
      ["empty", "[]"],
      ["a duplicate member", `[{"kid":"x","kid":"${entry.kid}","key":"${entry.key}","notBefore":"${entry.notBefore}","notAfter":"${entry.notAfter}"}]`],
      ["an extra member", JSON.stringify([{ ...entry, note: "x" }])],
      ["a padded key", JSON.stringify([{ ...entry, key: `${entry.key}=` }])],
      ["30 February", JSON.stringify([{ ...entry, notBefore: "2026-02-30T00:00:00Z" }])],
      ["hour 24", JSON.stringify([{ ...entry, notAfter: "2027-01-01T24:00:00Z" }])],
    ];
    for (const [label, t] of bad) assert.throws(() => parseAllowlist(t), TypeError, label);
    assert.deepEqual(parseAllowlist(JSON.stringify(kit.allowlist)), kit.allowlist);
  });

  void it("an event the table does not know is written as unlisted, its name only in the digest; nothing is dropped", async () => {
    const k = auditKit();
    const store = open(k);
    store.append("Bearer secret-token-value", { note: 1 });
    store.append("transport-error", { reason: "canaryErrorName" });
    store.append("transport-error", { reason: "TypeError" });
    store.append("made-up", JSON.parse('{"__proto__":"kept-as-data"}') as Record<string, string>);
    store.append("made-up", { big: 10n as unknown as number });
    await store.close();
    const t = readFileSync(k.log, "utf8");
    assert.ok(!t.includes("secret-token") && !t.includes("canaryErrorName") && !t.includes("kept-as-data"), t);
    const rows = t.trimEnd().split("\n").map((l) => JSON.parse(l) as { event: string; fields: Record<string, string> });
    assert.equal(rows[0]?.event, "unlisted");
    assert.match(rows[1]?.fields["reason"] ?? "", /^hmac-sha256:/, "an error name the platform does not define is digested");
    assert.equal(rows[2]?.fields["reason"], "TypeError", "the platform's own error names are bare");
    assert.match(rows[3]?.fields["unlisted"] ?? "", /^hmac-sha256:/, "__proto__ is kept, inside the digest");
    assert.equal(rows.length, 5, "a BigInt does not throw");
  });

  void it("the store checks its own last checkpoint's signature at start", async () => {
    const k = auditKit();
    const mem = new MemoryAnchor();
    const store = open(k, mem, "", 2);
    store.append("auth-refused", { reason: "expired" });
    store.append("auth-refused", { reason: "expired" });
    await store.close();
    const c = JSON.parse(mem.lines[0] as string) as Record<string, unknown>;
    const forged = canonicalJson({ ...c, time: "2026-01-01T00:00:00.000Z" });
    assert.throws(() => open(k, new MemoryAnchor(), `${forged}\n`), (e: unknown) => e instanceof AuditConfigError && /does not verify under the signing key/.test(e.message));
  });
});
