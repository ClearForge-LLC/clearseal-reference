// The auth seam (WO §1.11). A verifier returns a principal or a refusal; the transport never
// dispatches without a principal. The core's verifier is auth/verifier.ts's JwtVerifier
// (CSR-WO-1003), which replaced the refuse-all placeholder.

import type { IncomingHttpHeaders } from "node:http";

export interface Principal {
  /** A stable identifier for the caller; bound into sealed request state. */
  readonly id: string;
}

/** A refusal's `reason` is one word for the audit seam; it never reaches the client. */
export type Verdict = { ok: true; principal: Principal } | { ok: false; error?: "invalid_request" | "invalid_token" | "insufficient_scope"; reason?: string };

export interface Verifier {
  verify(headers: IncomingHttpHeaders): Promise<Verdict>;
}
