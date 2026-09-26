// Red-team F1 on CSR-WO-1003: every HTTP-level refusal the transport sends writes exactly one audit
// line, with a one-word reason and the principal once it is known (CHECKS.md H1: the duplicate
// Authorization header is `duplicate-authorization`). An event that writes its own line
// (auth-refused, verifier-timeout, verifier-contract) is not written twice.

import assert from "node:assert/strict";
import { connect } from "node:net";
import { after, before, describe, it } from "node:test";

import type { Verifier } from "../../src/transport/verifier.ts";
import { BEARER, held, modernBody, modernHeaders, raw, type Reply, start, type Started } from "./helpers.ts";

/** Raw bytes on a socket, for what an HTTP client will not send (two Host headers). */
function rawSocket(port: number, text: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const sock = connect(port, "127.0.0.1", () => sock.end(text));
    let out = "";
    sock.on("data", (d: Buffer) => (out += d.toString("latin1")));
    sock.on("end", () => {
      resolve({ status: Number(/^HTTP\/1\.1 (\d+)/.exec(out)?.[1] ?? 0), headers: {}, text: out, json: undefined });
    });
    sock.on("error", reject);
  });
}

const withoutAuth = (): Record<string, string> => {
  const h = modernHeaders("tools/list");
  delete h["authorization"];
  return h;
};

const body = (): string => JSON.stringify(modernBody("tools/list"));
const PRINCIPAL = "test-principal";

interface Case {
  name: string;
  send: (s: Started) => Promise<Reply>;
  status: number;
  line: string;
}

const CASES: Case[] = [
  { name: "a target that is not origin-form", send: (s) => raw(s.t, { path: "*", headers: modernHeaders("tools/list"), body: body() }), status: 400, line: 'http-refused {"status":400,"reason":"request-target"}' },
  { name: "an unknown route", send: (s) => raw(s.t, { path: "/nope", headers: modernHeaders("tools/list"), body: body() }), status: 404, line: 'http-refused {"status":404,"reason":"not-found"}' },
  { name: "Host sent twice", send: (s) => rawSocket(s.t.port, `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${String(s.t.port)}\r\nHost: 127.0.0.1:${String(s.t.port)}\r\nConnection: close\r\nContent-Length: 2\r\n\r\n{}`), status: 400, line: 'http-refused {"status":400,"reason":"host-count"}' },
  { name: "GET /mcp", send: (s) => raw(s.t, { method: "GET", headers: modernHeaders("tools/list") }), status: 405, line: 'http-refused {"status":405,"reason":"method"}' },
  { name: "POST /health", send: (s) => raw(s.t, { method: "POST", path: "/health", body: "{}" }), status: 405, line: 'http-refused {"status":405,"reason":"method"}' },
  { name: "/health with a Host not allowed", send: (s) => raw(s.t, { method: "GET", path: "/health", headers: { host: "evil.example.invalid" } }), status: 403, line: 'http-refused {"status":403,"reason":"host-not-allowed"}' },
  { name: "/mcp with a Host not allowed", send: (s) => raw(s.t, { headers: { ...modernHeaders("tools/list"), host: "evil.example.invalid" }, body: body() }), status: 403, line: 'http-refused {"status":403,"reason":"host-not-allowed"}' },
  { name: "/mcp with an Origin not allowed", send: (s) => raw(s.t, { headers: { ...modernHeaders("tools/list"), origin: "https://evil.example.invalid" }, body: body() }), status: 403, line: 'http-refused {"status":403,"reason":"origin-not-allowed"}' },
  { name: "H1 Authorization sent twice", send: (s) => raw(s.t, { headers: { ...modernHeaders("tools/list"), authorization: [`Bearer ${BEARER}`, `Bearer ${BEARER}`] }, body: body() }), status: 400, line: 'http-refused {"status":400,"reason":"duplicate-authorization"}' },
  { name: "no Authorization (auth-refused only)", send: (s) => raw(s.t, { headers: withoutAuth(), body: body() }), status: 401, line: 'auth-refused {"reason":"refused"}' },
  { name: "a token in the query too (auth-refused only)", send: (s) => raw(s.t, { path: "/mcp?access_token=x", headers: modernHeaders("tools/list"), body: body() }), status: 400, line: 'auth-refused {"reason":"token-elsewhere"}' },
  { name: "Accept without JSON", send: (s) => raw(s.t, { headers: { ...modernHeaders("tools/list"), accept: "text/html" }, body: body() }), status: 406, line: `http-refused {"status":406,"reason":"not-acceptable","principal":"${PRINCIPAL}"}` },
  { name: "Content-Type not JSON", send: (s) => raw(s.t, { headers: { ...modernHeaders("tools/list"), "content-type": "text/plain" }, body: body() }), status: 415, line: `http-refused {"status":415,"reason":"content-type","principal":"${PRINCIPAL}"}` },
  { name: "a content coding", send: (s) => raw(s.t, { headers: { ...modernHeaders("tools/list"), "content-encoding": "gzip" }, body: body() }), status: 415, line: `http-refused {"status":415,"reason":"content-coding","principal":"${PRINCIPAL}"}` },
  { name: "a transfer coding other than chunked", send: (s) => raw(s.t, { headers: { ...modernHeaders("tools/list"), "transfer-encoding": "gzip, chunked" }, body: body(), chunked: true }), status: 400, line: `http-refused {"status":400,"reason":"transfer-coding","principal":"${PRINCIPAL}"}` },
  { name: "a body over the cap", send: (s) => raw(s.t, { headers: modernHeaders("tools/list"), body: "x".repeat(2048) }), status: 413, line: `http-refused {"status":413,"reason":"body-too-large","principal":"${PRINCIPAL}"}` },
  { name: "a body that is not UTF-8", send: (s) => raw(s.t, { headers: modernHeaders("tools/list"), body: Buffer.from([0x7b, 0xff, 0x7d]) }), status: 400, line: `http-refused {"status":400,"reason":"body-not-utf8","principal":"${PRINCIPAL}"}` },
  { name: "a body that is not JSON", send: (s) => raw(s.t, { headers: modernHeaders("tools/list"), body: "{" }), status: 400, line: `http-refused {"status":400,"reason":"parse-error","principal":"${PRINCIPAL}"}` },
  { name: "a duplicate key", send: (s) => raw(s.t, { headers: modernHeaders("tools/list"), body: '{"jsonrpc":"2.0","jsonrpc":"2.0"}' }), status: 400, line: `http-refused {"status":400,"reason":"duplicate-key","principal":"${PRINCIPAL}"}` },
  { name: "a lone surrogate", send: (s) => raw(s.t, { headers: modernHeaders("tools/list"), body: '{"a":"\\ud800"}' }), status: 400, line: `http-refused {"status":400,"reason":"lone-surrogate","principal":"${PRINCIPAL}"}` },
  { name: "nesting over the depth cap", send: (s) => raw(s.t, { headers: modernHeaders("tools/list"), body: `${"[".repeat(100)}${"]".repeat(100)}` }), status: 400, line: `http-refused {"status":400,"reason":"body-depth","principal":"${PRINCIPAL}"}` },
  { name: "a batch (framing)", send: (s) => raw(s.t, { headers: modernHeaders("tools/list"), body: "[]" }), status: 400, line: `http-refused {"status":400,"reason":"framing","principal":"${PRINCIPAL}"}` },
];

