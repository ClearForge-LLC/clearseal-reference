// CSR-WO-1007b: the core owns the process entry. The settings snapshot is taken before any edition
// module loads, nothing the core does afterwards reads the environment, and the entry resolves the
// edition by package name. §1.2's two proofs are here: the environment is mutated after capture and
// every setting is unchanged, and an inventory names every `process.env` read in the core's source.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { runNode } from "../../src/node/cli.ts";
import { captureSettings, SettingsError } from "../../src/node/settings.ts";
import { manifestPathFault, PreparedNode } from "../../src/node/start.ts";
import { buildManifest, type PinnableTool, serializeManifest } from "../../src/pinning/manifest.ts";
import { AUDIENCE, ISSUER, TestIssuer } from "../auth/issuer.ts";
import { tag } from "../fixtures/tools.ts";
import { modern } from "../transport/helpers.ts";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const INSTALLED = join(REPO, "node_modules", "@clearseal-cli-test");
const DIR = mkdtempSync(join(tmpdir(), "clearseal-cli-"));
const MANIFEST = join(DIR, "manifest.json");
const echo: PinnableTool = { name: "echo", description: "an echo", inputSchema: { type: "object", properties: { text: { type: "string" } } }, capability: tag("echo"), handler: (args) => Promise.resolve({ content: [{ type: "text", text: String(args["text"]) }] }) };
const configSchema = {
  type: "object",
  "x-clearseal-env-prefix": "CLI_",
  properties: { CLI_RESOURCE_URL: { type: "string", "x-clearseal-setting": "resource-url" }, CLI_PORT: { type: "string", "x-clearseal-setting": "port", default: "0" } },
  required: ["CLI_RESOURCE_URL"],
  additionalProperties: false,
};
const pastes: string[] = [];
let issuer: TestIssuer;
let base: Record<string, string>;

before(async () => {
  writeFileSync(MANIFEST, serializeManifest(buildManifest([echo])));
  issuer = await TestIssuer.start();
  const ca = join(DIR, "ca.pem");
  writeFileSync(ca, issuer.ca);
  base = { CLEARSEAL_EDITION: "@clearseal-cli-test/edition", CLEARSEAL_MANIFEST: MANIFEST, AUDIT_STORE: "seam-only", CLI_RESOURCE_URL: AUDIENCE, AUTH_ISSUER: ISSUER, AUTH_JWKS_URL: issuer.jwksUrl, AUTH_AUDIENCE: AUDIENCE, AUTH_JWKS_CA_FILE: ca };
});
after(async () => {
  await issuer.close();
  rmSync(DIR, { recursive: true, force: true });
  rmSync(INSTALLED, { recursive: true, force: true });
  console.log(pastes.join("\n"));
});

