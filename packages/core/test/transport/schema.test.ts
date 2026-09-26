// Runtime validation of tools/call arguments (WO §1.6, architecture §5 *Runtime validation*;
// SPEC-MAP TL-4, TL-10, BI-14…BI-18, D-7) and registration-time schema checks (WO §5.5).

import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import { describe, it } from "node:test";

import ZSchema from "z-schema";

import { DEFAULT_LIMITS } from "../../src/transport/config.ts";
import { CanonicalRefusal } from "../../src/pinning/canonical.ts";
import { ManifestError } from "../../src/pinning/manifest.ts";
import type { PinnedRegistry } from "../../src/pinning/registry.ts";
import { RegistrationError, type Tool } from "../../src/transport/registry.ts";
import { pinForTest } from "../fixtures/pin.ts";
import { compileSchema, SchemaLoaderError } from "../../src/transport/schema.ts";

const ok = (): Promise<{ content: { type: "text"; text: string }[] }> => Promise.resolve({ content: [{ type: "text", text: "ok" }] });
const tool = (inputSchema: Record<string, unknown>, name = "t"): Tool => ({ name, inputSchema, handler: ok });
/** One tool through the pin gate into a registry: the static checks run in the constructor. */
const pin = (...tools: Tool[]): PinnedRegistry => pinForTest(tools, compileSchema, DEFAULT_LIMITS);

/** Replaces every network entry point with one that records and throws, for the callback's duration. */
async function withNetworkTrap<T>(fn: () => T | Promise<T>): Promise<{ value?: T; error?: unknown; attempts: string[] }> {
  const attempts: string[] = [];
  const saved = { fetch: globalThis.fetch, httpRequest: http.request, httpGet: http.get, httpsRequest: https.request, httpsGet: https.get };
  const trap = (what: string) => (...args: unknown[]): never => {
    attempts.push(`${what} ${String(args[0])}`);
    throw new Error("network access in a test that forbids it");
  };
  globalThis.fetch = trap("fetch");
  Object.assign(http, { request: trap("http.request"), get: trap("http.get") });
  Object.assign(https, { request: trap("https.request"), get: trap("https.get") });
  try {
    return { value: await fn(), attempts };
  } catch (error) {
    return { error, attempts };
  } finally {
    globalThis.fetch = saved.fetch;
    Object.assign(http, { request: saved.httpRequest, get: saved.httpGet });
    Object.assign(https, { request: saved.httpsRequest, get: saved.httpsGet });
  }
}

void describe("BI-16 BI-17 WO §5.5 an external $ref is refused at registration, never dereferenced", () => {
  const external: [string, Record<string, unknown>][] = [
    ["root https $ref", { type: "object", $ref: "https://example.com/x.json" }],
    ["nested http $ref", { type: "object", properties: { a: { $ref: "http://example.com/s" } } }],
    ["relative file $ref", { type: "object", properties: { a: { $ref: "other.json#/defs/a" } } }],
    ["file: URI $ref", { type: "object", properties: { a: { $ref: "file:///etc/passwd" } } }],
    ["external $dynamicRef", { type: "object", properties: { a: { $dynamicRef: "https://example.com/d#node" } } }],
  ];
  for (const [label, schema] of external) {
    void it(`${label}: refused, and no network call was attempted`, async () => {
      const result = await withNetworkTrap(() => {
        pin(tool(schema));
      });
      assert.ok(result.error instanceof RegistrationError, String(result.error));
      assert.match((result.error).message, /outside its own document/);
      assert.deepEqual(result.attempts, []);
    });
  }

  void it("the validator itself, handed an external $ref directly, fails without any network call (defence in depth)", async () => {
    const result = await withNetworkTrap(() => compileSchema({ type: "object", properties: { a: { $ref: "https://example.com/s" } } }));
    assert.ok(result.error !== undefined, "an unresolvable reference must not compile");
    assert.deepEqual(result.attempts, []);
  });

  void it("a schema reader installed by anyone makes compile and validate refuse (BI-16)", () => {
    const validate = compileSchema({ type: "object" });
    ZSchema.setSchemaReader(() => ({}));
    try {
      assert.throws(() => compileSchema({ type: "object" }), SchemaLoaderError);
      assert.throws(() => validate({}), SchemaLoaderError);
    } finally {
      ZSchema.setSchemaReader(undefined);
    }
  });

  void it("a same-document $ref and $defs are supported", () => {
    const r = pin(tool({ type: "object", $defs: { n: { type: "integer", minimum: 1 } }, properties: { a: { $ref: "#/$defs/n" } } }));
    const t = r.get("t");
    assert.equal(t?.validate({ a: 3 }), true);
    assert.equal(t?.validate({ a: 0 }), false);
  });
});

