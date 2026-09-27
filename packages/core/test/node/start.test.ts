// CSR-WO-1007 §1.1, CSR-WO-1007a §1.1: startNode, the only public path from an edition's definitions
// to a serving node, against the manifest the operator names in CLEARSEAL_MANIFEST. Each case is the
// operation that matters: a real startNode call, refused before it binds, or started and then asked
// what it serves. A refused manifest never reaches the gate; a manifest that is not a regular file is
// never waited on; what is served is what the operator's file pins, and nothing the edition passes can
// name another.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  Object.assign(process.env, { CLEARSEAL_MANIFEST: MANIFEST, SNT_RESOURCE_URL: AUDIENCE, AUTH_ISSUER: ISSUER, AUTH_JWKS_URL: issuer.jwksUrl, AUTH_AUDIENCE: AUDIENCE, AUTH_JWKS_CA_FILE: ca });
});
after(async () => {
  await issuer.close();
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  rmSync(DIR, { recursive: true, force: true });
});

/** A start that must be refused, with CLEARSEAL_MANIFEST set to `manifest` (unset when null): the
 *  error, or a failure if a node started. */
async function refused(edition: Parameters<typeof startNode>[0], manifest: string | null = MANIFEST): Promise<Error> {
  if (manifest === null) delete process.env["CLEARSEAL_MANIFEST"];
  else process.env["CLEARSEAL_MANIFEST"] = manifest;
  const t0 = performance.now();
  try {
    const node = await startNode(edition, { audit: () => undefined });
    await node.close();
  } catch (err) {
    assert.ok(performance.now() - t0 < 2_000, "refused at once, never waited on");
    return err as Error;
  } finally {
    process.env["CLEARSEAL_MANIFEST"] = MANIFEST;
  }
  assert.fail("the node started");
}

