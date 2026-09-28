// CSR-WO-2001 §3.2: the call side of approval, each documented case over a running transport and its
// approval listener (approval/RULES.md APR-1…APR-6, APR-10, APR-11, APR-13, APR-15). Every handler
// records its entries, so "never reaches its handler" is observed, not assumed (N4). The last test is
// the canary: no link token or code any rig issued appears in any audit row or response it saw.

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { approvalOf, ran, rig, seen } from "./harness.ts";

const pastes: string[] = [];
after(() => {
  console.log(pastes.join("\n"));
});

/** Approves a request through the confirm-URL, as the human the notifier reached. */
async function approveByLink(r: Awaited<ReturnType<typeof rig>>, index: number, decision: "approve" | "decline" = "approve"): Promise<number> {
  const n = r.notifier.sent[index];
  assert.ok(n !== undefined, `notification ${String(index)} was sent`);
  const res = await r.listener("POST", `/approval/link/${n.link.split("/").pop() ?? ""}`, { body: { code: n.code, decision } });
  return res.status;
}

void describe("CSR-WO-2001 approval: a grant for one call, once", () => {
  void it("APR-1: an approval-requiring call with no grant answers pending, and its handler is never entered", async () => {
    const r = await rig();
    try {
      const reply = await r.call("alice", "deploy", "prod");
      const a = approvalOf(reply);
      assert.equal(reply.status, 200);
      assert.equal(a.status, "pending");
      assert.match(a.requestId ?? "", /^[0-9a-f]{24}$/);
      assert.equal((reply.json as { result: { isError: boolean } }).result.isError, true);
      assert.deepEqual(r.entered, [], "the handler recorded no entry");
      assert.equal(r.of("approval-requested").length, 1);
      assert.equal(r.notifier.sent.length, 1, "the approver was notified");
      pastes.push(`APPROVAL no grant → ${String(reply.status)} ${JSON.stringify((reply.json as { result: unknown }).result)}; handler entries: ${String(r.entered.length)}`);
    } finally {
      await r.close();
    }
  });

  void it("APR-3: approved, then re-invoked → runs once; re-invoked again → used", async () => {
    const r = await rig();
    try {
      const id = approvalOf(await r.call("alice", "deploy", "prod")).requestId;
      assert.equal(await approveByLink(r, 0), 200);
      const first = await r.call("alice", "deploy", "prod", id);
      assert.ok(ran(first), first.text);
      const second = await r.call("alice", "deploy", "prod", id);
      assert.equal(approvalOf(second).status, "used");
      assert.deepEqual(r.entered, ["deploy prod"], "exactly one entry");
      assert.deepEqual(r.of("approval-redeemed").map((f) => f["approver"]), ["operator"], "the approver is recorded on the redemption (B2)");
      pastes.push(`APPROVAL approved, re-invoked → ran; again → ${String(approvalOf(second).status)}; handler entries: ${JSON.stringify(r.entered)}`);
    } finally {
      await r.close();
    }
  });

  void it("APR-4: declined, then the same request approved → refused; the call answers declined", async () => {
    const r = await rig();
    try {
      const id = approvalOf(await r.call("alice", "deploy", "prod")).requestId ?? "";
      assert.equal(await approveByLink(r, 0, "decline"), 200);
      const later = await r.listener("POST", `/approval/requests/${id}`, { bearer: "approver:bob", body: { decision: "approve" } });
      assert.equal(later.status, 409);
      assert.deepEqual(later.json, { error: "declined" });
      const call = await r.call("alice", "deploy", "prod", id);
      assert.equal(approvalOf(call).status, "declined");
      assert.deepEqual(r.entered, []);
      pastes.push(`APPROVAL declined, then approved → ${String(later.status)} ${later.text}; the call → ${String(approvalOf(call).status)}`);
    } finally {
      await r.close();
    }
  });

  void it("APR-2: a grant redeemed by another principal, for another tool, with other arguments, after expiry, or with an unknown id → each refused by name", async () => {
    const r = await rig({ settings: { grantTtlSeconds: 60 } });
    try {
      const id = approvalOf(await r.call("alice", "deploy", "prod")).requestId;
      assert.equal(await approveByLink(r, 0), 200);
      const refusals: [string, () => Promise<unknown>][] = [
        ["wrong-principal", () => r.call("mallory", "deploy", "prod", id)],
        ["wrong-tool", () => r.call("alice", "publish", "prod", id)],
        ["wrong-arguments", () => r.call("alice", "deploy", "staging", id)],
        ["unknown", () => r.call("alice", "deploy", "prod", "0123456789abcdef01234567")],
        ["unknown", () => r.call("alice", "deploy", "prod", { requestId: 7 })],
      ];
      for (const [kind, attempt] of refusals) {
        const reply = (await attempt()) as Parameters<typeof approvalOf>[0];
        assert.equal(approvalOf(reply).status, kind, reply.text);
        pastes.push(`APPROVAL ${kind}: ${((reply.json as { result: { content: { text: string }[] } }).result.content[0] as { text: string }).text}`);
      }
      assert.deepEqual(r.entered, [], "no refused attempt ran, and none consumed the grant");
      r.clock.advance(60_000);
      const late = await r.call("alice", "deploy", "prod", id);
      assert.equal(approvalOf(late).status, "expired");
      assert.deepEqual(r.entered, []);
      assert.equal(r.of("approval-expired").length, 1);
      pastes.push(`APPROVAL expired: ${String(approvalOf(late).status)}`);
      assert.deepEqual(r.of("approval-refused").map((f) => f["kind"]), ["wrong-principal", "wrong-tool", "wrong-arguments", "unknown", "unknown", "expired"], "each refusal audited by kind");
    } finally {
      await r.close();
    }
  });

  void it("APR-2: the refused attempts consumed nothing: the right call still redeems", async () => {
    const r = await rig();
    try {
      const id = approvalOf(await r.call("alice", "deploy", "prod")).requestId;
      assert.equal(await approveByLink(r, 0), 200);
      await r.call("mallory", "deploy", "prod", id);
      await r.call("alice", "deploy", "staging", id);
      assert.ok(ran(await r.call("alice", "deploy", "prod", id)));
    } finally {
      await r.close();
    }
  });

  void it("APR-5: an approver that is the requester is refused and audited, on both paths", async () => {
    const r = await rig();
    try {
      // The confirm-URL's approver is the operator: the operator calling the tool cannot approve it.
      const human = approvalOf(await r.call("operator", "deploy", "prod")).requestId ?? "";
      const byLink = await approveByLink(r, 0);
      assert.equal(byLink, 403);
      // A delegated approver whose token names the requester.
      const delegatedId = approvalOf(await r.call("carol", "deploy", "prod")).requestId ?? "";
      const byToken = await r.listener("POST", `/approval/requests/${delegatedId}`, { bearer: "approver:carol", body: { decision: "approve" } });
      assert.equal(byToken.status, 403);
      assert.deepEqual(byToken.json, { error: "self-approval" });
      assert.equal(approvalOf(await r.call("operator", "deploy", "prod", human)).status, "pending");
      assert.equal(approvalOf(await r.call("carol", "deploy", "prod", delegatedId)).status, "pending");
      assert.deepEqual(r.entered, []);
      const refused = r.of("approval-decision-refused").filter((f) => f["kind"] === "self-approval");
      assert.deepEqual(refused.map((f) => `${String(f["principal"])} by ${String(f["approver"])} via ${String(f["via"])}`), ["operator by operator via human", "carol by carol via delegated"]);
      pastes.push(`APPROVAL self-approval: confirm-URL → ${String(byLink)}; delegated → ${String(byToken.status)} ${byToken.text}; rows ${JSON.stringify(refused)}`);
    } finally {
      await r.close();
    }
  });

  void it("APR-6: an approval that discharges Rule-of-Two is refused to a delegated approver and granted through the confirm-URL", async () => {
    const r = await rig();
    try {
      const id = approvalOf(await r.call("alice", "publish", "post-1")).requestId ?? "";
      const delegated = await r.listener("POST", `/approval/requests/${id}`, { bearer: "approver:bob", body: { decision: "approve" } });
      assert.equal(delegated.status, 403);
      assert.deepEqual(delegated.json, { error: "human-required" });
      assert.equal(approvalOf(await r.call("alice", "publish", "post-1", id)).status, "pending", "the delegated decision decided nothing");
      assert.equal(await approveByLink(r, 0), 200);
      assert.ok(ran(await r.call("alice", "publish", "post-1", id)));
      // The same approver may decide a CAP-7-only approval.
      const deployId = approvalOf(await r.call("alice", "deploy", "prod")).requestId ?? "";
      const ok = await r.listener("POST", `/approval/requests/${deployId}`, { bearer: "approver:bob", body: { decision: "approve" } });
      assert.equal(ok.status, 200);
      assert.ok(ran(await r.call("alice", "deploy", "prod", deployId)));
      assert.equal(r.of("approval-decision-refused").filter((f) => f["kind"] === "human-required").length, 1, "the refusal is audited");
      pastes.push(`APPROVAL Rule-of-Two: a delegated approval of publish (untrusted-facing state_change, no containment) → ${String(delegated.status)} ${delegated.text}; through the confirm-URL → ran; a delegated approval of deploy (CAP-7 only) → ${String(ok.status)}, ran`);
    } finally {
      await r.close();
    }
  });
});