void describe("TL-4 BI-14 BI-15 BI-18 registration checks", () => {
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ["root type is not object", { type: "array" }, /type "object"/],
    ["declares draft-07", { $schema: "http://json-schema.org/draft-07/schema#", type: "object" }, /dialect/],
    ["declares $schema below the root", { type: "object", properties: { a: { $schema: "https://json-schema.org/draft/2020-12/schema" } } }, /below its root/],
    ["is not a valid schema", { type: "object", properties: { a: { type: "no-such-type" } } }, /does not compile/],
    ["nests deeper than maxSchemaDepth", { type: "object", properties: { a: JSON.parse('{"not":'.repeat(40) + "{}" + "}".repeat(40)) as unknown } }, /deeper/],
    ["has more than maxSchemaNodes subschemas", { type: "object", anyOf: Array.from({ length: 2001 }, () => ({ type: "object" })) }, /subschemas/],
  ];
  for (const [label, schema, why] of cases) {
    void it(`refused: inputSchema ${label}`, () => {
      assert.throws(() => {
        pin(tool(schema));
      }, (err: unknown) => err instanceof RegistrationError && why.test(err.message));
    });
  }

  void it("TL-5 a bad tool name, or a duplicate name, is refused, now before registration: the canonical form refuses the name (A5) and approve refuses the duplicate", () => {
    assert.throws(() => pin(tool({ type: "object" }, "bad name")), CanonicalRefusal);
    assert.throws(() => pin(tool({ type: "object" }, "a"), tool({ type: "object" }, "a")), ManifestError);
    assert.equal(pin(tool({ type: "object" }, "a")).get("a")?.definition.name, "a");
  });
});

void describe("TL-10 D-7 validation before the handler: the root default is unevaluatedProperties: false", () => {
  void it("a flat schema: an extra property is refused; declared ones pass", () => {
    const r = pin(tool({ type: "object", properties: { a: { type: "string" } } }));
    assert.equal(r.get("t")?.validate({ a: "x" }), true);
    assert.equal(r.get("t")?.validate({ a: "x", b: 1 }), false);
  });

  void it("composition at the root: properties declared under allOf still pass, extras are refused (why not additionalProperties)", () => {
    const r = pin(tool({ type: "object", allOf: [{ properties: { a: { type: "string" } } }, { properties: { b: { type: "integer" } } }] }));
    assert.equal(r.get("t")?.validate({ a: "x", b: 1 }), true);
    assert.equal(r.get("t")?.validate({ a: "x", b: 1, c: true }), false);
  });

  void it("a schema that decides for itself is left alone: additionalProperties: true admits extras", () => {
    const r = pin(tool({ type: "object", properties: { a: { type: "string" } }, additionalProperties: true }));
    assert.equal(r.get("t")?.validate({ a: "x", b: 1 }), true);
  });

  void it("the advertised definition is the registered schema, unchanged", () => {
    const schema = { type: "object", properties: { a: { type: "string" } } };
    const r = pin(tool(schema));
    assert.deepEqual(r.get("t")?.definition.inputSchema, { type: "object", properties: { a: { type: "string" } } });
  });

  void it("format is an annotation in 2020-12, not an assertion", () => {
    const r = pin(tool({ type: "object", properties: { e: { type: "string", format: "email" } } }));
    assert.equal(r.get("t")?.validate({ e: "not an email" }), true);
  });
});