/** Installs a package the operator's install resolves by name, for the entry to import. */
function installEdition(name: string, source: string): string {
  const dir = join(INSTALLED, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.js"), source);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `@clearseal-cli-test/${name}`, version: "0.0.0", private: true, type: "module", exports: { ".": { default: "./index.js" } } }));
  return `@clearseal-cli-test/${name}`;
}

const TOOL_SOURCE = `export const definitions = [{ name: "echo", description: "an echo", inputSchema: { type: "object", properties: { text: { type: "string" } } }, capability: { capability_class: "read_only", untrusted_input_facing: false, scope: "echo", privacy_sensitive: false, recoverability_basis: null, elevated: false, containment_domain: null }, handler: (args) => Promise.resolve({ content: [{ type: "text", text: String(args.text) }] }) }];
export const configSchema = ${JSON.stringify(configSchema)};
`;

void describe("CSR-WO-1007b §1.2: the snapshot is the only environment the core reads", () => {
  void it("every setting survives the environment being rewritten after capture", async () => {
    const saved = { ...process.env };
    Object.assign(process.env, base);
    const settings = captureSettings(process.env);
    // The snapshot is frozen and is a copy: writing the caller's object changes nothing in it.
    assert.ok(Object.isFrozen(settings) && Object.isFrozen(settings.env));
    const before = { manifestPath: settings.manifestPath, editionName: settings.editionName, pinStrict: settings.pinStrict, execToolsForbidden: settings.execToolsForbidden, resource: settings.env["CLI_RESOURCE_URL"], issuer: settings.verifier.issuer, audience: settings.verifier.audience, audit: settings.audit.mode };
    // Now the edition's load-time code, in the worst case it can manage: every setting rewritten.
    const hostile = join(DIR, "hostile-manifest.json");
    writeFileSync(hostile, serializeManifest(buildManifest([{ ...echo, name: "notes.exfil" }])));
    Object.assign(process.env, { CLEARSEAL_MANIFEST: hostile, CLEARSEAL_EDITION: "@evil/edition", PIN_STRICT: "false", EXEC_TOOLS_FORBIDDEN: "false", AUTH_ISSUER: "https://evil.invalid/", AUTH_AUDIENCE: "https://evil.invalid/x", CLI_RESOURCE_URL: "https://evil.invalid/r", AUDIT_STORE: "" });
    try {
      assert.deepEqual({ manifestPath: settings.manifestPath, editionName: settings.editionName, pinStrict: settings.pinStrict, execToolsForbidden: settings.execToolsForbidden, resource: settings.env["CLI_RESOURCE_URL"], issuer: settings.verifier.issuer, audience: settings.verifier.audience, audit: settings.audit.mode }, before, "the snapshot is unchanged");
      assert.throws(() => {
        (settings.env as Record<string, string>)["CLEARSEAL_MANIFEST"] = hostile;
      }, TypeError, "the snapshot's environment cannot be written");
      // And the node built from it serves the manifest's tool, under the strictness captured.
      const prepared = PreparedNode.prepare(settings);
      const t = await (async () => {
        const { startNode } = await import("../../src/node/start.ts");
        return startNode({ definitions: [echo], configSchema }, prepared);
      })();
      try {
        assert.equal(prepared.manifest.path, MANIFEST, "the operator's manifest, not the one written after capture");
        const token = issuer.mint(TestIssuer.claims(Math.floor(Date.now() / 1000)));
        const list = await modern(t, "tools/list", {}, { headers: { authorization: `Bearer ${token}` } });
        const names = ((list.json as { result?: { tools?: { name: string }[] } }).result?.tools ?? []).map((x) => x.name);
        assert.deepEqual(names, ["echo"]);
        // The transport's own configuration came from the snapshot: the resource URL rewritten after
        // capture never reached it (this is what a read of process.env inside startNode would change).
        assert.equal(t.config.resourceUrl, AUDIENCE, "the resource URL is the captured one");
        pastes.push(`SNAPSHOT after rewriting CLEARSEAL_MANIFEST, CLEARSEAL_EDITION, PIN_STRICT, EXEC_TOOLS_FORBIDDEN, AUTH_ISSUER, AUTH_AUDIENCE, CLI_RESOURCE_URL and AUDIT_STORE: manifest ${relative(REPO, prepared.manifest.path) === "" ? prepared.manifest.path : "the operator's"}, tools/list ${JSON.stringify(names)}, resourceUrl ${t.config.resourceUrl === AUDIENCE ? "unchanged" : "CHANGED"}`);
      } finally {
        await t.close();
      }
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });

  void it("the inventory: every process.env read in the core's source is named, and each is the capture step or a reader's documented fallback", () => {
    /** Comments say `process.env` when they explain it; only code counts. */
    const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    /** Every direct read, by file. Adding one anywhere fails this test until it is named here. */
    const DIRECT: Readonly<Record<string, { count: number; why: string }>> = {
      "node/cli.ts": { count: 1, why: "the entry's one read: runNode(process.env), whose first act is the capture, before any edition loads" },
      "node/start.ts": { count: 1, why: "startNodeFromEnv's default parameter, for the core's own tests; the entry passes a snapshot" },
      "auth/verifier.ts": { count: 1, why: "jwtVerifierFromEnv's default parameter; the capture step passes the snapshot" },
      "transport/request-state.ts": { count: 1, why: "requestStateKeyFromEnv's default parameter; the capture step passes the snapshot" },
      "pinning/registry.ts": { count: 2, why: "pinStrictFromEnv's and execToolsForbiddenFromEnv's default parameters; the capture step passes the snapshot" },
    };
    /** A reader called with no argument reads process.env through its default: the indirect reads. */
    const READERS = ["captureSettings", "auditFromEnv", "jwtVerifierFromEnv", "requestStateKeyFromEnv", "pinStrictFromEnv", "execToolsForbiddenFromEnv"];
    const INDIRECT: Readonly<Record<string, { count: number; why: string }>> = {
      "transport/server.ts": { count: 1, why: "options.verifier ?? jwtVerifierFromEnv(): the fallback for a direct startTransport caller that configures no verifier (the core's transport tests). startNode passes the snapshot's verifier, so a node's path never reaches it" },
      "pinning/registry.ts": { count: 2, why: "options.strict ?? pinStrictFromEnv() and options.execToolsForbidden ?? execToolsForbiddenFromEnv(): the fallback for a direct loadPinnedRegistry caller that omits the option (-1001 adversarial F5). startNode passes both from the snapshot, so a node's path never reaches them" },
    };
    const direct: Record<string, number> = {};
    const indirect: Record<string, number> = {};
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith(".ts")) {
          const rel = relative(SRC, p).split("\\").join("/");
          const text = code(readFileSync(p, "utf8"));
          // `process.env`, and the two forms that would reach it without naming it: a computed read off
          // `process`, and destructuring `env` from it (CSR-WO-1007b adversarial pass, L2).
          const d = (text.match(/process\.env|\bprocess\s*\[|\{[^}]*\benv\b[^}]*\}\s*=\s*process\b/g) ?? []).length;
          if (d > 0) direct[rel] = d;
          const i2 = READERS.reduce((n, r) => n + (text.match(new RegExp(`\\b${r}\\(\\s*\\)`, "g")) ?? []).length, 0);
          if (i2 > 0) indirect[rel] = i2;
        }
      }
    };
    walk(SRC);
    const table = (found: Record<string, number>, expected: Readonly<Record<string, { count: number; why: string }>>): string =>
      Object.keys({ ...expected, ...found })
        .sort()
        .map((f) => `| ${f} | ${String(found[f] ?? 0)} | ${expected[f]?.why ?? "NOT NAMED: a read outside the capture step"} |`)
        .join("\n");
    pastes.push(`PROCESS.ENV INVENTORY (packages/core/src)\ndirect reads (\`process.env\` in code):\n| file | reads | what it is |\n|---|---|---|\n${table(direct, DIRECT)}\nindirect reads (a reader called with no argument):\n| file | calls | what it is |\n|---|---|---|\n${table(indirect, INDIRECT)}`);
    assert.deepEqual(direct, Object.fromEntries(Object.entries(DIRECT).map(([f, v]) => [f, v.count])), "a direct process.env read the inventory does not name");
    assert.deepEqual(indirect, Object.fromEntries(Object.entries(INDIRECT).map(([f, v]) => [f, v.count])), "a reader called with no argument that the inventory does not name");
    // node/settings.ts is the capture step: it reads only the environment it is given.
    assert.equal(direct["node/settings.ts"], undefined, "the capture step names no process.env of its own");
  });
});

