// CSR-WO-2001 §1.4: the notifiers (approval/RULES.md APR-10, APR-16). A notifier is the only place the
// link and the code go; the webhook one posts only where the operator named, verifies TLS and follows
// no redirect. Every server here listens on 127.0.0.1 and is closed in `finally`.

import assert from "node:assert/strict";
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { describe, it, mock } from "node:test";

import { MemoryNotifier, type Notification, NotifyError, StderrNotifier, WebhookNotifier } from "../../src/approval/notifier.ts";
import { selfSigned } from "../auth/cert.ts";

const notification: Notification = Object.freeze({
  requestId: "req-7f3a",
  tool: "delete_file",
  requester: "alice",
  link: "http://127.0.0.1:3031/approve/link-token-canary",
  code: "code-canary-481516",
  humanOnly: true,
  expiresInSeconds: 600,
});

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

async function listen<S extends HttpServer | HttpsServer>(server: S): Promise<{ server: S; port: number }> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  return { server, port: (server.address() as AddressInfo).port };
}

async function close(server: HttpServer | HttpsServer): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const isNotifyError = (message: string) => (err: unknown): boolean => err instanceof NotifyError && err.message === message;

void describe("CSR-WO-2001 approval: the stderr and memory notifiers", () => {
  void it("StderrNotifier writes one line carrying the link and the code", async () => {
    const written: string[] = [];
    const write = mock.method(process.stderr, "write", (chunk: string | Uint8Array): boolean => {
      written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    });
    try {
      await new StderrNotifier().notify(notification);
    } finally {
      write.mock.restore();
    }
    assert.equal(written.length, 1, "one write");
    const line = written[0] ?? "";
    assert.ok(line.endsWith("\n"), "a whole line");
    assert.equal(line.split("\n").length, 2, "exactly one line");
    assert.ok(line.includes(notification.link), "the link");
    assert.ok(line.includes(notification.code), "the code");
    assert.ok(line.includes(notification.requestId) && line.includes(notification.tool) && line.includes(notification.requester), "the request, the tool and the requester");
  });

  void it("MemoryNotifier keeps what it was sent", async () => {
    const memory = new MemoryNotifier();
    const second: Notification = { ...notification, requestId: "req-8b4c", humanOnly: false };
    await memory.notify(notification);
    await memory.notify(second);
    assert.deepEqual(memory.sent, [notification, second]);
  });
});

void describe("CSR-WO-2001 approval: the webhook notifier (APR-16)", () => {
  // The https-only rule is enforced at settings time (approvalFromEnv refuses an http
  // APPROVAL_WEBHOOK_URL; see settings.test.ts), which is why the notifier itself can be pointed at a
  // plain-http loopback server in these tests.

  void it("a 2xx resolves, and the server received the notification as JSON", async () => {
    const received: { method: string; contentType: string; body: string }[] = [];
    const { server, port } = await listen(createHttpServer((req, res) => {
      void readBody(req).then((body) => {
        received.push({ method: req.method ?? "", contentType: req.headers["content-type"] ?? "", body });
        res.writeHead(204).end();
      });
    }));
    try {
      await new WebhookNotifier(`http://127.0.0.1:${String(port)}/hook`).notify(notification);
      assert.equal(received.length, 1, "one POST");
      const [hit] = received;
      assert.equal(hit?.method, "POST");
      assert.match(hit?.contentType ?? "", /^application\/json/);
      assert.deepEqual(JSON.parse(hit?.body ?? "null"), {
        requestId: notification.requestId,
        tool: notification.tool,
        requester: notification.requester,
        link: notification.link,
        code: notification.code,
        humanOnly: notification.humanOnly,
        expiresInSeconds: notification.expiresInSeconds,
      });
    } finally {
      await close(server);
    }
  });

  void it("a 500 rejects with NotifyError status-500", async () => {
    const { server, port } = await listen(createHttpServer((req, res) => {
      void readBody(req).then(() => {
        res.writeHead(500).end();
      });
    }));
    try {
      await assert.rejects(new WebhookNotifier(`http://127.0.0.1:${String(port)}/hook`).notify(notification), isNotifyError("status-500"));
    } finally {
      await close(server);
    }
  });

  void it("APR-16: a webhook redirect is not followed", async () => {
    const elsewhere: string[] = [];
    const handler: Handler = (req, res) => {
      void readBody(req).then((body) => {
        if (req.url === "/hook") {
          res.writeHead(302, { location: "/elsewhere" }).end();
          return;
        }
        if (req.url === "/elsewhere") elsewhere.push(body);
        res.writeHead(200).end();
      });
    };
    const { server, port } = await listen(createHttpServer(handler));
    try {
      await assert.rejects(new WebhookNotifier(`http://127.0.0.1:${String(port)}/hook`).notify(notification), isNotifyError("redirect"));
      assert.deepEqual(elsewhere, [], "the redirect target was never hit: the link and code went nowhere the operator did not name");
    } finally {
      await close(server);
    }
  });

  void it("APR-16: a webhook with a certificate it cannot verify is refused", async () => {
    // A self-signed certificate for 127.0.0.1 that nothing trusts: fetch's default verification must
    // refuse the handshake before any request (and so any link or code) reaches the handler.
    const cert = selfSigned();
    let handled = 0;
    const { server, port } = await listen(createHttpsServer({ key: cert.keyPem, cert: cert.certPem }, (_req, res) => {
      handled++;
      res.writeHead(204).end();
    }));
    try {
      await assert.rejects(new WebhookNotifier(`https://127.0.0.1:${String(port)}/hook`).notify(notification), isNotifyError("unreachable"));
      assert.equal(handled, 0, "the handler never ran");
    } finally {
      await close(server);
    }
  });
});
