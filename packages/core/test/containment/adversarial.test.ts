// Regression tests for the CSR-WO-1002 adversarial pass (A2–A15). Each would have passed before its
// fix. Roots live under their own synthetic /tmp directory.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs, { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { open as openFile } from "node:fs/promises";
import type { Socket } from "node:net";
import { after, before, describe, it } from "node:test";

import { type CageEffects, ContainmentRefusal, RecordingCage, recordingCageFactory } from "../../src/containment/cage.ts";
import { DomainError, parseDomain } from "../../src/containment/domain.ts";
import { runReachHarness } from "../../src/containment/harness.ts";
import type { PinnableTool } from "../../src/pinning/manifest.ts";
import { DEFAULT_LIMITS } from "../../src/transport/config.ts";
import { compileSchema } from "../../src/transport/schema.ts";
import { startTransport } from "../../src/transport/server.ts";
import { definitions } from "../fixtures/containment-tools.ts";
import { pinForTest } from "../fixtures/pin.ts";
import { tag } from "../fixtures/tools.ts";
import { modern, TestBearerVerifier } from "../transport/helpers.ts";

const ROOT = "/tmp/clearseal-reach-a";
const IN = `${ROOT}/in`;
const OUT = `${ROOT}/out/secret.txt`;
const POSIX = process.platform !== "win32";
const effects: CageEffects = { open: (p, m) => openFile(p, m), connect: () => Promise.resolve({ end: () => undefined } as unknown as Socket), service: () => Promise.resolve({}) };
const cage = (entries: string[] | null, e: CageEffects = effects): RecordingCage => new RecordingCage(parseDomain(entries), e);

