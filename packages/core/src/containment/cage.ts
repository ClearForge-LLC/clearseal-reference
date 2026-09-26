// The Cage interface (CSR-WO-1002 §1.2, architecture §5 "Where OS primitives live"). A handler
// reaches outside the process only through its cage: open a file, connect to a host, or use a
// named service. The core defines the interface and ships one implementation, RecordingCage;
// editions implement Cage with OS primitives and must pass the same reach harness.

import { constants, lstatSync, realpathSync } from "node:fs";
import { open as openFile, type FileHandle } from "node:fs/promises";
import { connect as netConnect, type Socket } from "node:net";
import { posix } from "node:path";

import { type Domain, EMPTY_DOMAIN } from "./domain.ts";

// Captured at load, before any test shim patches fs: the cage's own checks are not reaches.
const lstatOwn = lstatSync;
const realpathOwn = realpathSync;
const realpathNativeOwn = realpathSync.native;

export type ReachKind = "fs" | "net" | "svc";

export interface Reach {
  kind: ReachKind;
  /** The sink as requested: a path, host:port, or service name. */
  sink: string;
  /** For fs: the flags the handler asked for. */
  mode?: string;
  allowed: boolean;
}

/** An undeclared reach. It names the sink; the transport passes the full reach to the audit seam
 *  and puts only the sink's kind in the response. */
export class ContainmentRefusal extends Error {
  override name = "ContainmentRefusal";
  readonly reach: Reach;
  constructor(reach: Reach) {
    super(`containment refused a ${reach.kind} reach to ${reach.sink}`);
    this.reach = reach;
  }
}

export interface Cage {
  open(path: string, mode?: string): Promise<FileHandle>;
  connect(host: string, port: number): Promise<Socket>;
  service(name: string): Promise<unknown>;
  /** Every reach this cage saw, allowed or refused, in order. */
  reached(): readonly Reach[];
}

/** What a reach does once allowed. The defaults are Node's own; tests and editions supply others. */
export interface CageEffects {
  /** `flags` are numeric open(2) flags; on POSIX they include O_NOFOLLOW. */
  open(path: string, flags: number): Promise<FileHandle>;
  connect(host: string, port: number): Promise<Socket>;
  service(name: string): Promise<unknown>;
}

/** The numeric open(2) flags for a mode string; undefined for a mode this cage does not know. On
 *  POSIX, O_NOFOLLOW is added, so the kernel refuses a symlink in the final path component inside
 *  the open itself, atomically. */
function flagsFor(mode: string): number | undefined {
  const { O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_TRUNC, O_APPEND, O_EXCL } = constants;
  const table: Readonly<Record<string, number>> = {
    r: O_RDONLY,
    "r+": O_RDWR,
    w: O_WRONLY | O_CREAT | O_TRUNC,
    "w+": O_RDWR | O_CREAT | O_TRUNC,
    wx: O_WRONLY | O_CREAT | O_TRUNC | O_EXCL,
    "wx+": O_RDWR | O_CREAT | O_TRUNC | O_EXCL,
    a: O_WRONLY | O_CREAT | O_APPEND,
    "a+": O_RDWR | O_CREAT | O_APPEND,
    ax: O_WRONLY | O_CREAT | O_APPEND | O_EXCL,
    "ax+": O_RDWR | O_CREAT | O_APPEND | O_EXCL,
  };
  const flags = table[mode];
  if (flags === undefined) return undefined;
  return process.platform === "win32" ? flags : flags | constants.O_NOFOLLOW;
}

const DEFAULT_EFFECTS: CageEffects = {
  open: (path, flags) => openFile(path, flags),
  connect: (host, port) =>
    new Promise((resolve, reject) => {
      const socket = netConnect({ host, port });
      socket.once("connect", () => {
        resolve(socket);
      });
      socket.once("error", reject);
    }),
  service: (name) => Promise.reject(new Error(`no binding for service ${name}: the edition binds services at deploy`)),
};

const within = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);

/** The real path of `path` when it exists, else of its deepest existing ancestor with the rest
 *  appended, so a symlink anywhere on the way is resolved before the check. POSIX only: on Windows
 *  the RecordingCage compares normalized paths, and the edition's OS cage is the boundary. */
export function resolveReal(path: string): string {
  if (process.platform === "win32") return path;
  const parts = path.split("/");
  for (let i = parts.length; i > 0; i--) {
    const head = parts.slice(0, i).join("/") || "/";
    try {
      const real = realpathNativeOwn(head);
      return posix.join(real, ...parts.slice(i));
    } catch {
      // Keep walking up until something exists.
    }
  }
  return path;
}

