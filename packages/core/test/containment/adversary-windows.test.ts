// CSR-WO-1006 §5.3 adversarial pass, Windows: every attempt is a real open through a RecordingCage
// whose root sits under a POSIX-style path (on Windows it names a directory on the current drive).
// Links and junctions planted inside the root, a root reached through a junction, 8.3 short names,
// case variants, DOS device names, alternate data streams and Win32's trailing dot and space. Each
// case pushes an ADVERSARY-WIN line with its outcome and, on win32, asserts the safe outcome, so a
// hole turns CI red. On POSIX there is nothing to measure; the one test asserts that and returns
// (a skip would count as a failure in this repo's runner).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { win32 } from "node:path";
import { after, it } from "node:test";

import { cagePolicy, ContainmentRefusal, RecordingCage } from "../../src/containment/cage.ts";
import { parseDomain } from "../../src/containment/domain.ts";

const WIN = process.platform === "win32";
const ID = randomBytes(6).toString("hex");
const BASE_NAME = `clearseal-advwin-${ID}`;
const BASE = `/tmp/${BASE_NAME}`;
const ROOT = `${BASE}/root`;
const OUTSIDE = `${BASE}/outside`;
const INSIDE_TEXT = "inside\n";
const INNER_TEXT = "inner\n";
const LONG_TEXT = "long-named inside file\n";
const STREAM_TEXT = "stream-data\n";
const SECRET_TEXT = "SECRET-OUTSIDE\n";
const WRITER = cagePolicy("state_change");
const lines: string[] = [];
const links: string[] = [];

after(() => {
  // Links first, so a recursive remove never walks through a junction into the outside directory.
  for (const l of links.reverse()) {
    try {
      unlinkSync(l);
    } catch {
      try {
        rmdirSync(l);
      } catch {
        // Already gone, or never planted.
      }
    }
  }
  rmSync(BASE, { recursive: true, force: true });
  console.log(lines.join("\n"));
});

/** The native spelling of a POSIX-style path on this drive, for cmd and fsutil. */
const native = (p: string): string => win32.resolve(p);

function plant(target: string, path: string, type: "file" | "dir" | "junction"): string {
  try {
    symlinkSync(target, path, type);
    links.push(path);
    return "ok";
  } catch (err) {
    return `failed ${String((err as { code?: string }).code ?? err)}`;
  }
}

/** A real open through a cage. Devices are never read: an opened device is itself the failure. */
async function attempt(root: string, path: string, mode = "r", read = true): Promise<string> {
  const cage = new RecordingCage(parseDomain([`fs:${root}`]), undefined, undefined, undefined, WRITER);
  const t0 = performance.now();
  let outcome: string;
  try {
    const h = await cage.open(path, mode);
    try {
      outcome = read && mode === "r" ? `opened ${JSON.stringify(await h.readFile("utf8"))}` : "opened (not read)";
    } finally {
      await h.close();
    }
  } catch (err) {
    if (err instanceof ContainmentRefusal) {
      const type = err.reach.fileType;
      outcome = type === undefined ? "refused" : `refused ${type}`;
    } else {
      outcome = `error ${String((err as { code?: string }).code ?? err)}`;
    }
  }
  return `${outcome} (${(performance.now() - t0).toFixed(1)} ms)`;
}

const isRefused = (o: string): boolean => o.startsWith("refused");
const isRefusedOrError = (o: string): boolean => o.startsWith("refused") || o.startsWith("error");
const openedWith = (o: string, text: string): boolean => o.startsWith(`opened ${JSON.stringify(text)}`);
const neverOutside = (o: string): boolean => !o.includes("SECRET-OUTSIDE") && !o.includes("[fonts]") && !o.includes("for 16-bit");

interface Case {
  id: string;
  label: string;
  root?: string;
  path: string;
  mode?: string;
  read?: boolean;
  safe: (outcome: string) => boolean;
  expect: string;
}

async function run(c: Case): Promise<void> {
  const outcome = await attempt(c.root ?? ROOT, c.path, c.mode ?? "r", c.read ?? true);
  const ok = c.safe(outcome) && neverOutside(outcome);
  lines.push(`ADVERSARY-WIN ${c.id} ${ok ? "HELD" : "HOLE"} | ${c.label} | path ${c.path} mode ${c.mode ?? "r"} | ${outcome} | expected ${c.expect}`);
  assert.ok(ok, `${c.id} ${c.label}: ${outcome}; expected ${c.expect}`);
}

/** The 8.3 short name `dir /x` reports for `name` in `dir`, or undefined. */
function shortNameOf(dir: string, name: string): string | undefined {
  let listing: string;
  try {
    listing = execFileSync("cmd", ["/c", "dir", "/x", "/a", native(dir)], { encoding: "utf8" });
  } catch {
    return undefined;
  }
  for (const line of listing.split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (!trimmed.endsWith(` ${name}`)) continue;
    const before = trimmed.slice(0, trimmed.length - name.length).trimEnd().split(/\s+/);
    const candidate = before[before.length - 1];
    if (candidate !== undefined && candidate.includes("~")) return candidate;
  }
  return undefined;
}

