// The request receive time (requestTimeoutMs; SPEC-MAP "Request receive time"), CSR-WO-2008c §1.1.
//
// A client that sends its headers and then stalls the body is answered 408 and cut off. Node ends
// such a request on its connection sweep, every 30 s (connectionsCheckingInterval), not at the
// moment requestTimeoutMs passes, so the 408 comes between requestTimeoutMs and about 30 s later.
// This file holds only this test, so only its own deletion row pays the wait.

import assert from "node:assert/strict";
import { connect } from "node:net";
import { describe, it } from "node:test";

import { modernHeaders, start } from "./helpers.ts";

/** Longer than Node's 30 s sweep plus slack: past it, no 408 means the timeout is gone. */
const WAIT_MS = 45_000;

void describe("WO §1.10 request receive time", () => {
  void it("a request whose body never finishes is answered 408 after requestTimeoutMs, and the connection closes", async () => {
    const s = await start({ limits: { requestTimeoutMs: 1_000 } });
    try {
      const t0 = Date.now();
      const sock = connect(s.t.port, "127.0.0.1");
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
      // A request the transport accepts up to its body: authenticated, to the endpoint, then stalled.
      const headers = Object.entries({ ...modernHeaders("tools/list"), "content-length": "100" }).map(([k, v]) => `${k}: ${v}\r\n`).join("");
      sock.write(`POST /mcp HTTP/1.1\r\nhost: 127.0.0.1:${String(s.t.port)}\r\n${headers}\r\n{"jsonrpc"`);
      const r = await head;
      sock.destroy();
      const status = r.text.split("\r\n")[0] ?? "";
      console.log(`REQUEST-TIMEOUT requestTimeoutMs=1000 answered "${status}" after ${String(r.ms)} ms`);
      assert.equal(status, "HTTP/1.1 408 Request Timeout", `no 408 within ${String(WAIT_MS)} ms`);
      assert.ok(r.ms >= 1_000, `answered at ${String(r.ms)} ms, before requestTimeoutMs`);
    } finally {
      await s.close();
    }
  });
});
