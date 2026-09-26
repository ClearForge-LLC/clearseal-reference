// The reach harness (CSR-WO-1002 §1.5). It runs each tool's handler over the tool's own corpus of
// arguments, under a RecordingCage built from the tool's pinned domain, while a shim observes the
// process's direct routes out: fs, net, http, https, fetch and child_process. Every reach, seen by
// the cage or by the shim, must lie inside the declared domain; a null domain must see none at all.
// An undeclared reach fails the tool, naming the sink. For a read_only tool, a write is undeclared
// wherever it lands, whether the cage allowed it or the shim saw it (CSR-WO-1002a): the harness
// judges the class itself rather than trusting the cage under test. It can judge only what the cage
// records (a missing mode counts as a write) and what the shim sees: a cage that records "r" while
// opening for write through a function the shim cannot see passes. Descriptor-based metadata calls
// (fchmod, futimes, fchown, and a FileHandle's chmod, utimes, chown) carry no path, and are not
// judged.
//
// The shim is module patching, not a kernel observer (no strace), and it is the same on Linux and
// Windows. It sees calls through the patched functions only, and it does NOT see: a function
// reference captured before the run (other than readFileSync-style calls that go through a patched
// open), process.binding, process.dlopen, and native addons. Worker construction is refused while
// it is installed. realpath is not observed, because the cage itself uses it. It is a test
// instrument: it patches process-wide, and a second run while one is active is refused. Editions
// run this same harness against their OS-level Cage, which is the boundary the shim is not.

import { createRequire, syncBuiltinESMExports } from "node:module";
import { posix } from "node:path";

import { randomBytes } from "node:crypto";

import { constants } from "node:fs";

import { type Cage, type CageEffects, type CagePolicy, cagePolicy, ContainmentRefusal, type Reach, READ_ONLY_MODES, RecordingCage, resolveReal } from "./cage.ts";
import { within } from "./within.ts";
import { type Domain, parseDomain } from "./domain.ts";
import type { CallContext, Tool } from "../transport/registry.ts";

export interface HarnessTool {
  name: string;
  /** The pinned containment_domain, as hashed. */
  domain: readonly string[] | null;
  /** The pinned capability_class, as hashed: it decides whether a write is declared. */
  capabilityClass: string;
  handler: Tool["handler"];
  /** Arguments to run the handler with: the tool's own fixture inputs. */
  corpus: readonly Record<string, unknown>[];
}

export interface Observed {
  kind: "fs" | "net" | "svc" | "spawn";
  sink: string;
  via: "cage" | "shim";
  /** For fs: present, and true, when the reach writes (a mutating open mode or function). */
  write?: boolean;
}

export interface ToolVerdict {
  tool: string;
  pass: boolean;
  /** Every reach seen, by the cage and by the shim. */
  reaches: readonly Observed[];
  /** The ones outside the declared domain. */
  undeclared: readonly Observed[];
}

export interface HarnessOptions {
  /** What an allowed cage reach does. Tests pass stubs so the harness never touches the network. */
  effects?: CageEffects;
  /** Builds the cage for a domain and policy; editions pass their OS-level Cage here. */
  makeCage?: (domain: Domain, policy: CagePolicy) => Cage;
}

const require = createRequire(import.meta.url);

type Mutable = Record<string, unknown>;

const FS_FUNCTIONS = [
  "open", "openSync", "readFile", "readFileSync", "writeFile", "writeFileSync", "appendFile", "appendFileSync",
  "createReadStream", "createWriteStream", "readdir", "readdirSync", "mkdir", "mkdirSync", "rm", "rmSync", "unlink", "unlinkSync",
  "stat", "statSync", "lstat", "lstatSync", "access", "accessSync", "existsSync", "copyFile", "copyFileSync", "rename", "renameSync",
  "opendir", "opendirSync", "symlink", "symlinkSync", "readlink", "readlinkSync", "truncate", "truncateSync", "cp", "cpSync",
  "watch", "watchFile", "link", "linkSync", "chmod", "chmodSync", "chown", "chownSync", "utimes", "utimesSync", "statfs", "statfsSync",
  "openAsBlob", "mkdtemp", "mkdtempSync", "rmdir", "rmdirSync", "exists",
  "lchown", "lchownSync", "lutimes", "lutimesSync", "lchmod", "lchmodSync",
];
const FS_PROMISE_FUNCTIONS = ["lchown", "lutimes", "lchmod", "open", "readFile", "writeFile", "appendFile", "readdir", "mkdir", "rm", "unlink", "stat", "lstat", "access", "copyFile", "rename", "opendir", "symlink", "readlink", "truncate", "cp", "watch", "link", "chmod", "chown", "utimes", "statfs", "mkdtemp", "rmdir"];
/** fs functions that change the file system. copyFile, cp, rename, link and symlink also name a
 *  second path, the one written, and both are recorded. */
