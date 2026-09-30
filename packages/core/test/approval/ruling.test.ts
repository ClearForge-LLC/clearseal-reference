// CSR-WO-2001: the architect's ruling on the approval listener's rate limit (2026-09-30;
// approval/RULES.md APR-25…APR-29). R1 trusted proxies, R2 a valid approver never throttled by an
// address, R3 the per-link wrong-code cap under R2, R4 IPv6 keyed by /64, R5 the backslash escaped.

import assert from "node:assert/strict";
import { after, describe, it, mock } from "node:test";

import { addressKey, clientAddress, TrustedProxies } from "../../src/approval/address.ts";
import { ApprovalBook, type Call, MAX_WRONG_CODES } from "../../src/approval/book.ts";
import { startApprovalListener } from "../../src/approval/listener.ts";
import { MemoryNotifier, StderrNotifier } from "../../src/approval/notifier.ts";
import { ApprovalService } from "../../src/approval/service.ts";
import { ApprovalConfigError, approvalFromEnv, type ApprovalSettings, DEFAULT_APPROVAL } from "../../src/approval/settings.ts";
import { visible } from "../../src/approval/visible.ts";
import { ApproverVerifier } from "./harness.ts";

const pastes: string[] = [];
after(() => {
  console.log(pastes.join("\n"));
});

type Row = { event: string; fields: Record<string, string | number> };

interface ListenerRig {
  service: ApprovalService;
  rows: Row[];
  url: string;
  addresses: () => number;
  open: (principal: string, tool?: string) => { id: string; link: string; code: string };
  get: (path: string, headers?: Record<string, string>) => Promise<number>;
  post: (path: string, body: unknown, headers?: Record<string, string>) => Promise<number>;
  close: () => Promise<void>;
}

