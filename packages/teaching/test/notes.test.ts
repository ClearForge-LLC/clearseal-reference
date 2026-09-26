// CSR-WO-1004 §1.2, §1.3, §5.1: notes.read through a real teaching node. It reads a note by name
// from its root and nothing else: a name outside the pattern is refused by the pinned schema before
// the handler runs, and a link planted in the root is refused by the cage. Each attempt uses the real
// read. The Windows behaviour is measured here and printed (WINDOWS-MEASURE lines).

import assert from "node:assert/strict";
import { linkSync, symlinkSync, writeFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { cleanup, definitionsFor, mcp, type Node, notesRoot, pin, restoreEnv, startNode, TestIssuer } from "./node.ts";

let issuer: TestIssuer | undefined;
let node: Node | undefined;
let root: string;
const now = (): number => Math.floor(Date.now() / 1000);

before(async () => {
  issuer = await TestIssuer.start();
  root = notesRoot();
  writeFileSync(`${root}/today.md`, "Water the plants.\n");
  writeFileSync(`${root}/../outside.md`, "SECRET OUTSIDE THE ROOT\n");
  node = await startNode(issuer, root, pin(definitionsFor(root), root));
});
after(async () => {
  // Guarded: a start that failed in before() must fail the run, never hang it.
  try {
    await node?.close();
  } finally {
    await issuer?.close();
    restoreEnv();
    cleanup(root);
  }
});

const read = (name: unknown): Promise<{ status: number; text: string }> => {
  if (node === undefined || issuer === undefined) throw new Error("the node did not start");
  return mcp(node.t, "tools/call", { name: "notes.read", arguments: { name } }, { token: issuer.mint(TestIssuer.claims(now())), name: "notes.read" });
};

void describe("notes.read through a teaching node", () => {
  void it("reads a note in the root", async () => {
    const r = await read("today.md");
    console.log(`WINDOWS-MEASURE platform=${process.platform} root=${root} read today.md: ${String(r.status)} ${r.text.includes("Water the plants.") ? "text returned" : r.text}`);
    assert.equal(r.status, 200);
    assert.match(r.text, /Water the plants\./);
  });

  void it("a missing note is a tool error, not a transport one", async () => {
    const r = await read("absent.md");
    assert.equal(r.status, 200);
    assert.match(r.text, /"isError":true/);
  });

  void it("WO §5.1: names that climb, are absolute, carry a NUL or a backslash, or are very long are refused by the pinned schema", async () => {
    const rows: string[] = [];
    for (const name of ["../outside.md", `${root}/../outside.md`, "/etc/passwd", "a\u0000.md", "..\\outside.md", `${"a".repeat(65)}.md`, "today", ".hidden.md", "TODAY.md", 5]) {
      const r = await read(name);
      rows.push(`${JSON.stringify(name).slice(0, 40)} → ${String(r.status)}`);
      assert.equal(r.status, 400, JSON.stringify(name));
      assert.match(r.text, /Invalid arguments for tool notes\.read/);
      assert.ok(!r.text.includes("SECRET"));
    }
    console.log(`WINDOWS-MEASURE platform=${process.platform} refused names: ${rows.join("; ")}`);
  });

  void it("WO §5.1: a symlink planted in the root that points outside is refused by the cage", async () => {
    try {
      symlinkSync(`${root}/../outside.md`, `${root}/planted.md`);
    } catch (err) {
      // Windows without the symlink privilege: nothing can be planted, so nothing can escape by one.
      console.log(`WINDOWS-MEASURE platform=${process.platform} symlink not creatable (${String((err as { code?: unknown }).code)}): case not applicable`);
      assert.equal(process.platform, "win32");
      return;
    }
    const r = await read("planted.md");
    console.log(`WINDOWS-MEASURE platform=${process.platform} planted symlink read: ${String(r.status)} ${r.text.slice(0, 120)}`);
    // Windows: the core's in-process cage compares paths lexically and does not resolve links there;
    // the edition's OS cage is the boundary (architecture §5 *Containment matching*). The outcome is
    // measured and printed above, and asserted on POSIX, where the in-process cage makes the claim.
    if (process.platform !== "win32") {
      assert.ok(!r.text.includes("SECRET"), "the outside file's text never reaches the client");
      assert.equal(r.status, 500);
      assert.match(r.text, /reached outside its containment domain/);
      assert.ok(node?.lines.some((l) => l.startsWith('containment-refused {"tool":"notes.read"')) === true);
    } else {
      // The known Windows limit, asserted so a change in it is seen: the core's in-process cage
      // resolves no links there (architecture §5 *Containment matching*); an OS cage is the boundary.
      assert.equal(r.status, 200, "known limit: a link in the root is followed on Windows by the in-process cage");
      assert.ok(r.text.includes("SECRET"));
    }
  });

  void it("a note larger than a result may be, and a note that is not UTF-8, are tool errors", async () => {
    writeFileSync(`${root}/big.md`, "é".repeat(200_000));
    writeFileSync(`${root}/bytes.md`, Buffer.from([0x68, 0xff, 0x69]));
    const big = await read("big.md");
    const bytes = await read("bytes.md");
    assert.equal(big.status, 200);
    assert.match(big.text, /"isError":true/);
    assert.match(big.text, /larger than a result may be/);
    assert.equal(bytes.status, 200);
    assert.match(bytes.text, /not UTF-8 text/);
  });

  void it("known limit (adversarial A11): a hard link in the root is not a symlink, and the in-process cage follows it", async () => {
    // Stated in the cage (CSR-WO-1002a) and the edition's README: someone with write access to the
    // notes root can place a hard link there; only an OS cage or a read-only mount closes it. Asserted
    // so that a change in the limit is seen.
    try {
      linkSync(`${root}/../outside.md`, `${root}/hard.md`);
    } catch (err) {
      console.log(`KNOWN-LIMIT hard link not creatable here (${String((err as { code?: unknown }).code)})`);
      return;
    }
    const r = await read("hard.md");
    console.log(`KNOWN-LIMIT platform=${process.platform} hard link in the root: ${String(r.status)} ${r.text.includes("SECRET") ? "outside text returned" : r.text.slice(0, 80)}`);
    assert.equal(r.status, 200);
    assert.ok(r.text.includes("SECRET"));
  });
});
