// The P1 exit gate as a command (CSR-WO-1004 §1.6; roadmap P1 *Exit gate*; northstar N2, N3, N4).
// Each clause below prints one EXIT line naming the gate sentence it proves. One part of the gate is
// not re-run here: "proven able to fail by deleting the control it guards" is the deletion matrices
// recorded in the FEEDBACK of -1000 to -1004; this test carries the in-test red cases. The clauses a
// node can show run against a real teaching node, started by the edition's own scaffold with the
// core's in-process issuer. The clauses that are properties of the core (the subset test, the
// cross-language vectors, the enumeration detector, the supply-boundary test) are the core's own
// suites, each carrying its red case, and run here as child processes.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { DEFAULT_LIMITS, loadPinnedRegistry, type PinnableTool, startTransport, ValidationPool } from "@clearseal/core";

import { AUDIENCE, cleanup, definitionsFor, mcp, type Node, notesRoot, pin, restoreEnv, startNode, TestIssuer } from "./node.ts";

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
        assert.match(extra.text, /Invalid arguments for tool notes\.read/);
        rows.push(`${label}: forged Origin → ${String(origin.status)}, extra property → ${String(extra.status)}`);
      }
      assert.equal(runs, 0, "no handler ran for either refusal");
      const control = await mcp(countingNode, "tools/call", { name: "notes.read", arguments: { name: "today.md" } }, { name: "notes.read", token: token() });
      assert.equal(control.status, 200);
      assert.equal(runs, 1, "the counter does count: a valid call runs the handler once");
      record("a forged Origin and an extra request property are each refused before any handler runs", `${rows.join("; ")}; handler runs during both refusals: 0 (a valid call: 1)`);
    } finally {
      await countingNode.close();
    }
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
  return /test: \d+ file\(s\), \d+ test\(s\) passed/.exec(out)?.[0] ?? "passed";
}

void describe("P1 exit gate: the core's own suites, each with its red case", () => {
  const clauses: [string, string][] = [
    ["N3: every gate-read field is in the hash, and the subset test can go red", "packages/core/test/pinning/subset.test.ts"],
    ["every committed cross-language vector hashes identically in the core", "packages/core/test/pinning/vectors.test.ts"],
    ["the enumeration detector goes red when a local copy of the standard's field list is edited", "packages/core/test/pinning/spec-check.test.ts"],
    ["the supply-boundary test exists and goes red on a planted edition-side control", "packages/core/test/boundary/supply-boundary.test.ts"],
  ];
  for (const [sentence, file] of clauses) {
    void it(sentence, { timeout: 180_000 }, () => {
      const result = suite(file);
      record(sentence, `${file}: ${result}`);
    });
  }
});