/** A short name for `name` in `dir`: the one the volume generated, else one set with fsutil. */
function ensureShortName(dir: string, name: string, wanted: string): string | undefined {
  const existing = shortNameOf(dir, name);
  if (existing !== undefined) return existing;
  try {
    execFileSync("fsutil", ["file", "setshortname", native(`${dir}/${name}`), wanted], { encoding: "utf8", stdio: "pipe" });
  } catch (err) {
    lines.push(`ADVERSARY-WIN note: fsutil setshortname ${name} failed: ${String((err as { message?: string }).message ?? err).split(/\r?\n/)[0] ?? ""}`);
  }
  return shortNameOf(dir, name);
}

void it("CSR-WO-1006 §5.3: links, junctions, short names, case, devices, streams and trailing dots on Windows", async () => {
  if (!WIN) {
    // Junctions, 8.3 names, DOS devices and data streams are Windows semantics; the POSIX cases
    // (FIFOs, sockets, devices, swaps) are in regular-files.test.ts.
    assert.notEqual(process.platform, "win32");
    return;
  }

  mkdirSync(`${ROOT}/sub`, { recursive: true });
  mkdirSync(OUTSIDE, { recursive: true });
  writeFileSync(`${ROOT}/inside.txt`, INSIDE_TEXT);
  writeFileSync(`${ROOT}/sub/inner.txt`, INNER_TEXT);
  writeFileSync(`${ROOT}/longfilename-inside.txt`, LONG_TEXT);
  writeFileSync(`${OUTSIDE}/secret.txt`, SECRET_TEXT);

  const planted: [string, string, string, "file" | "dir" | "junction"][] = [
    ["junction leaf to outside", OUTSIDE, `${ROOT}/jleaf`, "junction"],
    ["junction dir to outside", OUTSIDE, `${ROOT}/jdir`, "junction"],
    ["junction to inside", `${ROOT}/sub`, `${ROOT}/jin`, "junction"],
    ["file symlink to UNC", "\\\\localhost\\C$\\Windows\\win.ini", `${ROOT}/unc-link.txt`, "file"],
    ["file symlink to outside", `${OUTSIDE}/secret.txt`, `${ROOT}/file-link.txt`, "file"],
    ["root reached through a junction", ROOT, `${BASE}/rootj`, "junction"],
    ["junction to outside inside the junctioned root", OUTSIDE, `${ROOT}/jdir2`, "junction"],
  ];
  for (const [label, target, path, type] of planted) {
    const result = plant(target.startsWith("\\\\") ? target : native(target), path, type);
    lines.push(`ADVERSARY-WIN plant ${label} (${type}) ${path} -> ${target}: ${result}`);
    assert.equal(result, "ok", `plant ${label}: ${result} (a case with nothing planted proves nothing)`);
  }
  writeFileSync(`${ROOT}/inside.txt:stream`, STREAM_TEXT);
  lines.push(`ADVERSARY-WIN lstat jleaf: link=${String(lstatSync(`${ROOT}/jleaf`).isSymbolicLink())}; lstat unc-link.txt: link=${String(lstatSync(`${ROOT}/unc-link.txt`).isSymbolicLink())}`);

  const insideOrRefused = (text: string) => (o: string) => isRefused(o) || openedWith(o, text);
  const cases: Case[] = [
    // Junctions and links.
    { id: "W1", label: "junction to outside, as the leaf", path: `${ROOT}/jleaf`, safe: isRefused, expect: "refused" },
    { id: "W1b", label: "junction to outside, as the leaf, mode w", path: `${ROOT}/jleaf`, mode: "w", safe: isRefused, expect: "refused" },
    { id: "W2", label: "junction to outside, as an intermediate directory", path: `${ROOT}/jdir/secret.txt`, safe: isRefused, expect: "refused" },
    { id: "W2b", label: "junction to outside, intermediate, mode r+", path: `${ROOT}/jdir/secret.txt`, mode: "r+", safe: isRefused, expect: "refused" },
    { id: "W2c", label: "junction to outside, intermediate, create a new file (mode wx)", path: `${ROOT}/jdir/created.txt`, mode: "wx", safe: isRefused, expect: "refused, and nothing created outside" },
    { id: "W3", label: "file symlink to a UNC path", path: `${ROOT}/unc-link.txt`, safe: isRefused, expect: "refused" },
    { id: "W3b", label: "file symlink to outside, leaf", path: `${ROOT}/file-link.txt`, safe: isRefused, expect: "refused" },
    { id: "W4", label: "junction whose target is inside the root, as the leaf", path: `${ROOT}/jin`, safe: isRefused, expect: "refused (a link at the leaf, wherever it points)" },
    { id: "W4b", label: "junction whose target is inside the root, as an intermediate", path: `${ROOT}/jin/inner.txt`, safe: insideOrRefused(INNER_TEXT), expect: "opened the inside inner.txt, or refused" },
    { id: "W5", label: "root declared as a junction; file below it", root: `${BASE}/rootj`, path: `${BASE}/rootj/inside.txt`, safe: insideOrRefused(INSIDE_TEXT), expect: "opened inside.txt, or refused" },
    { id: "W5b", label: "root declared as a junction; the real spelling of a file below it", root: `${BASE}/rootj`, path: `${ROOT}/inside.txt`, safe: insideOrRefused(INSIDE_TEXT), expect: "opened inside.txt, or refused" },
    { id: "W5c", label: "root declared as a junction; climb out with ..", root: `${BASE}/rootj`, path: `${BASE}/rootj/../outside/secret.txt`, safe: isRefused, expect: "refused" },
    { id: "W5d", label: "root declared as a junction; a junction to outside under it", root: `${BASE}/rootj`, path: `${BASE}/rootj/jdir2/secret.txt`, safe: isRefused, expect: "refused" },
    // Case variants.
    { id: "W7", label: "root upper-cased", path: `${ROOT.toUpperCase()}/inside.txt`, safe: insideOrRefused(INSIDE_TEXT), expect: "opened inside.txt, or refused" },
    { id: "W7b", label: "leaf upper-cased", path: `${ROOT}/INSIDE.TXT`, safe: insideOrRefused(INSIDE_TEXT), expect: "opened inside.txt, or refused" },
    { id: "W7c", label: "junction leaf, case variant", path: `${ROOT}/JLEAF`, safe: isRefused, expect: "refused" },
    { id: "W7d", label: "file link leaf, case variant", path: `${ROOT}/FILE-LINK.TXT`, safe: isRefused, expect: "refused" },
    { id: "W7e", label: "junction intermediate, case variant", path: `${ROOT}/JDIR/secret.txt`, safe: isRefused, expect: "refused" },
    // DOS device names: never data.
    ...["NUL", "nul.txt", "NUL.txt", "CON", "COM1", "COM1.txt", "AUX", "PRN", "LPT1", "CONIN$", "CONOUT$"].map((name): Case => ({ id: "W8", label: `device name ${name}`, path: `${ROOT}/${name}`, read: false, safe: isRefusedOrError, expect: "refused or an error, never opened" })),
    { id: "W8b", label: "device name NUL, mode w", path: `${ROOT}/NUL`, mode: "w", read: false, safe: isRefusedOrError, expect: "refused or an error, never opened" },
    { id: "W8c", label: "device name CON, mode r+", path: `${ROOT}/CON`, mode: "r+", read: false, safe: isRefusedOrError, expect: "refused or an error, never opened" },
    // Alternate data streams.
    { id: "W9", label: "alternate data stream of an inside file", path: `${ROOT}/inside.txt:stream`, safe: (o) => isRefused(o) || openedWith(o, STREAM_TEXT) || openedWith(o, INSIDE_TEXT), expect: "refused, or the inside file's own stream" },
    { id: "W9b", label: "::$DATA of an inside file", path: `${ROOT}/inside.txt::$DATA`, safe: insideOrRefused(INSIDE_TEXT), expect: "opened inside.txt, or refused" },
    { id: "W9c", label: "::$DATA of a file symlink to outside", path: `${ROOT}/file-link.txt::$DATA`, safe: isRefusedOrError, expect: "refused or an error, never the outside file" },
    { id: "W9d", label: "a named stream of a file symlink to outside", path: `${ROOT}/file-link.txt:stream`, safe: isRefusedOrError, expect: "refused or an error, never the outside file" },
    { id: "W9e", label: "a stream on a junction to outside", path: `${ROOT}/jleaf::$DATA`, safe: isRefusedOrError, expect: "refused or an error" },
    { id: "W9f", label: "a directory opened as its index stream", path: `${ROOT}/sub::$INDEX_ALLOCATION`, read: false, safe: isRefusedOrError, expect: "refused or an error" },
    { id: "W9g", label: "a stream on the root directory itself", path: `${ROOT}:stream`, mode: "r", safe: isRefusedOrError, expect: "refused or an error (nothing there)" },
    // Trailing dot and space.
    { id: "W10", label: "trailing dot on an inside file", path: `${ROOT}/inside.txt.`, safe: insideOrRefused(INSIDE_TEXT), expect: "opened inside.txt, or refused" },
    { id: "W10b", label: "trailing space on an inside file", path: `${ROOT}/inside.txt `, safe: insideOrRefused(INSIDE_TEXT), expect: "opened inside.txt, or refused" },
    { id: "W10c", label: "trailing dot on a file link to outside", path: `${ROOT}/file-link.txt.`, safe: isRefusedOrError, expect: "refused or an error, never the outside file" },
    { id: "W10d", label: "trailing space on a file link to outside", path: `${ROOT}/file-link.txt `, safe: isRefusedOrError, expect: "refused or an error, never the outside file" },
    { id: "W10e", label: "trailing dot on a junction intermediate", path: `${ROOT}/jdir./secret.txt`, safe: isRefusedOrError, expect: "refused or an error" },
    { id: "W10f", label: "trailing space on a junction intermediate", path: `${ROOT}/jdir /secret.txt`, safe: isRefusedOrError, expect: "refused or an error" },
    { id: "W10g", label: "trailing dot on a junction leaf", path: `${ROOT}/jleaf.`, safe: isRefusedOrError, expect: "refused or an error" },
    // Components Win32 might read as a parent while POSIX normalisation does not.
    { id: "W11", label: "a '.. ' component (dot dot space)", path: `${ROOT}/.. /outside/secret.txt`, safe: isRefusedOrError, expect: "refused or an error" },
    { id: "W11b", label: "a '...' component", path: `${ROOT}/.../outside/secret.txt`, safe: isRefusedOrError, expect: "refused or an error" },
    { id: "W11c", label: "'.. ' components under a missing directory, create (mode w)", path: `${ROOT}/missing/.. /.. /outside/created.txt`, mode: "w", safe: (o) => isRefusedOrError(o) || o.startsWith("opened"), expect: "anything, provided nothing is created outside (checked below)" },
    { id: "W11d", label: "the root's parent, spelled with ..", path: `${ROOT}/..`, safe: isRefusedOrError, expect: "refused or an error" },
  ];
  for (const c of cases) await run(c);

  // Nothing was created or changed outside the root by any write-mode attempt above.
  const outsideNow = readdirSync(OUTSIDE).sort().join(",");
  const baseNow = readdirSync(BASE).sort().join(",");
  lines.push(`ADVERSARY-WIN outside after all cases: [${outsideNow}]; base: [${baseNow}]`);
  assert.equal(outsideNow, "secret.txt", "nothing created outside the root");
  assert.equal(baseNow, "outside,root,rootj", "nothing created beside the root");
  assert.equal(existsSync(`${BASE}/created.txt`), false);

  // 8.3 short names: of an inside file, of a link inside the root, and of the base directory the
  // root sits in. Either the volume generates them, or fsutil sets one; if neither, say so.
  const shortFile = ensureShortName(ROOT, "longfilename-inside.txt", "LONGFI~1.TXT");
  const shortLink = ensureShortName(ROOT, "file-link.txt", "FILE-L~1.TXT");
  const shortBase = ensureShortName("/tmp", BASE_NAME, "CLEARS~9");
  lines.push(`ADVERSARY-WIN short names: file=${String(shortFile)} link=${String(shortLink)} base=${String(shortBase)}`);
  const shortCases: Case[] = [];
  if (shortFile !== undefined) shortCases.push({ id: "W6", label: "8.3 short name of an inside file", path: `${ROOT}/${shortFile}`, safe: insideOrRefused(LONG_TEXT), expect: "opened the long-named inside file, or refused" });
  if (shortLink !== undefined) shortCases.push({ id: "W6b", label: "8.3 short name of a file link to outside", path: `${ROOT}/${shortLink}`, safe: isRefusedOrError, expect: "refused or an error, never the outside file" });
  if (shortBase !== undefined) {
    shortCases.push({ id: "W6c", label: "8.3 short name of the base directory, file inside the root", path: `/tmp/${shortBase}/root/inside.txt`, safe: insideOrRefused(INSIDE_TEXT), expect: "opened inside.txt, or refused" });
    shortCases.push({ id: "W6d", label: "8.3 short name of the base directory, file outside the root", path: `/tmp/${shortBase}/outside/secret.txt`, safe: isRefusedOrError, expect: "refused" });
    shortCases.push({ id: "W6e", label: "root declared by its 8.3 spelling, file by its long spelling", root: `/tmp/${shortBase}/root`, path: `${ROOT}/inside.txt`, safe: insideOrRefused(INSIDE_TEXT), expect: "opened inside.txt, or refused" });
    shortCases.push({ id: "W6f", label: "root declared by its 8.3 spelling, outside file", root: `/tmp/${shortBase}/root`, path: `${OUTSIDE}/secret.txt`, safe: isRefusedOrError, expect: "refused" });
  }
  if (shortCases.length === 0) lines.push("ADVERSARY-WIN W6 not measured: this volume has no 8.3 names and fsutil could not set one");
  for (const c of shortCases) await run(c);
});
