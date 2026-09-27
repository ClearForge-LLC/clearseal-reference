// CSR-WO-2002: the audit store, its rows, its digests and its checkpoints (audit/RULES.md AU-1 to
// AU-12, AU-20, AU-24). Each test is a red-proof named in RULES.md; each writes real files.

import assert from "node:assert/strict";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";

import { checkpointPayload, GENESIS, lineHash } from "../../src/audit/chain.ts";
import { AuditConfigError } from "../../src/audit/files.ts";
import { keyedDigester } from "../../src/audit/digest.ts";
import { signerFromPem, verifyWith } from "../../src/audit/signer.ts";
import { FileAnchor, JsonLinesStore, MemoryAnchor } from "../../src/audit/store.ts";
import { auditKit, type AuditKit } from "./keys.ts";

interface Opened {
  kit: AuditKit;
  store: JsonLinesStore;
  anchor: MemoryAnchor;
}

function open(kit = auditKit(), opts: { rows?: number; ms?: number; anchorText?: string; anchor?: MemoryAnchor } = {}): Opened {
  const anchor = opts.anchor ?? new MemoryAnchor();
  const store = new JsonLinesStore({ log: kit.log, anchor, anchorText: opts.anchorText ?? anchor.text(), digester: keyedDigester(kit.digestKid, kit.digestKey), signer: signerFromPem(kit.kid, kit.signingPem), checkpointRows: opts.rows ?? 1000, checkpointMs: opts.ms ?? 3_600_000 });
  return { kit, store, anchor };
}
const rows = (kit: AuditKit): Record<string, unknown>[] => readFileSync(kit.log, "utf8").trimEnd().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
const lines = (kit: AuditKit): string[] => readFileSync(kit.log, "utf8").trimEnd().split("\n");

void describe("the chain (AU-1 to AU-3)", () => {
  void it("every row's prev is the SHA-256 of the line before it", async () => {
    const { kit, store } = open();
    for (let i = 0; i < 5; i++) store.append("http-refused", { status: 403, reason: "origin-not-allowed" });
    await store.close();
    const ls = lines(kit);
    const rs = rows(kit);
    assert.equal(rs[0]?.["prev"], GENESIS, "the first row's prev is the genesis value");
    for (let i = 1; i < rs.length; i++) assert.equal(rs[i]?.["prev"], lineHash(ls[i - 1] as string), `row ${String(i)}`);
    rs.forEach((r, i) => assert.equal(r["seq"], i));
    console.log(`AUDIT ROW ${ls[1] ?? ""}`);
  });

  void it("a restarted store continues seq and prev from the last row", async () => {
    const first = open();
    first.store.append("pin-non-strict", { admitted: 1, refused: 0 });
    first.store.append("pin-non-strict", { admitted: 1, refused: 0 });
    await first.store.close();
    const again = open(first.kit, { anchor: first.anchor, anchorText: first.anchor.text() });
    again.store.append("pin-non-strict", { admitted: 2, refused: 0 });
    await again.store.close();
    const ls = lines(first.kit);
    const rs = rows(first.kit);
    assert.deepEqual(rs.map((r) => r["seq"]), [0, 1, 2, 3]);
    assert.equal(rs[2]?.["prev"], lineHash(ls[1] as string));
    // AU-25: the resumed run's first row records the rows it adopted after the last checkpoint.
    assert.equal(rs[2]?.["event"], "audit-resumed");
    assert.deepEqual(rs[2]?.["fields"], { fromSeq: 2, unanchored: 0 });
  });

  void it("a resumed store records the unanchored rows it adopts", async () => {
    const first = open(auditKit(), { rows: 1000 });
    for (let i = 0; i < 3; i++) first.store.append("auth-refused", { reason: "expired" });
    // A crash: no close, so no checkpoint covers the three rows.
    first.store.flush();
    const again = open(first.kit, { anchor: new MemoryAnchor(), anchorText: first.anchor.text() });
    again.store.append("auth-refused", { reason: "expired" });
    await again.store.close();
    await first.store.close();
    const resumed = rows(first.kit).find((r) => r["event"] === "audit-resumed");
    assert.deepEqual(resumed?.["fields"], { fromSeq: 3, unanchored: 3 });
    console.log(`AUDIT RESUMED ${lines(first.kit).find((l) => l.includes("audit-resumed")) ?? ""}`);
  });
});

