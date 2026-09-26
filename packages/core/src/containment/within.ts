// One root comparison for the cage and the reach harness (CSR-WO-1006 §1.3). Internal: not part of
// the core's public exports.

/** Is `path` the root or below it? Both sides come from resolveReal, so on Windows both are in the
 *  native form (drive letter, backslashes) and compare with its separator. */
export const within = (path: string, root: string): boolean => path === root || path.startsWith(`${root}${process.platform === "win32" ? "\\" : "/"}`);
