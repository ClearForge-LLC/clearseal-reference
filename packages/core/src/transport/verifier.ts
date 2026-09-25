// The auth seam (WO §1.11). A verifier returns a principal or a refusal; the transport never
// dispatches without a principal. This WO ships only RefuseAllVerifier, so until -1003 replaces it
// every MCP request is answered 401 with a resource-metadata challenge: fail closed by
// construction (N4), not by configuration.

import type { IncomingHttpHeaders } from "node:http";

export interface Principal {
  /** A stable identifier for the caller; bound into sealed request state. */
  readonly id: string;
}

export type Verdict = { ok: true; principal: Principal } | { ok: false; error?: "invalid_request" | "invalid_token" | "insufficient_scope" };

export interface Verifier {
  verify(headers: IncomingHttpHeaders): Promise<Verdict>;
}

/** Accepts nothing. The only verifier this package ships until -1003. */
export class RefuseAllVerifier implements Verifier {
  verify(): Promise<Verdict> {
    return Promise.resolve({ ok: false });
  }
}