void describe("CSR-WO-1007b §1.1: the entry names the edition, and checks what it exports", () => {
  void it("CLEARSEAL_EDITION is a package name: a path, a URL or nothing refuses start", () => {
    const cases: [string, string | undefined][] = [
      ["missing", undefined],
      ["empty", ""],
      ["a relative path", "./dist/index.js"],
      ["an absolute path", "/tmp/edition/index.js"],
      ["a parent path", "../edition"],
      ["a file URL", "file:///tmp/edition/index.js"],
      ["a deep subpath", "@clearseal/teaching/dist/index.js"],
    ];
    for (const [label, value] of cases) {
      const env = { ...base, ...(value === undefined ? {} : { CLEARSEAL_EDITION: value }) };
      if (value === undefined) delete (env as Record<string, string | undefined>)["CLEARSEAL_EDITION"];
      let caught: unknown;
      try {
        captureSettings(env);
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof SettingsError, `${label}: ${String(caught)}`);
      assert.match(caught.message, /CLEARSEAL_EDITION/, label);
      pastes.push(`ENTRY CLEARSEAL_EDITION ${label}: ${caught.name}: ${caught.message}`);
    }
  });

  void it("an edition that exports more or less than its two values refuses start, and one that exports them serves", async () => {
    const extra = installEdition("extra", `${TOOL_SOURCE}export const manifestPath = "/tmp/own.json";\n`);
    const short = installEdition("short", `export const definitions = [];\n`);
    const good = installEdition("edition", TOOL_SOURCE);
    for (const [label, name, rule] of [["an extra export", extra, /exports manifestPath: an edition exports its definitions and its configSchema, and nothing else/], ["a missing export", short, /does not export configSchema/]] as const) {
      let caught: unknown;
      try {
        const started = await runNode({ ...base, CLEARSEAL_EDITION: name });
        await started.close();
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof SettingsError, `${label}: a node started instead of being refused (${String(caught)})`);
      assert.match(caught.message, rule, label);
      pastes.push(`ENTRY ${label}: ${caught.name}: ${caught.message}`);
    }
    const node = await runNode({ ...base, CLEARSEAL_EDITION: good });
    try {
      const token = issuer.mint(TestIssuer.claims(Math.floor(Date.now() / 1000)));
      const list = await modern({ port: Number(new URL(node.url).port) } as Parameters<typeof modern>[0], "tools/list", {}, { headers: { authorization: `Bearer ${token}` } });
      const names = ((list.json as { result?: { tools?: { name: string }[] } }).result?.tools ?? []).map((x) => x.name);
      assert.deepEqual(names, ["echo"], list.text);
      pastes.push(`ENTRY a well-formed edition, by name: ${node.url} serves ${JSON.stringify(names)}`);
    } finally {
      await node.close();
    }
  });

  void it("an edition that does not load refuses start, naming it", async () => {
    const broken = installEdition("broken", "throw new Error('load-time failure');\n");
    await assert.rejects(() => runNode({ ...base, CLEARSEAL_EDITION: broken }), (err: unknown) => err instanceof SettingsError && /does not load: load-time failure/.test(err.message));
  });
});

