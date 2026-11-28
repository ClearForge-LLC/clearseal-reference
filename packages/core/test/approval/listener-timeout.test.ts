// The approval listener's request receive time (listener.ts, `requestTimeout`: 10 s), CSR-WO-2008c
// §1.1. A client that sends a decision's headers and then stalls the body is answered 408 and cut
// off. Node ends such a request on its connection sweep, every 30 s (connectionsCheckingInterval),
// so the 408 comes about 30 s after the request starts, not at 10 s. The listener's timeout has no
// setting, so this waits for the real one. This file holds only this test, so only its own deletion
// row pays the wait.

import assert from "node:assert/strict";
import { connect } from "node:net";
import { describe, it } from "node:test";

import type { Call } from "../../src/approval/book.ts";
import { startApprovalListener } from "../../src/approval/listener.ts";
import { MemoryNotifier } from "../../src/approval/notifier.ts";
import { ApprovalService } from "../../src/approval/service.ts";
import { type ApprovalSettings, DEFAULT_APPROVAL } from "../../src/approval/settings.ts";
import { ApproverVerifier } from "./harness.ts";

/** Longer than Node's 30 s sweep plus slack: past it, no 408 means the timeout is gone. */
const WAIT_MS = 45_000;

void describe("CSR-WO-2001 the approval listener's request receive time", () => {
  void it("a decision whose body never finishes is answered 408 after the listener's 10 s, and the connection closes", async () => {
    const settings: ApprovalSettings = { ...DEFAULT_APPROVAL, backend: "listener", host: "127.0.0.1", port: 0 };
    const service = new ApprovalService({ settings, notifier: new MemoryNotifier(), clock: () => 1_000, audit: () => undefined, listens: true, delegatedVerifier: new ApproverVerifier() });
    const l = await startApprovalListener(service, { host: "127.0.0.1", port: 1 });
    try {
      const call: Call = { principal: "p", tool: "deploy", digest: "d1", auditDigest: "hmac-sha256:k:x", humanOnly: false, argumentsJson: "{}" };
      const o = service.book.open(call);
      if (o.kind !== "pending" || o.secret === undefined) throw new Error("not opened");
      const t0 = Date.now();
      const sock = connect(l.port, "127.0.0.1");
      const head = new Promise<{ text: string; ms: number }>((resolve) => {
        let text = "";
        const timer = setTimeout(() => {
          resolve({ text, ms: Date.now() - t0 });
        }, WAIT_MS);
        sock.on("data", (d: Buffer) => (text += d.toString("latin1")));
        sock.on("close", () => {
          clearTimeout(timer);
          resolve({ text, ms: Date.now() - t0 });
        });
        sock.on("error", () => undefined);
      });
      // A live link's decision, which the listener reads a body for, stalled after its first bytes.
      sock.write(`POST /approval/link/${o.secret.linkToken} HTTP/1.1\r\nhost: 127.0.0.1:${String(l.port)}\r\ncontent-type: application/json\r\ncontent-length: 100\r\n\r\n{"code"`);
      const r = await head;
      sock.destroy();
      const status = r.text.split("\r\n")[0] ?? "";
      console.log(`LISTENER-TIMEOUT answered "${status}" after ${String(r.ms)} ms`);
      assert.equal(status, "HTTP/1.1 408 Request Timeout", `no 408 within ${String(WAIT_MS)} ms`);
      assert.ok(r.ms >= 10_000, `answered at ${String(r.ms)} ms, before the listener's 10 s`);
    } finally {
      await l.close();
    }
  });
});
