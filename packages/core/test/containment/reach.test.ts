// CSR-WO-1002 §1.2, §1.5, §1.6, §3.3–§3.6 and the §5 cases: the RecordingCage, the reach harness
// over the fixtures, and the dispatch refusal with its audit line.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { Socket } from "node:net";
import { after, before, describe, it } from "node:test";

import { type CageEffects, ContainmentRefusal, RecordingCage, recordingCageFactory } from "../../src/containment/cage.ts";
import { parseDomain } from "../../src/containment/domain.ts";
import { formatVerdicts, runReachHarness } from "../../src/containment/harness.ts";
import type { PinnableTool } from "../../src/pinning/manifest.ts";
import { loadPinnedRegistry } from "../../src/pinning/registry.ts";
import { DEFAULT_LIMITS } from "../../src/transport/config.ts";
import { compileSchema } from "../../src/transport/schema.ts";
import { startTransport } from "../../src/transport/server.ts";
import { definitions, harnessTools, NOTES, OUTSIDE, REACH_ROOT } from "../fixtures/containment-tools.ts";
import { pinForTest } from "../fixtures/pin.ts";
import { tag } from "../fixtures/tools.ts";
import { modern, TestBearerVerifier } from "../transport/helpers.ts";

/** Allowed network reaches never leave the process in tests. */
const effects: CageEffects = {
  open: (path, mode) => import("node:fs/promises").then((fsp) => fsp.open(path, mode)),
  connect: () => Promise.resolve({ end: () => undefined } as unknown as Socket),
  service: (name) => Promise.resolve({ name }),
};

before(() => {
  mkdirSync(NOTES, { recursive: true });
  mkdirSync(`${REACH_ROOT}/outside`, { recursive: true });
  writeFileSync(`${NOTES}/today.txt`, "a note");
  writeFileSync(OUTSIDE, "not yours");
});
after(() => {
  rmSync(REACH_ROOT, { recursive: true, force: true });
});

void describe("the reach harness over the fixtures (WO §3.3)", () => {
  void it("three pass with their reaches listed; the misbehaving one fails, naming the tool and the sink", async () => {
    const verdicts = await runReachHarness(harnessTools, { effects });
    console.log(`HARNESS\n${formatVerdicts(verdicts)}`);
    const byName = new Map(verdicts.map((v) => [v.tool, v]));
    assert.equal(byName.get("read_note")?.pass, true);
    assert.equal(byName.get("fetch_status")?.pass, true);
    assert.equal(byName.get("pure_sum")?.pass, true);
    assert.deepEqual(byName.get("pure_sum")?.reaches, [], "a null domain observes zero reaches");
    const leaky = byName.get("leaky");
    assert.equal(leaky?.pass, false);
    assert.deepEqual(leaky.undeclared, [{ kind: "fs", sink: OUTSIDE, via: "shim" }]);
  });

  void it("WO §5.4: a handler that spawns a child process is an undeclared reach, and the harness never runs it", async () => {
    const spawner = { name: "spawner", domain: null, capabilityClass: "read_only", corpus: [{}], handler: async () => {
      const cp = await import("node:child_process");
      cp.execFileSync("node", ["--version"]);
      return { content: [] };
    } };
    const [v] = await runReachHarness([spawner], { effects });
    assert.equal(v?.pass, false);
    assert.ok(v.undeclared.some((o) => o.kind === "spawn" && o.sink === "node" && o.via === "shim"), JSON.stringify(v.undeclared));
  });
});