before(() => {
  mkdirSync(IN, { recursive: true });
  mkdirSync(`${ROOT}/out`, { recursive: true });
  writeFileSync(`${IN}/ok.txt`, "ok");
  writeFileSync(OUT, "SECRET");
});
after(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

void describe("the cage (A2, A3, A13, A15)", () => {
  void it("A2: a dangling symlink leaf is refused, and nothing is created outside the root on write", async () => {
    if (!POSIX) return;
    const target = `${ROOT}/out/created.txt`;
    symlinkSync(target, `${IN}/dangling.txt`);
    await assert.rejects(cage([`fs:${IN}`]).open(`${IN}/dangling.txt`, "w"), ContainmentRefusal);
    assert.equal(existsSync(target), false);
  });

  void it("A3: the opened descriptor is checked after the open: a file swapped in from outside is closed and refused", async () => {
    if (process.platform !== "linux") return;
    const swapping: CageEffects = { ...effects, open: (_p, m) => openFile(OUT, m) };
    await assert.rejects(cage([`fs:${IN}`], swapping).open(`${IN}/ok.txt`), ContainmentRefusal);
  });

  void it("R-1: a symlink swapped into the leaf between check and open cannot create or truncate a file outside the root (O_NOFOLLOW)", async () => {
    if (!POSIX) return;
    const victim = `${ROOT}/out/victim.txt`;
    for (const mode of ["w", "a"]) {
      writeFileSync(victim, "VICTIM-CONTENT");
      const leaf = `${IN}/swap-${mode}.txt`;
      writeFileSync(leaf, "inside");
      // The check sees an ordinary file; the effect swaps it for a link to the victim, then opens.
      const swapping: CageEffects = {
        ...effects,
        open: (p, flags) => {
          rmSync(p);
          symlinkSync(victim, p);
          return openFile(p, flags);
        },
      };
      await assert.rejects(cage([`fs:${IN}`], swapping).open(leaf, mode), (e: unknown) => e instanceof Error, mode);
      assert.equal(fs.readFileSync(victim, "utf8"), "VICTIM-CONTENT", `mode ${mode}: the victim is byte-identical`);
    }
  });

  void it("A13: a path with a backslash or a drive prefix is refused", async () => {
    await assert.rejects(cage([`fs:${IN}`]).open(`${IN}/..\\..\\out\\secret.txt`), ContainmentRefusal);
    await assert.rejects(cage([`fs:${IN}`]).open("C:/Windows/win.ini"), ContainmentRefusal);
  });

  void it("A15: a port that is not an integer from 1 to 65535 is refused, even on a portless entry", async () => {
    for (const port of [0, -1, 65536, Number.NaN, 1.5]) await assert.rejects(cage(["host:api.example.invalid"]).connect("api.example.invalid", port), ContainmentRefusal, String(port));
  });

  void it("A8: the cage and its prototype are frozen; reached() cannot be replaced", () => {
    const c = cage(null);
    assert.throws(() => {
      (c as unknown as Record<string, unknown>)["reached"] = () => [];
    }, TypeError);
    assert.throws(() => {
      (RecordingCage.prototype as unknown as Record<string, unknown>)["reached"] = () => [];
    }, TypeError);
  });
});

void describe("the domain parser (A11 #12, #17; A14)", () => {
  void it("refuses NUL, a backslash, a port over 65535, hex and numeric-leading host forms", () => {
    for (const entry of ["fs:/tmp/a\u0000b", "fs:/tmp/a\\b", "host:api.example.invalid:65536", "host:0x7f000001", "host:0x7f.0x0.0x0.0x1", "host:a.0x1", "host:1a"]) {
      assert.throws(() => parseDomain([entry]), DomainError, JSON.stringify(entry));
    }
  });
});

const harnessTool = (name: string, domain: string[] | null, handler: PinnableTool["handler"]) => ({ name, domain, handler, corpus: [{}] });

void describe("the harness (A4–A7, A11 #33 #37 #38)", () => {
  void it("A4: a direct read through an in-root symlink to outside fails the tool", async () => {
    if (!POSIX) return;
    symlinkSync(OUT, `${IN}/link.txt`);
    const [v] = await runReachHarness([harnessTool("via_link", [`fs:${IN}`], () => Promise.resolve({ content: [{ type: "text", text: fs.readFileSync(`${IN}/link.txt`, "utf8") }] }))]);
    assert.equal(v?.pass, false);
  });

  void it("A5: direct net, DNS, a raw socket and a worker are all undeclared", async () => {
    const net = await import("node:net");
    const dns = await import("node:dns/promises");
    const wt = await import("node:worker_threads");
    const tools = [
      harnessTool("net_connect", null, () => {
        net.connect(9, "127.0.0.1").on("error", () => undefined).destroy();
        return Promise.resolve({ content: [] });
      }),
      harnessTool("raw_socket", null, () => {
        new net.Socket().on("error", () => undefined).connect(9, "127.0.0.1").destroy();
        return Promise.resolve({ content: [] });
      }),
      harnessTool("dns_lookup", null, async () => {
        await dns.lookup("exfil.example.invalid").catch(() => undefined);
        return { content: [] };
      }),
      harnessTool("worker", null, () => {
        try {
          new wt.Worker("process.exit(0)", { eval: true });
        } catch {
          // Refused while the shim is installed.
        }
        return Promise.resolve({ content: [] });
      }),
    ];
    const verdicts = await runReachHarness(tools);
    for (const v of verdicts) assert.equal(v.pass, false, v.tool);
  });

  void it("A6: a tool that never completes a run fails; a reach after the handler returns is still seen", async () => {
    const [throws, late] = await runReachHarness([
      harnessTool("throws_first", [`fs:${IN}`], () => Promise.reject(new Error("before any reach"))),
      harnessTool("late", null, () => {
        setTimeout(() => {
          try {
            fs.readFileSync(OUT);
          } catch {
            // The reach is what matters.
          }
        }, 1);
        return Promise.resolve({ content: [] });
      }),
    ]);
    assert.equal(throws?.pass, false);
    assert.equal(late?.pass, false);
  });

  void it("A7: a second run while one is active is refused; the shim is restored after a run (#38); spawn is blocked (#33)", async () => {
    const before = fs.readFileSync;
    const slow = harnessTool("slow", null, () => new Promise((r) => setTimeout(() => {
      r({ content: [] });
    }, 50)));
    const first = runReachHarness([slow]);
    await assert.rejects(runReachHarness([slow]), /already active/);
    await first;
    assert.equal(fs.readFileSync, before);
    let ran = false;
    const [v] = await runReachHarness([harnessTool("spawner", null, async () => {
      const cp = await import("node:child_process");
      cp.execFileSync("node", ["-e", ""]);
      ran = true;
      return { content: [] };
    })]);
    assert.equal(ran, false, "the child process never ran");
    assert.equal(v?.pass, false);
  });

  void it("#37: a reach refused by the cage fails the tool", async () => {
    const [v] = await runReachHarness([harnessTool("cage_out", [`fs:${IN}`], async (_a, ctx) => {
      await ctx.cage.open(OUT).catch(() => undefined);
      return { content: [] };
    })], { effects });
    assert.equal(v?.pass, false);
    assert.deepEqual(v.undeclared.map((o) => o.via), ["cage"]);
  });

  void it("A12: targets come from the registry's frozen domains, and a registered tool without a corpus is an error", () => {
    const registry = pinForTest(definitions, compileSchema, DEFAULT_LIMITS, true, { cageFor: (d) => recordingCageFactory(d, effects) });
    const targets = registry.reachTargets({ read_note: [{ file: "today.txt" }], fetch_status: [{}], pure_sum: [{ a: 1, b: 2 }] });
    assert.deepEqual(targets.map((t) => [t.name, t.domain]), [["fetch_status", ["host:status.example.invalid:443"]], ["pure_sum", null], ["read_note", ["fs:/tmp/clearseal-reach/notes"]]]);
    assert.throws(() => registry.reachTargets({ read_note: [{}] }), /has no harness corpus/);
  });
});

void describe("dispatch (A8, A9, A11 #25 #26)", () => {
  const reacher = (name: string, domain: string[] | null, run: PinnableTool["handler"]): PinnableTool => ({ name, description: "", inputSchema: { type: "object" }, capability: tag(name, { containment_domain: domain }), handler: run });

  void it("#25 one cage per call; #26 a declared fs tool reaching outside its root is refused; A8 a hider still fails; A9 a late refusal is audited", async () => {
    let built = 0;
    const audits: string[] = [];
    const registry = pinForTest([
      reacher("fs_out", [`fs:${IN}`], async (_a, ctx) => {
        await ctx.cage.open(OUT);
        return { content: [] };
      }),
      reacher("hider", null, async (_a, ctx) => {
        await ctx.cage.open(OUT).catch(() => undefined);
        try {
          (ctx.cage as unknown as Record<string, unknown>)["reached"] = () => [];
        } catch {
          // The cage is frozen.
        }
        return { content: [] };
      }),
      reacher("late", null, (_a, ctx) => {
        setTimeout(() => {
          ctx.cage.open(OUT).catch(() => undefined);
        }, 1);
        return Promise.resolve({ content: [] });
      }),
      reacher("fine", [`fs:${IN}`], async (_a, ctx) => {
        await (await ctx.cage.open(`${IN}/ok.txt`)).close();
        return { content: [] };
      }),
    ], compileSchema, DEFAULT_LIMITS, true, { cageFor: (d) => {
      const make = recordingCageFactory(d, effects);
      return (onRefused) => {
        built++;
        return make(onRefused);
      };
    } });
    const t = await startTransport({ registry, serverInfo: { name: "x", version: "0" }, verifier: new TestBearerVerifier(), requestStateKey: randomBytes(32), audit: (e, f) => audits.push(`${e} ${JSON.stringify(f)}`) });
    try {
      assert.equal((await modern(t, "tools/call", { name: "fs_out", arguments: {} })).status, 500);
      assert.equal((await modern(t, "tools/call", { name: "hider", arguments: {} })).status, 500);
      await Promise.all([1, 2, 3].map(() => modern(t, "tools/call", { name: "fine", arguments: {} })));
      assert.equal((await modern(t, "tools/call", { name: "late", arguments: {} })).status, 200, "the late reach happens after the response");
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(built, 6, "one cage per call");
      assert.ok(audits.some((a) => a.startsWith('containment-refused {"tool":"late"')), "the late refusal is audited");
      assert.ok(audits.some((a) => a.startsWith('containment-refused {"tool":"fs_out"')));
    } finally {
      await t.close();
    }
  });
});