void describe("CSR-WO-1007b §1.6: what the manifest's audit rows say", () => {
  void it("a manifest that is read but does not parse writes manifest-refused with its path and hash, and no manifest-loaded", () => {
    const bad = join(DIR, "not-a-manifest.json");
    writeFileSync(bad, "{ not a manifest }\n");
    const rows: string[] = [];
    let caught: unknown;
    try {
      PreparedNode.prepare(captureSettings({ ...base, CLEARSEAL_MANIFEST: bad }), { audit: (e, f) => rows.push(`${e} ${JSON.stringify(f)}`) });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof Error, String(caught));
    const refused = rows.filter((r) => r.startsWith("manifest-refused"));
    assert.equal(refused.length, 1, rows.join(" | "));
    assert.ok(!rows.some((r) => r.startsWith("manifest-loaded")), "no manifest-loaded for a manifest that did not parse");
    // The row is JSON, so a Windows path's separators are escaped in it: compare the parsed fields.
    const fields = JSON.parse((refused[0] ?? "").slice("manifest-refused ".length)) as { path?: unknown; sha256?: unknown };
    assert.equal(fields.sha256, createHash("sha256").update(readFileSync(bad)).digest("hex"), "the hash of the bytes it read");
    assert.equal(fields.path, bad, "the path it read");
    pastes.push(`MANIFEST refused: ${(refused[0] ?? "").replace(createHash("sha256").update(readFileSync(bad)).digest("hex"), "<sha256>")}`);
  });

  void it("a manifest renamed between the open and the check says the file changed, not that it is a link", () => {
    // The core opens the manifest, then compares the descriptor's own path with the path it was given.
    // The two ways those differ are built here on disk, so each message is proven and neither is a guess.
    const dir = mkdtempSync(join(tmpdir(), "clearseal-rename-"));
    const real = join(dir, "real");
    mkdirSync(real);
    const inReal = join(real, "manifest.json");
    writeFileSync(inReal, serializeManifest(buildManifest([echo])));
    // A link on the way. Creating one needs a privilege Windows may withhold; where it cannot be made,
    // the other branch below still runs, and the symlink rule has its own coverage in start.test.ts.
    let link: string | undefined;
    try {
      symlinkSync(real, join(dir, "linked"), "dir");
      link = join(dir, "linked", "manifest.json");
    } catch (err) {
      console.log(`MANIFEST a link on the way: not creatable here (${String((err as { code?: unknown }).code)}); the branch is exercised on POSIX`);
    }
    if (link !== undefined) {
      assert.match(manifestPathFault(inReal, link), /passes through a symbolic link/);
      pastes.push(`MANIFEST a link on the way: ${manifestPathFault(inReal, link)}`);
    }
    // Renamed: the descriptor holds dir/moved.json, and the path it was opened through is gone.
    const moved = join(dir, "moved.json");
    renameSync(inReal, moved);
    const changed = manifestPathFault(moved, inReal);
    assert.match(changed, /the manifest file changed while it was being opened \(it was renamed, replaced or removed\)/);
    // And replaced, not removed: the path exists again, but names a different file.
    writeFileSync(inReal, "{}\n");
    assert.match(manifestPathFault(moved, inReal), /changed while it was being opened/);
    pastes.push(`MANIFEST renamed or replaced under the path: ${changed}`);
    rmSync(dir, { recursive: true, force: true });
  });
});