void describe("the RecordingCage (WO §1.2, §5)", () => {
  const cage = (entries: string[] | null): RecordingCage => new RecordingCage(parseDomain(entries), effects);

  void it("records every reach, allowed or refused, and refuses undeclared ones with the sink named", async () => {
    const c = cage([`fs:${NOTES}`, "host:status.example.invalid:443", "svc:mail-queue"]);
    await (await c.open(`${NOTES}/today.txt`)).close();
    await c.connect("Status.Example.Invalid", 443);
    await c.service("mail-queue");
    await assert.rejects(c.connect("status.example.invalid", 80), ContainmentRefusal);
    await assert.rejects(c.service("other"), ContainmentRefusal);
    assert.deepEqual(c.reached().map((r) => [r.kind, r.allowed]), [["fs", true], ["net", true], ["svc", true], ["net", false], ["svc", false]]);
  });

  void it("WO §5.2: a path that climbs out with .. is refused", async () => {
    await assert.rejects(cage([`fs:${NOTES}`]).open(`${NOTES}/../outside/secret.txt`), (e: unknown) => e instanceof ContainmentRefusal && e.reach.sink.endsWith("secret.txt"));
    await assert.rejects(cage([`fs:${NOTES}`]).open("today.txt"), ContainmentRefusal, "a relative path is never inside a root");
  });

  void it("WO §5.1: a symlink inside the root that points outside it is refused (POSIX: the real path is checked)", async () => {
    const link = `${NOTES}/escape.txt`;
    rmSync(link, { force: true });
    try {
      symlinkSync(OUTSIDE, link);
    } catch {
      // Windows without symlink rights: the RecordingCage does not resolve links there, by design.
      assert.equal(process.platform, "win32");
      return;
    }
    const result = cage([`fs:${NOTES}`]).open(link);
    if (process.platform === "win32") {
      await result.then((h) => h.close()).catch(() => undefined);
      return; // Documented: on Windows the edition's OS cage is the boundary for links.
    }
    await assert.rejects(result, ContainmentRefusal);
  });

  void it("WO §5.3: names, not addresses: a declared host reached by an address literal is refused", async () => {
    await assert.rejects(cage(["host:localhost"]).connect("127.0.0.1", 443), ContainmentRefusal);
  });

  void it("WO §5.5: a 10,000-entry domain parses and checks quickly", async () => {
    const entries = Array.from({ length: 10_000 }, (_, i) => `fs:/tmp/clearseal-reach/r${String(i).padStart(5, "0")}`);
    const t0 = performance.now();
    const domain = parseDomain(entries);
    const t1 = performance.now();
    const c = new RecordingCage(domain, effects);
    await assert.rejects(c.open("/tmp/clearseal-reach/zzz"), ContainmentRefusal);
    const t2 = performance.now();
    console.log(`SCALE parse 10000 entries ${(t1 - t0).toFixed(1)} ms; cage + one refused check ${(t2 - t1).toFixed(1)} ms`);
    assert.ok(t2 - t0 < 2000);
  });
});

void describe("dispatch runs every handler inside a per-call cage (WO §1.6, §3.4, §5.6)", () => {
  const nullReacher: PinnableTool = {
    name: "null_reacher",
    description: "Declares nothing, then asks its cage for a file.",
    inputSchema: { type: "object" },
    capability: tag("null_reacher"),
    handler: async (_args, ctx) => {
      await ctx.cage.open(OUTSIDE, "r");
      return { content: [] };
    },
  };
  const swallower: PinnableTool = { ...nullReacher, name: "swallower", handler: async (_args, ctx) => {
    await ctx.cage.open(OUTSIDE, "r").catch(() => undefined);
    return { content: [{ type: "text", text: "I caught it" }] };
  } };

  void it("a null-domain tool that reaches is refused: -32603 names the kind, the audit seam gets the path", async () => {
    const audits: string[] = [];
    const registry = pinForTest([nullReacher, swallower], compileSchema, DEFAULT_LIMITS, true, { cageFor: (d, p) => recordingCageFactory(d, p, effects) });
    const t = await startTransport({ registry, serverInfo: { name: "x", version: "0" }, verifier: new TestBearerVerifier(), requestStateKey: randomBytes(32), audit: (e, f) => audits.push(`${e} ${JSON.stringify(f)}`) });
    try {
      const r = await modern(t, "tools/call", { name: "null_reacher", arguments: {} });
      const s = await modern(t, "tools/call", { name: "swallower", arguments: {} });
      console.log(`DISPATCH response ${String(r.status)} ${r.text}\nDISPATCH audit ${audits.filter((a) => a.startsWith("containment")).join(" | ")}`);
      assert.equal(r.status, 500);
      assert.deepEqual((r.json as { error: unknown }).error, { code: -32603, message: "The tool reached outside its containment domain (file system)" });
      assert.ok(!r.text.includes(OUTSIDE) && !r.text.includes("secret"), "the path never reaches the response");
      assert.ok(audits.includes(`containment-refused {"tool":"null_reacher","kind":"fs","sink":"${OUTSIDE}","principal":"test-principal"}`));
      assert.equal(s.status, 500, "a handler that swallows the refusal still fails the call (N4)");
    } finally {
      await t.close();
    }
  });

  void it("the pinned fixtures run through dispatch; cages never leak across concurrent calls", async () => {
    const registry = loadPinnedRegistry(new URL("../fixtures/containment-manifest.json", import.meta.url), definitions, { compile: compileSchema, limits: DEFAULT_LIMITS, cageFor: (d, p) => recordingCageFactory(d, p, effects) });
    const t = await startTransport({ registry, serverInfo: { name: "x", version: "0" }, verifier: new TestBearerVerifier(), requestStateKey: randomBytes(32), audit: () => undefined });
    try {
      const calls = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? modern(t, "tools/call", { name: "read_note", arguments: { file: "today.txt" } }) : modern(t, "tools/call", { name: "pure_sum", arguments: { a: i, b: 1 } }))));
      for (const [i, c] of calls.entries()) assert.equal(c.status, 200, `call ${String(i)}: ${c.text}`);
      assert.match(calls[0]?.text ?? "", /a note/);
      const net = await modern(t, "tools/call", { name: "fetch_status", arguments: {} });
      assert.equal(net.status, 200, net.text);
    } finally {
      await t.close();
    }
  });
});