void describe("CSR-WO-2001 approval: the exact call (review M1, M2, L3)", () => {
  void it("APR-2 (review M1): a grant covers the call's input responses too: other input responses → wrong-arguments; the approver sees them", async () => {
    const r = await rig();
    try {
      const asked = { confirm: { action: "accept", content: { scope: "one host" } } };
      const id = approvalOf(await r.call("alice", "deploy", "prod", undefined, { inputResponses: asked })).requestId ?? "";
      const n = r.notifier.sent[0];
      assert.ok(n !== undefined);
      const shown = await r.listener("GET", `/approval/link/${n.link.split("/").pop() ?? ""}`);
      assert.match(shown.text, /one host/, "the approver reads the input responses");
      assert.equal(await approveByLink(r, 0), 200);
      const swapped = await r.call("alice", "deploy", "prod", id, { inputResponses: { confirm: { action: "accept", content: { scope: "every host" } } } });
      assert.equal(approvalOf(swapped).status, "wrong-arguments");
      assert.deepEqual(r.entered, []);
      assert.ok(ran(await r.call("alice", "deploy", "prod", id, { inputResponses: asked })));
      pastes.push(`APPROVAL exact call: approved with one host, redeemed with every host → ${String(approvalOf(swapped).status)}; with the input responses approved → ran`);
    } finally {
      await r.close();
    }
  });

  void it("APR-17 (review M2): a call too large to show an approver whole is refused approval, never shown cut", async () => {
    const r = await rig();
    try {
      const reply = await r.call("alice", "deploy", "x".repeat(17_000));
      assert.equal(approvalOf(reply).status, "too-large");
      assert.equal(r.notifier.sent.length, 0, "no approver was asked about something they could not read whole");
      assert.deepEqual(r.entered, []);
      assert.ok(approvalOf(await r.call("alice", "deploy", "x".repeat(15_000))).status === "pending", "one that fits is asked");
      pastes.push(`APPROVAL a 17 KB call → ${String(approvalOf(reply).status)}, nobody notified; a 15 KB call → pending`);
    } finally {
      await r.close();
    }
  });

  void it("review L3: a refusal of the call's own form comes before the gate and never spends a grant", async () => {
    const r = await rig();
    try {
      const id = approvalOf(await r.call("alice", "deploy", "prod")).requestId;
      assert.equal(await approveByLink(r, 0), 200);
      const malformed = await r.call("alice", "deploy", "prod", id, { requestState: "not a request state" });
      assert.notEqual(malformed.status, 200, malformed.text);
      assert.deepEqual(r.entered, []);
      assert.ok(ran(await r.call("alice", "deploy", "prod", id)), "the grant was not spent by the refused call");
    } finally {
      await r.close();
    }
  });
});