const FS_WRITE_FUNCTIONS = new Set([
  "writeFile", "writeFileSync", "appendFile", "appendFileSync", "createWriteStream", "mkdir", "mkdirSync", "rm", "rmSync", "unlink", "unlinkSync",
  "copyFile", "copyFileSync", "rename", "renameSync", "symlink", "symlinkSync", "truncate", "truncateSync", "cp", "cpSync", "link", "linkSync",
  "chmod", "chmodSync", "chown", "chownSync", "utimes", "utimesSync", "mkdtemp", "mkdtempSync", "rmdir", "rmdirSync",
  "lchown", "lchownSync", "lutimes", "lutimesSync", "lchmod", "lchmodSync",
]);
/** Functions whose options can carry an open flag (`flag`, or `flags` for streams) that writes. */
const FS_FLAG_FUNCTIONS = new Set(["readFile", "readFileSync", "createReadStream", "openAsBlob"]);

/** The open flag in an options argument: `flag`, or `flags` for streams, on an object. A bare
 *  string there is the encoding, never a flag. */
function flagOption(arg: unknown): unknown {
  if (typeof arg === "object" && arg !== null) {
    const o = arg as { flag?: unknown; flags?: unknown };
    return o.flag ?? o.flags;
  }
  return undefined;
}
const FS_TWO_PATH_FUNCTIONS = new Set(["copyFile", "copyFileSync", "cp", "cpSync", "rename", "renameSync", "link", "linkSync", "symlink", "symlinkSync"]);
const OPEN_FUNCTIONS = new Set(["open", "openSync"]);

/** Does an open's flags argument write? Omitted, "r" and "rs" read; a number reads only when it
 *  carries none of the writing bits. Anything else counts as a write. */
function openWrites(flags: unknown): boolean {
  if (flags === undefined || flags === "r" || flags === "rs") return false;
  if (typeof flags === "number") return (flags & (constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC | constants.O_APPEND)) !== 0;
  return true;
}

const SPAWN_FUNCTIONS = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"];

function pathOf(arg: unknown): string | undefined {
  if (typeof arg === "string") return arg;
  if (arg instanceof URL) return arg.protocol === "file:" ? decodeURIComponent(arg.pathname) : undefined;
  if (Buffer.isBuffer(arg)) return arg.toString("utf8");
  return undefined;
}

function netTarget(args: unknown[]): string {
  const [a, b] = args;
  if (typeof a === "object" && a !== null) {
    const o = a as { host?: unknown; hostname?: unknown; port?: unknown; path?: unknown };
    if (o instanceof URL) return `${o.hostname}:${o.port === "" ? (o.protocol === "https:" ? "443" : "80") : o.port}`;
    if (typeof o.path === "string" && o.host === undefined && o.hostname === undefined) return `ipc:${o.path}`;
    const text = (v: unknown, fallback: string): string => (typeof v === "string" || typeof v === "number" ? String(v) : fallback);
    return `${text(o.hostname ?? o.host, "localhost")}:${text(o.port, "")}`;
  }
  if (typeof a === "string" && /^[a-z]+:\/\//i.test(a)) {
    const u = new URL(a);
    return `${u.hostname}:${u.port === "" ? (u.protocol === "https:" ? "443" : "80") : u.port}`;
  }
  if (typeof a === "number") return `${typeof b === "string" ? b : "localhost"}:${String(a)}`;
  return String(a);
}

