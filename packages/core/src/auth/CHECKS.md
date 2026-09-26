# Checks: the resource server's token verification (CSR-WO-1003)

Written before the verifier, as the checklist it implements. Every check fails closed. The client
sees only the RFC 6750 error code; the audit seam gets the one-word reason in the last column.
Every row has a negative test in `packages/core/test/auth/`, shown red when the check is removed.
A check marked **(layer)** stands behind another that already refuses the same input; removing it
alone leaves the suite green by construction, and the row says which check covers it.

Sources:
- **RFC 8725**, JSON Web Token Best Current Practices, cited by section title.
- **RFC 6750**, Bearer Token Usage.
- **RFC 9728**, OAuth 2.0 Protected Resource Metadata.
- **RFC 7517 / 7518**, JWK and JWA.
- The MCP `2026-07-28` authorization page (*Token Handling*, *Access Token Privilege Restriction*).

## Request and header

| # | Check | Source | Client | Reason |
|---|---|---|---|---|
| H1 | Exactly one `Authorization` header; two is a malformed request | RFC 6750 *The Authorization Request Header Field*; the transport's F10 | `400` / `invalid_request` | `duplicate-authorization` |
| H2 | No `Authorization` header: a `401` with the challenge and no `error` | RFC 6750 *The WWW-Authenticate Response Header Field* | `401`, no error | `missing` |
| H3 | Another scheme is treated as no token: `401`, no `error` (the client used a method this server does not support). `Bearer` (case-insensitive) must be followed by one space and exactly one token; anything else, a comma-joined pair included, is malformed | RFC 6750 *Error Codes* | `401`, no error / `400` `invalid_request` | `scheme` / `malformed-bearer` |
| H3a | A token also offered in the query (`access_token`) or a form-encoded body is a second method: refused, and never read | RFC 6750 *Authenticated Requests*; WO §5.5 | `400` / `invalid_request` | `token-elsewhere` |
| H4 | The token is at most 8 KiB and a compact JWS: exactly three base64url segments, each unpadded and canonical (unused trailing bits zero, so one token has one spelling) | RFC 7515 compact serialization; RFC 8725 *Perform Algorithm Verification* | `invalid_token` | `malformed` |
| H5 | The JOSE header is strict UTF-8 (an invalid byte is refused, never replaced with U+FFFD) and a JSON object, parsed strictly (duplicate keys refused) | RFC 8725 *Validate All Cryptographic Operations* | `invalid_token` | `header` |
| H6 | `alg` is on the allow-list (`AUTH_ALGS`, default `ES256,EdDSA,RS256`). `none` and every HMAC (`HS*`) are refused **before any key lookup**. The explicit `none`/`HS*` clause is a **(layer)** over the allow-list, which `AUTH_ALGS` validation (G1) keeps free of both | RFC 8725 *Perform Algorithm Verification*, *Use Appropriate Algorithms* | `invalid_token` | `alg` |
| H7 | `crit` present is refused: no extension is understood | RFC 7515 *"crit" Header Parameter* | `invalid_token` | `crit` |
| H8 | `jku`, `x5u`, `jwk` and `x5c` are ignored; only the configured JWKS URL is ever fetched | RFC 8725 *Validate All Cryptographic Operations* (key selection) | — | — |
| H9 | `kid` is required: 1–128 characters of `[A-Za-z0-9._-]`. Anything else is refused without a fetch | RFC 8725 (key selection); WO §5.4 | `invalid_token` | `kid` |
| H10 | `typ`, when present, is `JWT` or `at+jwt` | RFC 8725 *Use Explicit Typing* | `invalid_token` | `typ` |

## Key and signature

