// CSR-WO-2001 §1.7: the approval settings (approval/RULES.md *Settings and defaults*, APR-9, APR-16).
// Validated, each default stated: unset takes the table's default, and every invalid value refuses
// start with an ApprovalConfigError that names its variable.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApprovalConfigError, approvalFromEnv, DEFAULT_APPROVAL, MAX_WAIT_SECONDS } from "../../src/approval/settings.ts";

const NODE_AUDIENCE = "https://mcp.example.invalid/mcp";

/** A URL carrying `user:pw@`, assembled at run time so the leak gate's userinfo rule never meets a literal (N6). */
const withCredentials = `https://${["user", "pw"].join(":")}${String.fromCharCode(64)}${["hooks", "example", "invalid"].join(".")}/x`;

/** Whether `err` is an ApprovalConfigError whose message names every one of `names`. */
const refusal = (names: readonly string[], also?: RegExp) => (err: unknown): boolean =>
  err instanceof ApprovalConfigError && names.every((n) => err.message.includes(n)) && (also === undefined || also.test(err.message));

void describe("CSR-WO-2001 approval: settings defaults", () => {
  void it("unset variables take DEFAULT_APPROVAL", () => {
    assert.deepEqual(approvalFromEnv({}), DEFAULT_APPROVAL);
    assert.ok(Object.isFrozen(approvalFromEnv({})), "the settings are frozen");
  });

  void it("an empty variable is unset", () => {
    const env: Record<string, string> = {};
    for (const name of ["APPROVAL_BACKEND", "APPROVAL_LISTENER_HOST", "APPROVAL_LISTENER_PORT", "APPROVAL_PUBLIC_URL", "APPROVAL_AUDIENCE", "APPROVAL_HUMAN_APPROVER", "APPROVAL_REQUEST_TTL_SECONDS", "APPROVAL_GRANT_TTL_SECONDS", "APPROVAL_WAIT_SECONDS", "APPROVAL_NOTIFIER", "APPROVAL_WEBHOOK_URL", "APPROVAL_MAX_PENDING", "APPROVAL_MAX_PENDING_PER_PRINCIPAL"]) env[name] = "";
    assert.deepEqual(approvalFromEnv(env), DEFAULT_APPROVAL);
  });

  void it("each default matches the RULES.md table", () => {
    const d = approvalFromEnv({});
    assert.equal(d.backend, "none", "APPROVAL_BACKEND: fail closed");
    assert.equal(d.host, "127.0.0.1", "APPROVAL_LISTENER_HOST: loopback");
    assert.equal(d.port, 3031, "APPROVAL_LISTENER_PORT");
    assert.equal(d.publicUrl, "", "APPROVAL_PUBLIC_URL: the listener's own http://host:port");
    assert.equal(d.audience, "", "APPROVAL_AUDIENCE: unset, no delegated approvers");
    assert.equal(d.humanApprover, "operator", "APPROVAL_HUMAN_APPROVER");
    assert.equal(d.requestTtlSeconds, 600, "APPROVAL_REQUEST_TTL_SECONDS: ten minutes");
    assert.equal(d.grantTtlSeconds, 300, "APPROVAL_GRANT_TTL_SECONDS: five minutes");
    assert.equal(d.waitSeconds, 0, "APPROVAL_WAIT_SECONDS: no call holds open");
    assert.equal(d.notifier, "stderr", "APPROVAL_NOTIFIER");
    assert.equal(d.webhookUrl, "", "APPROVAL_WEBHOOK_URL: unset");
    assert.equal(d.maxPending, 1_000, "APPROVAL_MAX_PENDING");
    assert.equal(d.maxPendingPerPrincipal, 3, "APPROVAL_MAX_PENDING_PER_PRINCIPAL");
    assert.equal(MAX_WAIT_SECONDS, 25, "the wait's ceiling, below the 30 s handler timeout");
  });
});

