// CSR-WO-1001 §1.3, §1.4, §3.3, §3.7: the registry is built only from the gate's admission; the
// strict default stops the node on any refusal; non-strict serves the admitted tools and names the
// refused ones on call; a missing manifest stops the node either way.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { Admission, PinGate } from "../../src/pinning/gate.ts";
import { ManifestError, type PinnableTool } from "../../src/pinning/manifest.ts";
import { loadPinnedRegistry, PinnedRegistry, PinRefusedError, pinStrictFromEnv } from "../../src/pinning/registry.ts";
import { DEFAULT_LIMITS } from "../../src/transport/config.ts";
import { compileSchema } from "../../src/transport/schema.ts";
import { startTransport } from "../../src/transport/server.ts";
import type { ToolRegistry } from "../../src/transport/registry.ts";
import { definitions } from "../fixtures/tools.ts";
import { FIXTURE_MANIFEST, modern, raw, TestBearerVerifier } from "../transport/helpers.ts";

const options = (strict: boolean) => ({ compile: compileSchema, limits: DEFAULT_LIMITS, strict });

/** Starts a transport that must refuse to start. If it starts anyway, it is closed at once and the
 *  refusal is missing, so the test fails instead of leaving a server open. */
async function startExpectingRefusal(opts: Parameters<typeof startTransport>[0]): Promise<unknown> {
  try {
    const t = await startTransport(opts);
    await t.close();
    return undefined;
  } catch (err) {
    return err;
  }
}
const manifestText = readFileSync(FIXTURE_MANIFEST, "utf8");
const echo = definitions.find((d) => d.name === "echo") as PinnableTool;
const drifted = [...definitions.filter((d) => d.name !== "echo"), { ...echo, description: "Returns its text, and more." }];

void describe("WO §3.7 the registry cannot be built from anything but the gate's admission", () => {
  void it("a raw definition list is refused by the constructor's type and at run time", () => {
    // @ts-expect-error -- the point of the test: a raw definition list is not an Admission, so this line must not type-check.
    assert.throws(() => new PinnedRegistry(definitions, options(true)), TypeError);
  });

  void it("an object shaped like an Admission is refused the same way; an Admission cannot be constructed outside the gate", () => {
    const forged = { admitted: definitions, refused: [] };
    // @ts-expect-error -- the Admission type is nominal (a private brand), so a look-alike must not type-check.
    assert.throws(() => new PinnedRegistry(forged, options(true)), TypeError);
    assert.throws(() => new Admission(Symbol("PinGate.admit"), [], []), TypeError);
  });

  void it("the transport serves only a PinnedRegistry", async () => {
    const handMade: ToolRegistry = { list: () => [], get: () => undefined };
    // @ts-expect-error -- startTransport's registry option is a PinnedRegistry; a hand-made ToolRegistry must not type-check.
    const err = await startExpectingRefusal({ registry: handMade, serverInfo: { name: "x", version: "0" } });
    assert.match(String(err), /only a PinnedRegistry/);
  });
});

void describe("adversarial F3, F4: the registry cannot be subclassed, forged, patched or re-labelled", () => {
  const genuine = (): PinnedRegistry => new PinnedRegistry(PinGate.load(manifestText).admit(definitions), options(true));

  void it("a subclass is refused at construction", () => {
    class Leaky extends PinnedRegistry {}
    assert.throws(() => new Leaky(PinGate.load(manifestText).admit(definitions), options(true)), /cannot be subclassed/);
  });

  void it("an object made from the prototype, with no admission behind it, is refused by the transport", async () => {
    const fake = Object.create(PinnedRegistry.prototype) as PinnedRegistry;
    assert.equal(PinnedRegistry.isGenuine(fake), false);
    const err = await startExpectingRefusal({ registry: fake, serverInfo: { name: "x", version: "0" } });
    assert.match(String(err), /only a PinnedRegistry/);
    assert.equal(PinnedRegistry.isGenuine(genuine()), true);
  });

  void it("the prototype and every instance are frozen: get() cannot be patched, pinning cannot be reassigned", () => {
    assert.throws(() => {
      (PinnedRegistry.prototype as unknown as Record<string, unknown>)["get"] = () => undefined;
    }, TypeError);
    const r = genuine();
    assert.throws(() => {
      (r as unknown as Record<string, unknown>)["pinning"] = { strict: false, admitted: 0, refused: [], isRefused: () => false };
    }, TypeError);
  });
});

