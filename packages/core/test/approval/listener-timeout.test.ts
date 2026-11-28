// The approval listener's request receive time (listener.ts, `requestTimeout`: 10 s), CSR-WO-2008c
// §1.1. A client that sends a decision's headers and then stalls the body is answered 408 and cut
// off. Node ends such a request on its connection sweep, which the listener runs every second
// (CSR-WO-1005c; Node's default is 30 s), so the 408 comes within a second of the 10 s. The listener's
// timeout has no setting, so this waits for the real one, in a file of its own.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Call } from "../../src/approval/book.ts";
import { startApprovalListener } from "../../src/approval/listener.ts";
import { MemoryNotifier } from "../../src/approval/notifier.ts";
import { ApprovalService } from "../../src/approval/service.ts";
import { type ApprovalSettings, DEFAULT_APPROVAL } from "../../src/approval/settings.ts";
import { stalledRequest } from "../fixtures/stall.ts";
import { ApproverVerifier } from "./harness.ts";

/** The listener's timeout, one sweep, and slack for a loaded runner. */
const SETTING_MS = 10_000;
const TOLERANCE_MS = 1_000 + 500;
/** Past it, no 408 means the timeout is gone. */
const WAIT_MS = 20_000;

void describe("CSR-WO-2001 the approval listener's request receive time", () => {
  void it("a decision whose body never finishes is answered 408 after the listener's 10 s, and the connection closes", async () => {
    const settings: ApprovalSettings = { ...DEFAULT_APPROVAL, backend: "listener", host: "127.0.0.1", port: 0 };
    const service = new ApprovalService({ settings, notifier: new MemoryNotifier(), clock: () => 1_000, audit: () => undefined, listens: true, delegatedVerifier: new ApproverVerifier() });
    const l = await startApprovalListener(service, { host: "127.0.0.1", port: 1 });
    try {
      const call: Call = { principal: "p", tool: "deploy", digest: "d1", auditDigest: "hmac-sha256:k:x", humanOnly: false, argumentsJson: "{}" };
      const o = service.book.open(call);
      if (o.kind !== "pending" || o.secret === undefined) throw new Error("not opened");
      // A live link's decision, which the listener reads a body for, stalled after its first bytes.
      const r = await stalledRequest(l.port, `POST /approval/link/${o.secret.linkToken} HTTP/1.1\r\nhost: 127.0.0.1:${String(l.port)}\r\ncontent-type: application/json\r\ncontent-length: 100\r\n\r\n{"code"`, WAIT_MS);
      console.log(`LISTENER-TIMEOUT answered "${r.status}" after ${String(r.ms)} ms`);
      assert.equal(r.status, "HTTP/1.1 408 Request Timeout", `no 408 within ${String(WAIT_MS)} ms`);
      assert.ok(r.ms >= SETTING_MS, `answered at ${String(r.ms)} ms, before the listener's 10 s`);
      assert.ok(r.ms <= SETTING_MS + TOLERANCE_MS, `answered at ${String(r.ms)} ms, more than ${String(TOLERANCE_MS)} ms past the listener's 10 s`);
    } finally {
      await l.close();
    }
  });
});
