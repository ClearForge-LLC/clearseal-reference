// CSR-WO-0101 spike: the local half of the measurement. A scripted client, speaking raw HTTP to the
// spike on loopback, records what each approval transport carries: the raw messages, timings, and
// whether the exchange completes. It covers both eras the core serves: 2026-07-28 (modern, with MRTR)
// and 2025-11-25 (legacy: initialize, no MRTR). The bearer is random per run; the grant TTL is
// shortened so the expiry case runs in seconds (the server default is 120 s).
//
//   node spikes/0101-approval/probe.ts            prints the report to stdout

import { randomBytes } from "node:crypto";
import { request } from "node:http";

import { startSpike } from "./server.ts";

const PV = "io.modelcontextprotocol/protocolVersion";
const CAPS = "io.modelcontextprotocol/clientCapabilities";

interface Exchange {
  label: string;
  request: unknown;
  status: number;
  response: unknown;
  ms: number;
}

export interface ProbeReport {
  exchanges: Exchange[];
  log: string[];
  rows: { transport: string; era: string; carried: string; completed: string; latency: string; notes: string }[];
}

let nextId = 1;

function post(port: number, headers: Record<string, string>, body: unknown): Promise<{ status: number; json: unknown; ms: number }> {
  const text = JSON.stringify(body);
  const t0 = performance.now();
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method: "POST", path: "/mcp", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const s = Buffer.concat(chunks).toString("utf8");
        let json: unknown;
        try {
          json = s === "" ? "" : (JSON.parse(s) as unknown);
        } catch {
          json = s;
        }
        resolve({ status: res.statusCode ?? 0, json, ms: Math.round(performance.now() - t0) });
      });
    });
    req.on("error", reject);
    req.end(text);
  });
}