void describe("WO §1.4, §3.3 strict vs non-strict", () => {
  void it("adversarial F5: strict omitted is PIN_STRICT from the environment, strict unless exactly false", () => {
    const saved = process.env["PIN_STRICT"];
    try {
      delete process.env["PIN_STRICT"];
      assert.equal(new PinnedRegistry(PinGate.load(manifestText).admit(definitions), { compile: compileSchema, limits: DEFAULT_LIMITS }).pinning.strict, true);
      process.env["PIN_STRICT"] = "false";
      assert.equal(new PinnedRegistry(PinGate.load(manifestText).admit(definitions), { compile: compileSchema, limits: DEFAULT_LIMITS }).pinning.strict, false);
      assert.throws(() => loadPinnedRegistry(new URL("./no-such-manifest.json", FIXTURE_MANIFEST), definitions, { compile: compileSchema, limits: DEFAULT_LIMITS }), ManifestError, "PIN_STRICT=false never excuses a missing manifest");
    } finally {
      if (saved === undefined) delete process.env["PIN_STRICT"];
      else process.env["PIN_STRICT"] = saved;
    }
  });

  void it("PIN_STRICT: strict unless exactly false", () => {
    assert.equal(pinStrictFromEnv({}), true);
    assert.equal(pinStrictFromEnv({ PIN_STRICT: "0" }), true);
    assert.equal(pinStrictFromEnv({ PIN_STRICT: "FALSE" }), true);
    assert.equal(pinStrictFromEnv({ PIN_STRICT: "false" }), false);
  });

  void it("strict (the default): a drifted tool stops the node before it binds, with the refusal logged once", async () => {
    const audits: string[] = [];
    const registry = new PinnedRegistry(PinGate.load(manifestText).admit(drifted), options(true));
    const err = await startExpectingRefusal({ registry, serverInfo: { name: "x", version: "0" }, audit: (event, fields) => audits.push(`${event} ${JSON.stringify(fields)}`) });
    console.log(`STRICT threw ${String(err)}\nSTRICT audit ${JSON.stringify(audits)}`);
    assert.ok(err instanceof PinRefusedError);
    assert.deepEqual(audits, ['pin-refused {"tool":"echo","reason":"drifted"}']);
  });

  void it("non-strict: the node starts; the drifted tool is absent from tools/list and refused on call with -32602 naming it; /health counts", async () => {
    const audits: string[] = [];
    const registry = new PinnedRegistry(PinGate.load(manifestText).admit(drifted), options(false));
    const t = await startTransport({ registry, serverInfo: { name: "x", version: "0" }, verifier: new TestBearerVerifier(), requestStateKey: randomBytes(32), audit: (event, fields) => audits.push(`${event} ${JSON.stringify(fields)}`) });
    try {
      const list = await modern(t, "tools/list");
      const names = (list.json as { result: { tools: { name: string }[] } }).result.tools.map((x) => x.name);
      const call = await modern(t, "tools/call", { name: "echo", arguments: { text: "hi" } });
      const health = await raw(t, { method: "GET", path: "/health" });
      console.log(`NON-STRICT audit ${JSON.stringify(audits)}\nNON-STRICT tools/list ${JSON.stringify(names)}\nNON-STRICT call echo ${String(call.status)} ${call.text}\nNON-STRICT health ${health.text}`);
      assert.ok(!names.includes("echo"));
      assert.equal(names.length, definitions.length - 1);
      assert.equal(call.status, 400);
      assert.deepEqual((call.json as { error: { code: number; message: string } }).error, { code: -32602, message: 'The tool "echo" is refused by the pin gate' });
      assert.deepEqual((health.json as { pinned: unknown }).pinned, { admitted: definitions.length - 1, refused: 1 });
      // The refused call writes its rpc-refused line (CSR-WO-1003a §1.7).
      assert.deepEqual(audits, ['pin-refused {"tool":"echo","reason":"drifted"}', `pin-non-strict {"admitted":${String(definitions.length - 1)},"refused":1}`, 'rpc-refused {"code":-32602,"method":"tools/call","principal":"test-principal"}']);
      const unknown = await modern(t, "tools/call", { name: "nope", arguments: {} });
      assert.equal((unknown.json as { error: { message: string } }).error.message, "Unknown tool", "a name the gate never saw is not echoed");
    } finally {
      await t.close();
    }
  });

  void it("WO §5.5: a missing or unparseable manifest stops the node under strict AND non-strict", () => {
    for (const strict of [true, false]) {
      assert.throws(() => loadPinnedRegistry(new URL("./no-such-manifest.json", FIXTURE_MANIFEST), definitions, options(strict)), (e: unknown) => e instanceof ManifestError && /without a manifest does not start/.test(e.message));
      assert.throws(() => PinGate.load("{ not json"), ManifestError);
    }
  });

  void it("strict: a removed tool (an entry with no definition) also stops the node", async () => {
    const registry = new PinnedRegistry(PinGate.load(manifestText).admit(definitions.filter((d) => d.name !== "echo")), options(true));
    const err = await startExpectingRefusal({ registry, serverInfo: { name: "x", version: "0" }, audit: () => undefined });
    assert.ok(err instanceof PinRefusedError && /echo \(removed\)/.test(err.message), String(err));
  });
});