/** Installs the shim; returns the log and an uninstall function. */
function installShim(): { log: Observed[]; uninstall: () => void } {
  const log: Observed[] = [];
  const restores: (() => void)[] = [];
  const wrap = (target: Mutable, name: string, record: (args: unknown[]) => void, block = false): void => {
    const original = target[name];
    if (typeof original !== "function") return;
    const fn = original as (...a: unknown[]) => unknown;
    target[name] = function (this: unknown, ...args: unknown[]): unknown {
      record(args);
      if (block) throw new Error(`the reach harness does not run child processes (${name})`);
      return fn.apply(this, args);
    };
    restores.push(() => {
      target[name] = original;
    });
  };
  const fs = require("node:fs") as Mutable;
  const fsPromises = require("node:fs/promises") as Mutable;
  const recordFs = (name: string, args: unknown[]): void => {
    const write = FS_WRITE_FUNCTIONS.has(name) || (OPEN_FUNCTIONS.has(name) && openWrites(args[1])) || (FS_FLAG_FUNCTIONS.has(name) && openWrites(flagOption(args[1])));
    const p = pathOf(args[0]);
    if (p !== undefined) log.push({ kind: "fs", sink: p, via: "shim", ...(write ? { write } : {}) });
    const second = FS_TWO_PATH_FUNCTIONS.has(name) ? pathOf(args[1]) : undefined;
    if (second !== undefined) log.push({ kind: "fs", sink: second, via: "shim", write: true });
  };
  for (const name of FS_FUNCTIONS) {
    wrap(fs, name, (args) => {
      recordFs(name, args);
    });
  }
  for (const name of FS_PROMISE_FUNCTIONS) {
    wrap(fsPromises, name, (args) => {
      recordFs(name, args);
    });
  }
  const recordNet = (args: unknown[]): void => {
    log.push({ kind: "net", sink: netTarget(args), via: "shim" });
  };
  for (const [mod, names] of [["node:net", ["connect", "createConnection"]], ["node:http", ["request", "get"]], ["node:https", ["request", "get"]], ["node:tls", ["connect"]]] as const) {
    for (const name of names) wrap(require(mod) as Mutable, name, recordNet);
  }
  wrap(globalThis, "fetch", recordNet);
  wrap(globalThis, "WebSocket", recordNet);
  wrap((require("node:net") as { Socket: { prototype: Mutable } }).Socket.prototype, "connect", recordNet);
  wrap((require("node:dgram") as { Socket: { prototype: Mutable } }).Socket.prototype, "send", (args) => {
    const part = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "");
    log.push({ kind: "net", sink: `udp:${part(args[args.length - 2])}:${part(args[args.length - 3])}`, via: "shim" });
  });
  const recordDns = (args: unknown[]): void => {
    log.push({ kind: "net", sink: `dns:${String(args[0])}`, via: "shim" });
  };
  for (const name of ["lookup", "resolve", "resolve4", "resolve6", "resolveAny", "resolveTxt", "resolveMx", "resolveCname", "resolveSrv", "resolveNs", "reverse"]) {
    wrap(require("node:dns") as Mutable, name, recordDns);
    wrap(require("node:dns/promises") as Mutable, name, recordDns);
  }
  wrap(require("node:worker_threads") as Mutable, "Worker", (args) => {
    log.push({ kind: "spawn", sink: `worker:${String(args[0])}`, via: "shim" });
  }, true);
  wrap((require("node:child_process") as { ChildProcess: { prototype: Mutable } }).ChildProcess.prototype, "spawn", (args) => {
    const o = args[0] as { file?: unknown } | undefined;
    log.push({ kind: "spawn", sink: typeof o?.file === "string" ? o.file : "child", via: "shim" });
  }, true);
  for (const name of SPAWN_FUNCTIONS) {
    wrap(require("node:child_process") as Mutable, name, (args) => {
      log.push({ kind: "spawn", sink: String(args[0]), via: "shim" });
    }, true);
  }
  syncBuiltinESMExports();
  return {
    log,
    uninstall: () => {
      for (const restore of restores.reverse()) restore();
      syncBuiltinESMExports();
    },
  };
}

/** Is an observed reach inside the domain? Names, never addresses. A child process never is: it
 *  is no kind of declared sink, so it falls through to false. */
