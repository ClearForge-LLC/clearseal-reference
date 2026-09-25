// Fails unless the bill of materials is a well-formed CycloneDX document that lists every direct
// dependency of the root and of every workspace, at the version the lockfile resolved
// (CSR-WO-0002 §1.6). An empty, truncated or malformed file fails; nothing is uploaded unverified.
//
// Usage: node .github/scripts/check-sbom.mjs <sbom.cdx.json>

import { readFileSync } from "node:fs";

const file = process.argv[2];
if (file === undefined) throw new Error("usage: check-sbom.mjs <sbom.cdx.json>");

/**
 * @param {string} path
 * @returns {unknown} the parsed JSON, or undefined if the file is unreadable or not JSON
 */
function readJson(path) {
  try {
    return /** @type {unknown} */ (JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return undefined;
  }
}

/** @typedef {{ version?: string, dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} LockEntry */
const lock = /** @type {{ packages: Record<string, LockEntry> }} */ (readJson("package-lock.json"));
const parsed = readJson(file);
const bom = /** @type {{ bomFormat?: unknown, specVersion?: unknown, components?: { purl?: string }[] }} */ (
  typeof parsed === "object" && parsed !== null ? parsed : {}
);

const problems = [];
if (parsed === undefined) problems.push(`${file} is empty, unreadable, or not JSON`);
if (bom.bomFormat !== "CycloneDX") problems.push(`bomFormat is ${JSON.stringify(bom.bomFormat)}, not "CycloneDX"`);
if (typeof bom.specVersion !== "string") problems.push("specVersion is missing");
const purls = new Set((bom.components ?? []).map((c) => c.purl));
if (purls.size === 0) problems.push("no components");

// Direct dependencies: the root entry and every workspace entry ("packages/<name>").
let direct = 0;
for (const [where, entry] of Object.entries(lock.packages)) {
  if (where !== "" && where.startsWith("node_modules/")) continue;
  for (const name of Object.keys({ ...entry.dependencies, ...entry.devDependencies })) {
    const resolved = lock.packages[`node_modules/${name}`]?.version;
    const purl = `pkg:npm/${name.replace(/^@/, "%40")}@${resolved ?? "?"}`;
    direct++;
    if (!purls.has(purl)) problems.push(`direct dependency ${name}@${resolved ?? "?"} is not in the bill of materials`);
  }
}

console.log(`check-sbom: ${String(purls.size)} component(s); ${String(direct)} direct dependenc(ies) checked`);
for (const p of problems) console.error(`check-sbom: FAIL — ${p}`);
process.exitCode = problems.length === 0 ? 0 : 1;
