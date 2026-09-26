// Test harness for the canonical form: one request shape for both implementations, and the Python
// oracle driven by subprocess. The oracle is the independent implementation (N3), so every
// cross-check here compares bytes the TypeScript produced with bytes the oracle produced.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  CanonicalRefusal,
  canonicalBytes,
  canonicalManifestBytes,
  canonicalSet,
  canonicalToolBytes,
  checkToolName,
  normalizeDescription,
  parseCanonicalJson,
  type ManifestInput,
} from "../../src/pinning/canonical.ts";

export type Request =
  | { kind: "json"; input_json_text: string }
  | { kind: "json-special"; input_special: "NaN" | "Infinity" | "-Infinity" }
  | { kind: "description" | "name" | "set" | "tool" | "manifest"; input: unknown };

export type Result = { ok: true; hex: string; sha256: string } | { ok: false; rule: string };

const SPECIAL = { NaN: Number.NaN, Infinity: Number.POSITIVE_INFINITY, "-Infinity": Number.NEGATIVE_INFINITY } as const;

function bytesFor(r: Request): Buffer {
  switch (r.kind) {
    case "json":
      return canonicalBytes(parseCanonicalJson(r.input_json_text));
    case "json-special":
      return canonicalBytes(SPECIAL[r.input_special]);
    case "description":
      if (typeof r.input !== "string") throw new CanonicalRefusal("A4", "a description must be a string");
      return Buffer.from(normalizeDescription(r.input), "utf8");
    case "name":
      return Buffer.from(checkToolName(r.input), "utf8");
    case "set":
      return canonicalBytes(canonicalSet(r.input));
    case "tool":
      return canonicalToolBytes(r.input);
    case "manifest":
      return canonicalManifestBytes(r.input as ManifestInput);
  }
}

/** The TypeScript canonicalizer's answer. Only a CanonicalRefusal counts as a refusal; any other
 *  error is a defect and propagates. */
export function typescriptAnswer(r: Request): Result {
  try {
    const b = bytesFor(r);
    return { ok: true, hex: b.toString("hex"), sha256: createHash("sha256").update(b).digest("hex") };
  } catch (err) {
    if (err instanceof CanonicalRefusal) return { ok: false, rule: err.rule };
    throw err;
  }
}

const ORACLE = fileURLToPath(new URL("../oracle/canonical_oracle.py", import.meta.url));

let python: string | undefined;
/** A Python 3 interpreter: CLEARSEAL_PYTHON when named, else `python3`, else `python` (the name on
 *  Windows runners). Missing Python fails the suite; it is never a skip. */
export function pythonCommand(): string {
  if (python !== undefined) return python;
  const named = process.env["CLEARSEAL_PYTHON"];
  for (const candidate of named === undefined ? ["python3", "python"] : [named]) {
    const probe = spawnSync(candidate, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8" });
    if (probe.status === 0 && probe.stdout.trim() === "3") {
      python = candidate;
      return candidate;
    }
  }
  throw new Error("no Python 3 interpreter found (set CLEARSEAL_PYTHON): the oracle cross-check cannot run");
}

/** Escapes every non-ASCII code unit, so the request line is ASCII whatever the platform's console
 *  encoding. JSON.stringify already writes a lone surrogate as an escape. */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** The oracle's answers, one subprocess for the whole batch. */
export function oracleAnswers(requests: readonly Request[]): Result[] {
  const input = requests.map((r) => asciiJson(r)).join("\n") + "\n";
  const run = spawnSync(pythonCommand(), [ORACLE, "serve"], { input, maxBuffer: 1 << 30 });
  if (run.status !== 0) throw new Error(`the oracle failed (status ${String(run.status)}): ${run.stderr.toString("utf8").slice(0, 2000)}`);
  const lines = run.stdout.toString("utf8").split("\n").filter((l) => l !== "");
  if (lines.length !== requests.length) throw new Error(`the oracle answered ${String(lines.length)} of ${String(requests.length)} requests`);
  return lines.map((l) => JSON.parse(l) as Result);
}

/** Bytes (or a refusal) are what the two implementations must agree on; the refusing rule's name
 *  depends on the order an implementation checks in, so it is not compared. */
export function agreement(r: Result): string {
  return r.ok ? `bytes ${r.hex}` : "refused";
}