void describe("CSR-WO-2007 §1.4: the rate limit's and the tripwire's settings are read in the snapshot", () => {
  void it("rewriting RATE_LIMIT_* and TRIPWIRE_* after capture changes nothing, and the node runs on the captured values", async () => {
    const env: Record<string, string> = { ...base, RATE_LIMIT_BURST: "5", RATE_LIMIT_REFILL_PER_MINUTE: "1", TRIPWIRE_THRESHOLD: "3" };
    const settings = captureSettings(env);
    Object.assign(env, { RATE_LIMIT_BURST: "1000", RATE_LIMIT_REFILL_PER_MINUTE: "1000", TRIPWIRE_THRESHOLD: "1000" });
    assert.deepEqual(settings.rateLimit, { burst: 5, refillPerMinute: 1, maxPrincipals: 10_000 }, "the captured budget, not the rewritten one");
    assert.deepEqual(settings.tripwire, { threshold: 3, windowSeconds: 60, quietSeconds: 300, maxPrincipals: 1_000 });
    assert.ok(Object.isFrozen(settings.rateLimit) && Object.isFrozen(settings.tripwire));
    const rows: string[] = [];
    const prepared = PreparedNode.prepare(settings, { audit: (event, fields) => rows.push(`${event} ${JSON.stringify(fields)}`) });
    const { startNode } = await import("../../src/node/start.ts");
    const t = await startNode({ definitions: [echo], configSchema }, prepared);
    try {
      const token = issuer.mint(TestIssuer.claims(Math.floor(Date.now() / 1000)));
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) statuses.push((await modern(t, "tools/call", { name: "echo", arguments: { text: String(i) } }, { headers: { authorization: `Bearer ${token}` } })).status);
      assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429], "a budget of 5, as captured");
      assert.equal(rows.filter((r) => r.startsWith("tripwire-read-burst ")).length, 1, "a threshold of 3, as captured: one row");
      assert.equal(rows.filter((r) => r.startsWith("rate-limited ")).length, 1);
      pastes.push(`SNAPSHOT RATE_LIMIT_BURST=5 and TRIPWIRE_THRESHOLD=3 captured, then rewritten to 1000: six calls → ${statuses.join(", ")}; ${rows.filter((r) => /^(tripwire-read-burst|rate-limited) /.test(r)).join("; ")}`);
    } finally {
      await t.close();
    }
  });

  for (const name of ["RATE_LIMIT_BURST", "RATE_LIMIT_REFILL_PER_MINUTE", "RATE_LIMIT_MAX_PRINCIPALS", "TRIPWIRE_THRESHOLD", "TRIPWIRE_WINDOW_SECONDS", "TRIPWIRE_QUIET_SECONDS", "TRIPWIRE_MAX_PRINCIPALS"]) {
    void it(`${name}=0 refuses start, naming it`, async () => {
      let caught: unknown;
      try {
        const node = await runNode({ ...base, [name]: "0" });
        await node.close();
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof Error, `${name}=0: a node started`);
      assert.match(caught.message, new RegExp(`^${name} must be a whole number from 1 to`));
      pastes.push(`SETTING ${name}=0 → ${caught.name}: ${caught.message}`);
    });
  }
});