| # | Check | Source | Client | Reason |
|---|---|---|---|---|
| K1 | The key is found by `kid` in the configured JWKS (cache, then one refetch; see J3) | RFC 7517 | `invalid_token` | `unknown-kid` |
| K2 | The JWK's `kty` (and `crv`) fit the header `alg`; its `alg`, when present, equals the header's; `use`, when present, is `sig`; `key_ops`, when present, includes `verify`. A mismatched key is not tried. One `kid` may name several keys (RFC 7517); each that fits is tried. The `kty`/`crv` test is a **(layer)**: the key is imported from only the members the `alg` needs, so a wrong type fails there too | RFC 8725 *Perform Algorithm Verification*; RFC 7517 | `invalid_token` | `key-mismatch` |
| K3 | The signature verifies with `node:crypto` (ES256 in IEEE P1363 form, EdDSA over Ed25519, RS256 PKCS#1 v1.5 with SHA-256). An RSA key is used only when its exponent is odd and at least 65537 and its modulus is 2048 to 8192 bits: with e = 1 a digest's own encoding is its signature, so anyone can forge one, and a huge modulus costs CPU an unauthenticated client chooses (red-team F3) | RFC 7518; RFC 8725 | `invalid_token` | `signature` |

## Claims

| # | Check | Source | Client | Reason |
|---|---|---|---|---|
| C1 | The payload is strict UTF-8 and a JSON object, parsed strictly. Lenient decoding would map the bytes `75 FF`, `75 FE` and `75 EF BF BD` to one `sub` (red-team F5) | RFC 8725 | `invalid_token` | `payload` |
| C2 | `iss` is string-equal to `AUTH_ISSUER` | RFC 8725 *Validate Issuer and Subject* | `invalid_token` | `iss` |
| C3 | `aud` equals `AUTH_AUDIENCE`: as a string, or as a one-element array. A multi-audience array is refused | RFC 8725 *Use and Validate Audience*; MCP *Token Handling* (audience-bound) | `invalid_token` | `aud` |
| C4 | `exp` is required, a number, and `now - skew < exp`. (`Number.isFinite` is a **(layer)**: the strict parser refuses a non-finite literal) | RFC 7519; RFC 8725 | `invalid_token` | `exp` |
| C5 | `nbf`, when present, is a number and `nbf < now + skew` | RFC 7519 | `invalid_token` | `nbf` |
| C6 | `iat`, when present, is a number and not later than `now + skew` | RFC 7519 | `invalid_token` | `iat` |
| C7 | `sub` is required: a non-empty string of at most 256 UTF-16 code units. It is the principal's id, and nothing else in the token is trusted for identity | RFC 8725 *Validate Issuer and Subject*; architecture §5 *Authorization server* | `invalid_token` | `sub` |

**The skew** is `AUTH_CLOCK_SKEW_S`, default 60 s: a stated constant, not a library default.

## JWKS

| # | Check | Source | Client | Reason |
|---|---|---|---|---|
| J1 | `AUTH_JWKS_URL` is `https:`; anything else refuses start | architecture §5 *Key-set fetching* | start refused | — |
| J2 | The key set is cached for `AUTH_JWKS_TTL_S` (default 300 s, bounded 30 s to 86,400 s). A clock stepped backwards expires the cache rather than stretching it | same | — | — |
| J3 | An unknown `kid` triggers **one** refetch per TTL window; a second unknown `kid` in the window answers from the cache. Concurrent lookups share one fetch. **The trade-off, stated:** anyone can spend the window with a forged unknown `kid`, so a genuinely new key can wait up to one TTL before it is fetched. Issuers publish a new key before signing with it, which covers this | same | `invalid_token` | `unknown-kid` |
| J4 | A fetch failure with a valid (unexpired) cache serves the cache; with no valid cache, the token is refused. After a failure, no fetch for 10 s (`JWKS_FAILURE_COOLDOWN_MS`), so clients cannot set the rate at which a failing issuer is asked | same | `invalid_token` | `jwks-unavailable` |
| J5 | A response over 64 KiB is refused while streaming, before parsing; more than 32 keys is refused; the body is strict UTF-8 and the JSON is parsed strictly | WO §1.3 | `invalid_token` | `jwks-unavailable` |
| J6 | The whole fetch has a 3 s deadline (not an idle timeout, which a server dripping bytes never trips), and a redirect is not followed (`node:https` follows none) | WO §1.3 | `invalid_token` | `jwks-unavailable` |

## Configuration and metadata

| # | Check | Source |
|---|---|---|
| G1 | `AUTH_ISSUER`, `AUTH_JWKS_URL`, `AUTH_AUDIENCE`, and the resource URL: any of them blank refuses start | WO §1.1; architecture §6 |
| G2 | The RFC 9728 document is `{resource, authorization_servers: [AUTH_ISSUER], bearer_methods_supported: ["header"], scopes_supported: []}`, and `resource` comes from configuration, never from `Host` | RFC 9728; MCP *Protected Resource Metadata* |
| G3 | Every `401` carries `WWW-Authenticate: Bearer resource_metadata="…"`, plus `error` when a token was presented and failed, and never a reason naming a key, claim value or check | RFC 6750; RFC 9728 *WWW-Authenticate Response* |
| G4 | Every HTTP-level refusal the transport sends writes exactly one audit line: its event (`http-refused {status, reason}`, or the event's own line for `auth-refused`, `verifier-timeout`, `verifier-contract` and `transport-error`), a one-word reason (`duplicate-authorization` for H1), and the principal once it is known (red-team F1). JSON-RPC errors that dispatch returns for a well-formed request are not HTTP-level refusals: their status is the era's and their events are dispatch's own | CHECKS H1; red-team F1 |

## The MCP authorization page, for a resource server

- **Implemented here:** validate the token's audience (C3), serve protected-resource metadata
  (G2), `401` with `WWW-Authenticate` (G3), never pass the token through to an upstream (the core
  forwards nothing), and the token only in the `Authorization` header (H1–H3; a token in the URL
  is never read).
- **Not implemented, recorded for the architect:** scope checks and `403 insufficient_scope`,
  because scopes are entitlement, deferred to P6 (WO §4); and the `WWW-Authenticate` `scope`
  parameter.
