// Notifiers (CSR-WO-2001 §1.4; approval/RULES.md APR-10, APR-16). A notifier is the only place the
// confirm-URL's link and code go: never the audit store, never a response to the caller.

import { visible } from "./visible.ts";

/** What an approver is told. */
export interface Notification {
  readonly requestId: string;
  readonly tool: string;
  readonly requester: string;
  /** The one-time link: the approval listener's base URL and the link token. */
  readonly link: string;
  readonly code: string;
  /** Whether only a human may decide it (APR-6). */
  readonly humanOnly: boolean;
  readonly expiresInSeconds: number;
}

/**
 * APR-19: the notification as it is written out, every caller-influenced field (the requester and the
 * tool) through the approver's-view escape, so a requester cannot write a line of its own or a
 * terminal control. The request id, link and code are the node's own.
 */
export function shown(n: Notification): Notification {
  return { ...n, requester: visible(n.requester), tool: visible(n.tool) };
}

export interface Notifier {
  /** Delivers one notification; rejects when it could not. */
  notify(n: Notification): Promise<void>;
}

/** Development: one line on stderr. The operator's terminal is the out-of-band channel. */
export class StderrNotifier implements Notifier {
  notify(notification: Notification): Promise<void> {
    const n = shown(notification);
    process.stderr.write(`[approval] ${n.requester} asks to run ${n.tool} (request ${n.requestId}${n.humanOnly ? ", a human must decide" : ""}); open ${n.link} and enter the code ${n.code} within ${String(n.expiresInSeconds)} s\n`);
    return Promise.resolve();
  }
}

/** Keeps what it was given (the test backend). */
export class MemoryNotifier implements Notifier {
  readonly sent: Notification[] = [];
  notify(n: Notification): Promise<void> {
    this.sent.push(n);
    return Promise.resolve();
  }
}

/** A notifier that could not deliver: the reason, for the audit. */
export class NotifyError extends Error {
  override name = "NotifyError";
}

/**
 * POSTs the notification as JSON to an operator URL (APR-16): `https` only (checked at start), TLS
 * verified (fetch's default; nothing here turns it off), and no redirect followed, since a redirect
 * could carry the link and code somewhere the operator never named.
 */
export class WebhookNotifier implements Notifier {
  readonly #url: string;
  readonly #timeoutMs: number;
  constructor(url: string, timeoutMs = 5_000) {
    this.#url = url;
    this.#timeoutMs = timeoutMs;
  }
  async notify(n: Notification): Promise<void> {
    let res: Response;
    try {
      res = await fetch(this.#url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(shown(n)), redirect: "manual", signal: AbortSignal.timeout(this.#timeoutMs) });
    } catch (err) {
      throw new NotifyError(err instanceof Error && err.name === "TimeoutError" ? "timeout" : "unreachable");
    }
    await res.body?.cancel();
    if (res.status >= 300 && res.status < 400) throw new NotifyError("redirect");
    if (!res.ok) throw new NotifyError(`status-${String(res.status)}`);
  }
}