void describe("principal and fields: keyed, never bare (AU-4 to AU-7)", () => {
  void it("every row carries a principal", async () => {
    const { kit, store } = open();
    store.append("manifest-loaded", { path: "/srv/m.json", sha256: "a".repeat(64) });
    store.append("auth-refused", { reason: "expired" });
    store.append("http-refused", { status: 403, reason: "origin-not-allowed" });
    store.append("http-refused", { status: 413, reason: "body-too-large", principal: "alice" });
    store.append("validation-error", { tool: "notes.read", principal: "bob" });
    store.append("something-new", { x: 1 });
    await store.close();
    const principals = rows(kit).map((r) => r["principal"]);
    assert.deepEqual(principals, ["node", "unauthenticated", "unauthenticated", "alice", "bob", "unattributed"]);
    for (const r of rows(kit)) assert.equal(typeof r["principal"], "string");
  });

  void it("equal arguments give equal digests, and the digest depends on the key", () => {
    const kit = auditKit();
    const d = keyedDigester(kit.digestKid, kit.digestKey);
    const other = keyedDigester(kit.digestKid, Buffer.alloc(32, 7));
    const a = d.args({ name: "today.md", n: 1 });
    assert.equal(a, d.args({ n: 1, name: "today.md" }), "key order does not matter: the canonical form");
    assert.notEqual(a, d.args({ name: "tomorrow.md", n: 1 }));
    assert.notEqual(a, other.args({ name: "today.md", n: 1 }), "another key, another digest");
    assert.match(a, /^hmac-sha256:test-digest-1:[A-Za-z0-9_-]{43}$/);
    assert.ok(!a.includes("today"));
    console.log(`AUDIT DIGEST ${a}`);
  });

  void it("a field outside the table, or of the wrong kind, is written as a keyed digest", async () => {
    const { kit, store } = open();
    store.append("http-refused", { status: 401, reason: "Bearer secret-token-value", note: "argument-value-canary" });
    store.append("rpc-refused", { code: -32601, method: "notes/argument-value-canary", principal: "p" });
    store.append("made-up-event", { anything: "argument-value-canary" });
    await store.close();
    const text = readFileSync(kit.log, "utf8");
    assert.ok(!text.includes("canary") && !text.includes("secret-token"), text);
    const [a, b, c] = rows(kit) as [Record<string, Record<string, string>>, Record<string, Record<string, string>>, Record<string, Record<string, string>>];
    assert.match(a["fields"]?.["reason"] ?? "", /^hmac-sha256:/, "a value of the wrong kind keeps its name, as a digest");
    assert.match(a["fields"]?.["unlisted"] ?? "", /^hmac-sha256:/, "an unlisted field is digested under unlisted");
    assert.equal(a["fields"]?.["note"], undefined, "an unlisted field's own name never appears");
    assert.match(b["fields"]?.["method"] ?? "", /^hmac-sha256:/, "a method the transport does not know is digested");
    assert.deepEqual(Object.keys(c["fields"] ?? {}), ["unlisted"]);
    console.log(`AUDIT POLICY ${lines(kit)[0] ?? ""}`);
  });

  void it("a containment sink is written as a keyed digest", async () => {
    const { kit, store } = open();
    store.append("containment-refused", { tool: "notes.read", kind: "fs", sink: "/srv/notes/../../etc/argument-value-canary", principal: "p" });
    await store.close();
    const r = rows(kit)[0] as Record<string, Record<string, string>>;
    assert.match(r["fields"]?.["sink"] ?? "", /^hmac-sha256:test-digest-1:/);
    assert.ok(!readFileSync(kit.log, "utf8").includes("canary"));
  });
});

