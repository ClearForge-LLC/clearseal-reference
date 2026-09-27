// CSR-WO-2002 §1.4: `audit verify` names every tamper (audit/RULES.md AU-13 to AU-20). A clean log is
// built by the real store (8 rows, a checkpoint every 3, and one at close), then each tamper is applied
// to its text and verified against the kit's allowlist.

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it } from "node:test";

import { canonicalJson } from "../../src/pinning/canonical.ts";
import { checkpointPayload, lineHash } from "../../src/audit/chain.ts";
import { runAudit } from "../../src/audit/cli.ts";
import { keyedDigester } from "../../src/audit/digest.ts";
import { type KeyEntry, signerFromPem } from "../../src/audit/signer.ts";
import { JsonLinesStore, MemoryAnchor } from "../../src/audit/store.ts";
import { type FindingKind, verifyAudit } from "../../src/audit/verify.ts";
import { auditKit, type AuditKit } from "./keys.ts";

let kit: AuditKit;
let log: string[];
let anchor: string[];
const text = (ls: readonly string[]): string => ls.map((l) => `${l}\n`).join("");
const pastes: string[] = [];

before(async () => {
  kit = auditKit();
  const mem = new MemoryAnchor();
  const store = new JsonLinesStore({ log: kit.log, anchor: mem, digester: keyedDigester(kit.digestKid, kit.digestKey), signer: signerFromPem(kit.kid, kit.signingPem), checkpointRows: 3, checkpointMs: 3_600_000 });
  store.append("manifest-loaded", { path: "/srv/pins/teaching.json", sha256: "b".repeat(64) });
  for (let i = 0; i < 7; i++) store.append("tool-call", { tool: "notes.read", outcome: "ok", args: store.digester.args({ name: `n${String(i)}.md` }), principal: "alice" });
  await store.close();
  log = readFileSync(kit.log, "utf8").trimEnd().split("\n");
  anchor = mem.lines;
});

/** Verifies and asserts the first finding's kind; records the paste. */
function named(label: string, logLines: readonly string[] | string, anchorLines: readonly string[], kind: FindingKind, allowlist: readonly KeyEntry[] = kit.allowlist): void {
  const report = verifyAudit(typeof logLines === "string" ? logLines : text(logLines), text(anchorLines), allowlist);
  const first = report.findings[0];
  pastes.push(`VERIFY ${label} → exit ${String(report.exitCode)}; first: ${first === undefined ? "none" : `${first.kind} at ${first.where}: ${first.detail}`}`);
  assert.equal(first?.kind, kind, `${label}: ${JSON.stringify(report.findings)}`);
  assert.equal(report.exitCode, kind === "torn-final-line" ? 3 : 1, label);
}

/** Re-chains rows from `from` on, as an attacker who edits a row and recomputes every later prev would. */
function rechain(ls: string[], from: number): string[] {
  const out = [...ls];
  for (let i = Math.max(1, from); i < out.length; i++) {
    const row = JSON.parse(out[i] as string) as Record<string, unknown>;
    row["prev"] = lineHash(out[i - 1] as string);
    out[i] = canonicalJson(row);
  }
  return out;
}
const edit = (line: string, from: string, to: string): string => {
  const row = JSON.parse(line.replace(from, to)) as unknown;
  return canonicalJson(row);
};