async function listenerRig(over: Partial<ApprovalSettings> = {}): Promise<ListenerRig> {
  const rows: Row[] = [];
  const settings: ApprovalSettings = { ...DEFAULT_APPROVAL, backend: "listener", host: "127.0.0.1", port: 0, ...over };
  const service = new ApprovalService({ settings, notifier: new MemoryNotifier(), clock: () => 1_000, audit: (event, fields) => rows.push({ event, fields }), listens: true, delegatedVerifier: new ApproverVerifier() });
  const l = await startApprovalListener(service, { host: "127.0.0.1", port: 1 });
  let n = 0;
  const open = (principal: string, tool = "deploy"): { id: string; link: string; code: string } => {
    const call: Call = { principal, tool, digest: `d${String(++n)}`, auditDigest: "hmac-sha256:k:x", humanOnly: false, argumentsJson: "{}" };
    const o = service.book.open(call);
    if (o.kind !== "pending" || o.secret === undefined) throw new Error("not opened");
    return { id: o.id, link: o.secret.linkToken, code: o.secret.code };
  };
  const get = async (path: string, headers: Record<string, string> = {}): Promise<number> => {
    const res = await fetch(`${l.url}${path}`, { headers });
    await res.body?.cancel();
    return res.status;
  };
  const post = async (path: string, body: unknown, headers: Record<string, string> = {}): Promise<number> => {
    const res = await fetch(`${l.url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    await res.body?.cancel();
    return res.status;
  };
  return { service, rows, url: l.url, addresses: () => l.addresses(), open, get, post, close: () => l.close() };
}

/** A request with no credential, which fails authentication: charged to its address. */
const junk = (r: ListenerRig, xff?: string): Promise<number> => r.get("/approval/requests/nothing", xff === undefined ? {} : { "x-forwarded-for": xff });

void describe("CSR-WO-2001 ruling R1: X-Forwarded-For only from a trusted proxy (APR-25)", () => {
  void it("APR-25: the attribution rules, as a function", () => {
    const none = new TrustedProxies([]);
    const proxy = new TrustedProxies(["127.0.0.1", "127.0.0.3/32"]);
    assert.equal(clientAddress("127.0.0.1", ["127.0.0.5"], none), "127.0.0.1", "no proxy named: the header is never read");
    assert.equal(clientAddress("127.0.0.2", ["127.0.0.5"], proxy), "127.0.0.2", "a peer not in the list: ignored entirely");
    assert.equal(clientAddress("127.0.0.1", ["127.0.0.5"], proxy), "127.0.0.5", "a trusted peer: its client");
    assert.equal(clientAddress("::ffff:127.0.0.1", ["127.0.0.5"], proxy), "127.0.0.5", "the peer in any form");
    assert.equal(clientAddress("127.0.0.1", ["127.0.0.9, 127.0.0.8, 127.0.0.5"], proxy), "127.0.0.5", "entries the client wrote on the left are ignored");
    assert.equal(clientAddress("127.0.0.1", ["127.0.0.5, 127.0.0.3"], proxy), "127.0.0.5", "a chain of trusted proxies is walked from the right");
    assert.equal(clientAddress("127.0.0.1", ["127.0.0.5", "127.0.0.3"], proxy), "127.0.0.5", "repeated headers are one list");
    assert.equal(clientAddress("127.0.0.1", ["127.0.0.3"], proxy), "127.0.0.1", "only trusted proxies: the peer");
    for (const bad of ["garbage", "127.0.0.5:8080", "127.0.0.5,", "", "127.0.0.9, not-an-address"]) assert.equal(clientAddress("127.0.0.1", [bad], proxy), "127.0.0.1", `malformed ${JSON.stringify(bad)}: the peer`);
    assert.equal(clientAddress("127.0.0.1", undefined, proxy), "127.0.0.1", "no header: the peer");
  });

  void it("APR-25: from a peer not in the list, a spoofed header is ignored: every request shares the peer's budget", async () => {
    const r = await listenerRig({ listenerRateBurst: 1, trustedProxies: ["127.0.0.2"] });
    try {
      assert.equal(await junk(r, "127.0.0.5"), 401);
      assert.equal(await junk(r, "127.0.0.6"), 429, "another spoofed address is the same peer");
      assert.equal(r.addresses(), 1);
    } finally {
      await r.close();
    }
  });

  void it("APR-25: behind a trusted proxy, each client has its own budget, keyed on the rightmost untrusted entry", async () => {
    const r = await listenerRig({ listenerRateBurst: 1, trustedProxies: ["127.0.0.1"] });
    try {
      assert.equal(await junk(r, "127.0.0.5"), 401);
      assert.equal(await junk(r, "127.0.0.6"), 401, "another client behind the proxy: its own budget");
      assert.equal(await junk(r, "127.0.0.5"), 429, "the first client's budget is spent");
      assert.equal(await junk(r, "127.0.0.200, 127.0.0.5"), 429, "a left entry the client wrote does not buy a new budget");
      assert.equal(await junk(r, "garbage"), 401, "malformed: the proxy's own budget");
      assert.equal(await junk(r, "127.0.0.5:80"), 429, "malformed again: the same shared budget, never the client's choice");
      pastes.push("R1 behind trusted 127.0.0.1: 127.0.0.5 → 401; 127.0.0.6 → 401; 127.0.0.5 → 429; \"127.0.0.200, 127.0.0.5\" → 429; garbage → 401 (the proxy's budget); 127.0.0.5:80 → 429");
    } finally {
      await r.close();
    }
  });

  void it("APR-25: APPROVAL_TRUSTED_PROXIES is validated in the snapshot", () => {
    assert.deepEqual(approvalFromEnv({}).trustedProxies, []);
    assert.deepEqual(approvalFromEnv({ APPROVAL_TRUSTED_PROXIES: "127.0.0.1,::1, 2001:DB8::/48" }).trustedProxies, ["127.0.0.1", "::1", "2001:db8::/48"]);
    for (const bad of ["proxy.example", "127.0.0.1/33", "::1/129", "127.0.0.1,,::1", "127.0.0.1/8/8", "::1%lo"]) assert.throws(() => approvalFromEnv({ APPROVAL_TRUSTED_PROXIES: bad }), (err: unknown) => err instanceof ApprovalConfigError && err.message.startsWith("APPROVAL_TRUSTED_PROXIES"), bad);
  });
});

void describe("CSR-WO-2001 ruling R2: a valid approver is never throttled by an address (APR-26)", () => {
  void it("APR-26: an attacker on the approver's address empties its budget; the delegated approver and a confirm-URL human each still decide; the attacker stays 429", async () => {
    const r = await listenerRig();
    try {
      const forDelegated = r.open("alice");
      const forHuman = r.open("carol");
      let served = 0;
      for (let i = 0; i < DEFAULT_APPROVAL.listenerRateBurst + 20; i++) if ((await r.get(`/approval/requests/${forDelegated.id}`, { authorization: "Bearer forged" })) !== 429) served++;
      assert.equal(served, DEFAULT_APPROVAL.listenerRateBurst, "the attacker's budget is spent");
      const bearer = { authorization: "Bearer approver:bob" };
      const statuses = {
        delegatedReads: await r.get(`/approval/requests/${forDelegated.id}`, bearer),
        delegatedDecides: await r.post(`/approval/requests/${forDelegated.id}`, { decision: "approve" }, bearer),
        humanReads: await r.get(`/approval/link/${forHuman.link}`),
        humanDecides: await r.post(`/approval/link/${forHuman.link}`, { code: forHuman.code, decision: "approve" }),
        attackerBearer: await r.get(`/approval/requests/${forDelegated.id}`, { authorization: "Bearer forged" }),
        attackerNoCredential: await r.get("/approval/requests/nothing"),
        attackerLink: await r.post("/approval/link/guessed-link", { code: "AAAAAAAA", decision: "approve" }),
      };
      assert.deepEqual(statuses, { delegatedReads: 200, delegatedDecides: 200, humanReads: 200, humanDecides: 200, attackerBearer: 429, attackerNoCredential: 429, attackerLink: 429 });
      assert.equal(r.service.book.stateOf(forDelegated.id), "approved");
      assert.equal(r.service.book.stateOf(forHuman.id), "approved");
      pastes.push(`R2 with the address budget empty: ${JSON.stringify(statuses)}`);
    } finally {
      await r.close();
    }
  });

  void it("APR-26: with the address budget empty, a spent link is counted, never a row each", async () => {
    const r = await listenerRig({ listenerRateBurst: 3 });
    try {
      const a = r.open("alice");
      for (let i = 0; i < MAX_WRONG_CODES; i++) await r.post(`/approval/link/${a.link}`, { code: "WRONG000", decision: "approve" });
      const rowsBefore = r.rows.length;
      const statuses = new Set<number>();
      for (let i = 0; i < 200; i++) statuses.add(await r.post(`/approval/link/${a.link}`, { code: "WRONG000", decision: "approve" }));
      assert.deepEqual([...statuses], [429]);
      assert.equal(r.rows.length, rowsBefore, "no row written while the budget is empty");
      await r.close();
      const counted = r.rows.filter((row) => row.event === "approval-unauthenticated-burst").map((row) => row.fields["count"]);
      assert.ok(Number(counted[0] ?? 0) >= 190, `counted in one row: ${JSON.stringify(counted)}`);
    } finally {
      await r.close();
    }
  });

  void it("APR-26: the confirm-URL's budget is per request: a leaked link's reads never stop the human deciding another request", async () => {
    const r = await listenerRig({ listenerRateBurst: 5 });
    try {
      const leaked = r.open("alice");
      const other = r.open("carol");
      const reads: number[] = [];
      for (let i = 0; i < 8; i++) reads.push(await r.get(`/approval/link/${leaked.link}`));
      assert.deepEqual(reads, [200, 200, 200, 200, 200, 429, 429, 429], "the leaked link spends its own request's budget");
      assert.equal(await r.post(`/approval/link/${other.link}`, { code: other.code, decision: "approve" }), 200, "the human decides another request");
      assert.equal(r.service.book.stateOf(other.id), "approved");
    } finally {
      await r.close();
    }
  });

  void it("APR-26: a verified approver is charged to its own budget, not its address's", async () => {
    const r = await listenerRig({ listenerRateBurst: 2 });
    try {
      const a = r.open("alice");
      const bearer = { authorization: "Bearer approver:bob" };
      assert.deepEqual([await r.get(`/approval/requests/${a.id}`, bearer), await r.get(`/approval/requests/${a.id}`, bearer), await r.get(`/approval/requests/${a.id}`, bearer)], [200, 200, 429], "bob's own budget of two");
      assert.equal(await junk(r), 401, "the address budget was never charged by bob");
    } finally {
      await r.close();
    }
  });
});

void describe("CSR-WO-2001 ruling R3: the per-link wrong-code cap holds under R2 (APR-27, APR-8)", () => {
  void it("APR-27: five wrong codes burn the link in one terminal row; the sixth try, with the right code, is refused; the request stays pending", async () => {
    const r = await listenerRig();
    try {
      const a = r.open("alice");
      const wrong: number[] = [];
      for (let i = 0; i < MAX_WRONG_CODES; i++) wrong.push(await r.post(`/approval/link/${a.link}`, { code: "WRONG000", decision: "approve" }));
      const sixth = await r.post(`/approval/link/${a.link}`, { code: a.code, decision: "approve" });
      assert.deepEqual(wrong, [403, 403, 403, 403, 403]);
      assert.equal(sixth, 410, "the right code on a burned link is refused");
      assert.equal(r.service.book.stateOf(a.id), "pending", "the request stays pending until it expires");
      const burned = r.rows.filter((row) => row.fields["kind"] === "link-burned");
      assert.equal(burned.length, 2, "the burn, and the refused sixth try");
      assert.equal(burned[0]?.fields["request"], a.id, "the burn names its request");
      assert.equal(JSON.stringify(r.rows).includes(a.code), false, "no row carries the code");
      pastes.push(`R3 five wrong codes → ${wrong.join(", ")}; the right code after → ${String(sixth)}; request ${String(r.service.book.stateOf(a.id))}; burn row ${JSON.stringify(burned[0]?.fields)}`);
    } finally {
      await r.close();
    }
  });

  void it("APR-27: with the address budget empty (so R2 still checks every code), the fifth wrong code still burns the link", async () => {
    const r = await listenerRig({ listenerRateBurst: 3 });
    try {
      const a = r.open("alice");
      for (let i = 0; i < 3; i++) await junk(r);
      assert.equal(await junk(r), 429, "the address budget is empty");
      for (let i = 0; i < MAX_WRONG_CODES; i++) assert.equal(await r.post(`/approval/link/${a.link}`, { code: "WRONG000", decision: "approve" }), 429);
      assert.equal(await r.post(`/approval/link/${a.link}`, { code: a.code, decision: "approve" }), 429, "a burned link is a failure, and the budget is empty");
      assert.deepEqual(r.service.book.describeLink(a.link), { kind: "refused", reason: "link-burned" }, "the codes were checked, and the link burned");
      assert.equal(r.service.book.stateOf(a.id), "pending");
      assert.equal(r.rows.filter((row) => row.fields["kind"] === "wrong-code").length, MAX_WRONG_CODES);
    } finally {
      await r.close();
    }
  });
});

void describe("CSR-WO-2001 ruling R4: an IPv6 address is keyed by its /64 (APR-28)", () => {
  void it("APR-28: the key", () => {
    assert.equal(addressKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), "2001:db8:1:2::/64");
    assert.equal(addressKey("2001:DB8:1:2::1"), "2001:db8:1:2::/64");
    assert.equal(addressKey("2001:db8:1:3::1"), "2001:db8:1:3::/64", "another /64, another key");
    assert.equal(addressKey("::1"), "0:0:0:0::/64");
    assert.equal(addressKey("::ffff:127.0.0.5"), "127.0.0.5", "IPv4-mapped: keyed as IPv4");
    assert.equal(addressKey("127.0.0.5"), "127.0.0.5", "IPv4: the whole address");
    assert.notEqual(addressKey("127.0.0.5"), addressKey("127.0.0.6"));
  });

  void it("APR-28: 10,000 addresses from one /64 share one budget and one table entry", async () => {
    const r = await listenerRig({ trustedProxies: ["127.0.0.1"] });
    try {
      const counts = new Map<number, number>();
      for (let batch = 0; batch < 100; batch++) {
        const statuses = await Promise.all(Array.from({ length: 100 }, (_, i) => junk(r, `2001:db8:1:2:${(batch * 100 + i).toString(16)}:${i.toString(16)}:0:1`)));
        for (const s of statuses) counts.set(s, (counts.get(s) ?? 0) + 1);
      }
      assert.deepEqual(Object.fromEntries(counts), { 401: DEFAULT_APPROVAL.listenerRateBurst, 429: 10_000 - DEFAULT_APPROVAL.listenerRateBurst });
      assert.equal(r.addresses(), 1, "one entry for the whole /64");
      assert.equal(await junk(r, "2001:db8:1:3::1"), 401, "the next /64 has its own budget");
      pastes.push(`R4 10,000 addresses in 2001:db8:1:2::/64 → ${JSON.stringify(Object.fromEntries(counts))}; table entries 1`);
    } finally {
      await r.close();
    }
  });
});

void describe("CSR-WO-2001 ruling R5: every \\u{ in a view is the helper's own (APR-29)", () => {
  const lookalike = "dave\\u{202E}";

  void it("APR-29: a literal backslash is shown escaped, so a look-alike escape is told apart from a real one", () => {
    assert.equal(visible(lookalike), "dave\\u{005C}u{202E}");
    assert.equal(visible("dave\u202E"), "dave\\u{202E}");
    assert.notEqual(visible(lookalike), visible("dave\u202E"));
    pastes.push(`R5 literal ${lookalike} → ${visible(lookalike)}; a real U+202E → ${visible("dave\u202E")}`);
  });

  void it("APR-29: in the approver's view and in the notifier line", async () => {
    let n = 0;
    const b = new ApprovalBook({ requestTtlMs: 60_000, grantTtlMs: 60_000, maxPending: 10, maxPendingPerPrincipal: 3, clock: () => 1_000, onEvent: () => undefined, secrets: { id: () => `req-${String(++n)}`, linkToken: () => "link", code: () => "CODE0000" } });
    const o = b.open({ principal: lookalike, tool: "deploy", digest: "d", auditDigest: "hmac-sha256:k:x", humanOnly: false, argumentsJson: '{"arguments":{"target":"a\\\\u{202E}"}}' });
    const d = b.describe(o.kind === "pending" ? o.id : "");
    assert.equal(d?.requester, "dave\\u{005C}u{202E}");
    assert.equal(d?.arguments, '{"arguments":{"target":"a\\u{005C}\\u{005C}u{202E}"}}');
    const written: string[] = [];
    const write = mock.method(process.stderr, "write", (chunk: string | Uint8Array): boolean => {
      written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    });
    try {
      await new StderrNotifier().notify({ requestId: "req-1", tool: "deploy", requester: lookalike, link: "http://127.0.0.1:3031/approval/link/link", code: "CODE0000", humanOnly: false, expiresInSeconds: 600 });
    } finally {
      write.mock.restore();
    }
    assert.ok(written.join("").startsWith("[approval] dave\\u{005C}u{202E} asks to run deploy"));
  });
});
