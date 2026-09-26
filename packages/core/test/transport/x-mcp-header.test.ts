// x-mcp-header, implemented fully on the server side (WO §1.5; SPEC-MAP SH-26…SH-39, D-4).
// Registration refuses every broken annotation; at call time each recognized Mcp-Param-* header
// must agree with the body.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { DEFAULT_LIMITS } from "../../src/transport/config.ts";
import { RegistrationError, type Tool } from "../../src/transport/registry.ts";
import { pinForTest } from "../fixtures/pin.ts";
import { compileSchema } from "../../src/transport/schema.ts";
import { modern, modernBody, modernHeaders, raw, type Reply, start, type Started } from "./helpers.ts";

const ok = (): Promise<{ content: { type: "text"; text: string }[] }> => Promise.resolve({ content: [{ type: "text", text: "ok" }] });
function tool(inputSchema: Record<string, unknown>): Tool {
  return { name: "t", inputSchema: { type: "object", ...inputSchema }, handler: ok };
}
function refused(schema: Record<string, unknown>): string {
  try {
    pinForTest([tool(schema)], compileSchema, DEFAULT_LIMITS);
  } catch (err) {
    assert.ok(err instanceof RegistrationError, String(err));
    return err.message;
  }
  assert.fail("registration was accepted");
}

void describe("SH-27…SH-29 registration refuses every broken x-mcp-header annotation", () => {
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ["empty", { properties: { a: { type: "string", "x-mcp-header": "" } } }, /empty/],
    ["not a token (space)", { properties: { a: { type: "string", "x-mcp-header": "Re gion" } } }, /token/],
    ["control character (CR LF)", { properties: { a: { type: "string", "x-mcp-header": "A\r\nX-Injected: 1" } } }, /token/],
    ["not case-insensitively unique", { properties: { a: { type: "string", "x-mcp-header": "Region" }, b: { type: "string", "x-mcp-header": "REGION" } } }, /unique/],
    ["type number", { properties: { a: { type: "number", "x-mcp-header": "N" } } }, /type/],
    ["type object", { properties: { a: { type: "object", "x-mcp-header": "O" } } }, /type/],
    ["no type", { properties: { a: { "x-mcp-header": "U" } } }, /type/],
    ["two primitive types", { properties: { a: { type: ["string", "integer"], "x-mcp-header": "U" } } }, /type/],
    ["under items", { properties: { a: { type: "array", items: { type: "string", "x-mcp-header": "I" } } } }, /statically reachable/],
    ["under anyOf", { anyOf: [{ properties: { a: { type: "string", "x-mcp-header": "C" } } }] }, /statically reachable/],
    ["under if/then", { if: { properties: { a: { type: "string" } } }, then: { properties: { a: { type: "string", "x-mcp-header": "C" } } } }, /statically reachable/],
    ["under $defs (reachable only by $ref)", { $defs: { d: { type: "string", "x-mcp-header": "D" } }, properties: { a: { $ref: "#/$defs/d" } } }, /statically reachable/],
    ["on the root", { "x-mcp-header": "Root" }, /statically reachable/],
  ];
  for (const [label, schema, why] of cases) {
    void it(`refused: ${label}`, () => {
      assert.match(refused(schema), why);
    });
  }

  void it("accepted: nested properties chain, integer, boolean, nullable primitive; an x-mcp-header key inside `default` data is not an annotation", () => {
    const registry = pinForTest(
      [
        tool({
        properties: {
          a: { type: "object", properties: { b: { type: "string", "x-mcp-header": "Deep" } } },
          n: { type: "integer", "x-mcp-header": "N" },
          f: { type: ["boolean", "null"], "x-mcp-header": "F" },
          d: { type: "object", default: { "x-mcp-header": "not-an-annotation" } },
        },
      }),
      ],
      compileSchema,
      DEFAULT_LIMITS,
    );
    // Order-insensitive: the registry serves the pin gate's canonical snapshot (CSR-WO-1001), whose
    // members are in JCS order, not the order they were written in.
    assert.deepEqual(registry.get("t")?.paramHeaders.map((p) => [p.header, p.path.join("/"), p.type]).sort(), [
      ["mcp-param-deep", "a/b", "string"],
      ["mcp-param-f", "f", "boolean"],
      ["mcp-param-n", "n", "integer"],
    ]);
  });
});

