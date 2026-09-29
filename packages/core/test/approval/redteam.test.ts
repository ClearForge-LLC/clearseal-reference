// CSR-WO-2001 red-team amendment (gate ruling 2026-09-29; approval/RULES.md APR-18…APR-24). One section
// per finding, each porting the red team's repro by the name of its harness file: a7-whole-call (M1),
// a10-operator-principal (M3), a6b-wait-capacity (M2), a2-self-approve (L1), a5-resources (L2),
// a2c-localhost-case (L3), a8-pending-ids (Info).

import assert from "node:assert/strict";
import { request as httpRequest, createServer as createHttpServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { after, describe, it, mock } from "node:test";

import { ApprovalBook, type Call, identityOf } from "../../src/approval/book.ts";
import { ApprovalListenerError, canonicalAddress, hostsOverlap, startApprovalListener } from "../../src/approval/listener.ts";
import { MemoryNotifier, type Notification, StderrNotifier, WebhookNotifier } from "../../src/approval/notifier.ts";
import { ApprovalService } from "../../src/approval/service.ts";
import { type ApprovalSettings, DEFAULT_APPROVAL } from "../../src/approval/settings.ts";
import { visible } from "../../src/approval/visible.ts";
import { modernBody, modernHeaders, raw } from "../transport/helpers.ts";
import { ApproverVerifier, approvalOf, ran, rig } from "./harness.ts";

const pastes: string[] = [];
after(() => {
  console.log(pastes.join("\n"));
});

const tokenOf = (link: string): string => link.split("/").pop() ?? "";

/** Every code point APR-18 escapes, by class. */
const CLASSES: Readonly<Record<string, readonly number[]>> = Object.freeze({
  bidi: [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200e, 0x200f, 0x061c],
  "zero-width": [0x200b, 0x200c, 0x200d, 0x2060, 0xfeff],
  C0: Array.from({ length: 0x20 }, (_, i) => i),
  DEL: [0x7f],
  C1: Array.from({ length: 0x20 }, (_, i) => 0x80 + i),
  tag: [0xe0041, 0xe007f],
  separators: [0x2028, 0x2029],
});

/** Any code point APR-18 escapes, found raw. */
const RAW_INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;

const hex = (cp: number): string => cp.toString(16).toUpperCase().padStart(4, "0");

function settings(over: Partial<ApprovalSettings> = {}): ApprovalSettings {
  return { ...DEFAULT_APPROVAL, backend: "listener", port: 0, ...over };
}

function book(): ApprovalBook {
  let n = 0;
  return new ApprovalBook({ requestTtlMs: 60_000, grantTtlMs: 60_000, maxPending: 100, maxPendingPerPrincipal: 3, clock: () => 1_000, onEvent: () => undefined, secrets: { id: () => `req-${String(++n)}`, linkToken: () => `link-${String(n)}`, code: () => "CODE0000" } });
}

const bookCall = (principal: string, argumentsJson = "{}"): Call => ({ principal, tool: "deploy", digest: "d", auditDigest: "hmac-sha256:k:x", humanOnly: false, argumentsJson });

void describe("CSR-WO-2001 red team M1 (a7-whole-call): the approver's view shows what is hidden (APR-18)", () => {
  void it("APR-18: every class is shown as a visible escape; plain text is unchanged", () => {
    for (const [name, points] of Object.entries(CLASSES)) {
      for (const cp of points) {
        const shown = visible(`a${String.fromCodePoint(cp)}b`);
        assert.equal(shown, `a\\u{${hex(cp)}}b`, `${name} U+${hex(cp)}`);
      }
    }
    const plain = 'deploy prod — café, 日本語, 🙂, a-b_c.d/e {"k": [1, 2]} ~!@#$%^&*()';
    assert.equal(visible(plain), plain, "plain text is unchanged");
    pastes.push(`M1 visible: ${visible("pay \u202Eevil\u2066 to\u200B x\u0085")}`);
  });

  void it("APR-18: a call hiding text reaches the approver escaped, on the link and to a delegated approver, never raw", async () => {
    const r = await rig();
    try {
      const hidden = `prod\u202E\u2066gnp.exe\u2069\u200B\u200D\uFEFF\u0085\u009B\u007F\u{E0041}`;
      const pending = approvalOf(await r.call("alice", "deploy", hidden));
      assert.equal(pending.status, "pending");
      const n = r.notifier.sent[0];
      assert.ok(n !== undefined);
      const byLink = await r.listener("GET", `/approval/link/${tokenOf(n.link)}`);
      const byId = await r.listener("GET", `/approval/requests/${pending.requestId ?? ""}`, { bearer: "approver:bob" });
      for (const [label, res] of [["link", byLink], ["delegated", byId]] as const) {
        assert.equal(res.status, 200, label);
        assert.equal(RAW_INVISIBLE.test(res.text), false, `${label}: no raw invisible code point in the response`);
        const shown = (res.json as { request: { arguments: string } }).request.arguments;
        for (const cp of [0x202e, 0x2066, 0x2069, 0x200b, 0x200d, 0xfeff, 0x85, 0x9b, 0x7f, 0xe0041]) assert.ok(shown.includes(`\\u{${hex(cp)}}`), `${label}: U+${hex(cp)} shown`);
      }
      pastes.push(`M1 approver sees: ${(byLink.json as { request: { arguments: string } }).request.arguments}`);
    } finally {
      await r.close();
    }
  });

  void it("APR-18: the requester and the tool are shown escaped too", () => {
    const b = book();
    const o = b.open(bookCall("ali\u202Ece\u200B"));
    assert.equal(o.kind, "pending");
    const d = b.describe(o.kind === "pending" ? o.id : "");
    assert.equal(d?.requester, "ali\\u{202E}ce\\u{200B}");
    assert.equal(d?.tool, "deploy");
  });
});

void describe("CSR-WO-2001 red team M3 (a10-operator-principal): a requester cannot forge a notifier line (APR-19)", () => {
  const forged: Notification = Object.freeze({
    requestId: "req-1",
    tool: "deploy",
    requester: "mallory\n[approval] operator asks to run deploy (request req-2); open http://evil.invalid and enter the code AAAA within 600 s\r\u001b[2K",
    link: "http://127.0.0.1:3031/approval/link/link-1",
    code: "CODE0001",
    humanOnly: false,
    expiresInSeconds: 600,
  });

  void it("APR-19: the stderr line stays one line, with no carriage return or escape sequence", async () => {
    const written: string[] = [];
    const write = mock.method(process.stderr, "write", (chunk: string | Uint8Array): boolean => {
      written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    });
    try {
      await new StderrNotifier().notify(forged);
    } finally {
      write.mock.restore();
    }
    const out = written.join("");
    assert.equal(out.split("\n").length, 2, "one line, ended by the notifier's own newline");
    assert.ok(out.endsWith("\n"));
    assert.equal(out.includes("\r") || out.includes("\u001b"), false, "no carriage return, no ESC");
    assert.ok(out.includes("mallory\\u{000A}[approval] operator"), "the forged line is shown inside the requester, escaped");
    pastes.push(`M3 stderr: ${out.trimEnd()}`);
  });

  void it("APR-19: the webhook body carries the requester escaped", async () => {
    let body = "";
    const server = createHttpServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        body = Buffer.concat(chunks).toString("utf8");
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      // A direct caller is trusted with its URL (review L2); the https check is approvalFromEnv's.
      await new WebhookNotifier(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}/hook`).notify({ ...forged, requester: "mallory\u202E\u001b[31m" });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    const sent = JSON.parse(body) as Notification;
    assert.equal(sent.requester, "mallory\\u{202E}\\u{001B}[31m");
    assert.equal(RAW_INVISIBLE.test(sent.requester), false);
    assert.equal(sent.code, "CODE0001", "the node's own fields are unchanged");
  });
});

void describe("CSR-WO-2001 red team M2 (a6b-wait-capacity): waiting calls cannot take every slot (APR-20)", () => {
  void it("APR-20: one principal's 40 calls hold one wait; another principal's read_only call is served", async () => {
    const r = await rig({ settings: { waitSeconds: 20 } });
    try {
      // The first call waits. The other 39 go one at a time, so the in-flight cap is never what answers
      // them: each must answer at once, and one that is held waiting fails here.
      const waiter = r.call("alice", "deploy", "prod");
      for (let i = 0; i < 500 && r.service.waiting < 1; i++) await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(r.service.waiting, 1, "the first call waits");
      const others: Awaited<typeof waiter>[] = [];
      for (let i = 0; i < 39; i++) {
        const answer = await Promise.race([r.call("alice", "deploy", "prod"), new Promise<"held">((resolve) => setTimeout(() => resolve("held"), 2_000))]);
        if (answer === "held") assert.fail(`call ${String(i + 2)} was held waiting: the per-principal cap did not apply`);
        others.push(answer);
      }
      assert.equal(r.service.waiting, 1, "still one call waits");
      const read = await raw(r.t, { headers: { ...modernHeaders("tools/call", "read"), authorization: "Bearer as:bob" }, body: JSON.stringify(modernBody("tools/call", { name: "read", arguments: { target: "x" } })) });
      assert.ok(ran(read), `another principal's read_only call is served: ${String(read.status)} ${read.text.slice(0, 200)}`);
      const id = r.notifier.sent[0]?.requestId ?? "";
      assert.equal(r.service.book.decideDelegated(id, "bob", "decline").kind, "decided");
      const answered = [await waiter, ...others];
      const statuses = answered.map((a) => `${String(a.status)} ${String(approvalOf(a).status)}`);
      assert.deepEqual(statuses.filter((x) => x === "200 pending").length, 39, "every call over the cap answered pending, never 503");
      assert.deepEqual(statuses.filter((x) => x === "200 declined").length, 1, "the waiting call answers the decision");
      assert.equal(r.service.waiting, 0);
      pastes.push(`M2 one principal: 40 calls → 1 waited, 39 pending at once, never 503; bob's read → ${String(read.status)}, ran`);
    } finally {
      for (const n of r.notifier.sent) r.service.book.decideDelegated(n.requestId, "bob", "decline");
      await r.close();
    }
  });

  void it("APR-20: many principals' waits are capped in all at maxWaiting; the rest answer pending at once", async () => {
    const r = await rig({ settings: { waitSeconds: 20 } });
    try {
      const names = Array.from({ length: 20 }, (_, i) => `p${String(i)}`);
      const calls = names.map((p) => r.call(p, "deploy", "prod"));
      // The twelve over the cap answer at once; wait for them, then count the waiting.
      while (r.notifier.sent.length < 20) await new Promise((resolve) => setImmediate(resolve));
      for (let i = 0; i < 50 && r.service.waiting < DEFAULT_APPROVAL.maxWaiting; i++) await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(r.service.waiting, DEFAULT_APPROVAL.maxWaiting, "at most maxWaiting wait");
      const read = await raw(r.t, { headers: { ...modernHeaders("tools/call", "read"), authorization: "Bearer as:bob" }, body: JSON.stringify(modernBody("tools/call", { name: "read", arguments: { target: "x" } })) });
      assert.ok(ran(read), "another principal's read_only call is served");
      for (const n of r.notifier.sent) r.service.book.decideDelegated(n.requestId, "bob", "decline");
      const all = await Promise.all(calls);
      assert.equal(all.filter((a) => approvalOf(a).status === "pending").length, 20 - DEFAULT_APPROVAL.maxWaiting);
      assert.equal(all.filter((a) => approvalOf(a).status === "declined").length, DEFAULT_APPROVAL.maxWaiting);
      assert.ok(all.every((a) => a.status === 200), "never 503");
      pastes.push(`M2 twenty principals: ${String(DEFAULT_APPROVAL.maxWaiting)} waited, ${String(20 - DEFAULT_APPROVAL.maxWaiting)} pending at once; bob's read → ${String(read.status)}, ran`);
    } finally {
      for (const n of r.notifier.sent) r.service.book.decideDelegated(n.requestId, "bob", "decline");
      await r.close();
    }
  });

  void it("APR-20: a waiting cap over half the in-flight cap refuses start", async () => {
    // A transport that does start is closed before the assertion fails, so the failure is the assertion's.
    const refused = await rig({ settings: { waitSeconds: 5, maxWaiting: 17 } }).then(
      async (r) => {
        await r.close();
        return "started";
      },
      (err: unknown) => (err instanceof Error ? err.message : "error"),
    );
    assert.match(refused, /APPROVAL_MAX_WAITING \(17\) must be at most half the in-flight cap \(32\)/);
    const r = await rig({ settings: { waitSeconds: 5, maxWaiting: 16 } });
    await r.close();
  });
});