const edition = { definitions: pinned, configSchema };
const lines: string[] = [];
void describe("CSR-WO-1007a §1.1: startNode reads the manifest the operator names in CLEARSEAL_MANIFEST, and nothing else", () => {
  void it("without CLEARSEAL_MANIFEST, or with it empty, the node refuses to start", async () => {
    for (const [label, value] of [["CLEARSEAL_MANIFEST unset", null], ["CLEARSEAL_MANIFEST empty", ""]] as const) {
      const err = await refused(edition, value);
      assert.ok(err instanceof NodeStartError, `${label}: ${String(err)}`);
      assert.match(err.message, /CLEARSEAL_MANIFEST is required: the operator names the approved manifest/, label);
      lines.push(`STARTNODE ${label}: ${err.name}: ${err.message}`);
    }
  });

  void it("an edition that passes a manifest path, or anything beyond its two values, is refused", async () => {
    const withPath = await refused({ ...edition, manifestPath: MANIFEST } as never);
    assert.ok(withPath instanceof NodeStartError, String(withPath));
    assert.match(withPath.message, /definitions and configSchema, nothing else \(not manifestPath\): the operator names the manifest in CLEARSEAL_MANIFEST/);
    const withOther = await refused({ ...edition, audit: () => undefined } as never);
    assert.match(withOther.message, /nothing else \(not audit\)/);
    lines.push(`STARTNODE an edition naming its manifest: ${withPath.name}: ${withPath.message}`);
  });

  void it("an edition's schema may not claim the core's own variables' prefix", async () => {
    for (const prefix of ["CLEARSEAL_", "AUTH_", "PIN_", "EXEC_"]) {
      const schema = { ...configSchema, "x-clearseal-env-prefix": prefix, properties: { [`${prefix}RESOURCE_URL`]: { type: "string", "x-clearseal-setting": "resource-url" } }, required: [] };
      const err = await refused({ definitions: pinned, configSchema: schema });
      assert.ok(err instanceof NodeStartError, `${prefix}: ${String(err)}`);
      assert.match(err.message, new RegExp(`the configuration prefix ${prefix} is the core's own`));
    }
  });

  void it("a manifest that is not an absolute path or file: URL to a regular file refuses start, before the gate", async () => {
    const dirPath = join(DIR, "a-directory");
    mkdirSync(dirPath);
    const cases: [string, string, RegExp][] = [
      ["a relative path", "manifest.json", /must be absolute, or a file: URL/],
      ["a dot-relative path", "./pins/teaching.json", /must be absolute, or a file: URL/],
      ["a data: URL", `data:application/json,${encodeURIComponent(serializeManifest(buildManifest(pinned)))}`, /must be absolute, or a file: URL/],
      ["an https: URL", "https://example.invalid/manifest.json", /is a https: URL/],
      ["a directory", dirPath, /not a regular file|cannot be read \((EISDIR|EPERM|EACCES)\)/],
      ["a missing file", join(DIR, "missing.json"), /cannot be read \(ENOENT\)/],
    ];
    if (POSIX) {
      const link = join(DIR, "link.json");
      symlinkSync(MANIFEST, link);
      cases.push(["a symbolic link to the real manifest (a link is followed by nothing)", link, /cannot be read \(ELOOP\)/]);
      const realDir = join(DIR, "real");
      mkdirSync(realDir);
      writeFileSync(join(realDir, "manifest.json"), serializeManifest(buildManifest(pinned)));
      symlinkSync(realDir, join(DIR, "linked-dir"));
      cases.push(["a link on the way, not at the leaf (a symlinked directory)", join(DIR, "linked-dir", "manifest.json"), /passes through a symbolic link/]);
      const fifo = join(DIR, "fifo.json");
      execFileSync("mkfifo", [fifo]);
      cases.push(["a FIFO (never waited on)", fifo, /not a regular file/]);
    }
    for (const [label, value, rule] of cases) {
      const err = await refused(edition, value);
      assert.ok(err instanceof ManifestError, `${label}: ${String(err)}`);
      assert.match(err.message, rule, label);
      lines.push(`STARTNODE CLEARSEAL_MANIFEST ${label}: ${err.name}: ${err.message}`);
    }
  });

  void it("the committed file decides: a tool it does not pin, or pins differently, refuses start under the strict default", async () => {
    const unpinned = await refused({ definitions: [...pinned, tool("extra")], configSchema });
    assert.ok(unpinned instanceof PinRefusedError, String(unpinned));
    assert.match(unpinned.message, /extra \(unpinned\)/);
    const drifted = await refused({ definitions: [tool("echo", "an edited description")], configSchema }, pathToFileURL(MANIFEST).href);
    assert.match(drifted.message, /echo \(drifted\)/);
    lines.push(`STARTNODE an unpinned tool: ${unpinned.name}: ${unpinned.message}`, `STARTNODE a drifted tool: ${drifted.name}: ${drifted.message}`);
  });

  void it("a configuration outside the edition's schema, or a schema without the core's annotations, refuses start", async () => {
    process.env["SNT_COLOUR"] = "blue";
    const unknown = await refused(edition);
    delete process.env["SNT_COLOUR"];
    assert.ok(unknown instanceof NodeStartError);
    assert.match(unknown.message, /does not match its schema: .*SNT_COLOUR/);
    const noPrefix = await refused({ definitions: pinned, configSchema: { type: "object", properties: {} } });
    assert.match(noPrefix.message, /x-clearseal-env-prefix/);
    const withoutResource = Object.fromEntries(Object.entries(configSchema.properties).filter(([k]) => k !== "SNT_RESOURCE_URL"));
    const noResource = await refused({ definitions: pinned, configSchema: { ...configSchema, properties: withoutResource, required: [] } });
    assert.match(noResource.message, /no resource-url variable/);
    lines.push(`STARTNODE an unknown variable: ${unknown.message}`, `STARTNODE a schema without its prefix: ${noPrefix.message}`, `STARTNODE a schema without a resource URL: ${noResource.message}`);
  });

  void it("started, the node writes manifest-loaded with the file's path and the SHA-256 of the bytes it admitted from, and serves exactly what that file pins", async () => {
    process.env["CLEARSEAL_MANIFEST"] = MANIFEST;
    const audits: [string, Record<string, string | number>][] = [];
    const node = await startNode(edition, { audit: (e, f) => audits.push([e, f]) });
    try {
      const loaded = audits.filter(([e]) => e === "manifest-loaded");
      assert.equal(loaded.length, 1, "one manifest-loaded line");
      assert.equal(audits[0]?.[0], "manifest-loaded", "written first, before anything is admitted");
      const fields = loaded[0]?.[1] ?? {};
      assert.equal(fields["path"], MANIFEST);
      assert.equal(fields["sha256"], createHash("sha256").update(readFileSync(MANIFEST)).digest("hex"));
      lines.push(`STARTNODE manifest-loaded ${JSON.stringify(fields)}`);
      const token = issuer.mint(TestIssuer.claims(Math.floor(Date.now() / 1000)));
      const list = await modern(node, "tools/list", {}, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(list.status, 200, list.text);
      const result = (list.json as { result: { tools: { name: string }[]; _meta: Record<string, { name: string }> } }).result;
      assert.deepEqual(result.tools.map((t) => t.name), ["echo"]);
      assert.equal(result._meta["io.modelcontextprotocol/serverInfo"]?.name, "clearseal-node");
      lines.push(`STARTNODE the operator's file's tools: tools/list ${JSON.stringify(result.tools.map((t) => t.name))}, serverInfo ${JSON.stringify(result._meta["io.modelcontextprotocol/serverInfo"])}`);
    } finally {
      await node.close();
    }
    console.log(lines.join("\n"));
  });
});