function declared(o: Observed, domain: Domain): boolean {
  if (o.kind === "svc") return domain.services.includes(o.sink);
  if (o.kind === "fs") {
    const p = o.sink.replace(/\\/g, "/");
    if (!posix.isAbsolute(p)) return false;
    // The real path, as the cage checks it: a link inside a root that points outside is outside.
    const real = resolveReal(posix.normalize(p));
    return domain.fs.map(resolveReal).some((root) => within(real, root));
  }
  if (o.kind === "net") {
    const colon = o.sink.lastIndexOf(":");
    const host = o.sink.slice(0, colon).toLowerCase();
    const port = Number(o.sink.slice(colon + 1));
    return domain.hosts.some((h) => h.host === host && (h.port === undefined || h.port === port));
  }
  return false;
}

/** A cage's fs reach writes unless its mode is a read mode; a missing mode counts as a write. */
const fromCage = (r: Reach): Observed => ({ kind: r.kind, sink: r.sink, via: "cage", ...(r.kind === "fs" && (r.mode === undefined || !READ_ONLY_MODES.has(r.mode)) ? { write: true } : {}) });

let running = false;

/** Lets work scheduled by the handler run while the shim is still installed. */
const drain = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 25));
};

/** Runs the harness over the tools, one at a time. A second run while one is active is refused:
 *  the shim is process-wide. */
export async function runReachHarness(tools: readonly HarnessTool[], options: HarnessOptions = {}): Promise<ToolVerdict[]> {
  if (running) throw new Error("a reach harness run is already active in this process; runs must not overlap");
  running = true;
  try {
    return await runAll(tools, options);
  } finally {
    running = false;
  }
}

async function runAll(tools: readonly HarnessTool[], options: HarnessOptions): Promise<ToolVerdict[]> {
  const verdicts: ToolVerdict[] = [];
  // A principal id no tool can recognize, so no tool can tell it is being watched.
  const principal = { id: randomBytes(12).toString("base64url") };
  for (const tool of tools) {
    const domain = parseDomain(tool.domain);
    const policy = cagePolicy(tool.capabilityClass);
    // A read_only tool writes nowhere, whatever its cage allowed.
    const forbiddenWrite = (o: Observed): boolean => policy.capabilityClass === "read_only" && o.write === true;
    const reaches: Observed[] = [];
    const undeclared: Observed[] = [];
    let completed = 0;
    for (const args of tool.corpus.length === 0 ? [{}] : tool.corpus) {
      const cage = options.makeCage?.(domain, policy) ?? new RecordingCage(domain, options.effects, undefined, undefined, policy);
      const shim = installShim();
      const ctx: CallContext = { principal, signal: new AbortController().signal, protocolVersion: "2026-07-28", clientCapabilities: {}, cage };
      try {
        await tool.handler(args, ctx);
        completed++;
      } catch (err) {
        // A handler that fails is not the harness's verdict; its reaches are.
        if (!(err instanceof ContainmentRefusal) && !(err instanceof Error)) throw err;
      } finally {
        await drain();
        shim.uninstall();
      }
      for (const r of cage.reached()) {
        const o = fromCage(r);
        reaches.push(o);
        if (!r.allowed || forbiddenWrite(o)) undeclared.push(o);
      }
      for (const o of shim.log) {
        reaches.push(o);
        if (!declared(o, domain) || forbiddenWrite(o)) undeclared.push(o);
      }
    }
    // A null domain declares nothing, so any reach it makes is undeclared: "zero reaches" follows.
    // A tool that never completed a run proved nothing about its reaches.
    if (completed === 0) undeclared.push({ kind: "spawn", sink: "(no run completed: the corpus never exercised the tool)", via: "shim" });
    const pass = undeclared.length === 0;
    verdicts.push({ tool: tool.name, pass, reaches, undeclared });
  }
  return verdicts;
}

/** One line per tool, for a transcript. */
export function formatVerdicts(verdicts: readonly ToolVerdict[]): string {
  return verdicts
    .map((v) => {
      const list = (os: readonly Observed[]): string => os.map((o) => `${o.kind}:${o.sink} (${o.via}${o.write === true ? ", write" : ""})`).join(", ") || "none";
      return v.pass ? `PASS ${v.tool}: reaches ${list(v.reaches)}` : `FAIL ${v.tool}: undeclared ${list(v.undeclared)}`;
    })
    .join("\n");
}
