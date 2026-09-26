// CSR-WO-1001 §1.1, §3.2, §3.6: the manifest's load refusals, and the invariance of manifest_hash
// under the fields outside it.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { manifestHash } from "../../src/pinning/canonical.ts";
import { buildManifest, canonicalInput, type Manifest, ManifestError, manifestHashOf, parseManifest, serializeManifest } from "../../src/pinning/manifest.ts";
import { definitions } from "../fixtures/tools.ts";

const approved = (): Manifest => buildManifest(definitions, new Date("2026-09-26T00:00:00Z"));
const text = (m: unknown): string => JSON.stringify(m);
const refusedWith = (m: unknown, why: RegExp): void => {
  assert.throws(() => parseManifest(text(m)), (err: unknown) => err instanceof ManifestError && why.test(err.message));
};

void describe("the manifest format (manifest_version 1)", () => {
  void it("an approved manifest loads, and its hash is -1000's manifestHash over the same tools (A9)", () => {
    const m = approved();
    assert.deepEqual(parseManifest(serializeManifest(m)), m);
    assert.equal(m.manifest_hash, manifestHash({ canonical_form_version: 1, tools: definitions.map(canonicalInput) }));
    assert.deepEqual(m.build, { commit: null, distribution_digest: null, signature: null, kid: null, key_valid_from: null, key_valid_to: null });
  });

  void it("a hand-edited tool_hash: manifest_hash no longer recomputes, and the load is refused", () => {
    const m = approved();
    const first = m.tools[0];
    assert.ok(first !== undefined);
    first.tool_hash = first.tool_hash.replace(/^./, (c) => (c === "0" ? "1" : "0"));
    refusedWith(m, /manifest_hash does not recompute/);
  });

  void it("an unknown top-level field is refused", () => {
    refusedWith({ ...approved(), note: "hello" }, /unknown top-level field\(s\): note/);
  });

  void it("canonical_form_version 2, or manifest_version 2, is refused", () => {
    refusedWith({ ...approved(), canonical_form_version: 2 }, /canonical_form_version this implementation does not implement/);
    refusedWith({ ...approved(), manifest_version: 2 }, /manifest_version this implementation does not implement/);
  });

  void it("tools out of order, or a name twice, is refused (A9)", () => {
    const m = approved();
    const swapped = { ...m, tools: [m.tools[1], m.tools[0], ...m.tools.slice(2)] };
    refusedWith({ ...swapped, manifest_hash: manifestHashOf(swapped.tools as Manifest["tools"]) }, /not sorted/);
    const twice = { ...m, tools: [m.tools[0], ...m.tools] };
    refusedWith({ ...twice, manifest_hash: manifestHashOf(twice.tools as Manifest["tools"]) }, /appears twice/);
  });

  void it("WO §5.2: code-point order for an astral name is refused (A9 is UTF-16 order); approve never writes it", () => {
    // U+1F600 is D83D DE00 in UTF-16, so it sorts before U+FB01; code-point order reverses them.
    // Names are ASCII (A5), so the case is built with the entries directly.
    const codePoint = [
      { name: "ﬁ", tool_hash: "a".repeat(64) },
      { name: "\u{1f600}", tool_hash: "b".repeat(64) },
    ];
    refusedWith({ ...approved(), tools: codePoint, manifest_hash: manifestHashOf(codePoint) }, /does not match manifest\.schema\.json|not sorted/);
  });

  void it("an extra build slot, a non-null hash-shaped mistake, or a bad generated_at is refused", () => {
    refusedWith({ ...approved(), build: { ...approved().build, extra: null } }, /manifest\.schema\.json/);
    refusedWith({ ...approved(), generated_at: "yesterday" }, /manifest\.schema\.json|RFC 3339/);
    refusedWith({ ...approved(), generated_at: "2026-09-26T00:00:00" }, /RFC 3339/);
    assert.throws(() => parseManifest('{"manifest_version":1,"manifest_version":1}'), ManifestError);
    assert.throws(() => parseManifest("not json"), ManifestError);
  });

  void it("WO §3.6 N3: generated_at and build are outside the hash: changing them leaves manifest_hash unchanged and the load valid", () => {
    const m = approved();
    const changed = { ...m, generated_at: "2031-01-01T12:34:56.789+02:00", build: { commit: "c", distribution_digest: "d", signature: null, kid: null, key_valid_from: "2026-01-01T00:00:00Z", key_valid_to: null } };
    const loaded = parseManifest(text(changed));
    console.log(`INVARIANCE manifest_hash before=${m.manifest_hash.slice(0, 12)} after=${loaded.manifest_hash.slice(0, 12)} (generated_at and build changed)`);
    assert.equal(loaded.manifest_hash, m.manifest_hash);
    assert.equal(manifestHashOf(loaded.tools), m.manifest_hash);
  });
});