void describe("CSR-WO-2001 red team L1 (a2-self-approve): the approver is compared as an identity (APR-21)", () => {
  const variants: [string, string][] = [
    ["Dave/dave", "Dave"],
    ["trailing space", "dave "],
    ["zero-width insert", "da\u200Bve"],
    ["fullwidth letters", "\uFF44\uFF41\uFF56\uFF45"],
  ];

  void it("APR-21: identityOf folds case, width, white space and invisible code points", () => {
    for (const [label, v] of variants) assert.equal(identityOf(v), identityOf("dave"), label);
    assert.notEqual(identityOf("dave"), identityOf("davey"), "different names stay different");
  });

  void it("APR-21: each variant is refused as self-approval, delegated and by the confirm-URL", () => {
    for (const [label, v] of variants) {
      const b = book();
      const o = b.open(bookCall("dave"));
      assert.equal(o.kind, "pending");
      if (o.kind !== "pending" || o.secret === undefined) return;
      assert.deepEqual(b.decideDelegated(o.id, v, "approve"), { kind: "refused", reason: "self-approval" }, `delegated: ${label}`);
      assert.deepEqual(b.decideByLink(o.secret.linkToken, o.secret.code, "approve", v), { kind: "refused", reason: "self-approval" }, `confirm-URL: ${label}`);
      assert.equal(b.stateOf(o.id), "pending", "nothing was decided");
    }
    pastes.push(`L1 self-approval refused for: ${variants.map(([label]) => label).join(", ")}`);
  });

  void it("APR-21: a requester whose name folds to the operator's cannot approve through the confirm-URL", () => {
    const b = book();
    const o = b.open(bookCall("OPERATOR"));
    if (o.kind !== "pending" || o.secret === undefined) return assert.fail("not pending");
    assert.deepEqual(b.decideByLink(o.secret.linkToken, o.secret.code, "approve", DEFAULT_APPROVAL.humanApprover), { kind: "refused", reason: "self-approval" });
  });
});

