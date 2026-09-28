// CSR-WO-2001 §1.6: the approval book's bounds (approval/RULES.md APR-12, APR-15), on a fake monotonic
// clock: a cap on requests in all, phases that end on time, and records dropped once neither their
// request nor their grant can matter.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApprovalBook, type Call } from "../../src/approval/book.ts";

function book(over: Partial<ConstructorParameters<typeof ApprovalBook>[0]> = {}): { b: ApprovalBook; events: string[]; advance: (ms: number) => void } {
  let t = 1_000;
  const events: string[] = [];
  let n = 0;
  const b = new ApprovalBook({
    requestTtlMs: 10_000,
    grantTtlMs: 5_000,
    maxPending: 3,
    maxPendingPerPrincipal: 3,
    clock: () => t,
    onEvent: (event, fields) => events.push(`${event} ${String(fields["kind"] ?? fields["phase"] ?? "")}`.trim()),
    secrets: { id: () => `req-${String(++n)}`, linkToken: () => `link-${String(n)}`, code: () => "CODE0000" },
    ...over,
  });
  return { b, events, advance: (ms) => void (t += ms) };
}

const call = (principal: string, target = "x"): Call => ({ principal, tool: "deploy", digest: `d-${target}`, auditDigest: "hmac-sha256:k:x", humanOnly: false, argumentsJson: "{}" });

void describe("CSR-WO-2001 approval: bounded state (APR-12)", () => {
  void it("APR-12: requests in all are capped, and one more is refused without notifying", () => {
    const { b, events } = book();
    for (const p of ["a", "b", "c"]) assert.equal(b.open(call(p)).kind, "pending");
    const fourth = b.open(call("d"));
    assert.deepEqual(fourth, { kind: "refused", reason: "too-many" });
    assert.equal(b.size, 3, "the table never exceeds its cap");
    assert.equal(events.filter((e) => e === "approval-requested").length, 3);
    assert.ok(events.includes("approval-refused too-many"));
  });

  void it("APR-12: a pending request expires on time, once, and every record is dropped once it cannot matter", () => {
    const { b, events, advance } = book();
    const opened = b.open(call("a"));
    assert.equal(opened.kind, "pending");
    const id = opened.kind === "pending" ? opened.id : "";
    const granted = b.open(call("b"));
    const gid = granted.kind === "pending" ? granted.id : "";
    assert.deepEqual(b.decideDelegated(gid, "approver", "approve"), { kind: "decided" });
    advance(9_999);
    assert.equal(b.stateOf(id), "pending");
    advance(1);
    assert.equal(b.stateOf(id), "expired");
    assert.deepEqual(b.redeem(id, call("a")), { kind: "refused", reason: "expired" });
    assert.equal(b.stateOf(gid), "expired", "the grant, approved at 1 s, lapsed after its own 5 s");
    assert.equal(events.filter((e) => e.startsWith("approval-expired")).length, 2, "one expiry row each, not one per look");
    assert.ok(events.includes("approval-expired request") && events.includes("approval-expired grant"));
    advance(5_000);
    assert.equal(b.stateOf(id), undefined, "dropped once neither its request nor its grant can matter");
    assert.equal(b.size, 0);
    assert.equal(b.open(call("c")).kind, "pending", "room again");
  });

  void it("APR-12: a full table frees as records are dropped", () => {
    const { b, advance } = book();
    for (const p of ["a", "b", "c"]) b.open(call(p));
    assert.equal(b.open(call("d")).kind, "refused");
    advance(15_000);
    assert.equal(b.open(call("d")).kind, "pending");
  });
});
