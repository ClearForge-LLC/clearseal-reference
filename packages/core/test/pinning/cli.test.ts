// CSR-WO-1001 §1.5, §3.4: the operator path. `diff` exits 0 only when every tool is unchanged;
// `approve` writes only with --yes; `verify` exits 0 only when every tool is admitted.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { runPin } from "../../src/pinning/cli.ts";

const TAG = '{ capability_class: "read_only", untrusted_input_facing: false, scope: "s", privacy_sensitive: false, recoverability_basis: null, elevated: false, containment_domain: null }';
const moduleText = (tools: { name: string; description: string }[]): string =>
  `export const definitions = [${tools.map((t) => `{ name: ${JSON.stringify(t.name)}, description: ${JSON.stringify(t.description)}, inputSchema: { type: "object" }, handler: async () => ({ content: [] }), capability: ${TAG} }`).join(", ")}];\n`;

void describe("npm run pin -- diff | approve --yes | verify", () => {
  let dir = "";
  let n = 0;
  const transcript: string[] = [];
  /** Each state gets its own module file: an ES module is cached by its URL. */
  const defs = (tools: { name: string; description: string }[]): string => {
    const file = join(dir, `definitions-${String(n++)}.mjs`);
    writeFileSync(file, moduleText(tools));
    return file;
  };
  const run = async (label: string, args: string[]): Promise<{ code: number; out: string; err: string }> => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runPin(args, (l) => out.push(l), (l) => err.push(l));
    const shown = args.map((a) => (a.startsWith(dir) ? a.slice(dir.length + 1).replace(/^definitions-\d+/, "definitions") : a)).join(" ");
    transcript.push(`$ npm run pin -- ${shown}   # ${label}`, ...out, ...err.map((e) => `(stderr) ${e}`), `exit ${String(code)}`);
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "pin-cli-"));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
    console.log(`CLI-TRANSCRIPT\n${transcript.join("\n")}`);
  });

  void it("the whole path: approve refused without --yes; approve --yes; diff clean; edit → drift; verify", async () => {
    const manifest = join(dir, "manifest.json");
    const v1 = defs([
      { name: "alpha", description: "A." },
      { name: "beta", description: "B." },
    ]);
    const noYes = await run("approve without --yes", ["approve", "--definitions", v1, "--manifest", manifest]);
    assert.equal(noYes.code, 2);
    assert.equal(existsSync(manifest), false, "nothing written without --yes");

    assert.equal((await run("approve", ["approve", "--yes", "--definitions", v1, "--manifest", manifest])).code, 0);
    assert.equal((await run("clean tree", ["diff", "--definitions", v1, "--manifest", manifest])).code, 0);
    assert.equal((await run("", ["verify", "--definitions", v1, "--manifest", manifest])).code, 0);

    const v2 = defs([
      { name: "alpha", description: "A, edited." },
      { name: "gamma", description: "G." },
    ]);
    const d = await run("after an edit, an addition and a removal", ["diff", "--definitions", v2, "--manifest", manifest]);
    assert.equal(d.code, 1);
    assert.match(d.out, /^drifted {4}alpha {2}[0-9a-f]{12} → [0-9a-f]{12}$/m);
    assert.match(d.out, /^new {8}gamma {2}\(unpinned\)/m);
    assert.match(d.out, /^removed {4}beta/m);
    const v = await run("", ["verify", "--definitions", v2, "--manifest", manifest]);
    assert.equal(v.code, 1);
    assert.match(v.out, /refused {4}alpha {2}drifted/);

    const before2 = readFileSync(manifest, "utf8");
    assert.equal((await run("approve without --yes, again", ["approve", "--definitions", v2, "--manifest", manifest])).code, 2);
    assert.equal(readFileSync(manifest, "utf8"), before2);
    assert.equal((await run("", ["approve", "--yes", "--definitions", v2, "--manifest", manifest])).code, 0);
    assert.equal((await run("", ["verify", "--definitions", v2, "--manifest", manifest])).code, 0);
  });

  void it("verify with no manifest fails; a bad command or a missing flag is a usage error", async () => {
    const v1 = defs([{ name: "alpha", description: "A." }]);
    assert.equal((await run("no manifest", ["verify", "--definitions", v1, "--manifest", join(dir, "absent.json")])).code, 1);
    assert.equal((await runPin(["delete"], () => undefined, () => undefined)), 2);
    assert.equal((await runPin(["diff", "--definitions", v1], () => undefined, () => undefined)), 2);
  });
});
