// CSR-WO-1000 §1.5: the TypeScript canonicalizer against the committed vectors, which the Python
// oracle generated (N3). The canonicalizer never writes the file; CI regenerates it from the
// oracle and fails on any difference.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { CANONICAL_FORM_VERSION } from "../../src/pinning/canonical.ts";
import { agreement, oracleAnswers, typescriptAnswer, type Request } from "./harness.ts";

type Vector = Request & { id: string; rule: string; expect: "canonical" | "refuse"; canonical_hex?: string; sha256?: string };

const file = JSON.parse(readFileSync(new URL("../vectors/canonical-v1.json", import.meta.url), "utf8")) as { canonical_form_version: number; vectors: Vector[] };

void describe("the canonical-form vectors (docs/canonical-form.md A1–A10)", () => {
  void it("the file is version 1 and holds a vector for every rule", () => {
    assert.equal(file.canonical_form_version, CANONICAL_FORM_VERSION);
    const rules = new Set(file.vectors.map((v) => v.rule));
    assert.deepEqual([...rules].sort(), ["A1", "A10", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"]);
  });

  for (const v of file.vectors) {
    void it(`${v.id} (${v.rule}, ${v.kind}): ${v.expect}`, () => {
      const got = typescriptAnswer(v);
      if (v.expect === "refuse") assert.equal(got.ok, false, `${v.id} must be refused`);
      else assert.deepEqual(got, { ok: true, hex: v.canonical_hex, sha256: v.sha256 });
    });
  }

  void it("the oracle, run now, agrees with the file on every vector", () => {
    const answers = oracleAnswers(file.vectors);
    const disagreements = file.vectors.filter((v, i) => agreement(answers[i] ?? { ok: false, rule: "none" }) !== (v.expect === "refuse" ? "refused" : `bytes ${v.canonical_hex ?? ""}`));
    console.log(`VECTORS ${String(file.vectors.length)} vectors; oracle disagreements: ${String(disagreements.length)}`);
    assert.deepEqual(disagreements.map((v) => v.id), []);
  });
});