/** One HTTP request to the listener from a chosen local address. */
function from(localAddress: string, url: string, method: string, headers: Record<string, string> = {}, body?: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, localAddress, headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) }) } }, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function listenerRig(over: Partial<ApprovalSettings> = {}): Promise<{ service: ApprovalService; rows: { event: string; fields: Record<string, string | number> }[]; url: string; addresses: () => number; close: () => Promise<void> }> {
  const rows: { event: string; fields: Record<string, string | number> }[] = [];
  const service = new ApprovalService({ settings: settings({ host: "127.0.0.1", ...over }), notifier: new MemoryNotifier(), clock: () => 1_000, audit: (event, fields) => rows.push({ event, fields }), listens: true, delegatedVerifier: new ApproverVerifier() });
  const l = await startApprovalListener(service, { host: "127.0.0.1", port: 1 });
  return { service, rows, url: l.url, addresses: () => l.addresses(), close: () => l.close() };
}

void describe("CSR-WO-2001 red team L2 (a5-resources): the listener is rate limited and junk is counted, not written (APR-22)", () => {
  void it("APR-22: 10,000 junk requests → one burst row with the count, no row each, bounded state", async () => {
    const l = await listenerRig({ listenerRateBurst: 1_000_000 });
    try {
      const statuses = new Map<number, number>();
      for (let batch = 0; batch < 100; batch++) {
        const replies = await Promise.all(
          Array.from({ length: 100 }, (_, i) =>
            i % 2 === 0
              ? fetch(`${l.url}/approval/requests/junk${String(i)}`, { method: "POST", headers: { authorization: "Bearer forged", "content-type": "application/json" }, body: '{"decision":"approve"}' })
              : fetch(`${l.url}/approval/link/junk${String(batch)}x${String(i)}`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"decision":"approve","code":"AAAAAAAA"}' }),
          ),
        );
        for (const res of replies) {
          statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
          await res.body?.cancel();
        }
      }
      assert.deepEqual(Object.fromEntries(statuses), { 401: 5_000, 404: 5_000 });
      assert.equal(l.service.book.size, 0, "no request was opened");
      assert.ok(l.addresses() <= 1, "one bucket for one address");
      await l.close();
      assert.deepEqual(l.rows.map((r) => r.event), ["approval-unauthenticated-burst"], "one row, not ten thousand");
      assert.deepEqual(l.rows[0]?.fields, { principal: "unauthenticated", count: 10_000, windowS: 60 });
      pastes.push(`L2 10,000 junk (5,000 forged bearers → 401, 5,000 unknown links → 404) → rows: ${JSON.stringify(l.rows)}`);
    } finally {
      await l.close();
    }
  });

  void it("APR-22: over the per-address budget, 429 with Retry-After; an approver from another address is served", async () => {
    const l = await listenerRig();
    try {
      const o = l.service.book.open(bookCall("alice", '{"arguments":{"target":"prod"}}'));
      const id = o.kind === "pending" ? o.id : "";
      let limited = 0;
      let served = 0;
      for (let i = 0; i < 2_000; i++) {
        const res = await from("127.0.0.2", `${l.url}/approval/requests/${id}`, "GET", { authorization: "Bearer forged" });
        if (res.status === 429) limited++;
        else served++;
      }
      assert.equal(served, DEFAULT_APPROVAL.listenerRateBurst, "the burst, then nothing");
      assert.equal(limited, 2_000 - DEFAULT_APPROVAL.listenerRateBurst);
      const approver = await from("127.0.0.1", `${l.url}/approval/requests/${id}`, "GET", { authorization: "Bearer approver:bob" });
      assert.equal(approver.status, 200, "the approver, from another address, is served");
      const decided = await from("127.0.0.1", `${l.url}/approval/requests/${id}`, "POST", { authorization: "Bearer approver:bob" }, '{"decision":"approve"}');
      assert.equal(decided.status, 200);
      assert.ok(l.addresses() <= 2);
      await l.close();
      const burst = l.rows.filter((r) => r.event === "approval-unauthenticated-burst");
      assert.deepEqual(burst.map((r) => r.fields["count"]), [DEFAULT_APPROVAL.listenerRateBurst], "only the requests the limit let through were refused for authentication, in one row");
      pastes.push(`L2 2,000 from one address → ${String(served)} answered, ${String(limited)} × 429; the approver from another address → ${String(approver.status)}, decided ${String(decided.status)}`);
    } finally {
      await l.close();
    }
  });

  void it("APR-22: a replayed link keeps its own row, naming the request; only a link that names nothing is counted", async () => {
    const l = await listenerRig();
    try {
      const o = l.service.book.open(bookCall("alice"));
      if (o.kind !== "pending" || o.secret === undefined) return assert.fail("not pending");
      const post = (token: string): Promise<Response> => fetch(`${l.url}/approval/link/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: o.secret?.code, decision: "approve" }) });
      assert.equal((await post(o.secret.linkToken)).status, 200);
      const replayed = await post(o.secret.linkToken);
      assert.equal(replayed.status, 410);
      assert.equal((await post("nothing-here")).status, 404);
      await l.close();
      const refused = l.rows.filter((r) => r.event === "approval-decision-refused").map((r) => r.fields);
      assert.deepEqual(refused.map((f) => [f["kind"], f["request"], f["tool"]]), [["link-used", o.id, "deploy"]], "the replayed link's row names its request");
      assert.deepEqual(l.rows.filter((r) => r.event === "approval-unauthenticated-burst").map((r) => r.fields["count"]), [1], "the link naming nothing is counted");
    } finally {
      await l.close();
    }
  });

  void it("APR-22: a 429 carries Retry-After and does no other work", async () => {
    const l = await listenerRig({ listenerRateBurst: 1 });
    try {
      await (await fetch(`${l.url}/approval/requests/x`, { headers: { authorization: "Bearer forged" } })).text();
      const res = await fetch(`${l.url}/approval/requests/x`, { headers: { authorization: "Bearer forged" } });
      assert.equal(res.status, 429);
      assert.equal(res.headers.get("retry-after"), "1");
      await res.text();
      await l.close();
      assert.deepEqual(l.rows.map((r) => r.fields["count"]), [1], "the limited request was not counted as a refusal");
    } finally {
      await l.close();
    }
  });
});

void describe("CSR-WO-2001 red team L3 (a2c-localhost-case): the approval listener cannot share an address by spelling (APR-23)", () => {
  void it("APR-23: addresses are compared in one form", () => {
    assert.equal(canonicalAddress("::FFFF:127.0.0.1"), "127.0.0.1");
    assert.equal(canonicalAddress("[::ffff:7f00:1]"), "127.0.0.1");
    assert.equal(canonicalAddress("0:0:0:0:0:0:0:1"), "::1");
    assert.equal(canonicalAddress("LOCALHOST"), "localhost");
    assert.equal(canonicalAddress("::1%LO"), "::1%lo", "a zone id is compared as written, never thrown on");
  });

  void it("APR-23: hosts overlap case-insensitively, by resolution, and through a wildcard", async () => {
    const overlapping: [string, string][] = [
      ["LOCALHOST", "127.0.0.1"],
      ["localhost", "127.0.0.1"],
      ["::ffff:127.0.0.1", "127.0.0.1"],
      ["0.0.0.0", "127.0.0.1"],
      ["::", "127.0.0.1"],
      ["127.0.0.1", "::"],
      ["127.0.0.1", "0.0.0.0"],
      ["0:0:0:0:0:0:0:1", "::1"],
    ];
    for (const [a, b] of overlapping) assert.equal(await hostsOverlap(a, b), true, `${a} / ${b}`);
    assert.equal(await hostsOverlap("127.0.0.1", "::1"), false, "distinct addresses do not overlap");
  });

  void it("APR-23: each spelling on the main listener's port is refused before binding", async () => {
    const main = { host: "127.0.0.1", port: 3456 };
    const cases: [string, { host: string; port: number }][] = [
      ["LOCALHOST", main],
      ["localhost", main],
      ["::ffff:127.0.0.1", main],
      ["0.0.0.0", main],
      ["::", main],
      ["127.0.0.1", { host: "::", port: 3456 }],
      ["127.0.0.1", { host: "0.0.0.0", port: 3456 }],
    ];
    for (const [host, m] of cases) {
      const service = new ApprovalService({ settings: settings({ host, port: 3456 }), notifier: new MemoryNotifier(), clock: () => 0, audit: () => undefined, listens: true });
      // A listener that does start is closed before the assertion fails, so the failure is the assertion's.
      const started = await startApprovalListener(service, m).then(
        (l) => l,
        (err: unknown) => err,
      );
      if (!(started instanceof ApprovalListenerError)) {
        if (typeof started === "object" && started !== null && "close" in started) await (started as { close: () => Promise<void> }).close();
        assert.fail(`${host} against ${m.host}: started, or failed otherwise (${started instanceof Error ? started.message : "listening"})`);
      }
    }
    pastes.push(`L3 refused before binding: ${cases.map(([h, m]) => `${h} vs main ${m.host}`).join("; ")}`);
  });
});

void describe("CSR-WO-2001 red team Info (a8-pending-ids): another principal's id is not confirmed to exist (APR-24)", () => {
  void it("APR-24: another principal's id answers unknown, as a made-up id does; the row keeps wrong-principal; the grant still redeems", async () => {
    const r = await rig();
    try {
      const id = approvalOf(await r.call("alice", "deploy", "prod")).requestId ?? "";
      const theirs = await r.call("mallory", "deploy", "prod", id);
      const madeUp = await r.call("mallory", "deploy", "prod", "0123456789abcdef01234567");
      assert.equal(approvalOf(theirs).status, "unknown");
      assert.equal(approvalOf(madeUp).status, "unknown");
      const text = (reply: typeof theirs): string => ((reply.json as { result: { content: { text: string }[] } }).result.content[0] as { text: string }).text;
      assert.equal(text(theirs).replace(id, "<id>"), text(madeUp).replace("0123456789abcdef01234567", "<id>"), "the two answers differ only in the id the caller sent");
      assert.deepEqual(r.of("approval-refused").filter((f) => f["principal"] === "mallory").map((f) => f["kind"]), ["wrong-principal", "unknown"], "the audit row says why");
      const n = r.notifier.sent[0];
      assert.ok(n !== undefined);
      assert.equal((await r.listener("POST", `/approval/link/${tokenOf(n.link)}`, { body: { code: n.code, decision: "approve" } })).status, 200);
      assert.ok(ran(await r.call("alice", "deploy", "prod", id)), "the requester's grant was not consumed");
      pastes.push(`INFO another principal's id → ${text(theirs)}`);
    } finally {
      await r.close();
    }
  });
});

void describe("CSR-WO-2001 red team gaps: the table at its default cap (APR-12)", () => {
  void it("at the default 1,000 pending requests the table is full and one more is refused, notifying nobody", () => {
    let n = 0;
    const events: string[] = [];
    const b = new ApprovalBook({ requestTtlMs: 600_000, grantTtlMs: 300_000, maxPending: DEFAULT_APPROVAL.maxPending, maxPendingPerPrincipal: DEFAULT_APPROVAL.maxPendingPerPrincipal, clock: () => 1_000, onEvent: (e) => events.push(e), secrets: { id: () => `req-${String(++n)}`, linkToken: () => `link-${String(n)}`, code: () => "CODE0000" } });
    for (let i = 0; i < DEFAULT_APPROVAL.maxPending; i++) {
      const o = b.open({ ...bookCall(`p${String(Math.floor(i / 3))}`), digest: `d${String(i)}` });
      assert.equal(o.kind, "pending");
    }
    assert.equal(b.size, DEFAULT_APPROVAL.maxPending);
    assert.deepEqual(b.open({ ...bookCall("newcomer"), digest: "new" }), { kind: "refused", reason: "too-many" });
    assert.equal(b.size, DEFAULT_APPROVAL.maxPending, "the table never exceeds its cap");
    assert.equal(events.filter((e) => e === "approval-requested").length, DEFAULT_APPROVAL.maxPending);
  });
});
