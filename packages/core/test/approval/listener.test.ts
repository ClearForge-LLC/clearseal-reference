// CSR-WO-2001 §3.2: the decision side (approval/RULES.md APR-7…APR-10, APR-14). The main listener
// serves no approval route; the approval listener cannot share its address and port; the confirm-URL
// needs its code and is spent once; a delegated approver's token is the core's verifier's, for the
// approval audience only; and without a backend nothing that needs approval is served.

import assert from "node:assert/strict";
import { createServer } from "node:net";
import { after, describe, it } from "node:test";

import { JwtVerifier } from "../../src/auth/verifier.ts";
import { ObligationError } from "../../src/capability/ladder.ts";
import { ApprovalListenerError } from "../../src/approval/listener.ts";
import { DEFAULT_LIMITS } from "../../src/transport/config.ts";
import { compileSchema } from "../../src/transport/schema.ts";
import { startTransport } from "../../src/transport/server.ts";
import { AUDIENCE, ISSUER, TestIssuer } from "../auth/issuer.ts";
import { pinForTest } from "../fixtures/pin.ts";
import { tag } from "../fixtures/tools.ts";
import { raw } from "../transport/helpers.ts";
import { PrincipalVerifier } from "../transport/principals.ts";
import { approvalOf, ran, rig, seen } from "./harness.ts";

const pastes: string[] = [];
after(() => {
  console.log(pastes.join("\n"));
});

const tokenOf = (link: string): string => link.split("/").pop() ?? "";

/** A free local port. */
async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

