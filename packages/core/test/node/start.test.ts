// CSR-WO-1007 §1.1: startNode, the only public path from an edition's definitions to a serving node.
// Each case is the operation that matters: a real startNode call, refused before it binds, or started
// and then asked what it serves. A refused manifest never reaches the gate; a manifest that is not a
// regular file is never waited on; what is served is what the committed file pins.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, it } from "node:test";

import { NodeStartError, startNode } from "../../src/node/start.ts";
import { buildManifest, ManifestError, type PinnableTool, serializeManifest } from "../../src/pinning/manifest.ts";
import { PinRefusedError } from "../../src/pinning/registry.ts";
import { AUDIENCE, ISSUER, TestIssuer } from "../auth/issuer.ts";
import { tag } from "../fixtures/tools.ts";
import { modern } from "../transport/helpers.ts";

const POSIX = process.platform !== "win32";
const DIR = mkdtempSync(join(tmpdir(), "clearseal-startnode-"));
const tool = (name: string, description = "an echo"): PinnableTool => ({ name, description, inputSchema: { type: "object" }, capability: tag(name), handler: () => Promise.resolve({ content: [{ type: "text", text: `${name} ran` }] }) });
const configSchema = {
  type: "object",
  "x-clearseal-env-prefix": "SNT_",
  properties: {
    SNT_RESOURCE_URL: { type: "string", "x-clearseal-setting": "resource-url" },
    SNT_HOST: { type: "string", "x-clearseal-setting": "host", default: "127.0.0.1" },
    SNT_PORT: { type: "string", pattern: "^[0-9]{1,5}$", "x-clearseal-setting": "port", default: "0" },
  },
  required: ["SNT_RESOURCE_URL"],
  additionalProperties: false,
};
const pinned = [tool("echo")];
const MANIFEST = join(DIR, "manifest.json");
let issuer: TestIssuer;
const saved = { ...process.env };

before(async () => {
  writeFileSync(MANIFEST, serializeManifest(buildManifest(pinned)));
  issuer = await TestIssuer.start();
  const ca = join(DIR, "ca.pem");
  writeFileSync(ca, issuer.ca);
  Object.assign(process.env, { SNT_RESOURCE_URL: AUDIENCE, AUTH_ISSUER: ISSUER, AUTH_JWKS_URL: issuer.jwksUrl, AUTH_AUDIENCE: AUDIENCE, AUTH_JWKS_CA_FILE: ca });
});
after(async () => {
  await issuer.close();
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  rmSync(DIR, { recursive: true, force: true });
});

/** A start that must be refused: the error, or a failure if a node started. */
async function refused(edition: Parameters<typeof startNode>[0]): Promise<Error> {
  const t0 = performance.now();
  try {
    const node = await startNode(edition);
    await node.close();
  } catch (err) {
    assert.ok(performance.now() - t0 < 2_000, "refused at once, never waited on");
    return err as Error;
  }
  assert.fail("the node started");
}

const lines: string[] = [];
void describe("CSR-WO-1007 §1.1: startNode reads the committed manifest file, and nothing else", () => {
  void it("a manifest that is not an absolute path or file: URL to a regular file refuses start, before the gate", async () => {
    const dirPath = join(DIR, "a-directory");
    mkdirSync(dirPath);
    const cases: [string, string | URL, RegExp][] = [
      ["a relative path", "manifest.json", /must be absolute, or a file: URL/],
      ["a data: URL", new URL(`data:application/json,${encodeURIComponent(serializeManifest(buildManifest(pinned)))}`), /is a data: URL/],
      ["an https: URL", new URL("https://example.invalid/manifest.json"), /is a https: URL/],
      ["a directory", dirPath, /not a regular file|cannot be read \((EISDIR|EPERM|EACCES)\)/],
      ["a missing file", join(DIR, "missing.json"), /cannot be read \(ENOENT\)/],
    ];
    if (POSIX) {
      const link = join(DIR, "link.json");
      symlinkSync(MANIFEST, link);
      cases.push(["a symbolic link to the real manifest (a link is followed by nothing)", link, /cannot be read \(ELOOP\)/]);
      const fifo = join(DIR, "fifo.json");
      execFileSync("mkfifo", [fifo]);
      cases.push(["a FIFO (never waited on)", fifo, /not a regular file/]);
    }
    for (const [label, manifestPath, rule] of cases) {
      const err = await refused({ definitions: pinned, manifestPath, configSchema });
      assert.ok(err instanceof ManifestError, `${label}: ${String(err)}`);
      assert.match(err.message, rule, label);
      lines.push(`STARTNODE ${label}: ${err.name}: ${err.message}`);
    }
  });

  void it("the committed file decides: a tool it does not pin, or pins differently, refuses start under the strict default", async () => {
    const unpinned = await refused({ definitions: [...pinned, tool("extra")], manifestPath: MANIFEST, configSchema });
    assert.ok(unpinned instanceof PinRefusedError, String(unpinned));
    assert.match(unpinned.message, /extra \(unpinned\)/);
    const drifted = await refused({ definitions: [tool("echo", "an edited description")], manifestPath: pathToFileURL(MANIFEST), configSchema });
    assert.match(drifted.message, /echo \(drifted\)/);
    lines.push(`STARTNODE an unpinned tool: ${unpinned.name}: ${unpinned.message}`, `STARTNODE a drifted tool: ${drifted.name}: ${drifted.message}`);
  });

  void it("a configuration outside the edition's schema, or a schema without the core's annotations, refuses start", async () => {
    process.env["SNT_COLOUR"] = "blue";
    const unknown = await refused({ definitions: pinned, manifestPath: MANIFEST, configSchema });
    delete process.env["SNT_COLOUR"];
    assert.ok(unknown instanceof NodeStartError);
    assert.match(unknown.message, /does not match its schema: .*SNT_COLOUR/);
    const noPrefix = await refused({ definitions: pinned, manifestPath: MANIFEST, configSchema: { type: "object", properties: {} } });
    assert.match(noPrefix.message, /x-clearseal-env-prefix/);
    const withoutResource = Object.fromEntries(Object.entries(configSchema.properties).filter(([k]) => k !== "SNT_RESOURCE_URL"));
    const noResource = await refused({ definitions: pinned, manifestPath: MANIFEST, configSchema: { ...configSchema, properties: withoutResource, required: [] } });
    assert.match(noResource.message, /no resource-url variable/);
    lines.push(`STARTNODE an unknown variable: ${unknown.message}`, `STARTNODE a schema without its prefix: ${noPrefix.message}`, `STARTNODE a schema without a resource URL: ${noResource.message}`);
  });

  void it("started from a committed file, a node serves exactly the tools that file pins, under the core's identity", async () => {
    const node = await startNode({ definitions: pinned, manifestPath: MANIFEST, configSchema });
    try {
      const token = issuer.mint(TestIssuer.claims(Math.floor(Date.now() / 1000)));
      const list = await modern(node, "tools/list", {}, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(list.status, 200, list.text);
      const result = (list.json as { result: { tools: { name: string }[]; _meta: Record<string, { name: string }> } }).result;
      assert.deepEqual(result.tools.map((t) => t.name), ["echo"]);
      assert.equal(result._meta["io.modelcontextprotocol/serverInfo"]?.name, "clearseal-node");
      lines.push(`STARTNODE the committed file's tools: tools/list ${JSON.stringify(result.tools.map((t) => t.name))}, serverInfo ${JSON.stringify(result._meta["io.modelcontextprotocol/serverInfo"])}`);
    } finally {
      await node.close();
    }
    console.log(lines.join("\n"));
  });
});
