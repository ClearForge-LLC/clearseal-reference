// CSR-WO-1006 §1.2 (N4): the cage opens regular files only, and never waits. Every attempt is the
// operation that matters: a real open of a real FIFO, socket, device or directory inside a declared
// root, including one swapped in between the cage's lstat and its open, and a started node that
// is sent more FIFO reads than it has slots. A refusal must come well inside the handler timeout,
// be recorded naming the file type, and leave the slot free.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { type FileHandle, open as openFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { after, before, describe, it } from "node:test";

import { type CageEffects, cagePolicy, ContainmentRefusal, type Reach, RecordingCage, recordingCageFactory } from "../../src/containment/cage.ts";
import { parseDomain } from "../../src/containment/domain.ts";
import { DEFAULT_LIMITS } from "../../src/transport/config.ts";
import { compileSchema } from "../../src/transport/schema.ts";
import { startTransport } from "../../src/transport/server.ts";
import { pinForTest } from "../fixtures/pin.ts";
import { tag } from "../fixtures/tools.ts";
import { modern, TestBearerVerifier } from "../transport/helpers.ts";

const POSIX = process.platform !== "win32";
const BASE = `/tmp/clearseal-regular-${randomBytes(6).toString("hex")}`;
const ROOT = `${BASE}/root`;
const REGULAR = `${ROOT}/regular.txt`;
const FIFO = `${ROOT}/fifo`;
const SOCKET = `${ROOT}/socket`;
const TIMEOUT_MS = 3_000;
const WRITER = cagePolicy("state_change");
const evidence: string[] = [];
let server: Server | undefined;

before(async () => {
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(REGULAR, "regular\n");
  if (POSIX) {
    execFileSync("mkfifo", [FIFO]);
    server = createServer();
    await new Promise<void>((resolve) => server?.listen(SOCKET, resolve));
  }
});
after(async () => {
  await new Promise<void>((resolve) => (server === undefined ? resolve() : server.close(() => resolve())));
  rmSync(BASE, { recursive: true, force: true });
  console.log(evidence.join("\n"));
});

const domainFor = (...roots: string[]) => parseDomain(roots.map((r) => `fs:${r}`));

/** Opens through a cage and returns how it ended, how long it took, and the refused record. */
async function tryOpen(cage: RecordingCage, path: string, mode: string): Promise<{ refused: Reach | undefined; ms: number; opened: boolean; error: string | undefined }> {
  const t0 = performance.now();
  let opened = false;
  let error: string | undefined;
  try {
    const h = await cage.open(path, mode);
    opened = true;
    await h.close();
  } catch (err) {
    error = err instanceof ContainmentRefusal ? "ContainmentRefusal" : ((err as { code?: string }).code ?? String(err));
  }
  return { refused: cage.reached().find((r) => !r.allowed), ms: performance.now() - t0, opened, error };
}

const row = (label: string, r: Awaited<ReturnType<typeof tryOpen>>): string => `REGULAR ${label}: ${r.error ?? "opened"} fileType=${String(r.refused?.fileType)} in ${r.ms.toFixed(1)} ms`;

/** Effects that, just before the real open, replace the path with something else: the swap between
 *  the cage's lstat and its open. */
function swapBeforeOpen(swap: (path: string) => void | Promise<void>): CageEffects {
  return {
    open: async (p, flags): Promise<FileHandle> => {
      await swap(p);
      return openFile(p, flags);
    },
    connect: () => Promise.resolve({ end: () => undefined } as unknown as Socket),
    service: () => Promise.resolve({}),
  };
}

