// Operator-named files for the audit store (audit/RULES.md AU-21): the log, the anchor and the two key
// files get the checks CLEARSEAL_MANIFEST gets (node/start.ts readManifestFile). The path is absolute;
// the file is regular; no link at the leaf (O_NOFOLLOW, in the open itself) and none on the way (the
// descriptor's own path on Linux, the resolved path elsewhere). On Windows there is no O_NOFOLLOW: a
// link at the leaf is refused by an lstat before the open.

import { closeSync, constants, fstatSync, lstatSync, openSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export class AuditConfigError extends Error {
  override name = "AuditConfigError";
}

const WIN = process.platform === "win32";

/**
 * Opens an operator-named file and returns its descriptor. `create` opens it for appending, creating
 * it (mode 0600) if it does not exist; otherwise it is opened read-only and must exist. Throws
 * AuditConfigError naming the setting.
 */
export function openOperatorFile(setting: string, path: string, create: boolean): number {
  if (!isAbsolute(path)) throw new AuditConfigError(`${setting} must be an absolute path`);
  if (WIN) {
    let link = false;
    try {
      link = lstatSync(path).isSymbolicLink();
    } catch {
      // The open below reports it.
    }
    if (link) throw new AuditConfigError(`${setting} is a symbolic link: the audit reads and writes regular files`);
  }
  const flags = create ? constants.O_RDWR | constants.O_APPEND | constants.O_CREAT : constants.O_RDONLY;
  let fd: number;
  try {
    fd = openSync(path, flags | (WIN ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK), 0o600);
  } catch (err) {
    const code = err instanceof Error && "code" in err ? String(err.code) : "error";
    throw new AuditConfigError(`${setting} cannot be opened (${code})`, { cause: err });
  }
  try {
    if (!fstatSync(fd).isFile()) throw new AuditConfigError(`${setting} is not a regular file`);
    if (!WIN) {
      let real: string | undefined;
      try {
        real = realpathSync(process.platform === "linux" ? `/proc/self/fd/${String(fd)}` : path);
      } catch {
        real = undefined;
      }
      if (real !== resolve(path)) throw new AuditConfigError(`${setting} passes through a symbolic link: the audit uses paths with no link on the way`);
    }
    return fd;
  } catch (err) {
    closeSync(fd);
    throw err;
  }
}

/** The identity of an open file, to tell two settings naming the same file apart. */
export function fileIdentity(fd: number): string {
  const st = fstatSync(fd, { bigint: true });
  return `${String(st.dev)}:${String(st.ino)}`;
}
