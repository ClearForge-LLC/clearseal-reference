// CSR-WO-2010: the official conformance suite (@modelcontextprotocol/conformance, pinned in this
// spike's package.json), `--requirements 2026-07-28`, against the core's conformance fixture server
// (packages/core/test/conformance/fixture-server.ts: the real transport with the fixture tools the
// suite's server scenarios call). The teaching node serves one tool, so the suite's scenarios would
// only measure "tool not found" there. Writes results/conformance-summary.json: counts by required
// and unscored scenario, and every check that did not pass.
//
//   node conformance.ts      (after `npm install` in this directory)

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const here = new URL(".", import.meta.url).pathname;
const repo = join(here, "..", "..");
const cli = join(here, "node_modules/@modelcontextprotocol/conformance/dist/index.js");
const port = process.env["CONFORMANCE_PORT"] ?? "3999";

const server = spawn(process.execPath, [join(repo, "packages/core/test/conformance/fixture-server.ts"), port], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise<void>((resolve, reject) => {
  server.stdout.on("data", (d: Buffer) => {
    if (d.toString().includes("listening")) resolve();
  });
  server.once("exit", (code) => {
    reject(new Error(`fixture server exited ${String(code)}`));
  });
});

try {
  const listed = spawnSync(process.execPath, [cli, "list", "--requirements", "2026-07-28"], { encoding: "utf8" });
  const block = listed.stdout.split("Server scenarios")[1]?.split("Client scenarios")[0] ?? "";
  const required = new Set([...block.matchAll(/^\s+- ([a-z0-9-]+)/gm)].map((m) => m[1]));
  const out = mkdtempSync(join(tmpdir(), "csr-2010-conformance-"));
  const run = spawnSync(process.execPath, [cli, "server", "--url", `http://127.0.0.1:${port}/mcp`, "--requirements", "2026-07-28", "-o", out], { encoding: "utf8" });
  const total = /Total: (\d+) passed, (\d+) failed/.exec(run.stdout);
  const tally: Record<string, Record<string, number>> = { required: {}, unscored: {} };
  const scenarios: Record<string, { scored: boolean; counts: Record<string, number> }> = {};
  const notPassing: { scenario: string; scored: boolean; status: string; id: string; message: string; specReferences: string[] }[] = [];
  for (const dir of readdirSync(out)) {
    const f = join(out, dir, "checks.json");
    if (!existsSync(f)) continue;
    const scenario = dir.replace(/^server-/, "").replace(/-20\d\d-.*$/, "");
    const scored = required.has(scenario);
    const counts: Record<string, number> = {};
    for (const c of JSON.parse(readFileSync(f, "utf8")) as { id: string; status: string; errorMessage?: string; message?: string; description?: string; specReferences?: { id?: string; url?: string }[] }[]) {
      counts[c.status] = (counts[c.status] ?? 0) + 1;
      const bucket = tally[scored ? "required" : "unscored"] as Record<string, number>;
      bucket[c.status] = (bucket[c.status] ?? 0) + 1;
      if (c.status !== "SUCCESS" && c.status !== "INFO") notPassing.push({ scenario, scored, status: c.status, id: c.id, message: (c.errorMessage ?? c.message ?? c.description ?? "").slice(0, 300), specReferences: (c.specReferences ?? []).map((r) => r.url ?? r.id ?? "") });
    }
    scenarios[scenario] = { scored, counts };
  }
  const summary = { suite: "@modelcontextprotocol/conformance 0.2.0-alpha.12", requirements: "2026-07-28", target: "packages/core/test/conformance/fixture-server.ts", ran: new Date().toISOString(), suiteTotal: total === null ? null : { passed: Number(total[1]), failed: Number(total[2]) }, checks: tally, requiredScenarios: required.size, scenarios, notPassing };
  mkdirSync(join(here, "results"), { recursive: true });
  writeFileSync(join(here, "results/conformance-summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(`CONFORMANCE suite total ${JSON.stringify(summary.suiteTotal)}; required ${JSON.stringify(tally.required)}; unscored ${JSON.stringify(tally.unscored)}`);
} finally {
  server.kill();
}