void describe("CSR-WO-2001 approval: the bounded wait and the notification cap", () => {
  void it("review L5: a request that expires during the bounded wait answers expired, not pending", async () => {
    const r = await rig({ settings: { waitSeconds: 1, requestTtlSeconds: 2 } });
    try {
      const pending = r.call("alice", "deploy", "prod");
      for (let i = 0; i < 50 && r.service.book.size === 0; i++) await new Promise((res) => setTimeout(res, 10));
      r.clock.advance(2_000);
      assert.equal(approvalOf(await pending).status, "expired");
      assert.deepEqual(r.entered, []);
    } finally {
      await r.close();
    }
  });

  void it("APR-13: a decision inside the bounded wait runs in one call; none answers pending at the limit", async () => {
    const r = await rig({ settings: { waitSeconds: 1 } });
    try {
      const pending = r.call("alice", "deploy", "prod");
      // The delegated approver decides while the call waits.
      for (let i = 0; i < 50 && r.service.book.size === 0; i++) await new Promise((res) => setTimeout(res, 10));
      const id = r.service.book.describeLink(r.notifier.sent[0]?.link.split("/").pop() ?? "");
      assert.ok(!("kind" in id), "the request exists");
      assert.equal((await r.listener("POST", `/approval/requests/${id.requestId}`, { bearer: "approver:bob", body: { decision: "approve" } })).status, 200);
      const reply = await pending;
      assert.ok(ran(reply), reply.text);
      assert.deepEqual(r.entered, ["deploy prod"]);
      const started = Date.now();
      const none = await r.call("alice", "deploy", "staging");
      const waited = Date.now() - started;
      assert.equal(approvalOf(none).status, "pending");
      assert.ok(waited >= 900 && waited < 5_000, `waited ${String(waited)} ms`);
      pastes.push(`APPROVAL bounded wait 1 s: approved inside it → ran in one call; no decision → pending after ${String(Math.round(waited / 100) / 10)} s`);
    } finally {
      await r.close();
    }
  });

  void it("APR-11: notifications per principal are capped, and a repeat of a pending request notifies nothing", async () => {
    const r = await rig({ settings: { maxPendingPerPrincipal: 3 } });
    try {
      for (const target of ["a", "b", "c"]) assert.equal(approvalOf(await r.call("alice", "deploy", target)).status, "pending");
      const repeat = await r.call("alice", "deploy", "a");
      assert.equal(approvalOf(repeat).status, "pending");
      const fourth = await r.call("alice", "deploy", "d");
      assert.equal(approvalOf(fourth).status, "too-many");
      assert.equal(r.notifier.sent.length, 3, "three notifications: the repeat and the fourth sent none");
      assert.equal(approvalOf(await r.call("bob", "deploy", "a")).status, "pending", "another principal's own cap");
      assert.equal(r.notifier.sent.length, 4);
      pastes.push(`APPROVAL notification cap 3: three requests notified, a repeat → pending (not notified), a fourth → ${String(approvalOf(fourth).status)} (not notified); bob → pending (notified)`);
    } finally {
      await r.close();
    }
  });
});

void describe("CSR-WO-2001 approval: the canary (APR-10)", () => {
  void it("no link token or code any rig issued appears in any audit row or any response, to the caller or from the listener", () => {
    const secrets = seen.secrets.filter((s) => s.length >= 8);
    assert.ok(secrets.length >= 10, `the suite issued secrets to look for (${String(secrets.length)})`);
    assert.ok(seen.texts.length > 50, "and saw rows and responses to look in");
    for (const s of secrets) for (const text of seen.texts) assert.ok(!text.includes(s), `a link token or code reached: ${text.slice(0, 120)}`);
    pastes.push(`APPROVAL canary: ${String(secrets.length)} link tokens and codes issued; ${String(seen.texts.length)} audit rows and responses scanned; none carries one`);
  });
});
