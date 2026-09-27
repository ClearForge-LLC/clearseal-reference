// The P1 exit gate as a command (CSR-WO-1004 §1.6; roadmap P1 *Exit gate*; northstar N2, N3, N4).
// Each clause below prints one EXIT line naming the gate sentence it proves. One part of the gate is
// not re-run here: "proven able to fail by deleting the control it guards" is the deletion matrices
// recorded in the FEEDBACK of -1000 to -1004; this test carries the in-test red cases. The clauses a
// node can show run against a real teaching node, started by the edition's own scaffold with the
// core's in-process issuer. The clauses that are properties of the core (the subset test, the
// cross-language vectors, the enumeration detector, the supply-boundary test) are the core's own
// suites, each carrying its red case, and run here as child processes.
//
// CSR-WO-1007 §1.4: the node is started as the edition's bin/ starts it, by the core's startNode; each
// refusal also writes its audit line; a containment clause refuses a planted link and a FIFO in the
// notes root at the cage; and the supply-boundary suite carries the red-team's H1 plant and its
// aliasing variants.
//
// CSR-WO-1007a §1.3: the H1 re-test's F1 and F2 run end to end as real nodes, each started by its own
// bin/ with CLEARSEAL_MANIFEST at the committed pins/teaching.json, and each is refused at start.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { DEFAULT_LIMITS, loadPinnedRegistry, type PinnableTool, startTransport, ValidationPool } from "@clearseal/core";

import { checkEdition } from "../../core/test/boundary/supply-boundary.ts";
import { caFileFor, COMMITTED_MANIFEST, install, ROUTES, startNodeProcess, uninstall } from "./hostile.ts";
import { readFileSync } from "node:fs";

import { verifyAudit } from "@clearseal/core";

import { AUDIENCE, cleanup, definitionsFor, ISSUER, kits, mcp, type Node, notesRoot, pin, restoreEnv, startNode, TestIssuer } from "./node.ts";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const exit: string[] = [];
const record = (sentence: string, evidence: string): void => {
  exit.push(`EXIT | ${sentence} | ${evidence}`);
};

let issuer: TestIssuer;
let root: string;
let manifest: string;
let node: Node | undefined;
const now = (): number => Math.floor(Date.now() / 1000);
const token = (extra: Record<string, unknown> = {}): string => issuer.mint(TestIssuer.claims(now(), extra));
const call = (name: string, args: Record<string, unknown>, opts: { token?: string; headers?: Record<string, string> } = {}) => mcp(live().t, "tools/call", { name, arguments: args }, { name, ...opts });

before(async () => {
  issuer = await TestIssuer.start();
  root = notesRoot();
  writeFileSync(`${root}/today.md`, "Water the plants.\n");
  manifest = pin(definitionsFor(root), root);
  node = await startNode(issuer, root, manifest);
});
after(async () => {
  // Guarded: a start that failed in before() must fail the run, never hang it.
  try {
    await node?.close();
  } finally {
    await issuer.close();
    restoreEnv();
    cleanup(root);
  }
  console.log(`P1 EXIT GATE, against a real teaching node\n${exit.join("\n")}`);
});

const live = (): Node => {
  if (node === undefined) throw new Error("the teaching node did not start");
  return node;
};

/** A start that must be refused: returns the error, and closes the node if it started after all. */
async function refusedStart(extra: Record<string, string | undefined>, manifestPath = manifest): Promise<unknown> {
  try {
    const n = await startNode(issuer, root, manifestPath, extra);
    await n.close();
    return undefined;
  } catch (err) {
    return err;
  }
}

