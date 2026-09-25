// The strict JSON parser (WO §1.3): agrees with JSON.parse on valid input, and refuses what
// JSON.parse silently accepts or resolves.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { JsonParseError, parseJsonStrict } from "../../src/transport/json.ts";

const kind = (text: string, depth = 64): string => {
  try {
    parseJsonStrict(text, depth);
    return "accepted";
  } catch (err) {
    assert.ok(err instanceof JsonParseError, String(err));
    return err.kind;
  }
};

void describe("parseJsonStrict", () => {
  void it("agrees with JSON.parse on a corpus of valid documents", () => {
    const corpus = [
      "0", "-0", "1.5e3", "-12.25E-2", '"a\\"b\\\\c\\/d\\b\\f\\n\\r\\t"', '"\\u00e9\\ud83d\\ude00"', "true", "false", "null",
      "[]", "{}", ' { "a" : [ 1 , { "b" : null } ] , "c" : "é😀" } ', '{"":1}', "[[[[]]]]",
    ];
    for (const text of corpus) assert.deepEqual(parseJsonStrict(text, 64), JSON.parse(text), text);
  });

  void it("refuses a duplicate key at any depth", () => {
    assert.equal(kind('{"a":1,"a":2}'), "duplicate-key");
    assert.equal(kind('{"x":{"a":1,"b":{"c":1,"c":1}}}'), "duplicate-key");
    assert.equal(kind('{"a":1,"\\u0061":2}'), "duplicate-key", "an escaped spelling of the same key is the same key");
  });

  void it("a __proto__ key is an own property, never a prototype", () => {
    const v = parseJsonStrict('{"__proto__":{"polluted":true}}', 64) as Record<string, unknown>;
    assert.equal(Object.getPrototypeOf(v), Object.prototype);
    assert.deepEqual(Object.keys(v), ["__proto__"]);
    assert.equal(({} as Record<string, unknown>)["polluted"], undefined);
  });

  void it("refuses lone surrogate escapes, high and low", () => {
    assert.equal(kind('"\\ud800"'), "lone-surrogate");
    assert.equal(kind('"\\udc00"'), "lone-surrogate");
    assert.equal(kind('"\\ud800\\u0041"'), "lone-surrogate");
  });

  void it("depth: exactly the cap accepted, one more refused", () => {
    assert.equal(kind("[".repeat(64) + "]".repeat(64)), "accepted");
    assert.equal(kind("[".repeat(65) + "]".repeat(65)), "depth");
    assert.equal(kind('{"a":'.repeat(65) + "1" + "}".repeat(65)), "depth");
  });

  void it("refuses what RFC 8259 does not allow", () => {
    for (const bad of ["", " ", "01", "1.", ".5", "+1", "NaN", "Infinity", "[1,]", '{"a":1,}', "{'a':1}", '"\t"', '"\\x41"', "[1] [2]", "tru", '{"a" 1}', "1e400"]) {
      assert.equal(kind(bad), "syntax", JSON.stringify(bad));
    }
  });
});