void describe("CSR-WO-2001 approval: channel separation (APR-7)", () => {
  void it("every approval path on the main listener → not found", async () => {
    const r = await rig();
    try {
      await r.call("alice", "deploy", "prod");
      const n = r.notifier.sent[0];
      assert.ok(n !== undefined);
      const id = approvalOf(await r.call("alice", "deploy", "prod")).requestId ?? "";
      const paths = [`/approval/link/${tokenOf(n.link)}`, `/approval/requests/${id}`, "/approval", "/approval/", "/approval/link", "/approval/requests"];
      const statuses: string[] = [];
      for (const path of paths) {
        for (const method of ["GET", "POST"]) {
          let res: Awaited<ReturnType<typeof raw>>;
          try {
            // A declared length: the main listener refuses an unknown path without reading the body, and a
            // chunked body still being written when it answers can see the socket close instead.
            const body = JSON.stringify({ code: n.code, decision: "approve" });
            res = await raw(r.t, { method, path, headers: { authorization: "Bearer approver:bob", "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) }, body });
          } catch (err) {
            assert.fail(`${method} ${path.replace(tokenOf(n.link), "<link>")}: ${err instanceof Error ? err.message : "error"}`);
          }
          seen.texts.push(res.text);
          assert.equal(res.status, 404, `${method} ${path} on the main listener`);
          statuses.push(`${method} ${path.replace(tokenOf(n.link), "<link>").replace(id, "<id>")} → ${String(res.status)}`);
        }
      }
      assert.equal(approvalOf(await r.call("alice", "deploy", "prod", id)).status, "pending", "nothing sent to the main listener decided anything");
      pastes.push(`LISTENER main listener: ${statuses.join("; ")}`);
    } finally {
      await r.close();
    }
  });

  void it("the approval listener on the main listener's address and port → start refused", async () => {
    const port = await freePort();
    let caught: unknown;
    try {
      const r = await rig({ settings: { port } });
      await r.close();
    } catch (err) {
      caught = err;
    }
    // The rig's transport binds the main listener on a random port, so name the port explicitly: start
    // one whose main listener is on `port`, and whose approval listener is asked for the same.
    if (caught === undefined) {
      const { ApprovalService } = await import("../../src/approval/service.ts");
      const { MemoryNotifier } = await import("../../src/approval/notifier.ts");
      const { DEFAULT_APPROVAL } = await import("../../src/approval/settings.ts");
      const service = new ApprovalService({ settings: { ...DEFAULT_APPROVAL, backend: "listener", port }, notifier: new MemoryNotifier(), clock: () => 0, audit: () => undefined, listens: true });
      try {
        const t = await startTransport({ registry: pinForTest([{ name: "deploy", description: "d", inputSchema: { type: "object" }, capability: tag("deploy", { capability_class: "state_change", elevated: true }), handler: () => Promise.resolve({ content: [] }) }], compileSchema, DEFAULT_LIMITS, true, { approvalBackend: "configured" }), serverInfo: { name: "x", version: "0" }, verifier: new PrincipalVerifier(), config: { port }, approval: service, audit: () => undefined });
        await t.close();
      } catch (err) {
        caught = err;
      }
    }
    assert.ok(caught instanceof ApprovalListenerError, String(caught));
    assert.match(caught.message, /cannot share the main listener's address and port/);
    pastes.push(`LISTENER same address and port → ${caught.name}: ${caught.message}`);
  });
});

void describe("CSR-WO-2001 approval: the confirm-URL (APR-8)", () => {
  void it("the link alone does not decide: reading it describes the request, without the code", async () => {
    const r = await rig();
    try {
      const id = approvalOf(await r.call("alice", "deploy", "prod")).requestId;
      const n = r.notifier.sent[0];
      assert.ok(n !== undefined);
      const read = await r.listener("GET", `/approval/link/${tokenOf(n.link)}`);
      assert.equal(read.status, 200);
      assert.equal((read.json as { request: { requestId: string; tool: string; requester: string; arguments: string } }).request.tool, "deploy");
      assert.equal((read.json as { request: { requester: string } }).request.requester, "alice");
      assert.ok(!read.text.includes(n.code), "the code is not in the page");
      const noCode = await r.listener("POST", `/approval/link/${tokenOf(n.link)}`, { body: { decision: "approve" } });
      assert.equal(noCode.status, 400);
      assert.equal(approvalOf(await r.call("alice", "deploy", "prod", id)).status, "pending", "reading, and posting without the code, decided nothing");
    } finally {
      await r.close();
    }
  });

  void it("a wrong code, a second use and an expired link are each refused; five wrong codes burn the link", async () => {
    const r = await rig();
    try {
      await r.call("alice", "deploy", "a");
      await r.call("alice", "deploy", "b");
      await r.call("bob", "deploy", "c");
      const [a, b, c] = r.notifier.sent;
      assert.ok(a !== undefined && b !== undefined && c !== undefined);
      const post = (link: string, code: string): ReturnType<typeof r.listener> => r.listener("POST", `/approval/link/${tokenOf(link)}`, { body: { code, decision: "approve" } });
      const wrong = await post(a.link, "WRONGCOD");
      assert.equal(wrong.status, 403);
      assert.deepEqual(wrong.json, { error: "wrong-code" });
      assert.equal((await post(a.link, a.code)).status, 200, "the right code still decides after one wrong one");
      const second = await post(a.link, a.code);
      assert.equal(second.status, 410);
      assert.deepEqual(second.json, { error: "link-used" });
      for (let i = 0; i < 5; i++) assert.equal((await post(b.link, "WRONGCOD")).status, 403);
      const burned = await post(b.link, b.code);
      assert.deepEqual([burned.status, burned.json], [410, { error: "link-burned" }], "after five wrong codes the right one no longer works");
      r.clock.advance(600_000);
      const expired = await post(c.link, c.code);
      assert.deepEqual([expired.status, expired.json], [410, { error: "link-expired" }]);
      pastes.push(`LISTENER confirm-URL: wrong code → ${String(wrong.status)} ${wrong.text}; second use → ${String(second.status)} ${second.text}; five wrong then right → ${String(burned.status)} ${burned.text}; expired → ${String(expired.status)} ${expired.text}`);
    } finally {
      await r.close();
    }
  });
});

void describe("CSR-WO-2001 approval: the delegated approver's audience (APR-9)", () => {
  void it("a delegated approver with the node's own audience → refused; with the approval audience → decides", async () => {
    const issuer = await TestIssuer.start();
    const approvalAudience = "https://approve.example.invalid/decide";
    const verifier = new JwtVerifier({ issuer: ISSUER, jwksUrl: issuer.jwksUrl, audience: approvalAudience, jwksCa: issuer.ca });
    const r = await rig({ delegatedVerifier: verifier });
    try {
      const id = approvalOf(await r.call("alice", "deploy", "prod")).requestId ?? "";
      const nowS = Math.floor(Date.now() / 1000);
      const nodeToken = issuer.mint(TestIssuer.claims(nowS, { sub: "bot-approver", aud: AUDIENCE }));
      const refused = await r.listener("POST", `/approval/requests/${id}`, { bearer: nodeToken, body: { decision: "approve" } });
      assert.equal(refused.status, 401);
      assert.equal(approvalOf(await r.call("alice", "deploy", "prod", id)).status, "pending");
      const approverToken = issuer.mint(TestIssuer.claims(nowS, { sub: "bot-approver", aud: approvalAudience }));
      const decided = await r.listener("POST", `/approval/requests/${id}`, { bearer: approverToken, body: { decision: "approve" } });
      assert.equal(decided.status, 200);
      assert.ok(ran(await r.call("alice", "deploy", "prod", id)));
      assert.deepEqual(r.of("approval-redeemed").map((f) => f["approver"]), ["bot-approver"], "the approver is the token's sub");
      pastes.push(`LISTENER delegated approver: a token for the node's audience → ${String(refused.status)} ${refused.text}; for the approval audience → ${String(decided.status)}, approver bot-approver recorded on redemption`);
    } finally {
      await r.close();
      await issuer.close();
    }
  });

  void it("with no approval audience configured there are no delegated approvers", async () => {
    const r = await rig({ delegatedVerifier: null });
    try {
      const id = approvalOf(await r.call("alice", "deploy", "prod")).requestId ?? "";
      const res = await r.listener("POST", `/approval/requests/${id}`, { bearer: "approver:bob", body: { decision: "approve" } });
      assert.equal(res.status, 404);
    } finally {
      await r.close();
    }
  });
});

void describe("CSR-WO-2001 approval: fail closed without a backend (APR-14)", () => {
  const deploy = { name: "deploy", description: "d", inputSchema: { type: "object" }, capability: tag("deploy", { capability_class: "state_change", elevated: true }), handler: () => Promise.resolve({ content: [] }) };

  void it("no approval backend configured → an elevated tool is refused at construction, as before", () => {
    assert.throws(() => pinForTest([deploy], compileSchema, DEFAULT_LIMITS), (err: unknown) => err instanceof ObligationError && /elevated requires an approval backend; none is configured/.test(err.message));
    pastes.push("LISTENER no backend → refused at construction: elevated requires an approval backend; none is configured");
  });

  void it("a registry that says configured, given no backend → the transport refuses to start", async () => {
    let caught: unknown;
    try {
      const t = await startTransport({ registry: pinForTest([deploy], compileSchema, DEFAULT_LIMITS, true, { approvalBackend: "configured" }), serverInfo: { name: "x", version: "0" }, verifier: new PrincipalVerifier(), audit: () => undefined });
      // Started: close it, so the failure below is the assertion's and not a hung process.
      await t.close();
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof Error, "the transport started with an elevated tool and no approval backend");
    assert.match(caught.message, /the tools deploy need approval and no approval backend was given: the node does not start without one/);
  });
});

void describe("CSR-WO-2001 approval: the canary (APR-10)", () => {
  void it("no link token or code appears in any audit row or response this file saw", () => {
    const secrets = seen.secrets.filter((s) => s.length >= 8);
    assert.ok(secrets.length >= 6);
    for (const s of secrets) for (const text of seen.texts) assert.ok(!text.includes(s), `a link token or code reached: ${text.slice(0, 120)}`);
  });
});
