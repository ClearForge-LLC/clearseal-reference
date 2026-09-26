// The auth seam (WO §1.11). A verifier returns a principal or a refusal; the transport never
// dispatches without a principal. The core's verifier is auth/verifier.ts's JwtVerifier
// (CSR-WO-1003), which replaced the refuse-all placeholder.

import type { IncomingHttpHeaders } from "node:http";

export interface Principal {
  /** A stable identifier for the caller; bound into sealed request state. */
  readonly id: string;
}

/** A refusal's `reason` is one word for the audit seam; it never reaches the client.
 *  `unavailable` says the verifier could not judge the token at all (its issuer's key set is
 *  unreachable): the transport answers 503 with Retry-After, so a correct client keeps its token
 *  (CSR-WO-1003a §1.1). It is the verdict's field, never inferred from `reason`. */
export type Verdict =
  | { ok: true; principal: Principal }
  | { ok: false; error?: "invalid_request" | "invalid_token" | "insufficient_scope"; reason?: string; unavailable?: { readonly retryAfterS: number } };

export interface Verifier {
  verify(headers: IncomingHttpHeaders): Promise<Verdict>;
}