/**
 * The core's in-process cage. It enforces the declared domain: an undeclared reach throws
 * ContainmentRefusal and never happens. It records every reach, allowed or refused.
 *
 * It is NOT an OS boundary. A handler that calls `fs` or `net` directly bypasses it; the reach
 * harness catches that in tests, and an edition's OS-level Cage stops it in production.
 *
 * Matching rules:
 * - fs: the path must be absolute. It is normalized (so `..` cannot climb out), and on POSIX its
 *   real path (symlinks resolved) must also lie under a root, compared with the roots' real paths.
 * - net: the host is compared by name, lower-cased, never by address. A declared port must match;
 *   an entry without a port allows any port.
 * - svc: the name must be declared exactly.
 */
export class RecordingCage implements Cage {
  readonly #domain: Domain;
  readonly #effects: CageEffects;
  readonly #reached: Reach[] = [];
  readonly #realRoots: readonly string[];
  readonly #onRefused: ((reach: Reach) => void) | undefined;

  /** `realRoots`, when given, are the domain's roots already resolved (see recordingCageFactory);
   *  `onRefused` hears every refusal as it happens, including one after the handler returned. */
  constructor(domain: Domain = EMPTY_DOMAIN, effects: CageEffects = DEFAULT_EFFECTS, realRoots?: readonly string[], onRefused?: (reach: Reach) => void) {
    this.#domain = domain;
    this.#effects = effects;
    this.#realRoots = realRoots ?? domain.fs.map(resolveReal);
    this.#onRefused = onRefused;
    Object.freeze(this);
  }

  #record(reach: Reach): void {
    this.#reached.push(Object.freeze(reach));
    if (!reach.allowed) {
      this.#onRefused?.(reach);
      throw new ContainmentRefusal(reach);
    }
  }

  #inside(real: string): boolean {
    return this.#realRoots.some((root) => within(real, root));
  }

  /**
   * Three layers, and one limit.
   * - Before the open: a symlink leaf is refused (lstat), and the path's real path must lie under a
   *   root's real path.
   * - The open itself: on POSIX it carries O_NOFOLLOW, so a symlink swapped into the final path
   *   component between the check and the open is refused by the kernel, atomically. Nothing is
   *   created or truncated through it.
   * - After the open (Linux): the descriptor's real path must lie under a root, or the file is
   *   closed and the reach refused.
   *
   * The limit, stated plainly: O_NOFOLLOW covers the final component only. If an intermediate
   * directory is swapped for a symlink between the check and the open, the open follows it. In a
   * write mode, a file outside the root can then be created or truncated before the post-open check
   * refuses the handle. Closing that needs an open resolved beneath a directory (openat2 with
   * RESOLVE_BENEATH), which Node does not expose. It is the edition's OS-level Cage's job, not this
   * in-process one's. On Windows none of the POSIX layers apply, and the OS cage is the boundary.
   */
  async open(path: string, mode = "r"): Promise<FileHandle> {
    const normalized = posix.isAbsolute(path) && !path.includes("\\") && !/^[a-zA-Z]:/.test(path) ? posix.normalize(path) : undefined;
    let leafIsLink = false;
    if (normalized !== undefined && process.platform !== "win32") {
      try {
        leafIsLink = lstatOwn(normalized).isSymbolicLink();
      } catch {
        // Nothing there yet: no link to follow.
      }
    }
    const flags = flagsFor(mode);
    const allowed = normalized !== undefined && flags !== undefined && !leafIsLink && this.#inside(resolveReal(normalized));
    this.#record({ kind: "fs", sink: path, mode, allowed });
    const handle = await this.#effects.open(normalized ?? path, flags ?? constants.O_RDONLY);
    if (process.platform === "linux" && typeof handle.fd === "number") {
      let real: string | undefined;
      try {
        real = realpathOwn(`/proc/self/fd/${String(handle.fd)}`);
      } catch {
        real = undefined;
      }
      if (real === undefined || !this.#inside(real)) {
        await handle.close();
        this.#record({ kind: "fs", sink: path, mode, allowed: false });
      }
    }
    return handle;
  }

  connect(host: string, port: number): Promise<Socket> {
    try {
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        this.#record({ kind: "net", sink: `${host}:${String(port)}`, allowed: false });
      }
      const name = host.toLowerCase();
      const allowed = this.#domain.hosts.some((h) => h.host === name && (h.port === undefined || h.port === port));
      this.#record({ kind: "net", sink: `${host}:${String(port)}`, allowed });
      return this.#effects.connect(name, port);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  service(name: string): Promise<unknown> {
    try {
      this.#record({ kind: "svc", sink: name, allowed: this.#domain.services.includes(name) });
      return this.#effects.service(name);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  reached(): readonly Reach[] {
    return [...this.#reached];
  }
}

Object.freeze(RecordingCage.prototype);

/** A cage factory for one domain: the roots' real paths are resolved once, here, not per call. A
 *  root that is a symlink is followed once, at registration; the resolved bound then holds. */
export function recordingCageFactory(domain: Domain, effects: CageEffects = DEFAULT_EFFECTS): (onRefused?: (reach: Reach) => void) => Cage {
  const realRoots = Object.freeze(domain.fs.map(resolveReal));
  return (onRefused) => new RecordingCage(domain, effects, realRoots, onRefused);
}
