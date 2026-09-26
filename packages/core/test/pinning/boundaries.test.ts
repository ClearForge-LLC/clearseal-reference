// The canonicalizer's boundaries, from the CSR-WO-1000 stage-B adversarial pass:
// - the nesting limit (F1): the same in both implementations, on the text path and the value path,
//   and a refusal rather than a crash;
// - the API boundary (F2, F3): only JSON-shaped values reach the hash.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CanonicalRefusal, canonicalBytes, canonicalManifestBytes, toolHash, type ManifestInput } from "../../src/pinning/canonical.ts";
import { agreement, oracleAnswers, typescriptAnswer, type Request } from "./harness.ts";

const nestedArrayText = (n: number): string => "[".repeat(n) + "]".repeat(n);
const nestedObjectText = (n: number): string => '{"a":'.repeat(n - 1) + "{}" + "}".repeat(n - 1);
function nestedValue(n: number): unknown {
  let v: unknown = [];
  for (let i = 1; i < n; i++) v = [v];
  return v;
}

const TOOL = {
  name: "echo",
  description: "Returns its text.",
  input_schema: { type: "object" },
  capability_class: "read_only",
  untrusted_input_facing: false,
  scope: "echo",
  privacy_sensitive: false,
  recoverability_basis: null,
  elevated: false,
  containment_domain: null,
};

const refused = (f: () => unknown): void => {
  assert.throws(f, CanonicalRefusal);
};

void describe("nesting: 512 levels accepted, 513 refused, by both implementations on both paths", () => {
  void it("JSON text and a tool's input_schema value, at 512 and 513", () => {
    // The tool object is one level, so a schema of n levels nests n + 1 deep.
    const requests: Request[] = [
      { kind: "json", input_json_text: nestedArrayText(512) },
      { kind: "json", input_json_text: nestedObjectText(512) },
      { kind: "json", input_json_text: nestedArrayText(513) },
      { kind: "json", input_json_text: nestedObjectText(513) },
      { kind: "tool", input: { ...TOOL, input_schema: { deep: nestedValue(510) } } },
      { kind: "tool", input: { ...TOOL, input_schema: { deep: nestedValue(511) } } },
    ];
    const expected = ["bytes", "bytes", "refused", "refused", "bytes", "refused"];
    const ts = requests.map((r) => agreement(typescriptAnswer(r)));
    const py = oracleAnswers(requests).map(agreement);
    console.log(`NESTING ts=${JSON.stringify(ts.map((a) => a.split(" ")[0]))} oracle=${JSON.stringify(py.map((a) => a.split(" ")[0]))}`);
    assert.deepEqual(ts.map((a) => a.split(" ")[0]), expected);
    assert.deepEqual(py, ts);
  });

  void it("a cycle is refused at the limit, not a stack overflow", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    refused(() => canonicalBytes(cyclic));
    refused(() => toolHash({ ...TOOL, input_schema: cyclic }));
  });
});

void describe("the API boundary: only JSON-shaped values reach the hash", () => {
  void it("an accessor, a symbol key, a non-enumerable member or an array's extra property is refused, never skipped", () => {
    const getter = { ...TOOL };
    Object.defineProperty(getter, "elevated", { get: () => false, enumerable: true });
    refused(() => toolHash(getter));
    refused(() => toolHash({ ...TOOL, [Symbol("extra")]: 1 }));
    const hidden = { ...TOOL };
    Object.defineProperty(hidden, "title", { value: "x", enumerable: false });
    refused(() => toolHash(hidden));
    const arr = Object.assign([1, 2], { extra: 3 });
    refused(() => canonicalBytes(arr));
    const holed = [1, 2, 3];
    Reflect.deleteProperty(holed, 1);
    refused(() => canonicalBytes(holed));
  });

  void it("a manifest that is not an object is refused (A9)", () => {
    for (const m of [null, undefined, 1, "m", [], new Map()]) refused(() => canonicalManifestBytes(m as unknown as ManifestInput));
  });

  void it("an object without a prototype is JSON-shaped and accepted", () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { b: 1, a: 2 });
    assert.equal(canonicalBytes(bare).toString("utf8"), '{"a":2,"b":1}');
  });
});
