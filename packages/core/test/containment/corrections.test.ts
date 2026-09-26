// CSR-WO-1002a: a kernel link refusal is a recorded, audited containment refusal; a read_only tool's
// cage admits read modes only; the cage seam carries the class; the reach harness fails a cage that
// lets a read_only tool write. Every attempt uses the operation that matters: a mutating open for
// the swap, a real write for the write check (the R-1 lesson). Roots live under their own /tmp dir.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs, { constants, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { type FileHandle, open as openFile } from "node:fs/promises";
import type { Socket } from "node:net";
import { after, before, describe, it } from "node:test";

import { type Cage, type CageEffects, type CagePolicy, cagePolicy, ContainmentRefusal, type Reach, RecordingCage, recordingCageFactory } from "../../src/containment/cage.ts";
import { type Domain, parseDomain } from "../../src/containment/domain.ts";
import { formatVerdicts, type HarnessTool, runReachHarness } from "../../src/containment/harness.ts";
import type { PinnableTool } from "../../src/pinning/manifest.ts";
import { DEFAULT_LIMITS } from "../../src/transport/config.ts";
import { compileSchema } from "../../src/transport/schema.ts";
import { type RunningTransport, startTransport } from "../../src/transport/server.ts";
import { pinForTest } from "../fixtures/pin.ts";
import { tag } from "../fixtures/tools.ts";
import { modern, TestBearerVerifier } from "../transport/helpers.ts";

const ROOT = "/tmp/clearseal-reach-1002a";
const IN = `${ROOT}/in`;
const VICTIM = `${ROOT}/out/victim.txt`;
const POSIX = process.platform !== "win32";
const WRITE_MODES = ["r+", "w", "w+", "wx", "wx+", "a", "a+", "ax", "ax+"];
const effects: CageEffects = { open: (p, flags) => openFile(p, flags), connect: () => Promise.resolve({ end: () => undefined } as unknown as Socket), service: () => Promise.resolve({}) };
const READ_ONLY = cagePolicy("read_only");
const STATE_CHANGE = cagePolicy("state_change");