void describe("SH-30…SH-38 call-time Mcp-Param-* validation against the fixture tool", () => {
  let s: Started;
  before(async () => {
    s = await start();
  });
  after(async () => {
    await s.close();
  });
  const call = (args: Record<string, unknown>, headers: Record<string, string>): Promise<Reply> => modern(s.t, "tools/call", { name: "region_query", arguments: { query: "q", ...args } }, { headers });
  const code = (r: Reply): unknown => (r.json as { error?: { code: number } }).error?.code;

  void it("matching plain, integer, boolean and nested headers → 200", async () => {
    const r = await call({ region: "us-west1", limit: 42, dry: true, scope: { zone: "b" } }, { "mcp-param-region": "us-west1", "mcp-param-limit": "42", "mcp-param-dry": "true", "mcp-param-zone": "b" });
    assert.equal(r.status, 200, r.text);
  });

  void it("SH-36 header names are case-insensitive", async () => {
    const r = await call({ region: "us-west1" }, { "MCP-PARAM-REGION": "us-west1" });
    assert.equal(r.status, 200, r.text);
  });

  void it("SH-38 an integer compares numerically: header 42.0 matches body 42", async () => {
    const r = await call({ limit: 42 }, { "mcp-param-limit": "42.0" });
    assert.equal(r.status, 200, r.text);
  });

  void it("SH-31 a Base64 sentinel is decoded before comparing (non-ASCII value)", async () => {
    const r = await call({ region: "Hello, 世界" }, { "mcp-param-region": `=?base64?${Buffer.from("Hello, 世界").toString("base64")}?=` });
    assert.equal(r.status, 200, r.text);
  });

  void it("SH-35 value in the body but header missing → 400 -32020", async () => {
    const r = await call({ region: "us-west1" }, {});
    assert.equal(r.status, 400);
    assert.equal(code(r), -32020);
    assert.match(r.text, /Mcp-Param-Region is missing/);
  });

  void it("SH-35 header does not match the body → 400 -32020, and the message never carries either value", async () => {
    const r = await call({ region: "us-west1" }, { "mcp-param-region": "eu-north1" });
    assert.equal(code(r), -32020);
    assert.ok(!r.text.includes("us-west1") && !r.text.includes("eu-north1"), r.text);
  });

  void it("SH-35 null value: the header is not expected; D-4 one sent anyway is refused", async () => {
    assert.equal((await call({ dry: null }, {})).status, 200);
    assert.equal(code(await call({ dry: null }, { "mcp-param-dry": "false" })), -32020);
  });

  void it("SH-35 absent value: the header is not expected; D-4 one sent anyway is refused", async () => {
    assert.equal((await call({}, {})).status, 200);
    assert.equal(code(await call({}, { "mcp-param-region": "x" })), -32020);
  });

  void it("SH-34 invalid characters in a recognized header → 400 -32020", async () => {
    const r = await call({ region: "us-west1" }, { "mcp-param-region": "us-west1\u0080" });
    assert.equal(code(r), -32020);
  });

  void it("SH-31 an invalid Base64 payload inside the sentinel → 400 -32020", async () => {
    const r = await call({ region: "x" }, { "mcp-param-region": "=?base64?***?=" });
    assert.equal(code(r), -32020);
  });

  void it("SH-28 an integer outside the safe range in the body → 400 -32020", async () => {
    const r = await call({ limit: 2 ** 53 }, { "mcp-param-limit": String(2 ** 53) });
    assert.equal(code(r), -32020);
  });

  void it("SH-33 an unrecognized Mcp-Param-* header is ignored", async () => {
    const r = await call({}, { "mcp-param-unrelated": "anything" });
    assert.equal(r.status, 200, r.text);
  });

  void it("a recognized header sent twice → 400 -32020", async () => {
    const r = await raw(s.t, { headers: { ...modernHeaders("tools/call", "region_query"), "mcp-param-region": ["a", "a"] }, body: JSON.stringify(modernBody("tools/call", { name: "region_query", arguments: { query: "q", region: "a" } })) });
    assert.equal(code(r), -32020);
  });
});