void describe("audit verify (AU-13 to AU-20)", () => {
  void it("a clean log verifies", () => {
    const report = verifyAudit(text(log), text(anchor), kit.allowlist);
    pastes.push(`VERIFY clean → exit ${String(report.exitCode)}; ${String(report.rows)} rows, ${String(report.checkpoints)} checkpoints, ${String(report.unanchored)} unanchored`);
    assert.equal(report.exitCode, 0, JSON.stringify(report.findings));
    assert.deepEqual([report.rows, report.checkpoints, report.unanchored], [8, 3, 0]);
  });

  void it("verify names an edited row", () => {
    const ls = [...log];
    ls[4] = edit(ls[4] as string, '"alice"', '"mallory"');
    named("an edited row (seq 4)", ls, anchor, "edited-row");
  });

  void it("verify names a removed row", () => {
    named("a removed row (seq 4)", [...log.slice(0, 4), ...log.slice(5)], anchor, "removed-rows");
  });

  void it("verify names reordered rows", () => {
    const ls = [...log];
    [ls[2], ls[3]] = [ls[3] as string, ls[2] as string];
    named("two rows swapped (seq 2 and 3)", ls, anchor, "reordered-rows");
    // Two valid logs spliced: this one's first half, then another store's rows from seq 0.
    const other = auditKit();
    const store2 = new JsonLinesStore({ log: other.log, anchor: new MemoryAnchor(), digester: keyedDigester(kit.digestKid, kit.digestKey), signer: signerFromPem(kit.kid, kit.signingPem), checkpointRows: 100, checkpointMs: 3_600_000 });
    store2.append("auth-refused", { reason: "expired" });
    store2.append("auth-refused", { reason: "expired" });
    void store2.close();
    const second = readFileSync(other.log, "utf8").trimEnd().split("\n");
    named("two valid logs spliced", [...log.slice(0, 4), ...second], [], "inserted-rows");
  });

  void it("verify names a non-canonical row", () => {
    const ls = [...log];
    ls[3] = (ls[3] as string).replace('"event":', '"event": ');
    named("a row with a space added (same content, another spelling)", ls, anchor, "non-canonical-row");
    const dup = [...log];
    dup[3] = (dup[3] as string).replace('{"event":"tool-call"', '{"event":"tool-call","event":"tool-call"');
    named("a row with a duplicate key", dup, anchor, "malformed-row");
  });

  void it("verify names a truncation behind a checkpoint", () => {
    named("the last three rows removed (behind the close checkpoint)", log.slice(0, 5), anchor, "truncated-behind-checkpoint");
  });

  void it("verify names a head mismatch", () => {
    const ls = [...log];
    ls[7] = edit(ls[7] as string, '"alice"', '"mallory"');
    named("the last row edited (no successor to notice)", ls, anchor, "head-mismatch");
    named("a row edited and every later prev recomputed (re-chained)", rechain([...log.slice(0, 2), edit(log[2] as string, '"alice"', '"mallory"'), ...log.slice(3)], 3), anchor, "head-mismatch");
    // A checkpoint whose count matches but whose head does not: re-signed by the real key, so only
    // the head can tell.
    const c = JSON.parse(anchor[0] as string) as Record<string, string | number>;
    const forged = { kid: kit.kid, seq: 0, head: lineHash(log[1] as string), count: c["count"] as number, time: c["time"] as string };
    const sig = Buffer.from(signerFromPem(kit.kid, kit.signingPem).sign(checkpointPayload(forged))).toString("base64url");
    named("a checkpoint whose count matches but whose head does not", log, [canonicalJson({ ...forged, sig }), ...anchor.slice(1)], "head-mismatch");
  });

  void it("verify names an unknown kid", () => {
    named("a checkpoint key not in the allowlist", log, anchor, "unknown-kid", [{ ...(kit.allowlist[0] as KeyEntry), kid: "someone-else" }]);
  });

  void it("verify names a key used outside its window", () => {
    named("a checkpoint time after its key's notAfter", log, anchor, "key-out-of-window", [{ ...(kit.allowlist[0] as KeyEntry), notBefore: "2020-01-01T00:00:00Z", notAfter: "2021-01-01T00:00:00Z" }]);
    named("a checkpoint time before its key's notBefore", log, anchor, "key-out-of-window", [{ ...(kit.allowlist[0] as KeyEntry), notBefore: "2099-01-01T00:00:00Z", notAfter: "2100-01-01T00:00:00Z" }]);
  });

  void it("verify names a bad signature", () => {
    const c = JSON.parse(anchor[0] as string) as Record<string, string | number>;
    named("a checkpoint's count changed after signing", log, [canonicalJson({ ...c, count: 2 }), ...anchor.slice(1)], "bad-signature");
    const { privateKey } = generateKeyPairSync("ed25519");
    const impostor = signerFromPem(kit.kid, privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    const unsigned = { kid: kit.kid, seq: c["seq"] as number, head: c["head"] as string, count: c["count"] as number, time: c["time"] as string };
    named("a checkpoint signed by another key under the same kid", log, [canonicalJson({ ...unsigned, sig: Buffer.from(impostor.sign(checkpointPayload(unsigned))).toString("base64url") }), ...anchor.slice(1)], "bad-signature");
  });

  void it("verify names a replayed checkpoint", () => {
    named("the first checkpoint appended again", log, [...anchor, anchor[0] as string], "checkpoint-replayed");
    named("a checkpoint removed from the anchor", log, [anchor[0] as string, anchor[2] as string], "checkpoint-replayed");
  });

  void it("verify reports a torn final line as its own kind", () => {
    const whole = text(log);
    named("the last row cut mid-write (no final newline)", whole.slice(0, whole.length - 30), anchor.slice(0, 2), "torn-final-line");
  });

  void it("the command: names the first failure, lists every one, and exits 0, 1, 2 or 3", () => {
    const out: string[] = [];
    const dir = kit.dir;
    const files = { log: join(dir, "v-log.jsonl"), anchor: join(dir, "v-anchor.jsonl") };
    writeFileSync(files.anchor, text(anchor));
    writeFileSync(files.log, text(log));
    assert.equal(runAudit(["verify", "--log", files.log, "--anchor", files.anchor, "--keys", kit.keysFile], (l) => out.push(l)), 0);
    writeFileSync(files.log, text([...log.slice(0, 4), ...log.slice(5)]));
    assert.equal(runAudit(["verify", "--log", files.log, "--anchor", files.anchor, "--keys", kit.keysFile], (l) => out.push(l)), 1);
    assert.equal(runAudit(["verify", "--log", files.log], (l) => out.push(l), (l) => out.push(l)), 2);
    const whole = text(log);
    writeFileSync(files.log, whole.slice(0, whole.length - 30));
    writeFileSync(files.anchor, text(anchor.slice(0, 2)));
    assert.equal(runAudit(["verify", "--log", files.log, "--anchor", files.anchor, "--keys", kit.keysFile], (l) => out.push(l)), 3);
    console.log(`AUDIT CLI\n${out.join("\n")}`);
    console.log(pastes.join("\n"));
  });
});