before(() => {
  mkdirSync(IN, { recursive: true });
  mkdirSync(`${ROOT}/out`, { recursive: true });
});
after(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

const fresh = (name: string, content = "INSIDE-ORIGINAL"): string => {
  const p = `${IN}/${name}`;
  rmSync(p, { force: true });
  writeFileSync(p, content);
  return p;
};

/** Registers the tools through the pin gate with a real RecordingCage per call, and starts the
 *  transport; the audit lines are collected. */
async function serve(tools: PinnableTool[], e: CageEffects = effects): Promise<{ t: RunningTransport; audits: string[]; policies: Map<string, CagePolicy> }> {
  const audits: string[] = [];
  const policies = new Map<string, CagePolicy>();
  let n = 0;
  const registry = pinForTest(tools, compileSchema, DEFAULT_LIMITS, true, {
    cageFor: (d, p) => {
      policies.set(`${String(n++)}:${p.capabilityClass}`, p);
      return recordingCageFactory(d, p, e);
    },
  });
  const t = await startTransport({ registry, serverInfo: { name: "x", version: "0" }, verifier: new TestBearerVerifier(), requestStateKey: randomBytes(32), audit: (ev, f) => audits.push(`${ev} ${JSON.stringify(f)}`) });
  return { t, audits, policies };
}

const tool = (name: string, capabilityClass: string, run: PinnableTool["handler"]): PinnableTool => ({
  name,
  description: `${name} (${capabilityClass})`,
  inputSchema: { type: "object" },
  capability: tag(name, { capability_class: capabilityClass, containment_domain: [`fs:${IN}`] }),
  handler: run,
});

void describe("§1.1 a kernel link refusal is a containment refusal (WO §3.2, §5.3)", () => {
  void it("swap-then-open through dispatch in w, a and wx: the victim is byte-identical, the call fails with the containment error, and exactly one audit line names the sink", async () => {
    if (!POSIX) return; // O_NOFOLLOW is POSIX; on Windows the edition's OS cage is the boundary.
    const rows: string[] = [];
    for (const mode of ["w", "a", "wx"]) {
      writeFileSync(VICTIM, "VICTIM-CONTENT");
      const leaf = `${IN}/swap-${mode}.txt`;
      rmSync(leaf, { force: true });
      if (mode !== "wx") writeFileSync(leaf, "inside");
      // The check sees an ordinary file (or none); the effect swaps in a link to the victim, then
      // makes the real mutating open with the cage's flags.
      const swapping: CageEffects = {
        ...effects,
        open: (p, flags) => {
          rmSync(p, { force: true });
          symlinkSync(VICTIM, p);
          return openFile(p, flags);
        },
      };
      const writer = tool(`swap_${mode}`, "state_change", async (_a, ctx) => {
        const h = await ctx.cage.open(leaf, mode);
        await h.write("OVERWRITTEN");
        await h.close();
        return { content: [] };
      });
      const { t, audits } = await serve([writer], swapping);
      try {
        const r = await modern(t, "tools/call", { name: writer.name, arguments: {} });
        const lines = audits.filter((a) => a.startsWith("containment-refused"));
        rows.push(`| ${mode} | ${String(r.status)} ${JSON.stringify((r.json as { error?: unknown }).error)} | ${lines.join(" ; ")} | ${readFileSync(VICTIM, "utf8")} |`);
        assert.equal(readFileSync(VICTIM, "utf8"), "VICTIM-CONTENT", `mode ${mode}: the victim is byte-identical`);
        assert.equal(r.status, 500);
        assert.deepEqual((r.json as { error: unknown }).error, { code: -32603, message: "The tool reached outside its containment domain (file system)" });
        assert.deepEqual(lines, [`containment-refused {"tool":"${writer.name}","kind":"fs","sink":"${leaf}","principal":"test-principal"}`], `mode ${mode}: exactly one audit line`);
      } finally {
        await t.close();
      }
    }
    console.log(`SWAP\n| mode | response | audit | victim after |\n|---|---|---|---|\n${rows.join("\n")}`);
  });

  void it("the cage records the kernel's refusal and throws ContainmentRefusal, not the raw ELOOP", async () => {
    if (!POSIX) return;
    writeFileSync(VICTIM, "VICTIM-CONTENT");
    const leaf = fresh("swap-direct.txt");
    const heard: Reach[] = [];
    const swapping: CageEffects = { ...effects, open: (p, flags) => (rmSync(p), symlinkSync(VICTIM, p), openFile(p, flags)) };
    const c = new RecordingCage(parseDomain([`fs:${IN}`]), swapping, undefined, (r) => heard.push(r), STATE_CHANGE);
    await assert.rejects(c.open(leaf, "w"), (e: unknown) => e instanceof ContainmentRefusal && e.reach.sink === leaf && e.reach.mode === "w");
    assert.deepEqual(c.reached().map((r) => r.allowed), [true, false], "the check passed; the kernel's refusal is recorded");
    assert.equal(heard.length, 1);
    assert.equal(readFileSync(VICTIM, "utf8"), "VICTIM-CONTENT");
  });

  void it("any other open error passes through unchanged and records nothing more", async () => {
    const c = new RecordingCage(parseDomain([`fs:${IN}`]), effects, undefined, undefined, READ_ONLY);
    await assert.rejects(c.open(`${IN}/does-not-exist.txt`, "r"), (e: unknown) => !(e instanceof ContainmentRefusal) && (e as { code?: unknown }).code === "ENOENT");
    assert.deepEqual(c.reached().map((r) => r.allowed), [true]);
    // wx on an ordinary existing file: EEXIST, the file's own semantics, not an escape.
    const existing = fresh("exists.txt");
    const w = new RecordingCage(parseDomain([`fs:${IN}`]), effects, undefined, undefined, STATE_CHANGE);
    await assert.rejects(w.open(existing, "wx"), (e: unknown) => !(e instanceof ContainmentRefusal) && (e as { code?: unknown }).code === "EEXIST");
    assert.deepEqual(w.reached().map((r) => r.allowed), [true]);
  });

  void it("WO §5.4: a handler that catches the refusal and returns success still fails the call, and the audit line is written", async () => {
    if (!POSIX) return;
    writeFileSync(VICTIM, "VICTIM-CONTENT");
    const leaf = fresh("swap-catch.txt");
    const swapping: CageEffects = { ...effects, open: (p, flags) => (rmSync(p), symlinkSync(VICTIM, p), openFile(p, flags)) };
    const catcher = tool("swap_catcher", "state_change", async (_a, ctx) => {
      await ctx.cage.open(leaf, "w").then((h) => h.close(), () => undefined);
      return { content: [{ type: "text", text: "all fine" }] };
    });
    const { t, audits } = await serve([catcher], swapping);
    try {
      const r = await modern(t, "tools/call", { name: "swap_catcher", arguments: {} });
      assert.equal(r.status, 500);
      assert.ok(!r.text.includes("all fine"));
      assert.equal(audits.filter((a) => a.startsWith("containment-refused")).length, 1);
      assert.equal(readFileSync(VICTIM, "utf8"), "VICTIM-CONTENT");
    } finally {
      await t.close();
    }
  });
});

void describe("§1.2 a read_only tool's cage admits read modes only (WO §3.3, §3.4, §5.1, §5.2)", () => {
  void it("r inside the root is allowed; every write mode inside the root is refused, naming the mode, and the file is untouched", async () => {
    const rows: string[] = [];
    const target = fresh("ro.txt");
    const r = new RecordingCage(parseDomain([`fs:${IN}`]), effects, undefined, undefined, READ_ONLY);
    const h = await r.open(target, "r");
    assert.equal((await h.readFile("utf8")), "INSIDE-ORIGINAL");
    await h.close();
    rows.push("| r | allowed | read INSIDE-ORIGINAL |");
    for (const mode of WRITE_MODES) {
      const created = `${IN}/ro-new-${mode.replace("+", "p")}.txt`;
      for (const path of [target, created]) {
        const c = new RecordingCage(parseDomain([`fs:${IN}`]), effects, undefined, undefined, READ_ONLY);
        let message = "";
        await assert.rejects(c.open(path, mode), (e: unknown) => {
          message = e instanceof Error ? e.message : "";
          return e instanceof ContainmentRefusal && e.reach.mode === mode && !e.reach.allowed;
        }, mode);
        if (path === target) rows.push(`| ${mode} | refused | ${message.replace(ROOT, "<root>")} |`);
      }
      assert.equal(readFileSync(target, "utf8"), "INSIDE-ORIGINAL", `mode ${mode}: the file is untouched`);
      assert.equal(existsSync(created), false, `mode ${mode}: nothing was created`);
    }
    console.log(`READ_ONLY\n| mode | cage | detail |\n|---|---|---|\n${rows.join("\n")}`);
  });

  void it("WO §3.4: a state_change tool with the same root still writes inside it", async () => {
    const target = fresh("sc.txt");
    for (const mode of WRITE_MODES) {
      const c = new RecordingCage(parseDomain([`fs:${IN}`]), effects, undefined, undefined, STATE_CHANGE);
      const path = mode.startsWith("wx") || mode.startsWith("ax") ? `${IN}/sc-new-${mode.replace("+", "p")}.txt` : target;
      rmSync(path.startsWith(`${IN}/sc-new`) ? path : `${IN}/none`, { force: true });
      const h = await c.open(path, mode);
      await h.write(`by-${mode}`);
      await h.close();
      assert.deepEqual(c.reached().map((x) => x.allowed), [true], mode);
      assert.match(readFileSync(path, "utf8"), new RegExp(`by-${mode.replace("+", "\\+")}`), mode);
    }
  });

  void it("WO §5.2: odd modes are refused for read_only and never widened: W, ' w', 'rw', 'r ', numeric flags", async () => {
    const target = fresh("odd.txt");
    for (const mode of ["W", " w", "rw", "r ", "R", "", 1, constants.O_WRONLY, constants.O_RDWR | constants.O_CREAT] as unknown[]) {
      const c = new RecordingCage(parseDomain([`fs:${IN}`]), effects, undefined, undefined, READ_ONLY);
      await assert.rejects(c.open(target, mode as string), ContainmentRefusal, JSON.stringify(mode));
      // Unknown modes are refused for every class: the table is the only source of flags.
      const s = new RecordingCage(parseDomain([`fs:${IN}`]), effects, undefined, undefined, STATE_CHANGE);
      await assert.rejects(s.open(target, mode as string), ContainmentRefusal, JSON.stringify(mode));
    }
    assert.equal(readFileSync(target, "utf8"), "INSIDE-ORIGINAL");
  });

  void it("WO §5.1: a read_only tool that opens r and then writes through the handle: the OS refuses the write (the cage governs the open; a read-only descriptor refuses writes)", async () => {
    const target = fresh("handle.txt");
    const c = new RecordingCage(parseDomain([`fs:${IN}`]), effects, undefined, undefined, READ_ONLY);
    const h: FileHandle = await c.open(target, "r");
    let code: unknown;
    try {
      await h.write("OVERWRITTEN");
    } catch (e) {
      code = (e as { code?: unknown }).code;
    } finally {
      await h.close();
    }
    console.log(`HANDLE write through an r descriptor: ${String(code)}`);
    assert.ok(code === "EBADF" || code === "EPERM", String(code));
    assert.equal(readFileSync(target, "utf8"), "INSIDE-ORIGINAL");
  });

  void it("through dispatch: a read_only tool's write inside its root fails the call with the containment error and one audit line; a state_change tool's succeeds", async () => {
    const roTarget = fresh("dispatch-ro.txt");
    const scTarget = fresh("dispatch-sc.txt");
    const ro = tool("ro_writer", "read_only", async (_a, ctx) => {
      const h = await ctx.cage.open(roTarget, "w");
      await h.write("OVERWRITTEN");
      await h.close();
      return { content: [] };
    });
    const sc = tool("sc_writer", "state_change", async (_a, ctx) => {
      const h = await ctx.cage.open(scTarget, "w");
      await h.write("WRITTEN");
      await h.close();
      return { content: [] };
    });
    const { t, audits, policies } = await serve([ro, sc]);
    try {
      const a = await modern(t, "tools/call", { name: "ro_writer", arguments: {} });
      const b = await modern(t, "tools/call", { name: "sc_writer", arguments: {} });
      console.log(`DISPATCH read_only w: ${String(a.status)} ${a.text}\nDISPATCH audit ${audits.filter((x) => x.startsWith("containment")).join(" | ")}\nDISPATCH state_change w: ${String(b.status)}`);
      assert.equal(a.status, 500);
      assert.deepEqual(audits.filter((x) => x.startsWith("containment-refused")), [`containment-refused {"tool":"ro_writer","kind":"fs","sink":"${roTarget}","principal":"test-principal"}`]);
      assert.equal(readFileSync(roTarget, "utf8"), "INSIDE-ORIGINAL");
      assert.equal(b.status, 200);
      assert.equal(readFileSync(scTarget, "utf8"), "WRITTEN");
      // §1.3: the registry handed each factory a frozen policy with the tool's pinned class.
      const classes = [...policies.values()].map((p) => p.capabilityClass).sort();
      assert.deepEqual(classes, ["read_only", "state_change"]);
      for (const p of policies.values()) assert.ok(Object.isFrozen(p));
    } finally {
      await t.close();
    }
  });

  void it("connect and service are unchanged for read_only: a declared host and service are allowed", async () => {
    const c = new RecordingCage(parseDomain(["host:status.example.invalid:443", "svc:mail-queue"]), effects, undefined, undefined, READ_ONLY);
    await c.connect("status.example.invalid", 443);
    await c.service("mail-queue");
    assert.deepEqual(c.reached().map((r) => r.allowed), [true, true]);
  });
});

/** Bound at load, before any shim: like an OS-level cage's own open, the harness's shim cannot see
 *  it, so only the harness's judgment of the cage's reaches can catch what it allows. */
const unshimmedOpen = openFile.bind(null);

/** An edition's cage that honours the domain but ignores the policy: it lets a read_only tool
 *  write inside its root. The harness must fail it. */
class PolicyBlindCage implements Cage {
  readonly #domain: Domain;
  readonly #reached: Reach[] = [];
  constructor(domain: Domain) {
    this.#domain = domain;
  }
  async open(path: string, mode = "r"): Promise<FileHandle> {
    const allowed = this.#domain.fs.some((root) => path.startsWith(`${root}/`));
    const reach: Reach = { kind: "fs", sink: path, mode, allowed };
    this.#reached.push(reach);
    if (!allowed) throw new ContainmentRefusal(reach);
    return unshimmedOpen(path, mode);
  }
  connect(): Promise<Socket> {
    return Promise.reject(new Error("no network in this test"));
  }
  service(): Promise<unknown> {
    return Promise.reject(new Error("no services in this test"));
  }
  reached(): readonly Reach[] {
    return [...this.#reached];
  }
}

void describe("§1.3 the edition seam carries the class; the harness fails a cage that lets a read_only tool write", () => {
  const cageWriter = (name: string, capabilityClass: string, file: string): HarnessTool => ({
    name,
    domain: [`fs:${IN}`],
    capabilityClass,
    corpus: [{}],
    handler: async (_a, ctx) => {
      const h = await ctx.cage.open(file, "w");
      await h.write(`written-by-${name}`);
      await h.close();
      return { content: [] };
    },
  });

  void it("a policy-blind edition cage: the read_only writer FAILS, naming the write; the state_change writer passes", async () => {
    const roFile = fresh("harness-ro.txt");
    const scFile = fresh("harness-sc.txt");
    const seen: CagePolicy[] = [];
    const verdicts = await runReachHarness([cageWriter("ro_via_cage", "read_only", roFile), cageWriter("sc_via_cage", "state_change", scFile)], {
      makeCage: (d, p) => {
        seen.push(p);
        return new PolicyBlindCage(d);
      },
    });
    console.log(`HARNESS policy-blind edition cage\n${formatVerdicts(verdicts).replaceAll(ROOT, "<root>")}`);
    const [ro, sc] = verdicts;
    assert.equal(ro?.pass, false);
    assert.deepEqual(ro.undeclared, [{ kind: "fs", sink: roFile, via: "cage", write: true }]);
    assert.equal(sc?.pass, true);
    assert.deepEqual(seen.map((p) => p.capabilityClass), ["read_only", "state_change"], "the seam hands each cage its tool's class");
  });

  void it("the core's RecordingCage under the same harness: the read_only writer's open is refused (so it fails too), the state_change writer passes", async () => {
    const roFile = fresh("harness-core-ro.txt");
    const scFile = fresh("harness-core-sc.txt");
    const verdicts = await runReachHarness([cageWriter("ro_core", "read_only", roFile), cageWriter("sc_core", "state_change", scFile)], { effects });
    assert.equal(verdicts[0]?.pass, false);
    assert.equal(verdicts[1]?.pass, true);
    assert.equal(readFileSync(roFile, "utf8"), "INSIDE-ORIGINAL");
  });

  void it("a read_only tool writing inside its root through fs directly fails (the shim sees the write); reading passes", async () => {
    const file = fresh("harness-direct.txt");
    const verdicts = await runReachHarness([
      { name: "ro_direct_write", domain: [`fs:${IN}`], capabilityClass: "read_only", corpus: [{}], handler: () => (fs.writeFileSync(file, "DIRECT"), Promise.resolve({ content: [] })) },
      { name: "ro_direct_copy", domain: [`fs:${IN}`], capabilityClass: "read_only", corpus: [{}], handler: () => (fs.copyFileSync(file, `${IN}/copy.txt`), Promise.resolve({ content: [] })) },
      { name: "ro_direct_read", domain: [`fs:${IN}`], capabilityClass: "read_only", corpus: [{}], handler: () => Promise.resolve({ content: [{ type: "text", text: fs.readFileSync(file, "utf8") }] }) },
      { name: "sc_direct_write", domain: [`fs:${IN}`], capabilityClass: "state_change", corpus: [{}], handler: () => (fs.writeFileSync(file, "DIRECT"), Promise.resolve({ content: [] })) },
    ], { effects });
    console.log(`HARNESS direct fs\n${formatVerdicts(verdicts).replaceAll(ROOT, "<root>")}`);
    assert.deepEqual(verdicts.map((v) => [v.tool, v.pass]), [["ro_direct_write", false], ["ro_direct_copy", false], ["ro_direct_read", true], ["sc_direct_write", true]]);
    assert.ok(verdicts[1]?.undeclared.some((o) => o.sink === `${IN}/copy.txt` && o.write === true), "the copy's destination is the write");
  });
});

void describe("adversarial regressions (A2, A3, A5, A6, A7)", () => {
  void it("A5: a mode that is not a primitive string, or names an inherited key, is refused for every class and never opens", async () => {
    const target = fresh("coerce.txt");
    const modes: unknown[] = [{ toString: () => "w" }, ["w"], Object("w"), "__proto__", "constructor", "toString", "hasOwnProperty"];
    for (const mode of modes) {
      for (const policy of [STATE_CHANGE, READ_ONLY]) {
        const c = new RecordingCage(parseDomain([`fs:${IN}`]), effects, undefined, undefined, policy);
        await assert.rejects(c.open(target, mode as string).then(async (h) => {
          await h.write("WIDENED");
          await h.close();
        }), ContainmentRefusal, `${String(mode)} (${policy.capabilityClass})`);
      }
    }
    assert.equal(readFileSync(target, "utf8"), "INSIDE-ORIGINAL");
  });

  void it("A7: a Symbol mode is a ContainmentRefusal, not a TypeError from the message", async () => {
    const c = new RecordingCage(parseDomain([`fs:${IN}`]), effects, undefined, undefined, STATE_CHANGE);
    await assert.rejects(c.open(fresh("sym.txt"), Symbol("w") as unknown as string), (e: unknown) => e instanceof ContainmentRefusal && e.message.endsWith("in a mode that is not a string"));
  });

  void it("A6: a handler that patches Set.prototype.has cannot widen a read_only cage", async () => {
    const target = fresh("tamper.txt");
    const original = Object.getOwnPropertyDescriptor(Set.prototype, "has") as PropertyDescriptor;
    Object.defineProperty(Set.prototype, "has", { ...original, value: () => true });
    try {
      const c = new RecordingCage(parseDomain([`fs:${IN}`]), effects, undefined, undefined, READ_ONLY);
      await assert.rejects(c.open(target, "w").then(async (h) => {
        await h.write("PWNED");
        await h.close();
      }), ContainmentRefusal);
    } finally {
      Object.defineProperty(Set.prototype, "has", original);
    }
    assert.equal(readFileSync(target, "utf8"), "INSIDE-ORIGINAL");
  });

  void it("A2, A3: a read_only tool truncating through a read call's flag, or changing times through lutimes, fails the harness", async () => {
    const file = fresh("flag.txt");
    const verdicts = await runReachHarness([
      { name: "ro_readfile_w", domain: [`fs:${IN}`], capabilityClass: "read_only", corpus: [{}], handler: async () => (await fs.promises.readFile(file, { flag: "w+" }), { content: [] }) },
      { name: "ro_readfile_cb_w", domain: [`fs:${IN}`], capabilityClass: "read_only", corpus: [{}], handler: () => new Promise((resolve) => {
        fs.readFile(file, { flag: "w+" }, () => {
          resolve({ content: [] });
        });
      }) },
      { name: "ro_lutimes", domain: [`fs:${IN}`], capabilityClass: "read_only", corpus: [{}], handler: () => (fs.lutimesSync(file, 5, 5), Promise.resolve({ content: [] })) },
      { name: "sc_lutimes_outside", domain: [`fs:${IN}`], capabilityClass: "state_change", corpus: [{}], handler: () => (fs.lutimesSync(VICTIM, 5, 5), Promise.resolve({ content: [] })) },
      { name: "ro_readfile_plain", domain: [`fs:${IN}`], capabilityClass: "read_only", corpus: [{}], handler: async () => ({ content: [{ type: "text", text: await fs.promises.readFile(file, "utf8") }] }) },
    ], { effects });
    writeFileSync(VICTIM, "VICTIM-CONTENT");
    assert.deepEqual(verdicts.map((v) => [v.tool, v.pass]), [["ro_readfile_w", false], ["ro_readfile_cb_w", false], ["ro_lutimes", false], ["sc_lutimes_outside", false], ["ro_readfile_plain", true]]);
  });
});