void describe("F1: every HTTP-level refusal writes exactly one audit line", () => {
  let s: Started;
  before(async () => {
    s = await start({ limits: { maxBodyBytes: 1024, maxInFlight: 1 } });
  });
  after(async () => {
    await s.close();
  });

  const rows: string[] = [];
  for (const c of CASES) {
    void it(`${String(c.status)} ${c.name}`, async () => {
      const before = s.lines.length;
      const r = await c.send(s);
      const written = s.lines.slice(before);
      rows.push(`| ${String(r.status)} | ${c.name} | ${written.join(" ; ")} |`);
      assert.equal(r.status, c.status);
      assert.deepEqual(written, [c.line]);
    });
  }

  void it("503 at capacity: the second call is refused with one line naming the caller", async () => {
    const first = raw(s.t, { headers: modernHeaders("tools/call", "hold"), body: JSON.stringify(modernBody("tools/call", { name: "hold", arguments: {} })) });
    while (held.gates.length === 0) await new Promise((r) => setTimeout(r, 5));
    const before = s.lines.length;
    const r = await raw(s.t, { headers: modernHeaders("tools/list"), body: body() });
    const written = s.lines.slice(before);
    held.gates.splice(0).forEach((g) => {
      g.open();
    });
    await first;
    rows.push(`| ${String(r.status)} | at capacity | ${written.join(" ; ")} |`);
    assert.equal(r.status, 503);
    assert.deepEqual(written, [`http-refused {"status":503,"reason":"capacity","principal":"${PRINCIPAL}"}`]);
    console.log(`REFUSAL-AUDIT\n| status | case | audit line(s) |\n|---|---|---|\n${rows.join("\n")}`);
  });
});

void describe("F1: events that write their own line are not written twice", () => {
  for (const [name, verifier, status, line] of [
    ["verifier timeout", { verify: () => new Promise(() => undefined) }, 503, 'verifier-timeout {"limitMs":50}'],
    ["verifier ok without a principal", { verify: () => Promise.resolve({ ok: true, principal: { id: "" } }) }, 500, 'verifier-contract {"reason":"ok without a principal"}'],
  ] as [string, Verifier, number, string][]) {
    void it(`${String(status)} ${name}`, async () => {
      const s = await start({ verifier, limits: { verifierTimeoutMs: 50 } });
      try {
        const r = await raw(s.t, { headers: modernHeaders("tools/list"), body: body() });
        assert.equal(r.status, status);
        assert.deepEqual(s.lines, [line]);
      } finally {
        await s.close();
      }
    });
  }
});
