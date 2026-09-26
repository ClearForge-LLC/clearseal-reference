# CSR-WO-1003 — Auth: `401` with resource metadata, JWKS verification, audience and issuer, the principal carried downstream

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD; the
base must contain `-1005`'s transport with the `Verifier` seam and `RefuseAllVerifier`).
**Branch:** `wo/CSR-WO-1003`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P1 · **Phase exit gate (the clauses this WO owns):** `curl -i` unauthenticated returns
`401` with resource metadata; a wrong-audience token → `401`; a missing token → `401`;
unauthenticated `/health` → `200`.
**Grounds:** `docs/northstar.md` N4, N5, N8; `docs/architecture.md` §5 rows *Authorization server*
("AS-agnostic: an issuer, a JWKS location, and an expected audience, all configuration"; "identity
must come from the token's `sub`"), *Key-set fetching* ("JWKS cached with a TTL; one refetch on an
unknown `kid`; a fetch failure with no valid cache answers `401`, never accepts; clock-skew
tolerance is a stated constant — each of these is a fail-open when left to a library default"),
*Caller entitlement* (seam now: the principal on every audit row); §7.1 rows *A compromised or
impostor client*, *A stolen bearer token*; §8 row *`401` + protected-resource metadata;
audience-bound verify*; `docs/roadmap.md` P1. Specification of record: RFC 9728 (protected
resource metadata), RFC 6750 (bearer usage), RFC 7517/7518 (JWK/JWA), RFC 8725 (JWT best current
practices), and the MCP `2026-07-28` authorization page. Code seams: `transport/verifier.ts`,
`transport/server.ts` (the `401` challenge and PRM path already exist as stubs).

> **What this is:** the resource-server half of OAuth, done the way RFC 8725 says and the fleet's
> reference node proved — with every library default that fails open replaced by an explicit rule
> that fails closed. The verifier is configuration: an issuer, a JWKS URL, an expected audience.
> It fetches keys, caches them, verifies a bearer's signature, checks `iss` equals the configured
> issuer, `aud` equals the configured audience (string equality, not "contains"), `exp`/`nbf`
> within a stated skew, the algorithm on an explicit allow-list, and hands the transport a
> `Principal` whose `id` is the token's `sub` — nothing else in the token is trusted for identity.
> Tests run against an in-process issuer with a generated key, so the suite needs no network. It
> is NOT the authorization server (a node picks its own), NOT dynamic client registration, NOT
> scopes-as-entitlement (deferred, P6), and NOT token minting.

**Cadence:** build. One PR, left unmerged for review.

## 1. Scope — numbered, specific

1. **Configuration, by name** (`.env.example`): `AUTH_ISSUER`, `AUTH_JWKS_URL`, `AUTH_AUDIENCE`,
   `AUTH_JWKS_TTL_S` (default 300), `AUTH_CLOCK_SKEW_S` (default 60, the stated constant),
   `AUTH_ALGS` (default `ES256,EdDSA,RS256`). The transport refuses to start when issuer, JWKS URL
   or audience is blank (§3.3: "when the audience is unconfigured").
2. **Protected-resource metadata** (RFC 9728) served at the well-known path the transport already
   reserves: `resource` (the node's own URL, from configuration, never inferred from `Host`),
   `authorization_servers: [AUTH_ISSUER]`, `bearer_methods_supported: ["header"]`,
   `scopes_supported: []`. The `401` challenge's `WWW-Authenticate` carries `resource_metadata`
   pointing at it and, when a token was presented and failed, `error` per RFC 6750 (`invalid_token`
   with no reason text that names a key, claim value or the failing check beyond the RFC's codes —
   the audit seam gets the reason).
3. **JWKS client** (`packages/core/src/auth/jwks.ts`): fetches over HTTPS only (an `http:` URL is a
   configuration refusal at start); caches the key set for the TTL; on a token whose `kid` is not
   in the cache, **refetches once** and then answers from whatever it holds; a fetch failure with a
   valid cache serves the cache, a fetch failure with no valid cache → the verdict is `401`
   (`invalid_token`), never a pass; a key set over 64 KiB or with more than 32 keys is refused;
   fetch timeout 3 s. Keys are used only for the algorithms in `AUTH_ALGS`; a JWK whose `alg`/`kty`
   disagrees with the token header is not tried.
4. **Verifier** (`packages/core/src/auth/verifier.ts`, implements the transport's `Verifier`):
   exactly one `Authorization: Bearer` header (two → `invalid_request`); the token is a compact JWS
   with exactly three segments; header `alg` on the allow-list (`none` and any HMAC family refused
   before any key lookup); `kid` required; signature verified with `node:crypto` (`crypto.verify`
   with the key imported from the JWK) — **no JOSE library at runtime**; `iss` string-equal to
   `AUTH_ISSUER`; `aud` equal to `AUTH_AUDIENCE` whether the claim is a string or a one-element
   array (an array with more than one audience is refused — the reference does not accept tokens
   minted for a set that includes it and others); `exp` required and `now - skew < exp`; `nbf`,
   when present, `nbf < now + skew`; `iat` not in the future beyond skew; `sub` required, non-empty,
   at most 256 chars, and the `Principal.id` is exactly that string. Every failure is `invalid_token`
   to the client and a one-word reason at the audit seam. Verification is constant-time where a
   comparison touches secret-adjacent material.
5. **In-process test issuer** (`packages/core/test/auth/issuer.ts`): generates an ES256 key at
   test start, serves a JWKS from a loopback HTTPS server with a self-signed certificate the test
   process trusts via `NODE_EXTRA_CA_CERTS` scoped to the test (never a global TLS-verification
   switch), mints tokens with arbitrary claims for the negative tests. It is test code, under
   `test/`, and the suite must not touch the network.
6. **Development harness, labelled not-a-product** (`packages/core/dev/oidc/`): a script that runs
   `node-oidc-provider` (pinned exactly, dev dependency, tree measured) as a local issuer for
   end-to-end runs with a real client; README's first line says it is not for deployment and
   configures nothing outside `dev/`.
7. **The principal downstream.** The transport already refuses dispatch without a principal; this
   WO makes `ctx.principal` available to handlers and puts `principal.id` on every log line the
   audit seam emits for a call (the hash-chained audit is `-2002`; the field is placed now so the
   row shape does not change later).
8. **`FEEDBACK.md`** per §6.

## 2. Invariants — restated by number from the northstar

- **N4** — every check fails closed; a fetch failure without cache is a `401`; `alg: none` and HMAC
  are refused before a key is consulted; an unconfigured audience refuses to start.
- **N5** — every check in §1.4 and every rule in §1.3 has a negative test that goes red when the
  check is removed (the *Key-set fetching* ruling names four; there are more here — all of them).
- **N8** — no key material committed; the test issuer generates its key per run; the dev harness
  reads its secrets from named env vars.
- **N6** — the resource URL comes from configuration; no hostname in tree.

**Protected surfaces — must diff to empty:** the four steering documents, `LICENSE`, `NOTICE`,
`scripts/**`, `.github/**`, `spikes/**`, `docs/canonical-form.md`, everything under
`packages/core/src/pinning/**` and `packages/core/src/capability/**`. The transport may change
only at the verifier seam, the PRM route, and where it passes `ctx.principal`.

## 3. Tests / acceptance — what must be proven, not asserted

1. `npm run check` green on both runners, with the suite touching no network.
2. The `curl -i` transcripts: unauthenticated `/mcp` → `401` with `WWW-Authenticate` and the PRM
   URL; the PRM document; `/health` → `200` unauthenticated; a valid token → dispatch.
3. The refusal table — one row per check in §1.4 and §1.3 — each pasted with the client-visible
   result (`401`, RFC 6750 error) and the audit-seam reason; and each shown red when the check is
   removed (a matrix, as `-1005` did).
4. JWKS behaviour pasted: cache hit; unknown `kid` → one refetch (counted by the test issuer);
   second unknown `kid` in the TTL → no second refetch, `401`; issuer down with warm cache →
   verified; issuer down with cold cache → `401`.
5. Skew: a token expiring 30 s ago accepted under the 60 s constant, 90 s ago refused; both pasted.
6. `aud` as `["us"]` accepted, `["us","them"]` refused, `"them"` refused.
7. The dev harness started and one end-to-end call made against it with the real transport, pasted
   (loopback; nothing exposed).
8. No JOSE library in `dependencies`; the runtime dependency list unchanged.

## 4. Scope fence — what is NOT in this work order

- **Dynamic client registration, `iss` on authorization responses, refresh tokens** — client-side
  concerns; the reference is the resource server.
- **Scopes as entitlement.** `-6xxx`; `scopes_supported` is empty on purpose.
- **Token introspection or opaque tokens.** JWT only; a node that needs introspection adds a second
  verifier behind the same interface.
- **mTLS, DPoP.** Recorded as open questions if the builder finds the spec requires either.

## 5. Adversarial pass — try to break it before calling it done

Fresh subagent. Findings with severity into FEEDBACK.

1. A token signed with the *issuer's own public key* as an HMAC secret (the classic confusion):
   refused before any key lookup.
2. A JWKS entry with `alg: RS256` used to verify an `ES256`-headed token: not tried.
3. A token with a `jku`/`x5u` header pointing elsewhere: ignored; only the configured JWKS URL is
   ever fetched.
4. `kid` values that are path-shaped or 10 KB long: refused without a fetch.
5. Two tokens presented in one request (header and body): `invalid_request`.
6. Clock stepped backwards 10 minutes mid-run: a previously valid token stays valid only within
   skew; the test issuer's `iat`-in-the-future case.
7. A JWKS response that is valid JSON but 10 MB: refused at the size cap before parsing.

## 6. Upward-feedback directive

`FEEDBACK.md`: the transcripts first, then the refusal matrix, the JWKS behaviour table, the skew
and audience cases, the dev-harness run, the dependency listing, then the standard entries. Under
*decision-needed*: anything the MCP authorization page requires of a resource server that this WO
does not implement.

## 7. Flag-and-stop conditions

- `node:crypto` cannot verify one of the allow-listed algorithms on the pinned Node — record and
  stop that algorithm; do not add a library.
- The loopback HTTPS issuer cannot be trusted per-process on the Windows runner — run those tests
  Linux-only, record why.
- A protected surface must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-1003` off current `main` where an AS-agnostic verifier configured by issuer, JWKS URL and audience replaces `RefuseAllVerifier`, protected-resource metadata is served and named in every `401`, JWKS keys are cached with one refetch on an unknown kid and a cold-cache fetch failure refuses, every claim and header check fails closed with a negative test shown red when removed, the principal's id is the token's `sub` and reaches handlers and the audit seam, an in-process issuer keeps the suite off the network, a not-a-product dev harness runs one end-to-end call, no JOSE library is a runtime dependency, `npm run check` is green on both runners, and the work is parked as one unmerged pull request. Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-1003 origin/main`. Node 24.21.0. Cadence: **build**, spec-first for the checks — list every check from RFC 8725 and the MCP authorization page in a `CHECKS.md` beside the verifier before writing it, then implement each with its negative test. Read `docs/work-orders/CSR-WO-1003.md` in full and `docs/architecture.md` §5 (*Authorization server*, *Key-set fetching*, *Caller entitlement*), §7.1. Ratified with reasons: `node:crypto` only, no JOSE at runtime; `alg` allow-list with `none`/HMAC refused before key lookup; `aud` string-equal, one audience; `sub` is the identity; one refetch on unknown kid; cold-cache failure is `401`; skew is a stated constant; the resource URL comes from configuration. Protected surfaces per WO §2. Leak gate before every push, exit code checked directly. Adversarial pass per §5 to a fresh subagent. Report the PR link, the `curl` transcripts, and the refusal matrix.