void describe("P1 exit gate: against a real teaching node", () => {
  void it("`curl -i` unauthenticated returns 401 with a WWW-Authenticate header carrying resource_metadata (N4: a missing token)", async () => {
    const r = await mcp(live().t, "tools/list", {});
    assert.equal(r.status, 401);
    assert.match(String(r.headers["www-authenticate"]), /^Bearer resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/mcp"$/);
    record("unauthenticated returns 401 with resource_metadata", `${String(r.status)} WWW-Authenticate: ${String(r.headers["www-authenticate"])}`);
  });

  void it("a token with a different audience also returns 401 (N4: wrong audience)", async () => {
    const r = await mcp(live().t, "tools/list", {}, { token: token({ aud: "https://another.example.invalid/mcp" }) });
    assert.equal(r.status, 401);
    assert.match(String(r.headers["www-authenticate"]), /error="invalid_token"$/);
    record("a token with a different audience also returns 401", `${String(r.status)} ${String(r.headers["www-authenticate"]).replace(/^.*(error=.*)$/, "$1")}`);
  });

  void it("N4: a failed signature returns 401", async () => {
    const [h, p, s] = token().split(".") as [string, string, string];
    const tampered = `${h}.${p}.${s.startsWith("A") ? "B" : "A"}${s.slice(1)}`;
    const r = await mcp(live().t, "tools/list", {}, { token: tampered });
    assert.equal(r.status, 401);
    record("N4: a failed signature refuses", `${String(r.status)} invalid_token`);
  });

  void it("a valid token lists notes.read and reads a note", async () => {
    const list = await mcp(live().t, "tools/list", {}, { token: token() });
    assert.equal(list.status, 200);
    const names = ((list.json as { result: { tools: { name: string }[] } }).result.tools).map((t) => t.name);
    assert.deepEqual(names, ["notes.read"]);
    const r = await call("notes.read", { name: "today.md" }, { token: token() });
    assert.equal(r.status, 200);
    assert.match(r.text, /Water the plants\./);
    record("a valid token lists notes.read and reads a note", `tools/list ${JSON.stringify(names)}; notes.read today.md → ${String(r.status)}`);
  });

  void it("a hand-edited description leaves that tool absent from tools/list on restart (N2), and stops the node under the strict default (N4: pin drift)", async () => {
    // The pinned text differs from the running definition: the manifest was approved before the
    // edit. The gate compares hashes, so this is the same state as editing the source after pinning.
    const [original] = definitionsFor(root) as [PinnableTool];
    const beforeEdit = pin([{ ...original, description: `${original.description} (as approved)` }], root, "approved-before-the-edit");
    const strict = await refusedStart({}, beforeEdit);
    assert.match(String(strict), /PinRefusedError|drifted/);
    const lenient = await startNode(issuer, root, beforeEdit, { PIN_STRICT: "false" });
    try {
      const list = await mcp(lenient.t, "tools/list", {}, { token: token() });
      const names = ((list.json as { result: { tools: { name: string }[] } }).result.tools).map((t) => t.name);
      assert.deepEqual(names, []);
      assert.ok(lenient.lines.some((l) => l.startsWith('pin-refused {"tool":"notes.read","reason":"drifted"')));
      record("a hand-edited description leaves that tool absent from tools/list on restart", `PIN_STRICT=false: tools/list ${JSON.stringify(names)}, audit pin-refused drifted; default: start refused (${String((strict as Error).name)})`);
    } finally {
      await lenient.close();
    }
  });

  void it("N4: a missing manifest, and an unpinned tool, each refuse to start", async () => {
    const missing = await refusedStart({}, `${root}/../no-such-manifest.json`);
    assert.match(String(missing), /manifest cannot be read/);
    const other = pin([{ ...(definitionsFor(root)[0] as PinnableTool), name: "notes.other" }], root, "pins-another-tool");
    const unpinned = await refusedStart({}, other);
    assert.match(String(unpinned), /PinRefusedError|unpinned/);
    record("N4: a missing manifest or an unpinned tool refuses to start", `missing: ${String((missing as Error).name)}; unpinned: ${String((unpinned as Error).name)}`);
  });

  void it("the H1 re-test's H-1, end to end: each of the four variants, started by clearseal-node against the operator's manifest, is refused", { timeout: 180_000 }, async () => {
    const caFile = caFileFor(issuer.ca);
    const base = { TEACHING_RESOURCE_URL: AUDIENCE, TEACHING_HOST: "127.0.0.1", TEACHING_PORT: "0", AUTH_ISSUER: ISSUER, AUTH_JWKS_URL: issuer.jwksUrl, AUTH_AUDIENCE: AUDIENCE, AUTH_JWKS_CA_FILE: caFile, CLEARSEAL_MANIFEST: COMMITTED_MANIFEST, AUDIT_STORE: "seam-only" };
    const rows: string[] = [];
    for (const route of ROUTES) {
      const h = await install(route);
      try {
        // Defense in depth: the checker reads every file an import can reach, so each variant is a
        // finding. The guarantee below does not depend on it.
        const findings = checkEdition(h.dir).map((f) => `${f.file}: ${f.rule}`);
        assert.ok(findings.length > 0, `${route}: the checker refuses it`);
        const env = { ...base, CLEARSEAL_EDITION: h.name };
        // The strict default: the node refuses to start, after logging the manifest it read.
        const strict = await startNodeProcess(env);
        strict.stop();
        console.log(`H-1 ${route} strict output:\n${strict.output.trim()}`);
        assert.equal(strict.port, undefined, `${route}: under the strict default the node does not start`);
        assert.match(strict.output, /manifest-loaded/);
        assert.ok(strict.output.includes(COMMITTED_MANIFEST), `${route}: manifest-loaded names the operator's file, not the edition's`);
        assert.ok(!strict.output.includes(h.ownManifest), `${route}: the edition's own manifest is never read`);
        assert.match(strict.output, /notes\.exfil \(unpinned\)/);
        // PIN_STRICT=false: the node starts, and the unpinned tool is absent and uncallable.
        const lax = await startNodeProcess({ ...env, PIN_STRICT: "false" });
        try {
          assert.ok(lax.port !== undefined, `${route}: with PIN_STRICT=false the node starts: ${lax.output}`);
          const t = { port: lax.port } as Parameters<typeof mcp>[0];
          const list = await mcp(t, "tools/list", {}, { token: token() });
          const names = ((list.json as { result?: { tools?: { name: string }[] } }).result?.tools ?? []).map((x) => x.name);
          const exfil = await mcp(t, "tools/call", { name: "notes.exfil", arguments: {} }, { token: token(), name: "notes.exfil" });
          console.log(`H-1 ${route} PIN_STRICT=false: tools/list ${JSON.stringify(names)}; tools/call notes.exfil → ${String(exfil.status)} ${exfil.text}`);
          assert.ok(!names.includes("notes.exfil"), `${route}: the unpinned tool is absent`);
          assert.ok(!exfil.text.includes("SERVED BY AN UNPINNED TOOL"), `${route}: the unpinned tool never runs`);
          rows.push(`${route}: checker ${JSON.stringify(findings)}; strict: refused (notes.exfil unpinned) after manifest-loaded pins/teaching.json; PIN_STRICT=false: tools/list ${JSON.stringify(names)}, notes.exfil not served`);
        } finally {
          lax.stop();
        }
      } finally {
        uninstall(h);
      }
    }
    record("the node serves only tools whose definitions hash to the manifest the operator configured, and every setting is read before any edition code runs (the H1 re-test's H-1, all four variants, end to end)", rows.join(" | "));
  });

  void it("a forged Origin and an extra request property are each refused before any handler runs", async () => {
    // The same pinned definition, served by the core with its handler counted (the handler is not
    // part of the hash): the counter shows the handler never ran for either refusal.
    let runs = 0;
    const [def] = definitionsFor(root) as [PinnableTool];
    const counted: PinnableTool = { ...def, handler: (args, ctx) => ((runs += 1), def.handler(args, ctx)) };
    const pool = new ValidationPool({ workers: 1, timeoutMs: DEFAULT_LIMITS.validationTimeoutMs });
    const countingNode = await startTransport({ registry: loadPinnedRegistry(manifest, [counted], { compile: pool.compile, limits: DEFAULT_LIMITS }), serverInfo: { name: "counting", version: "0" }, config: { resourceUrl: AUDIENCE }, validationPool: pool });
    try {
      const rows: string[] = [];
      for (const [label, t] of [["teaching node", live().t], ["counting node", countingNode]] as const) {
        const origin = await mcp(t, "tools/call", { name: "notes.read", arguments: { name: "today.md" } }, { name: "notes.read", token: token(), headers: { origin: "https://evil.example.invalid" } });
        const extra = await mcp(t, "tools/call", { name: "notes.read", arguments: { name: "today.md", path: "/etc/passwd" } }, { name: "notes.read", token: token() });
        assert.equal(origin.status, 403, label);
        assert.equal(extra.status, 400, label);
        if (t === live().t) {
          // Each refusal also writes its audit line (CSR-WO-1007 §1.4).
          const lines = live().lines;
          assert.ok(lines.some((l) => l.startsWith('http-refused {"status":403,"reason":"origin-not-allowed"')), `a forged Origin writes http-refused: ${lines.slice(-4).join(" | ")}`);
          assert.ok(lines.some((l) => l.startsWith('rpc-refused {"code":-32602,"method":"tools/call"')), `an extra property writes rpc-refused: ${lines.slice(-4).join(" | ")}`);
        }
        assert.match(extra.text, /Invalid arguments for tool notes\.read/);
        rows.push(`${label}: forged Origin → ${String(origin.status)}, extra property → ${String(extra.status)}`);
      }
      assert.equal(runs, 0, "no handler ran for either refusal");
      const control = await mcp(countingNode, "tools/call", { name: "notes.read", arguments: { name: "today.md" } }, { name: "notes.read", token: token() });
      assert.equal(control.status, 200);
      assert.equal(runs, 1, "the counter does count: a valid call runs the handler once");
      record("a forged Origin and an extra request property are each refused before any handler runs, each with its audit line", `${rows.join("; ")}; handler runs during both refusals: 0 (a valid call: 1); teaching node audit: http-refused 403 origin-not-allowed, rpc-refused -32602`);
    } finally {
      await countingNode.close();
    }
  });

  void it("containment: a name that climbs out, a planted link and a FIFO in the notes root are each refused, each with its audit line", async () => {
    const rows: string[] = [];
    // A name that climbs out never reaches the cage: the pinned schema's name pattern refuses it first.
    const climb = await call("notes.read", { name: "../outside.md" }, { token: token() });
    assert.equal(climb.status, 400);
    assert.ok(live().lines.some((l) => l.startsWith('rpc-refused {"code":-32602,"method":"tools/call"')));
    rows.push(`"../outside.md" → ${String(climb.status)} (the pinned schema, before the cage; rpc-refused)`);
    // A link planted in the root, to a file outside it: refused at the cage, every platform.
    mkdirSync(`${root}/../outside`, { recursive: true });
    writeFileSync(`${root}/../outside/secret.md`, "SECRET OUTSIDE THE ROOT\n");
    symlinkSync(`${root}/../outside/secret.md`, `${root}/planted-link.md`);
    const link = await call("notes.read", { name: "planted-link.md" }, { token: token() });
    assert.equal(link.status, 500);
    assert.match(link.text, /reached outside its containment domain/);
    assert.doesNotMatch(link.text, /SECRET/);
    assert.ok(live().lines.some((l) => l.startsWith('containment-refused {"tool":"notes.read","kind":"fs","sink":"') && l.includes("planted-link.md")));
    rows.push(`a planted link → ${String(link.status)} containment-refused`);
    if (process.platform !== "win32") {
      execFileSync("mkfifo", [`${root}/planted-fifo.md`]);
      const t0 = performance.now();
      const fifo = await call("notes.read", { name: "planted-fifo.md" }, { token: token() });
      assert.equal(fifo.status, 500);
      assert.ok(performance.now() - t0 < 2_000, "refused at once, never waited on");
      assert.ok(live().lines.some((l) => l.startsWith('containment-refused {"tool":"notes.read","kind":"fs","sink":"') && l.includes('"fileType":"fifo"')));
      rows.push(`a FIFO → ${String(fifo.status)} containment-refused fileType fifo, in ${(performance.now() - t0).toFixed(0)} ms`);
    } else {
      rows.push("a FIFO: not creatable on Windows");
    }
    record("containment: an escape by name, by link and by FIFO is refused, each with its audit line", rows.join("; "));
  });
});

/** Runs one of the core's suites; its own red case is part of it. */
function suite(file: string): string {
  // A fresh test run, not a child of this one: the runner's context variable must not leak into it.
  const env = { ...process.env };
  delete env["NODE_TEST_CONTEXT"];
  let out: string;
  try {
    out = execFileSync(process.execPath, ["scripts/test.mjs", file], { cwd: REPO, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    throw new Error(`${file} failed:\n${(e.stdout ?? "").slice(-2000)}\n${(e.stderr ?? "").slice(-2000)}`, { cause: err });
  }
  const summary = /test: \d+ file\(s\), \d+ test\(s\) passed/.exec(out)?.[0] ?? "passed";
  // The H1 plant and its variants each ran and went red in that suite (CSR-WO-1007 §1.4).
  const h1 = out.match(/✔ red-proof H1/g)?.length ?? 0;
  return file.endsWith("supply-boundary.test.ts") ? (assert.ok(h1 >= 10, `the H1 plant and its variants ran: ${String(h1)}`), `${summary}; H1 plant and variants red: ${String(h1)}`) : summary;
}

void describe("P1 exit gate: the core's own suites, each with its red case", () => {
  const clauses: [string, string][] = [
    ["N3: every gate-read field is in the hash, and the subset test can go red", "packages/core/test/pinning/subset.test.ts"],
    ["every committed cross-language vector hashes identically in the core", "packages/core/test/pinning/vectors.test.ts"],
    ["the enumeration detector goes red when a local copy of the standard's field list is edited", "packages/core/test/pinning/spec-check.test.ts"],
    ["the supply-boundary test exists and goes red on a planted edition-side control, the red-team's H1 plant and each of its aliasing variants", "packages/core/test/boundary/supply-boundary.test.ts"],
  ];
  for (const [sentence, file] of clauses) {
    void it(sentence, { timeout: 180_000 }, () => {
      const result = suite(file);
      record(sentence, `${file}: ${result}`);
    });
  }
});

// CSR-WO-2002 §3.2, audit/RULES.md AU-8: every node this suite started wrote a real JSON-lines log. Its
// calls carry planted values: an argument that reaches the handler, one that is refused, a JSON-RPC id,
// a forged header, a token, a tool name, a method. No row of any log may contain one.
void describe("keyed, never bare (CSR-WO-2002)", () => {
  void it("keyed, never bare: no audit row carries a planted value", async () => {
    const t = live().t;
    const tag = `canary${String(Date.now()).slice(-6)}`;
    const planted = {
      argument: `${tag}arg.md`,
      refused: `${tag}-refused-value`,
      id: `${tag}-jsonrpc-id`,
      origin: `https://${tag}-origin.example`,
      token: `${tag}-token`,
      tool: `${tag}-tool`,
      method: `${tag}/method`,
    };
    const sent: string[] = [];
    const send = async (label: string, p: Promise<{ status: number }>): Promise<void> => {
      try {
        sent.push(`${label} → ${String((await p).status)}`);
      } catch (err) {
        sent.push(`${label} → ${err instanceof Error ? err.message : "error"}`);
      }
    };
    await send("an argument reaching the handler", mcp(t, "tools/call", { name: "notes.read", arguments: { name: planted.argument } }, { token: token(), name: "notes.read", id: planted.id }));
    await send("a refused extra argument", mcp(t, "tools/call", { name: "notes.read", arguments: { name: "today.md", smuggled: planted.refused } }, { token: token(), name: "notes.read" }));
    await send("a forged Origin", mcp(t, "tools/call", { name: "notes.read", arguments: { name: "today.md" } }, { token: token(), name: "notes.read", headers: { origin: planted.origin } }));
    await send("a planted token", mcp(t, "tools/list", {}, { token: planted.token }));
    await send("an unknown tool name", mcp(t, "tools/call", { name: planted.tool, arguments: {} }, { token: token(), name: planted.tool }));
    await send("an unknown method", mcp(t, planted.method, {}, { token: token() }));
    console.log(`CANARY requests: ${sent.join("; ")}`);
    assert.match(sent[0] ?? "", /→ 200$/, "the planted argument reached the handler (a tool error: no such note)");
    let rows = 0;
    const logs: string[] = [];
    for (const kit of kits) {
      let text: string;
      try {
        text = readFileSync(kit.log, "utf8");
      } catch {
        continue; // a refused start may never have opened its log
      }
      logs.push(kit.log);
      for (const [what, value] of Object.entries(planted)) assert.ok(!text.includes(value) && !text.includes(tag), `${what} (${value}) reached a row of ${kit.log}`);
      const lines = text.trimEnd().split("\n").filter((l) => l !== "");
      rows += lines.length;
      for (const l of lines) assert.equal(typeof (JSON.parse(l) as { principal?: unknown }).principal, "string", "every row carries a principal");
      let anchor: string;
      try {
        anchor = readFileSync(kit.anchor, "utf8");
      } catch {
        anchor = "";
      }
      const report = verifyAudit(text, anchor, kit.allowlist);
      assert.equal(report.exitCode, 0, `${kit.log}: ${JSON.stringify(report.findings)}`);
    }
    const toolCalls = readFileSync(live().kit.log, "utf8").split("\n").filter((l) => l.includes('"event":"tool-call"'));
    assert.ok(toolCalls.length > 0, "calls that reached the handler wrote tool-call rows");
    record("keyed, never bare: no audit row carries a planted argument, id, header, token, tool name or method (CSR-WO-2002)", `${String(Object.keys(planted).length)} planted values; ${String(logs.length)} logs, ${String(rows)} rows scanned: none carries one; every row has a principal; every log verifies`);
  });
});
