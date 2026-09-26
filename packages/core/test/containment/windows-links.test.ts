// CSR-WO-1006 §1.3: the cage resolves links on Windows too. Measured first, on every runner: what
// realpathSync.native and lstat report for links planted inside a root, and for spellings of the
// root (MEASURE lines). Then the operation that matters: a real open through the cage of each
// planted link, and of each spelling, asserted refused or admitted, on every platform (LINKS lines).

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { after, it } from "node:test";

import { cagePolicy, ContainmentRefusal, RecordingCage } from "../../src/containment/cage.ts";
import { parseDomain } from "../../src/containment/domain.ts";

const ID = randomBytes(6).toString("hex");
const ROOT = `/tmp/clearseal-links-${ID}/root`;
const OUTSIDE = `/tmp/clearseal-links-${ID}/outside`;

after(() => {
  rmSync(`/tmp/clearseal-links-${ID}`, { recursive: true, force: true });
  console.log(lines.join("\n"));
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
  plant("inside-link.txt", `${ROOT}/inside.txt`, "file");
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
});

/** A real open through a cage whose one root is ROOT: "opened", "refused", or the open's error. */
async function openThroughCage(path: string): Promise<string> {
  const cage = new RecordingCage(parseDomain([`fs:${ROOT}`]));
  try {
    const h = await cage.open(path, "r");
    const text = await h.readFile("utf8");
    await h.close();
    return `opened ${JSON.stringify(text)}`;
  } catch (err) {
    return err instanceof ContainmentRefusal ? "refused" : `error ${String((err as { code?: string }).code)}`;
  }
}

void it("a planted symlink, directory symlink, junction or UNC link is refused, and spellings of the root compare canonically", async () => {
  const win = process.platform === "win32";
  const cases: [string, string, (outcome: string) => boolean][] = [
    ["a regular file inside the root", `${ROOT}/inside.txt`, (o) => o === 'opened "inside\\n"'],
    ["a file symlink at the leaf, to outside", `${ROOT}/file-link.txt`, (o) => o === "refused"],
    ["a file through a directory symlink, to outside", `${ROOT}/dir-link/secret.txt`, (o) => o === "refused"],
    ["a junction at the leaf", `${ROOT}/junction`, (o) => o === "refused"],
    ["a file through a junction, to outside", `${ROOT}/junction/secret.txt`, (o) => o === "refused"],
    ["a symlink to a UNC path", `${ROOT}/unc-link.txt`, (o) => o === "refused"],
    ["a dangling symlink", `${ROOT}/dangling.txt`, (o) => o === "refused"],
    ["a symlink at the leaf to a file inside the root (a link is refused, wherever it points)", `${ROOT}/inside-link.txt`, (o) => o === "refused"],
    ["the root spelled upper-case", `${ROOT.toUpperCase()}/INSIDE.TXT`, (o) => (win ? o === 'opened "inside\\n"' : o === "refused")],
    ["the root's last component in another case", `${ROOT.replace(/root$/, "ROOT")}/inside.txt`, (o) => (win ? o === 'opened "inside\\n"' : o === "refused")],
    ["a drive-letter spelling", `${/^[a-zA-Z]:/.exec(process.cwd())?.[0] ?? "C:"}${ROOT}/inside.txt`, (o) => o === "refused"],
    ["a \\\\?\\ prefix", `\\\\?\\D:${ROOT.replaceAll("/", "\\")}\\inside.txt`, (o) => o === "refused"],
    ["backslash separators", `${ROOT.replaceAll("/", "\\")}\\inside.txt`, (o) => o === "refused"],
  ];
  for (const [label, path, ok] of cases) {
    const outcome = await openThroughCage(path);
    lines.push(`LINKS platform=${process.platform} ${label} (${path}): ${outcome}`);
    assert.ok(ok(outcome), `${label}: ${outcome}`);
  }
});

void it("adversarial A9: a link to a directory whose real path is longer than PATH_MAX is refused before a write open truncates anything outside", async () => {
  if (process.platform === "win32") {
    assert.equal(process.platform, "win32", "POSIX PATH_MAX; the Windows cases are above");
    return;
  }
  // Short symlink hops build a real path of about 4.7 KB outside the root, and a link inside the
  // root points into it. realpath of anything below that link fails with ENAMETOOLONG.
  const base = `/tmp/clearseal-links-${ID}/long`;
  const name = "d".repeat(250);
  mkdirSync(`${base}/h0/${name}`, { recursive: true });
  let prev = `${base}/h0/${name}`;
  for (let k = 1; k <= 18; k++) {
    symlinkSync(prev, `${base}/h${String(k)}`);
    mkdirSync(`${base}/h${String(k)}/${name}`);
    prev = `${base}/h${String(k)}/${name}`;
  }
  symlinkSync(prev, `${ROOT}/deep`);
  const victim = `${ROOT}/deep/victim.txt`;
  writeFileSync(victim, "VICTIM-ORIGINAL");
  const cage = new RecordingCage(parseDomain([`fs:${ROOT}`]), undefined, undefined, undefined, cagePolicy("state_change"));
  for (const mode of ["w", "a", "r+", "r"]) {
    let outcome = "opened";
    try {
      const h = await cage.open(victim, mode);
      await h.close();
    } catch (err) {
      outcome = err instanceof ContainmentRefusal ? "refused" : String(err);
    }
    const now = readFileSync(victim, "utf8");
    lines.push(`LINKS platform=${process.platform} A9 mode ${mode} through a link into a real path over PATH_MAX: ${outcome}; outside file ${JSON.stringify(now)}`);
    assert.equal(outcome, "refused", mode);
    assert.equal(now, "VICTIM-ORIGINAL", `mode ${mode}: nothing outside the root was truncated or written`);
  }
  // Refused at the check: the only record is the refused one, so the open never happened.
  assert.ok(cage.reached().every((r) => !r.allowed));
});