void describe("CSR-WO-1006 §1.2: regular files only, and the open never waits", () => {
  void it("a regular file inside the root still opens, for reading and for writing", async () => {
    for (const mode of ["r", "r+", "a"]) {
      const r = await tryOpen(new RecordingCage(domainFor(ROOT), undefined, undefined, undefined, WRITER), REGULAR, mode);
      assert.equal(r.opened, true, mode);
      assert.equal(r.refused, undefined, mode);
    }
  });

  void it("a directory inside the root is refused as a directory (every platform)", async () => {
    const r = await tryOpen(new RecordingCage(domainFor(BASE)), ROOT, "r");
    assert.equal(r.error, "ContainmentRefusal");
    assert.equal(r.refused?.fileType, "directory");
    evidence.push(row("directory, mode r", r));
  });

  void it("a FIFO inside the root is refused as a fifo, for reading and for writing, at once", { timeout: TIMEOUT_MS * 2 }, async () => {
    if (!POSIX) {
      assert.equal(process.platform, "win32", "a FIFO is POSIX; on Windows the directory and swap cases stand");
      return;
    }
    for (const mode of ["r", "w", "a", "r+"]) {
      const r = await tryOpen(new RecordingCage(domainFor(ROOT), undefined, undefined, undefined, WRITER), FIFO, mode);
      assert.equal(r.error, "ContainmentRefusal", mode);
      assert.equal(r.refused?.fileType, "fifo", mode);
      assert.ok(r.ms < 500, `mode ${mode}: refused in ${String(r.ms)} ms`);
      evidence.push(row(`fifo, mode ${mode}`, r));
    }
  });

  void it("a socket and a device are refused naming their type", async () => {
    if (!POSIX) {
      assert.equal(process.platform, "win32");
      return;
    }
    const sock = await tryOpen(new RecordingCage(domainFor(ROOT)), SOCKET, "r");
    assert.equal(sock.refused?.fileType, "socket");
    evidence.push(row("socket, mode r", sock));
    for (const device of ["/dev/null", "/dev/zero", "/dev/tty"]) {
      const r = await tryOpen(new RecordingCage(domainFor("/dev")), device, "r");
      assert.equal(r.error, "ContainmentRefusal", device);
      assert.equal(r.refused?.fileType, "character-device", device);
      assert.ok(r.ms < 500, device);
      evidence.push(row(`${device} under a declared root /dev, mode r`, r));
    }
  });

  void it("a FIFO or a socket swapped in between the lstat and the open is refused, and the open does not wait", { timeout: TIMEOUT_MS * 2 }, async () => {
    if (!POSIX) {
      assert.equal(process.platform, "win32");
      return;
    }
    const target = `${ROOT}/swapped`;
    const toFifo = (p: string): void => {
      rmSync(p, { force: true });
      execFileSync("mkfifo", [p]);
    };
    const cases: [string, string, (p: string) => void | Promise<void>, string][] = [
      ["regular → fifo, mode r (opens at once under O_NONBLOCK; the fstat refuses it)", "r", toFifo, "fifo"],
      ["regular → fifo, mode w (no reader: ENXIO under O_NONBLOCK)", "w", toFifo, "fifo"],
      ["regular → fifo, mode r+", "r+", toFifo, "fifo"],
      ["regular → socket, mode r (ENXIO)", "r", async (p) => {
        rmSync(p, { force: true });
        const s = createServer();
        await new Promise<void>((resolve) => s.listen(p, resolve));
        s.unref();
      }, "socket"],
    ];
    for (const [label, mode, swap, type] of cases) {
      writeFileSync(target, "regular\n");
      const cage = new RecordingCage(domainFor(ROOT), swapBeforeOpen(swap), undefined, undefined, WRITER);
      const r = await tryOpen(cage, target, mode);
      assert.equal(r.opened, false, label);
      assert.equal(r.refused?.fileType, type, label);
      assert.ok(r.ms < 1_000, `${label}: ${String(r.ms)} ms`);
      evidence.push(row(label, r));
      rmSync(target, { force: true });
    }
  });

  void it("a node sent more FIFO reads than it has slots refuses every one inside the timeout and frees every slot", { timeout: TIMEOUT_MS * 4 }, async () => {
    if (!POSIX) {
      assert.equal(process.platform, "win32");
      return;
    }
    const audits: string[] = [];
    const reader = { name: "fifo.read", description: "reads a named file", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false }, capability: tag("fifo", { containment_domain: [`fs:${ROOT}`] }), handler: async (a: Record<string, unknown>, ctx: { cage: { open(p: string, m?: string): Promise<FileHandle> } }) => {
      const h = await ctx.cage.open(String(a["path"]), "r");
      try {
        return { content: [{ type: "text", text: await h.readFile("utf8") }] };
      } finally {
        await h.close();
      }
    } };
    const registry = pinForTest([reader], compileSchema, DEFAULT_LIMITS, true, { cageFor: (d, p) => recordingCageFactory(d, p) });
    const slots = 2;
    const t = await startTransport({ registry, serverInfo: { name: "x", version: "0" }, verifier: new TestBearerVerifier(), requestStateKey: randomBytes(32), config: { limits: { maxInFlight: slots, handlerTimeoutMs: TIMEOUT_MS } }, audit: (e, f) => audits.push(`${e} ${JSON.stringify(f)}`) });
    try {
      const n = slots * 4;
      const timings: number[] = [];
      const statuses: number[] = [];
      // Waves of `slots` concurrent calls: under the old cage the first wave pinned every slot and
      // every later call was answered 503 at capacity.
      for (let i = 0; i < n; i += slots) {
        const wave = await Promise.all(Array.from({ length: slots }, async () => {
          const t0 = performance.now();
          const r = await modern(t, "tools/call", { name: "fifo.read", arguments: { path: FIFO } });
          timings.push(performance.now() - t0);
          return r;
        }));
        for (const r of wave) {
          statuses.push(r.status);
          assert.equal(r.status, 500, r.text);
          assert.match(r.text, /outside its containment domain/);
        }
      }
      assert.ok(Math.max(...timings) < TIMEOUT_MS / 4, `every refusal well inside the ${String(TIMEOUT_MS)} ms handler timeout: ${timings.map((x) => x.toFixed(0)).join(", ")}`);
      assert.equal(t.inFlight(), 0, "no slot left held");
      const lines = audits.filter((a) => a.startsWith("containment-refused"));
      assert.equal(lines.length, n);
      assert.equal(audits.filter((a) => a.startsWith("handler-timeout")).length, 0);
      const ok = await modern(t, "tools/call", { name: "fifo.read", arguments: { path: REGULAR } });
      assert.equal(ok.status, 200, ok.text);
      evidence.push(`REGULAR node: ${String(n)} fifo.read calls against ${String(slots)} slots, handler timeout ${String(TIMEOUT_MS)} ms → statuses ${JSON.stringify([...new Set(statuses)])}, slowest ${Math.max(...timings).toFixed(1)} ms; containment-refused lines ${String(lines.length)}; handler-timeout lines 0; inFlight after ${String(t.inFlight())}; a regular read after → ${String(ok.status)}`, `REGULAR audit line: ${String(lines[0])}`);
    } finally {
      await t.close();
    }
  });
});
