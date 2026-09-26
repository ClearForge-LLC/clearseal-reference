// CSR-WO-0101 §3: what must be proven locally. The probe is the measurement; these tests pin its
// claims so they go red if the harness changes under them.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { canonicalCode, GrantStore } from "../grants.ts";
import { runProbe } from "../probe.ts";
import { MIN_BEARER_LENGTH, StartRefused, startSpike } from "../server.ts";

void describe("the grant store (architecture §5 Approval binding)", () => {
  void it("a code redeems once; the second use is refused", () => {
    const g = new GrantStore(120_000);
    const { code } = g.issue("p", "approve_via_grant", { action: "a" });
    assert.equal(g.redeem(code, "p", "approve_via_grant", { action: "a" }).ok, true);
    assert.deepEqual(g.redeem(code, "p", "approve_via_grant", { action: "a" }), { ok: false, reason: "unknown-or-used" });
    g.close();
  });

  void it("an expired code is refused, and the sweep deletes it (no grant survives its expiry)", () => {
    let now = 1_000;
    const g = new GrantStore(120_000, () => now, 60_000);
    const a = g.issue("p", "t", { action: "a" });
    g.issue("p", "t", { action: "b" });
    now += 120_000;
    assert.equal(g.sweep(), 2);
    assert.equal(g.size(), 0, "no grant survives its expiry");
    now += 60_000;
    assert.deepEqual(g.redeem(a.code, "p", "t", { action: "a" }), { ok: false, reason: "expired" }, "a late redemption still reports expired (tombstone, no authority)");
    g.close();
  });

  void it("a code is bound to principal, tool and arguments, and a mismatch burns it", () => {
    const g = new GrantStore(120_000);
    const c1 = g.issue("p", "t", { action: "a" }).code;
    assert.deepEqual(g.redeem(c1, "p", "t", { action: "b" }), { ok: false, reason: "bound-elsewhere" });
    assert.deepEqual(g.redeem(c1, "p", "t", { action: "a" }), { ok: false, reason: "unknown-or-used" });
    const c2 = g.issue("p", "t", { action: "a" }).code;
    assert.deepEqual(g.redeem(c2, "q", "t", { action: "a" }), { ok: false, reason: "bound-elsewhere" });
    const c3 = g.issue("p", "t", { action: "a" }).code;
    assert.deepEqual(g.redeem(c3, "p", "u", { action: "a" }), { ok: false, reason: "bound-elsewhere" });
    g.close();
  });

  void it("codes match in canonical ASCII only: lower case and Crockford aliases accepted, non-ASCII look-alikes refused", () => {
    const g = new GrantStore(120_000);
    const c = g.issue("p", "t", {}).code;
    assert.equal(g.redeem(c.toLowerCase(), "p", "t", {}).ok, true);
    const d = g.issue("p", "t", {}).code;
    const lookalike = d.replace(/S/g, "\u017f");
    if (lookalike !== d) assert.equal(g.redeem(lookalike, "p", "t", {}).ok, false);
    assert.equal(canonicalCode("oOiIl-LlIoO"), "00111-11100");
    assert.equal(canonicalCode("ABCDE12345"), undefined);
    g.close();
  });

  void it("codes are 10 characters of Crockford base32, readable aloud", () => {
    const g = new GrantStore(1000);
    assert.match(g.issue("p", "t", {}).code, /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    g.close();
  });
});

void describe("the bearer, by name only (N8)", () => {
  void it("refuses to start without the bearer, or with a short one (WO §5.3)", async () => {
    await assert.rejects(startSpike({ bearer: undefined }), StartRefused);
    await assert.rejects(startSpike({ bearer: "x".repeat(MIN_BEARER_LENGTH - 1) }), StartRefused);
    await assert.rejects(startSpike({ bearer: " ".repeat(MIN_BEARER_LENGTH) }), StartRefused, "a bearer the client cannot send is refused");
  });

  void it("refuses to widen Host/Origin on an ephemeral port", async () => {
    await assert.rejects(startSpike({ bearer: randomBytes(32).toString("base64url"), extraHosts: ["h.example"] }), StartRefused);
  });
});

void describe("the probe's local half (WO §3.2, §3.3, §3.4, §5.1)", () => {
  void it("every row the report states holds", async () => {
    const r = await runProbe({ grantTtlMs: 300 });
    const ex = (label: string): { status: number; response: unknown } => {
      const e = r.exchanges.find((x) => x.label.startsWith(label));
      assert.ok(e, label);
      return e;
    };
    const text = (label: string): string => ((ex(label).response as { result?: { content?: { text?: string }[] } }).result?.content?.[0]?.text ?? "");
    assert.equal(ex("no bearer").status, 401);
    assert.equal(ex("wrong bearer").status, 401);
    assert.match(text("mrtr: retry with accept + approve:true"), /^APPROVED via mrtr/);
    assert.match(text("mrtr: retry with decline"), /^REFUSED via mrtr/);
    assert.match(text("mrtr: retry with accept but approve:false"), /^REFUSED via mrtr/);
    assert.equal(ex("mrtr: client does NOT declare elicitation").status, 400);
    assert.equal(ex("mrtr: state from one action replayed").status, 400);
    assert.deepEqual([ex("legacy mrtr call").status, (ex("legacy mrtr call").response as { error?: { code?: number } }).error?.code], [200, -32601]);
    assert.match(text("task (modern)"), /^NOT OFFERED/);
    assert.equal(ex("tasks/get").status, 404);
    assert.match(text("grant: issue (modern)"), /^PENDING via grant/);
    assert.ok(!JSON.stringify(ex("grant: issue (modern)").response).match(/[0-9A-Z]{5}-[0-9A-Z]{5}/), "the code is never in the reply");
    assert.match(text("grant: redeem with the logged code"), /^APPROVED via grant/);
    assert.match(text("grant: redeem the same code again"), /^REFUSED via grant: the code is unknown or already used/);
    assert.match(text("grant: redeem for a different action"), /^REFUSED via grant: the code is not for this call/);
    assert.match(text("grant: redeem after the TTL"), /^REFUSED via grant: the code is expired/);
    assert.match(text("grant: redeem (legacy)"), /^APPROVED via grant/);
    assert.match(text("mrtr: the SAME state after the decline"), /^APPROVED via mrtr/, "measured: the state is not single-use (a finding for -2001)");
    assert.ok(!JSON.stringify(r).match(/"code":"(?!XXXXX-XXXXX)[0-9A-Z]{5}-[0-9A-Z]{5}"/), "codes are masked in the report");
  });
});