void describe("CSR-WO-2001 §1.6, §1.7: the approval backend comes from the snapshot", () => {
  const deploy: PinnableTool = { name: "deploy", description: "Deploys.", inputSchema: { type: "object", properties: { target: { type: "string" } } }, capability: tag("deploy", { capability_class: "state_change", elevated: true }), handler: () => Promise.resolve({ content: [{ type: "text", text: "deployed" }] }) };

  void it("without APPROVAL_BACKEND an elevated tool refuses start; with APPROVAL_BACKEND=listener the node starts, its approval listener apart, and gates the call", async () => {
    const manifest = join(DIR, "approval-manifest.json");
    writeFileSync(manifest, serializeManifest(buildManifest([deploy])));
    const env = { ...base, CLEARSEAL_MANIFEST: manifest };
    const { startNode } = await import("../../src/node/start.ts");
    const refusedPrep = PreparedNode.prepare(captureSettings(env));
    await assert.rejects(() => startNode({ definitions: [deploy], configSchema }, refusedPrep), /elevated requires an approval backend; none is configured/);
    await refusedPrep.close();
    const settings = captureSettings({ ...env, APPROVAL_BACKEND: "listener", APPROVAL_LISTENER_PORT: "0" });
    assert.equal(settings.approval.backend, "listener");
    const t = await startNode({ definitions: [deploy], configSchema }, PreparedNode.prepare(settings));
    try {
      assert.match(t.approvalUrl ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.notEqual(new URL(t.approvalUrl ?? "http://x").port, String(t.port), "its own port");
      const token = issuer.mint(TestIssuer.claims(Math.floor(Date.now() / 1000)));
      const reply = await modern(t, "tools/call", { name: "deploy", arguments: { target: "prod" } }, { headers: { authorization: `Bearer ${token}` } });
      const status = ((reply.json as { result?: { _meta?: Record<string, { status?: string }> } }).result?._meta?.["clearseal/approval"] ?? {}).status;
      assert.equal(status, "pending");
      pastes.push(`APPROVAL node: no APPROVAL_BACKEND → refused at construction; APPROVAL_BACKEND=listener → started, approval listener ${t.approvalUrl === undefined ? "missing" : "on its own port"}, deploy → ${String(status)}`);
    } finally {
      await t.close();
    }
  });
});

void describe("CSR-WO-2001 APR-9: the delegated approvers' verifier is the core's, for the approval audience", () => {
  void it("APPROVAL_AUDIENCE gives a verifier with the node's issuer and that audience, never the node's", () => {
    const settings = captureSettings({ ...base, APPROVAL_AUDIENCE: "https://approve.example.invalid/decide" });
    assert.ok(settings.approvalVerifier !== undefined);
    assert.equal(settings.approvalVerifier.audience, "https://approve.example.invalid/decide");
    assert.equal(settings.approvalVerifier.issuer, settings.verifier.issuer);
    assert.notEqual(settings.approvalVerifier.audience, settings.verifier.audience);
    assert.equal(captureSettings(base).approvalVerifier, undefined, "no approval audience, no delegated approvers");
  });
});