export async function runProbe(opts: { grantTtlMs?: number } = {}): Promise<ProbeReport> {
  const bearer = randomBytes(32).toString("base64url");
  const log: string[] = [];
  const spike = await startSpike({ bearer, grantTtlMs: opts.grantTtlMs ?? 1500, log: (l) => log.push(l) });
  const port = spike.t.port;
  const exchanges: Exchange[] = [];
  const auth = { authorization: `Bearer ${bearer}` };

  const modern = async (label: string, method: string, params: Record<string, unknown>, caps: Record<string, unknown> = {}, headers: Record<string, string> = auth): Promise<{ status: number; json: unknown; ms: number }> => {
    const body = { jsonrpc: "2.0", id: nextId++, method, params: { ...params, _meta: { [PV]: "2026-07-28", [CAPS]: caps } } };
    const name: Record<string, string> = typeof params["name"] === "string" ? { "mcp-name": params["name"] } : {};
    const r = await post(port, { ...headers, "mcp-protocol-version": "2026-07-28", "mcp-method": method, ...name }, body);
    exchanges.push({ label, request: body, status: r.status, response: r.json, ms: r.ms });
    return r;
  };
  const legacy = async (label: string, method: string, params: Record<string, unknown>, withHeader = true): Promise<{ status: number; json: unknown; ms: number }> => {
    const body = { jsonrpc: "2.0", id: nextId++, method, params };
    const r = await post(port, { ...auth, ...(withHeader ? { "mcp-protocol-version": "2025-11-25" } : {}) }, body);
    exchanges.push({ label, request: body, status: r.status, response: r.json, ms: r.ms });
    return r;
  };
  const result = (r: { json: unknown }): Record<string, unknown> => ((r.json as { result?: Record<string, unknown> }).result ?? {});
  const textOf = (r: { json: unknown }): string => ((result(r)["content"] as { text?: string }[] | undefined)?.[0]?.text ?? JSON.stringify(r.json));
  const lastCode = (): string => {
    const line = [...log].reverse().find((l) => l.includes("GRANT issued"));
    return /code ([0-9A-Z]{5}-[0-9A-Z]{5})/.exec(line ?? "")?.[1] ?? "";
  };
  const rows: ProbeReport["rows"] = [];
  const elicit = { elicitation: { form: {} } };

  try {
    // Bearer: missing and wrong (WO §3.4).
    await modern("no bearer → expect 401", "server/discover", {}, {}, {});
    await modern("wrong bearer → expect 401", "server/discover", {}, {}, { authorization: "Bearer wrong" });
    await modern("server/discover", "server/discover", {});
    await modern("tools/list", "tools/list", {});

    // (a) MRTR, modern: accept, decline, no elicitation capability, missing answer.
    const a1 = await modern("mrtr: first call (client declares elicitation)", "tools/call", { name: "approve_via_mrtr", arguments: { action: "rotate the demo key" } }, elicit);
    const sealed = result(a1)["requestState"];
    const state = typeof sealed === "string" ? sealed : "";
    const a2 = await modern("mrtr: retry with accept + approve:true + echoed requestState", "tools/call", { name: "approve_via_mrtr", arguments: { action: "rotate the demo key" }, requestState: state, inputResponses: { approval: { action: "accept", content: { approve: true } } } }, elicit);
    rows.push({ transport: "(a) MRTR-carried elicitation", era: "2026-07-28", carried: a1.status === 200 && result(a1)["resultType"] === "input_required" ? "yes: input_required with an elicitation/create request, and a sealed requestState" : "no", completed: textOf(a2).startsWith("APPROVED") ? "yes (accept)" : "no", latency: `${String(a1.ms)} ms + ${String(a2.ms)} ms (two round trips; human time excluded)`, notes: "the retry must echo requestState. Every answer in this probe is produced by the probe itself: the server cannot tell a human's answer from the token holder's (channel separation)" });

    const d1 = await modern("mrtr: first call (for the decline case)", "tools/call", { name: "approve_via_mrtr", arguments: { action: "delete the demo file" } }, elicit);
    const d2 = await modern("mrtr: retry with decline → expect a refusal", "tools/call", { name: "approve_via_mrtr", arguments: { action: "delete the demo file" }, requestState: result(d1)["requestState"], inputResponses: { approval: { action: "decline" } } }, elicit);
    const d3 = await modern("mrtr: retry with accept but approve:false → expect a refusal", "tools/call", { name: "approve_via_mrtr", arguments: { action: "delete the demo file" }, requestState: result(d1)["requestState"], inputResponses: { approval: { action: "accept", content: { approve: false } } } }, elicit);
    const d4 = await modern("mrtr: the SAME state after the decline, now accept → measures replay", "tools/call", { name: "approve_via_mrtr", arguments: { action: "delete the demo file" }, requestState: result(d1)["requestState"], inputResponses: { approval: { action: "accept", content: { approve: true } } } }, elicit);
    rows.push({ transport: "(a) MRTR decline", era: "2026-07-28", carried: "yes", completed: `${textOf(d2).startsWith("REFUSED") ? "refused (decline)" : "NOT REFUSED"}; ${textOf(d3).startsWith("REFUSED") ? "refused (approve:false)" : "NOT REFUSED"}`, latency: `${String(d2.ms)} ms`, notes: `a decline refuses that call; but the same sealed state re-presented with accept: ${textOf(d4).startsWith("APPROVED") ? "APPROVED (the state is not single-use: a decline is not final)" : "refused"}` });

    const n1 = await modern("mrtr: client does NOT declare elicitation → expect -32021", "tools/call", { name: "approve_via_mrtr", arguments: { action: "x" } }, {});
    const swapped = await modern("mrtr: state from one action replayed for another → expect refusal", "tools/call", { name: "approve_via_mrtr", arguments: { action: "a different action" }, requestState: state, inputResponses: { approval: { action: "accept", content: { approve: true } } } }, elicit);
    rows.push({ transport: "(a) MRTR without the elicitation capability", era: "2026-07-28", carried: `no: ${String(n1.status)} ${String((n1.json as { error?: { code?: number } }).error?.code)}`, completed: "no", latency: `${String(n1.ms)} ms`, notes: `the core refuses before the tool asks (MissingRequiredClientCapability). Binding exercised: a state replayed for another action → ${String(swapped.status)} ${String((swapped.json as { error?: { code?: number } }).error?.code)}; principal binding cannot be exercised with one static principal` });

    // (a) on the legacy era: no MRTR in 2025-11-25.
    await legacy("legacy initialize (no header)", "initialize", { protocolVersion: "2025-11-25", capabilities: { elicitation: {} }, clientInfo: { name: "probe", version: "0" } }, false);
    const l1 = await legacy("legacy mrtr call", "tools/call", { name: "approve_via_mrtr", arguments: { action: "x" } });
    rows.push({ transport: "(a) MRTR-carried elicitation", era: "2025-11-25", carried: `no: ${String(l1.status)} ${String((l1.json as { error?: { code?: number } }).error?.code)}`, completed: "no", latency: `${String(l1.ms)} ms`, notes: "2025-11-25 has no MRTR; its elicitation is a server-to-client request on an SSE stream, which the core does not send" });

    // (b) Tasks.
    const t1 = await modern("task (modern)", "tools/call", { name: "approve_via_task", arguments: { action: "x" } }, { extensions: { "io.modelcontextprotocol/tasks": {} } });
    const t2 = await modern("tasks/get (not routed by the core)", "tasks/get", { taskId: "none" }, { extensions: { "io.modelcontextprotocol/tasks": {} } });
    rows.push({ transport: "(b) Tasks extension", era: "both", carried: "not offered", completed: "no", latency: `${String(t1.ms)} ms`, notes: `the tool reports NOT OFFERED (isError); tasks/get → ${String(t2.status)} ${String((t2.json as { error?: { code?: number } }).error?.code)}` });

    // (c) Grant: issue, redeem, redeem again, wrong action, expiry; on both eras.
    const g1 = await modern("grant: issue (modern)", "tools/call", { name: "approve_via_grant", arguments: { action: "restart the demo" } });
    const code = lastCode();
    const g2 = await modern("grant: redeem with the logged code", "tools/call", { name: "approve_via_grant", arguments: { action: "restart the demo", code } });
    const g3 = await modern("grant: redeem the same code again → expect refusal", "tools/call", { name: "approve_via_grant", arguments: { action: "restart the demo", code } });
    rows.push({ transport: "(c) out-of-band grant", era: "2026-07-28", carried: g1.status === 200 ? "yes (plain tool results; nothing protocol-level)" : "no", completed: `${textOf(g2).startsWith("APPROVED") ? "yes" : "no"}; second use: ${textOf(g3).startsWith("REFUSED") ? "refused" : "NOT REFUSED"}`, latency: `${String(g1.ms)} ms + ${String(g2.ms)} ms (two calls; the human reads the code off channel)`, notes: "the code never appears in a reply to the calling client, only in the server log" });

    await modern("grant: issue (for the wrong-action case)", "tools/call", { name: "approve_via_grant", arguments: { action: "A" } });
    const wrong = await modern("grant: redeem for a different action → expect refusal", "tools/call", { name: "approve_via_grant", arguments: { action: "B", code: lastCode() } });
    await modern("grant: issue (for the expiry case)", "tools/call", { name: "approve_via_grant", arguments: { action: "expire me" } });
    const expCode = lastCode();
    await new Promise((r) => setTimeout(r, (opts.grantTtlMs ?? 1500) + 200));
    const expired = await modern("grant: redeem after the TTL → expect refusal", "tools/call", { name: "approve_via_grant", arguments: { action: "expire me", code: expCode } });
    rows.push({ transport: "(c) grant refusals", era: "2026-07-28", carried: "yes", completed: `wrong action: ${textOf(wrong).startsWith("REFUSED") ? "refused" : "NOT REFUSED"}; after TTL: ${textOf(expired).startsWith("REFUSED") ? "refused" : "NOT REFUSED"}`, latency: "—", notes: `grants live after the run: ${String(spike.grants.size())}` });

    const lg1 = await legacy("grant: issue (legacy)", "tools/call", { name: "approve_via_grant", arguments: { action: "legacy restart" } });
    const lg2 = await legacy("grant: redeem (legacy)", "tools/call", { name: "approve_via_grant", arguments: { action: "legacy restart", code: lastCode() } });
    rows.push({ transport: "(c) out-of-band grant", era: "2025-11-25", carried: lg1.status === 200 ? "yes" : "no", completed: textOf(lg2).startsWith("APPROVED") ? "yes" : "no", latency: `${String(lg1.ms)} ms + ${String(lg2.ms)} ms`, notes: "works on both eras: it needs only tools/call" });
  } finally {
    await spike.close();
  }
  // Grant codes are identifiers (OPERATOR-PROTOCOL §0): masked everywhere in the report, even
  // though these are dead, per-run codes.
  const mask = <T>(v: T): T => JSON.parse(JSON.stringify(v).replace(/[0-9A-Z]{5}-[0-9A-Z]{5}/g, "XXXXX-XXXXX")) as T;
  return { exchanges: mask(exchanges), log: mask(log), rows };
}

if (import.meta.main) {
  const report = await runProbe();
  console.log("## Local half\n");
  console.log("| transport | era | carried locally | completed? | latency | notes |");
  console.log("|---|---|---|---|---|---|");
  for (const r of report.rows) console.log(`| ${r.transport} | ${r.era} | ${r.carried} | ${r.completed} | ${r.latency} | ${r.notes} |`);
  console.log("\n## Raw exchanges\n");
  for (const e of report.exchanges) console.log(`### ${e.label} (${String(e.status)}, ${String(e.ms)} ms)\n→ ${JSON.stringify(e.request)}\n← ${JSON.stringify(e.response)}\n`);
  console.log("## Server log (codes masked)\n");
  for (const l of report.log) console.log(l);
}