void describe("CSR-WO-2001 approval: settings validation", () => {
  /** [variable, value, extra environment, the variables the message must name]. */
  const bad: [string, string, Record<string, string>, string[]][] = [
    ["APPROVAL_BACKEND", "console", {}, ["APPROVAL_BACKEND"]],
    ["APPROVAL_BACKEND", "yes", {}, ["APPROVAL_BACKEND"]],
    ["APPROVAL_LISTENER_PORT", "-1", {}, ["APPROVAL_LISTENER_PORT"]],
    ["APPROVAL_LISTENER_PORT", "65536", {}, ["APPROVAL_LISTENER_PORT"]],
    ["APPROVAL_LISTENER_PORT", "x", {}, ["APPROVAL_LISTENER_PORT"]],
    ["APPROVAL_LISTENER_PORT", "01", {}, ["APPROVAL_LISTENER_PORT"]],
    ["APPROVAL_REQUEST_TTL_SECONDS", "0", {}, ["APPROVAL_REQUEST_TTL_SECONDS"]],
    ["APPROVAL_GRANT_TTL_SECONDS", "0", {}, ["APPROVAL_GRANT_TTL_SECONDS"]],
    ["APPROVAL_WAIT_SECONDS", String(MAX_WAIT_SECONDS + 1), {}, ["APPROVAL_WAIT_SECONDS"]],
    ["APPROVAL_WAIT_SECONDS", "-1", {}, ["APPROVAL_WAIT_SECONDS"]],
    ["APPROVAL_MAX_PENDING", "0", {}, ["APPROVAL_MAX_PENDING"]],
    ["APPROVAL_MAX_PENDING_PER_PRINCIPAL", "0", {}, ["APPROVAL_MAX_PENDING_PER_PRINCIPAL"]],
    ["APPROVAL_MAX_PENDING_PER_PRINCIPAL", "101", {}, ["APPROVAL_MAX_PENDING_PER_PRINCIPAL"]],
    ["APPROVAL_NOTIFIER", "email", {}, ["APPROVAL_NOTIFIER"]],
    ["APPROVAL_WEBHOOK_URL", "http://hooks.example.invalid/x", {}, ["APPROVAL_WEBHOOK_URL"]],
    ["APPROVAL_WEBHOOK_URL", withCredentials, {}, ["APPROVAL_WEBHOOK_URL"]],
    ["APPROVAL_WEBHOOK_URL", "not a url", {}, ["APPROVAL_WEBHOOK_URL"]],
    // The notifier set to webhook with no URL: the message names the missing variable.
    ["APPROVAL_NOTIFIER", "webhook", {}, ["APPROVAL_WEBHOOK_URL", "APPROVAL_NOTIFIER"]],
    ["APPROVAL_PUBLIC_URL", "ftp://x.invalid", {}, ["APPROVAL_PUBLIC_URL"]],
    ["APPROVAL_PUBLIC_URL", "https://approve.example.invalid/?a=1", {}, ["APPROVAL_PUBLIC_URL"]],
    ["APPROVAL_HUMAN_APPROVER", "the operator", {}, ["APPROVAL_HUMAN_APPROVER"]],
  ];
  for (const [name, value, extra, names] of bad) {
    void it(`${name}=${JSON.stringify(value)} refuses start, naming the variable`, () => {
      assert.throws(() => approvalFromEnv({ ...extra, [name]: value }), refusal(names));
    });
  }

  void it("APR-9: an approval audience equal to the node's audience refuses start", () => {
    assert.throws(() => approvalFromEnv({ AUTH_AUDIENCE: NODE_AUDIENCE, APPROVAL_AUDIENCE: NODE_AUDIENCE }), refusal(["APPROVAL_AUDIENCE", "AUTH_AUDIENCE"]));
    const other = "https://approvals.example.invalid";
    assert.equal(approvalFromEnv({ AUTH_AUDIENCE: NODE_AUDIENCE, APPROVAL_AUDIENCE: other }).audience, other, "a different audience is accepted");
  });

  void it("APR-16: an http webhook URL refuses start", () => {
    assert.throws(() => approvalFromEnv({ APPROVAL_NOTIFIER: "webhook", APPROVAL_WEBHOOK_URL: "http://hooks.example.invalid/x" }), refusal(["APPROVAL_WEBHOOK_URL"], /https/));
  });

  void it("a full set of valid values is accepted and parsed", () => {
    const s = approvalFromEnv({
      AUTH_AUDIENCE: NODE_AUDIENCE,
      APPROVAL_BACKEND: "listener",
      APPROVAL_LISTENER_HOST: "127.0.0.1",
      APPROVAL_LISTENER_PORT: "4040",
      APPROVAL_PUBLIC_URL: "https://approve.example.invalid/base/",
      APPROVAL_AUDIENCE: "https://approvals.example.invalid",
      APPROVAL_HUMAN_APPROVER: "on-call",
      APPROVAL_REQUEST_TTL_SECONDS: "60",
      APPROVAL_GRANT_TTL_SECONDS: "30",
      APPROVAL_WAIT_SECONDS: String(MAX_WAIT_SECONDS),
      APPROVAL_NOTIFIER: "webhook",
      APPROVAL_WEBHOOK_URL: "https://hooks.example.invalid/x",
      APPROVAL_MAX_PENDING: "100000",
      APPROVAL_MAX_PENDING_PER_PRINCIPAL: "100",
      APPROVAL_MAX_WAITING_PER_PRINCIPAL: "2",
      APPROVAL_MAX_WAITING: "4",
      APPROVAL_LISTENER_RATE_BURST: "10",
      APPROVAL_LISTENER_RATE_REFILL_PER_MINUTE: "20",
      APPROVAL_LISTENER_RATE_MAX_ADDRESSES: "30",
      APPROVAL_TRUSTED_PROXIES: "127.0.0.1, ::FFFF:127.0.0.2, 2001:db8::/32",
    });
    assert.deepEqual(s, {
      backend: "listener",
      host: "127.0.0.1",
      port: 4040,
      publicUrl: "https://approve.example.invalid/base",
      audience: "https://approvals.example.invalid",
      humanApprover: "on-call",
      requestTtlSeconds: 60,
      grantTtlSeconds: 30,
      waitSeconds: MAX_WAIT_SECONDS,
      notifier: "webhook",
      webhookUrl: "https://hooks.example.invalid/x",
      maxPending: 100_000,
      maxPendingPerPrincipal: 100,
      maxWaitingPerPrincipal: 2,
      maxWaiting: 4,
      listenerRateBurst: 10,
      listenerRateRefillPerMinute: 20,
      listenerRateMaxAddresses: 30,
      trustedProxies: ["127.0.0.1", "127.0.0.2", "2001:db8::/32"],
    });
    assert.ok(Object.isFrozen(s));
  });

  void it("the bounds themselves are accepted", () => {
    assert.equal(approvalFromEnv({ APPROVAL_LISTENER_PORT: "0" }).port, 0);
    assert.equal(approvalFromEnv({ APPROVAL_LISTENER_PORT: "65535" }).port, 65_535);
    assert.equal(approvalFromEnv({ APPROVAL_WAIT_SECONDS: "0" }).waitSeconds, 0);
    assert.equal(approvalFromEnv({ APPROVAL_MAX_PENDING_PER_PRINCIPAL: "1" }).maxPendingPerPrincipal, 1);
    assert.equal(approvalFromEnv({ APPROVAL_BACKEND: "none" }).backend, "none");
    assert.equal(approvalFromEnv({ APPROVAL_NOTIFIER: "stderr" }).notifier, "stderr");
    assert.equal(approvalFromEnv({ APPROVAL_PUBLIC_URL: "http://127.0.0.1:3031" }).publicUrl, "http://127.0.0.1:3031");
  });
});

void describe("CSR-WO-2001 approval: the wait and the request lifetime (review L5)", () => {
  void it("review L5: APPROVAL_WAIT_SECONDS no shorter than APPROVAL_REQUEST_TTL_SECONDS refuses start", () => {
    assert.throws(() => approvalFromEnv({ APPROVAL_WAIT_SECONDS: "10", APPROVAL_REQUEST_TTL_SECONDS: "10" }), (err: unknown) => err instanceof ApprovalConfigError && /APPROVAL_WAIT_SECONDS must be shorter than APPROVAL_REQUEST_TTL_SECONDS/.test(err.message));
    assert.equal(approvalFromEnv({ APPROVAL_WAIT_SECONDS: "9", APPROVAL_REQUEST_TTL_SECONDS: "10" }).waitSeconds, 9);
  });
});
