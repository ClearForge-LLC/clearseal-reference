// test:subset (CSR-WO-1000 §1.7, northstar N3): every field a gate reads is inside the hash. The
// gate-read list is imported from the capability module (one list); the hashed set is read from the
// canonicalizer's own output.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GATE_READ_FIELDS, PINNED_FIELDS } from "../../src/capability/fields.ts";
import { canonicalFieldSet, gateFieldsNotPinned } from "../../src/pinning/canonical.ts";

void describe("test:subset: a gate never decides on a field the manifest does not hash", () => {
  void it("every gate-read field is in the hashed set", () => {
    console.log(`SUBSET gate-read=${JSON.stringify(GATE_READ_FIELDS)} hashed=${JSON.stringify([...canonicalFieldSet()].sort())} unpinned=${JSON.stringify(gateFieldsNotPinned())}`);
    assert.deepEqual(gateFieldsNotPinned(), []);
  });

  void it("the hashed set is exactly the ten pinned fields of the capability module", () => {
    assert.deepEqual([...canonicalFieldSet()].sort(), [...PINNED_FIELDS].sort());
  });

  void it("the check can go red: a gate-read field outside the hash is returned", () => {
    assert.deepEqual(gateFieldsNotPinned([...GATE_READ_FIELDS, "rate_limit_tier"]), ["rate_limit_tier"]);
  });
});
