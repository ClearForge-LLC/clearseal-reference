// CSR-WO-1006 §1.3, measure first: what realpathSync.native and lstat report for links planted
// inside a root, on this platform. Prints MEASURE lines; the assertions come after the measurement.

import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { after, it } from "node:test";

const ID = randomBytes(6).toString("hex");
const ROOT = `/tmp/clearseal-links-${ID}/root`;
const OUTSIDE = `/tmp/clearseal-links-${ID}/outside`;

after(() => {
  rmSync(`/tmp/clearseal-links-${ID}`, { recursive: true, force: true });
});

const tryIt = (f: () => unknown): string => {
  try {
    return JSON.stringify(f());
  } catch (err) {
    return `throws ${(err as { code?: string }).code ?? String(err)}`;
  }
};
const lines: string[] = [];
const measure = (label: string, value: string): void => {
  lines.push(`MEASURE platform=${process.platform} ${label}: ${value}`);
};

void it("measures links, junctions, drive letters and case on this platform", () => {
  mkdirSync(ROOT, { recursive: true });
  mkdirSync(OUTSIDE, { recursive: true });
  writeFileSync(`${ROOT}/inside.txt`, "inside\n");
  writeFileSync(`${OUTSIDE}/secret.txt`, "secret\n");
  const plant = (name: string, target: string, type: "file" | "dir" | "junction"): void => {
    measure(`plant ${name} (${type})`, tryIt(() => (symlinkSync(target, `${ROOT}/${name}`, type), "ok")));
  };
  plant("file-link.txt", `${OUTSIDE}/secret.txt`, "file");
  plant("dir-link", OUTSIDE, "dir");
  plant("junction", OUTSIDE, "junction");
  plant("unc-link.txt", "\\\\localhost\\C$\\Windows\\win.ini", "file");
  plant("dangling.txt", `${OUTSIDE}/missing.txt`, "file");
  for (const p of [ROOT, `${ROOT}/inside.txt`, `${ROOT}/file-link.txt`, `${ROOT}/dir-link`, `${ROOT}/dir-link/secret.txt`, `${ROOT}/junction`, `${ROOT}/junction/secret.txt`, `${ROOT}/unc-link.txt`, `${ROOT}/dangling.txt`, `${ROOT}/missing.txt`]) {
    measure(`lstat ${p}`, tryIt(() => ({ link: lstatSync(p).isSymbolicLink(), dir: lstatSync(p).isDirectory(), file: lstatSync(p).isFile() })));
    measure(`realpath.native ${p}`, tryIt(() => realpathSync.native(p)));
    measure(`realpath ${p}`, tryIt(() => realpathSync(p)));
  }
  // Case and drive-letter variants of the root, as a caller might spell them.
  const cwd = process.cwd();
  const drive = /^[a-zA-Z]:/.exec(cwd)?.[0] ?? "";
  measure("cwd", cwd);
  const variants = [ROOT.toUpperCase(), ROOT.replace("root", "ROOT"), `${drive.toLowerCase()}${ROOT}`, `${drive.toUpperCase()}${ROOT}`, `${drive.toLowerCase()}${ROOT.replaceAll("/", "\\")}`, `\\\\?\\${drive.toUpperCase()}${ROOT.replaceAll("/", "\\")}`];
  for (const v of variants) measure(`realpath.native variant ${v}`, tryIt(() => realpathSync.native(v)));
  measure("tmpdir", tmpdir());
  measure("realpath.native tmpdir", tryIt(() => realpathSync.native(tmpdir())));
  console.log(lines.join("\n"));
});