void describe("checkpoints (AU-9, AU-10)", () => {
  void it("a checkpoint is written every N rows", async () => {
    const { store, anchor } = open(auditKit(), { rows: 3 });
    for (let i = 0; i < 7; i++) store.append("auth-refused", { reason: "expired" });
    assert.deepEqual(anchor.lines.map((l) => (JSON.parse(l) as { count: number }).count), [3, 6]);
    await store.close();
  });

  void it("a checkpoint is written after T", async () => {
    const { store, anchor } = open(auditKit(), { ms: 40 });
    store.append("auth-refused", { reason: "expired" });
    assert.equal(anchor.lines.length, 0);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(anchor.lines.length, 1, "a checkpoint after T with one row pending");
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(anchor.lines.length, 1, "none while nothing new was written");
    await store.close();
  });

  void it("close writes a final checkpoint", async () => {
    const { store, anchor } = open();
    store.append("auth-refused", { reason: "expired" });
    store.append("auth-refused", { reason: "expired" });
    assert.equal(anchor.lines.length, 0);
    await store.close();
    assert.equal(anchor.lines.length, 1);
    assert.equal((JSON.parse(anchor.lines[0] as string) as { count: number }).count, 2);
  });

  void it("a checkpoint is signed over its own canonical bytes", async () => {
    const { kit, store, anchor } = open(auditKit(), { rows: 2 });
    store.append("auth-refused", { reason: "expired" });
    store.append("auth-refused", { reason: "expired" });
    await store.close();
    const c = JSON.parse(anchor.lines[0] as string) as { kid: string; seq: number; head: string; count: number; time: string; sig: string };
    const entry = kit.allowlist[0];
    assert.ok(entry !== undefined);
    assert.equal(c.head, lineHash(lines(kit)[1] as string));
    assert.ok(verifyWith(entry, checkpointPayload(c), Buffer.from(c.sig, "base64url")), "the signature verifies over the checkpoint's bytes");
    assert.ok(!verifyWith(entry, checkpointPayload({ ...c, count: 1 }), Buffer.from(c.sig, "base64url")), "and over nothing else");
    console.log(`AUDIT CHECKPOINT ${anchor.lines[0] ?? ""}`);
  });
});

void describe("start-time checks (AU-20, AU-24)", () => {
  void it("the store refuses to start on a torn log", async () => {
    const { kit, store } = open();
    store.append("auth-refused", { reason: "expired" });
    await store.close();
    appendFileSync(kit.log, '{"seq":1,"ti');
    assert.throws(() => open(kit), (e: unknown) => e instanceof AuditConfigError && /final line is torn/.test(e.message));
  });

  void it("the store refuses to start on a log behind its last checkpoint", async () => {
    const { kit, store, anchor } = open(auditKit(), { rows: 2 });
    for (let i = 0; i < 4; i++) store.append("auth-refused", { reason: "expired" });
    await store.close();
    const ls = lines(kit);
    writeFileSync(kit.log, `${ls.slice(0, 3).join("\n")}\n`);
    assert.throws(() => open(kit, { anchor: new MemoryAnchor(), anchorText: anchor.text() }), (e: unknown) => e instanceof AuditConfigError && /truncated behind the checkpoint/.test(e.message));
    const edited = [...ls];
    edited[3] = (edited[3] as string).replace("expired", "EXPIRED");
    writeFileSync(kit.log, `${edited.join("\n")}\n`);
    assert.throws(() => open(kit, { anchor: new MemoryAnchor(), anchorText: anchor.text() }), (e: unknown) => e instanceof AuditConfigError && /does not match its last checkpoint's head/.test(e.message));
  });

  void it("the log and the anchor are never the same file", () => {
    const kit = auditKit();
    const anchor = new FileAnchor(kit.log);
    try {
      assert.throws(() => new JsonLinesStore({ log: kit.log, anchor, digester: keyedDigester(kit.digestKid, kit.digestKey), signer: signerFromPem(kit.kid, kit.signingPem), checkpointRows: 10, checkpointMs: 60_000 }), (e: unknown) => e instanceof AuditConfigError && /name the same file/.test(e.message));
    } finally {
      anchor.close();
    }
  });
});
