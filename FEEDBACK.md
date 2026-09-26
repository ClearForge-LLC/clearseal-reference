# FEEDBACK: CSR-WO-1003 (the resource server's token verifier, AS-agnostic)

Branch `wo/CSR-WO-1003`, cut from `main` at `7e11d0b`, rebased onto `809a6b9` (`-1002a` merged) for
the red-team fix-up, and kept as one commit. Parked as one unmerged pull
request. Built on Node v24.21.0.

## Transcripts (WO §3.2)

`curl -i` against the dev harness (below): node-oidc-provider on loopback HTTPS as the
authorization server, the real transport with the core's `JwtVerifier` as the resource server. The
token came from the provider's token endpoint (client credentials, resource indicator) and is
elided. Ports are ephemeral.

```
$ curl -i -X POST http://127.0.0.1:<port>/mcp   # no Authorization
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Content-Length: 66
Cache-Control: no-store
X-Content-Type-Options: nosniff
WWW-Authenticate: Bearer resource_metadata="http://127.0.0.1:42841/.well-known/oauth-protected-resource/mcp"

{"jsonrpc":"2.0","error":{"code":-32600,"message":"Unauthorized"}}

$ curl -i http://127.0.0.1:<port>/.well-known/oauth-protected-resource/mcp
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 153
Cache-Control: no-store
X-Content-Type-Options: nosniff

{"resource":"http://127.0.0.1:42841/mcp","authorization_servers":["https://127.0.0.1:33269"],"bearer_methods_supported":["header"],"scopes_supported":[]}

$ curl -i http://127.0.0.1:<port>/health
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 116
Cache-Control: no-store
X-Content-Type-Options: nosniff

{"status":"ok","version":"0.0.0","protocolVersions":["2026-07-28","2025-11-25"],"pinned":{"admitted":1,"refused":0}}

$ curl -i -X POST http://127.0.0.1:<port>/mcp -H "Authorization: Bearer <token from the provider>"
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 209
Cache-Control: no-store
X-Content-Type-Options: nosniff

{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"clearseal-dev-client"}],"resultType":"complete","_meta":{"io.modelcontextprotocol/serverInfo":{"name":"@clearseal/core","version":"0.0.0"}}}}

$ curl -i -X POST http://127.0.0.1:<port>/mcp -H "Authorization: Bearer <the same token, payload altered>"
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Content-Length: 66
Cache-Control: no-store
X-Content-Type-Options: nosniff
WWW-Authenticate: Bearer resource_metadata="http://127.0.0.1:42841/.well-known/oauth-protected-resource/mcp", error="invalid_token"

{"jsonrpc":"2.0","error":{"code":-32600,"message":"Unauthorized"}}
```

The audit seam for the same run, and nothing else, got the reasons:

```
[audit-seam] auth-refused {"reason":"missing"}
[audit-seam] auth-refused {"reason":"signature"}
```

## The refusal matrix (WO §3.3)

Every row is a test in `packages/core/test/auth/verifier.test.ts` (pasted from its output), plus the
transport-level rows from `transport.test.ts`. "Client" is what the client sees; "Reason" is the
audit seam's word. "Fetches" is the key-set fetches the verifier made: 0 means the check fired
before any key was looked up. Each row is shown red when its check is removed in the matrix under
*Red-proofs*.

| # | Case | Client | Reason | Fetches |
|---|---|---|---|---|
| H2 | no Authorization header | `401`, no error | `missing` | 0 |
| H3 | scheme is Basic (no error code: an unsupported method) | `401`, no error | `scheme` | 0 |
| H3 | Bearer with two tokens | `400` `invalid_request` (transport) | `malformed-bearer` | 0 |
| H3 | two Bearer credentials joined by a comma | `400` `invalid_request` (transport) | `malformed-bearer` | 0 |
| H3 | Bearer with no token | `400` `invalid_request` (transport) | `malformed-bearer` | 0 |
| H4 | two segments | `401` `invalid_token` | `malformed` | 0 |
| H4 | four segments | `401` `invalid_token` | `malformed` | 0 |
| H4 | a validly signed token over 8 KiB | `401` `invalid_token` | `malformed` | 0 |
| H4 | signature segment not base64url | `401` `invalid_token` | `malformed` | 0 |
| H4 | a valid signature respelled: unused trailing bits set (adversarial A11) | `401` `invalid_token` | `malformed` | 0 |
| H5 | header not base64url JSON | `401` `invalid_token` | `header` | 0 |
| H5 | header is an array | `401` `invalid_token` | `header` | 0 |
| H5 | header with a duplicate key (alg twice) | `401` `invalid_token` | `header` | 0 |
| H6 | alg none, unsigned | `401` `invalid_token` | `alg` | 0 |
| H6 | alg None, unsigned | `401` `invalid_token` | `alg` | 0 |
| H6 | WO §5.1: HS256 keyed with the issuer's own public key | `401` `invalid_token` | `alg` | 0 |
| H6 | alg PS256, not on the allow-list | `401` `invalid_token` | `alg` | 0 |
| H6 | EdDSA token, AUTH_ALGS=ES256 | `401` `invalid_token` | `alg` | 0 |
| H7 | crit present | `401` `invalid_token` | `crit` | 0 |
| H9 | no kid | `401` `invalid_token` | `kid` | 0 |
| H9 | WO §5.4: path-shaped kid | `401` `invalid_token` | `kid` | 0 |
| H9 | kid of 129 characters | `401` `invalid_token` | `kid` | 0 |
| H9 | kid a number | `401` `invalid_token` | `kid` | 0 |
| H9 | WO §5.4: kid of 10 KB (over the token cap first) | `401` `invalid_token` | `malformed` | 0 |
| H10 | typ JOSE | `401` `invalid_token` | `typ` | 0 |
| K1 | kid not in the key set | `401` `invalid_token` | `unknown-kid` | 2 |
| K2 | WO §5.2: ES256 header naming an RS256 key | `401` `invalid_token` | `key-mismatch` | 1 |
| K2 | a P-256 key served with use enc | `401` `invalid_token` | `key-mismatch` | 1 |
| K2 | a P-256 key served with key_ops [encrypt] (adversarial A8) | `401` `invalid_token` | `key-mismatch` | 1 |
| K2 | a P-256 key served with alg ES384 | `401` `invalid_token` | `key-mismatch` | 1 |
| K3 | an RSA key of 1024 bits | `401` `invalid_token` | `key-mismatch` | 1 |
| K3 | payload altered after signing | `401` `invalid_token` | `signature` | 1 |
| K3 | signed by another key under a served kid | `401` `invalid_token` | `signature` | 1 |
| C1 | payload not JSON | `401` `invalid_token` | `payload` | 0 |
| C1 | payload with a duplicate key (sub twice) | `401` `invalid_token` | `payload` | 0 |
| C2 | iss another issuer | `401` `invalid_token` | `iss` | 1 |
| C2 | iss with a trailing slash | `401` `invalid_token` | `iss` | 1 |
| C2 | iss missing | `401` `invalid_token` | `iss` | 1 |
| C3 | aud "them" | `401` `invalid_token` | `aud` | 1 |
| C3 | aud ["us","them"] | `401` `invalid_token` | `aud` | 1 |
| C3 | aud missing | `401` `invalid_token` | `aud` | 1 |
| C3 | aud [] | `401` `invalid_token` | `aud` | 1 |
| C4 | exp missing | `401` `invalid_token` | `exp` | 1 |
| C4 | exp a string | `401` `invalid_token` | `exp` | 1 |
| C4 | exp 90 s ago (skew 60) | `401` `invalid_token` | `exp` | 1 |
| C5 | nbf 90 s ahead | `401` `invalid_token` | `nbf` | 1 |
| C5 | nbf a string | `401` `invalid_token` | `nbf` | 1 |
| C6 | iat 90 s ahead | `401` `invalid_token` | `iat` | 1 |
| C6 | iat a string | `401` `invalid_token` | `iat` | 1 |
| C7 | sub missing | `401` `invalid_token` | `sub` | 1 |
| C7 | sub empty | `401` `invalid_token` | `sub` | 1 |
| C7 | sub of 257 characters | `401` `invalid_token` | `sub` | 1 |
| C7 | sub a number | `401` `invalid_token` | `sub` | 1 |

**Accepted, each boundary on the inside:**

```
ACCEPTED | ES256 | principal user-42
ACCEPTED | EdDSA | principal user-42
ACCEPTED | RS256 | principal user-42
ACCEPTED | scheme bearer in lower case | principal user-42
ACCEPTED | typ JWT | principal user-42
ACCEPTED | typ absent | principal user-42
ACCEPTED | WO §3.6 aud ["us"] | principal user-42
ACCEPTED | WO §3.5 exp 30 s ago (skew 60) | principal user-42
ACCEPTED | nbf 30 s ahead | principal user-42
ACCEPTED | iat 30 s ahead | principal user-42
ACCEPTED | nbf and iat absent | principal user-42
ACCEPTED | sub of 256 characters | principal ssssssssssssssss
ACCEPTED | one kid naming an EC and an OKP key: an EdDSA token finds the OKP one (adversarial A7) | principal user-42
ACCEPTED | one kid naming an EC and an OKP key: an ES256 token finds the EC one (adversarial A7) | principal user-42
```

**H8 (WO §5.3), with the attacker provably reachable:**

```
H8 | es-1 | attacker fetches 0 | configured fetches 1 | signature
H8 | atk-1 | attacker fetches 0 | configured fetches 2 | unknown-kid
```

**Transport-level rows** (`transport.test.ts`):

| # | Case | Client | Reason |
|---|---|---|---|
| H1 | two `Authorization` headers, both valid | `400` (the transport's F10) | — |
| H2 | no `Authorization` | `401`, `WWW-Authenticate: Bearer resource_metadata="…"`, no `error` | `missing` |
| H3 | `Basic …` | `401`, challenge, no `error` | `scheme` |
| H3 | `Bearer A, Bearer B` in one header | `400`, challenge with `error="invalid_request"` | `malformed-bearer` |
| H3a | header token plus `?access_token=` | `400`, `error="invalid_request"` | `token-elsewhere` |
| H3a | header token plus a form-encoded body | `400`, `error="invalid_request"` | `token-elsewhere` |
| H3a | `?access_token=` alone | `400`, `error="invalid_request"` (never read) | `token-elsewhere` |
| G1 | the core's verifier with no resource URL | start refused | — |
| G1 | no verifier and no `AUTH_*` | start refused, naming `AUTH_ISSUER` | — |
| G2 | the metadata document, at both well-known paths | `{resource, authorization_servers:[AUTH_ISSUER], bearer_methods_supported:["header"], scopes_supported:[]}`; `resource` from configuration even when `Host` differs | — |
| G3 | a failed token (`aud` them) | `401`, `error="invalid_token"`; no check name or claim value in the body or header | `aud` |

## JWKS behaviour (WO §3.4)

```
JWKS | cache hit | fetches within TTL 1 | after TTL 2
JWKS | unknown kid (rotated) | refetches 1 | verified
JWKS | second unknown kid in TTL | refetches 0 | 401 unknown-kid
JWKS | issuer down, warm cache | verified
JWKS | issuer down, cold cache | 401 jwks-unavailable
JWKS | issuer down, expired cache | 401 jwks-unavailable
JWKS | issuer down, cold cache, 30 requests | fetches 1 | after the cooldown 2
JWKS | 10 MB key set | 401 jwks-unavailable | 23 ms
JWKS | hanging key set | 401 jwks-unavailable | 3000 ms
JWKS | key set dripped 1 byte / 400 ms | 401 jwks-unavailable | 3000 ms
```

- **A burst of 50 unknown kids at once** costs one refetch; a cold burst of 50 valid tokens shares one fetch.
- **A failed refetch for an unknown kid keeps the warm cache.**
- **32 keys are served, 33 refused;** a key set that is not a key set, or has a duplicate member, is refused. A redirect is not followed (the `Location` is never requested). An untrusted certificate is a fetch failure.
- **A non-https key-set URL** (`http:`, `file:`, not a URL) refuses construction (J1).

## Skew and audience (WO §3.5, §3.6)

Skew is `AUTH_CLOCK_SKEW_S`, default 60 s: a stated constant, bounded 0–300.

| Case | Result |
|---|---|
| `exp` 30 s ago | **accepted** (`ACCEPTED | WO §3.5 exp 30 s ago (skew 60)`) |
| `exp` 90 s ago | **refused**, `invalid_token` / `exp` |
| `exp` 30 s ago with `AUTH_CLOCK_SKEW_S=0` | refused, `exp` |
| `nbf` / `iat` 30 s ahead | accepted |
| `nbf` / `iat` 90 s ahead | refused, `nbf` / `iat` |
| `aud: ["us"]` | **accepted** |
| `aud: ["us","them"]` | **refused**, `aud` |
| `aud: "them"` | **refused**, `aud` |
| `aud` missing, `[]` | refused, `aud` |

**WO §5.6, the clock stepped back 10 minutes mid-run:**

```
CLOCK | stepped back 600 s | minted before the step: nbf
CLOCK | iat 600 s in the future | iat
```

A token minted before the step is refused once outside skew (`nbf`); one minted on the new clock verifies, and the step **expires** the key-set cache (one fetch) rather than stretching it by ten minutes. A step back does not hold the unknown-kid window shut.

## The dev harness (WO §3.7)

`packages/core/dev/oidc/`. Its README's first line: *"NOT FOR DEPLOYMENT. A development harness
only: it is not part of ClearSeal, it never ships, and nothing here is a supported authorization
server."*

- node-oidc-provider `9.12.2`, a devDependency of `@clearseal/core`, pinned exactly. HTTPS on
  `127.0.0.1` with a certificate generated per run, trusted only by this process's key-set client.
  Signing key generated per run. The client secret comes from `DEV_OIDC_CLIENT_SECRET` (named in
  `.env.example`, at least 32 characters), never printed.
- One client, client-credentials grant, resource indicator: the access token is an ES256 `at+jwt`
  whose `aud` is the node's resource URL and whose `sub` is the client id.
- It is type-checked and linted with the core (`tsconfig` includes `dev/**`). A ten-line local
  type declaration covers the two members it uses, instead of `@types/oidc-provider` and its tree.

One end-to-end run (`DEV_OIDC_CLIENT_SECRET=… node packages/core/dev/oidc/harness.ts`), exit 0:

```
TOKEN 200 header {"alg":"ES256","typ":"at+jwt","kid":"dev-1a89c5d00500"}
TOKEN claims {"jti":"O0CoEf-xI_GjytNWRt9F1XeKM2vQNzqEQyYs7hyiPPC","sub":"clearseal-dev-client","iat":1790435290,"exp":1790435890,"client_id":"clearseal-dev-client","iss":"https://127.0.0.1:35017","aud":"http://127.0.0.1:40273/mcp"}
CALL 200 {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"clearseal-dev-client"}],"resultType":"complete","_meta":{"io.modelcontextprotocol/serverInfo":{"name":"@clearseal/core","version":"0.0.0"}}}}
[audit-seam] auth-refused {"reason":"signature"}
TAMPERED 401 Bearer resource_metadata="http://127.0.0.1:40273/.well-known/oauth-protected-resource/mcp", error="invalid_token"
```

The token's `sub` (the client id) is the principal the handler answered with. `jti` is a one-time id of a token that expired ten minutes after this run.

## Dependencies (WO §3.8)

- **Runtime:** unchanged. `npm ls -w @clearseal/core --omit=dev --all` before and after is
  byte-identical: `z-schema@12.4.6` and its four. **No JOSE library** at runtime; the verifier uses
  `node:crypto` only.
- **Dev:** `oidc-provider@9.12.2`, exact. The lockfile grows from 203 to 222 entries: `koa` and
  its tree, `cookies`, `keygrip`, `tsscmp`, `deep-equal`, `http-assert`, `oidc-provider`. `jose`
  (a JOSE library) is in the dev tree already, through `@modelcontextprotocol/sdk`, and is now
  shared with the provider: dev only, never imported by `src`.

## What was built

- **`packages/core/src/auth/CHECKS.md`**, written first: every check from RFC 8725, RFC 6750,
  RFC 9728, RFC 7515/7517/7518 and the MCP authorization page, with its client result, its audit
  reason, and its test. Checks that stand behind another are marked *(layer)*.
- **`auth/jws.ts`**: `keyFits`, `importKey` (only the members the `alg` needs; RSA under 2048
  refused), `verifySignature` (ES256 in IEEE P1363 form, EdDSA, RS256), strict canonical base64url.
- **`auth/jwks.ts`**: the key-set client. HTTPS only; TTL cache (30 s to 1 day); one refetch per
  window on an unknown `kid`, shared by concurrent lookups; a warm cache served through failures,
  a cold one refused; a 10 s cooldown after a failed fetch; 64 KiB and 32 keys; a 3 s deadline on
  the whole fetch; no redirects; strict JSON; one `kid` may name several keys. Trust is a per-client
  `ca`, never a process switch.
- **`auth/verifier.ts`**: `JwtVerifier` (the checks in CHECKS order) and `jwtVerifierFromEnv`.
  The principal's id is the token's `sub`.
- **The transport, at the three places the WO allows:**
  - *The verifier seam:* the default verifier is `jwtVerifierFromEnv()`, resolved after the pin
    checks; with the core's verifier the resource URL must be configured (G1). `RefuseAllVerifier`
    is gone. `Verdict` gains `reason`, which goes to `auth-refused` on the audit seam and never to
    the client. An `invalid_request` verdict answers `400`, anything else `401`, both with the
    challenge. A token offered in the query or a form body is refused before the verifier runs.
  - *The PRM route:* `authorization_servers` is the verifier's issuer; `scopes_supported: []`.
  - *Where the principal is passed:* the per-call `ctx.audit` binds `principal.id`, so every
    call-scoped line carries it, including a containment refusal that fires after the handler
    returned. `transport-error` carries it too once the caller is known.
- **Tests:** the in-process issuer (`test/auth/issuer.ts`: ES256, EdDSA and RS256 keys per run, a
  loopback HTTPS key set whose certificate is built in `test/auth/cert.ts` with `node:crypto` and a
  small DER encoder, a unique subject per certificate, fetch counting and down/hang/redirect/drip
  modes). `verifier.test.ts` (the matrix, the boundaries, the key set, the clock, configuration)
  and `transport.test.ts` (transcripts, the principal, the late containment refusal).
- **`.env.example`:** `AUTH_ISSUER`, `AUTH_JWKS_URL`, `AUTH_AUDIENCE`, `AUTH_JWKS_TTL_S=300`,
  `AUTH_CLOCK_SKEW_S=60`, `AUTH_ALGS=ES256,EdDSA,RS256`, and `DEV_OIDC_CLIENT_SECRET` for the
  harness only.

## Deviations

| # | Deviation | Why |
|---|---|---|
| D-1 | **WO §1.5 names `NODE_EXTRA_CA_CERTS`** to trust the test issuer's certificate. It is read only at process start and is process-wide. The key-set client takes its own `ca` instead: the self-signed certificate is trusted by that one client, nowhere else. Verified by the adversarial pass: a plain `https` request in the same process after a verifier fetch still fails `DEPTH_ZERO_SELF_SIGNED_CERT`, and `globalAgent` is untouched. §7's Windows flag-and-stop does not arise: the tests run on both runners | Per-client trust is what §1.5's "never a global TLS switch" asks. For the architect to ratify |
| D-2 | **WO §5.5 (two tokens)** is enforced at the transport's auth step, not in the verifier: `Verifier.verify` sees headers only, so a query or body token is invisible to it. `tokenElsewhere` is at the verifier seam, the first of the three places the transport may change | The interface is headers-only by design |
| D-3 | **H3 is split per RFC 6750.** WO §1.4 says `invalid_token` to the client. Another scheme (`Basic`) is treated as no token: `401` with the challenge and no `error`. A malformed `Bearer` (two tokens, a comma-joined pair, none) is `400 invalid_request` | RFC 6750 *Error Codes*; adversarial A4, A5 |
| D-4 | **The resource URL is required with the core's verifier** (G1), from the transport's `resourceUrl` setting: there is no `AUTH_RESOURCE_URL`. The transport's old derivation from the bound address stays only for a custom verifier (tests) | §1.1 lists six variables; the kickoff says the URL comes from configuration. See *decision-needed* |
| D-5 | **`transport-error` carries the principal** once the caller is authenticated (adversarial A16). It is one field on one line, beside the `ctx.audit` binding | The kickoff: every call-scoped event carries the caller |
| D-6 | **The dev harness imports test helpers** (`cert.ts`, `pinForTest`, `tag`), so it pins its one tool through the same path a node uses | It is dev tooling, never shipped |

## Red-proofs (N5)

64 mutants, each removing or weakening one check, were run against the auth tests (and, for the
transport's, the transport and containment tests too), each run limited to 300 s, on a committed
tree (the script refuses a dirty one). **61 go red. The 3 green are the layers CHECKS.md names:** the
`none`/HMAC clause (behind the allow-list, which G1 keeps free of both), the `kty`/`crv` test
(behind `importKey`, which reads only the members the `alg` needs), and strict base64url (behind the
canonical re-encoding check, which refuses the same input). The two J6 mutants go red by hanging to
the 300 s kill: the lookup never ends.

| # | Mutant | Red in |
|---|---|---|
| H2 | missing header not told apart | auth RED 7: unauthenticated /mcp: 401, WWW-Authenticate naming the metadata document, no error code |
| H3 | any scheme accepted | auth RED 7: H3 a scheme other than Bearer: 401 with the challenge and no error code (RFC 6750) |
| H3 | another scheme gets an error code | auth RED 7: H3 a scheme other than Bearer: 401 with the challenge and no error code (RFC 6750) |
| H3 | more than one token accepted | auth RED 11: H3 a malformed Bearer (two credentials joined by a comma): 400 invalid_request, not disp |
| H3 | invalid_request answered 401 | auth RED 4: H3 a malformed Bearer (two credentials joined by a comma): 400 invalid_request, not disp |
| H4 | non-canonical base64url accepted | auth RED 4: H4 a valid signature respelled: unused trailing bits set (adversarial A11) → invalid_tok |
| H4 | no size cap | auth RED 6: H4 a validly signed token over 8 KiB → invalid_token / malformed |
| H4 | segment count loose | auth RED 4: H4 four segments → invalid_token / malformed |
| H4 | signature not strict base64url | GREEN |
| H5/C1 | JSON not strict (duplicate keys) | auth RED 10: H5 header not base64url JSON → invalid_token / header |
| H5/C1 | array accepted as object | auth RED 4: H5 header is an array → invalid_token / header |
| H6 | whole alg check removed | auth RED 12: H6 alg none, unsigned → invalid_token / alg |
| H6 | allow-list not consulted | auth RED 8: H6 alg None, unsigned → invalid_token / alg |
| H6 | none/HMAC clause removed (layer over the allow-list) | GREEN |
| H6 | AUTH_ALGS not validated | auth RED 4: AUTH_ALGS naming an algorithm this verifier does not implement refuses start (HS256, non |
| H7 | crit accepted | auth RED 4: H7 crit present → invalid_token / crit |
| H9 | kid shape not checked | auth RED 6: H9 WO §5.4: path-shaped kid → invalid_token / kid |
| H10 | typ not checked | auth RED 4: H10 typ JOSE → invalid_token / typ |
| K2 | keyFits not called | auth RED 8: K2 a P-256 key served with use enc → invalid_token / key-mismatch |
| K2 | key_ops not checked | auth RED 4: K2 a P-256 key served with key_ops [encrypt] (adversarial A8) → invalid_token / key-mism |
| K2 | only the last key under a kid | auth RED 4: one kid naming an EC and an OKP key: an ES256 token finds the EC one (adversarial A7) |
| K2 | use not checked | auth RED 4: K2 a P-256 key served with use enc → invalid_token / key-mismatch |
| K2 | JWK alg not checked | auth RED 4: K2 a P-256 key served with alg ES384 → invalid_token / key-mismatch |
| K2 | kty/crv not checked (layer: importKey re-derives them) | GREEN |
| K3 | signature not verified | auth RED 9: K3 payload altered after signing → invalid_token / signature |
| K3 | weak RSA accepted | auth RED 4: K3 an RSA key of 1024 bits → invalid_token / key-mismatch |
| K3 | ES256 in DER form | auth RED 100: a valid token dispatches, and the handler sees the token's sub as the principal (WO §1.7 |
| C2 | iss not checked | auth RED 8: C2 iss another issuer → invalid_token / iss |
| C3 | aud not checked | auth RED 13: G3 a failed token: 401 with error=invalid_token; the reason reaches the audit seam and n |
| C3 | multi-audience array accepted | auth RED 4: C3 aud ["us","them"] → invalid_token / aud |
| C4 | exp not checked | auth RED 11: C4 exp missing → invalid_token / exp |
| C4 | skew doubled | auth RED 4: C4 exp 90 s ago (skew 60) → invalid_token / exp |
| C4 | no skew | auth RED 4: WO §3.5 exp 30 s ago (skew 60) |
| C5 | nbf not checked | auth RED 9: C5 nbf 90 s ahead → invalid_token / nbf |
| C6 | iat not checked | auth RED 9: C6 iat 90 s ahead → invalid_token / iat |
| C7 | sub not checked | auth RED 10: C7 sub missing → invalid_token / sub |
| C7 | sub length unbounded | auth RED 4: C7 sub of 257 characters → invalid_token / sub |
| C7 | principal from another claim | auth RED 4: C7: the principal's id is the token's sub, and only that |
| G1 | blank config accepted | auth RED 4: a blank issuer, key-set URL or audience refuses start, naming the variable |
| G1 | skew not bounded | auth RED 4: a skew or TTL that is not a sane number refuses start |
| J1 | http key-set URL accepted | auth RED 4: J1 a key-set URL that is not https refuses construction |
| J2 | cache never expires | auth RED 9: J2 cache hit: two verifications, one fetch; past the TTL, a second fetch |
| J2 | clock step back extends the cache | auth RED 6: a token minted before the step is refused once it is outside skew; the cache is not stre |
| J3 | refetch on every unknown kid | auth RED 4: J3 unknown kid: one refetch finds a rotated key; a second unknown kid in the window gets |
| J3 | no refetch on an unknown kid | auth RED 6: J3 unknown kid: one refetch finds a rotated key; a second unknown kid in the window gets |
| J3 | concurrent refreshes not shared | auth RED 4: J3 a burst of verifications on a cold cache shares one fetch (adversarial A9) |
| J4 | cold cache not refused | auth RED 20: J4 issuer down with a warm cache: verified; with a cold cache: 401; with an expired cach |
| J4 | failure drops a warm cache | auth RED 4: J4 a failed refetch for an unknown kid keeps the warm cache |
| J4 | no failure cooldown | auth RED 4: J4 a failing issuer is not hammered: one fetch per cooldown, whatever the request rate ( |
| J2 | TTL not bounded | auth RED 4: a skew or TTL that is not a sane number refuses start |
| J4 | certificate not verified | auth RED 4: J4 an untrusted certificate is a fetch failure: the trust is this client's, not the proc |
| J5 | no size cap | auth RED 4: J5 WO §5.7: a 10 MB key set that is valid JSON is refused at the cap |
| J5 | no key-count cap | auth RED 4: J5 32 keys are served; 33 are refused |
| J5 | key set JSON not strict | auth RED 4: J5 a key set that is not a key set, or has a duplicate key, is refused |
| J6 | no deadline | auth RED (hang, killed at 300 s) |
| J6 | idle timeout instead of a deadline | auth RED (hang, killed at 300 s) |
| G1 | resource URL not required | auth RED 4: with the core's verifier and no resource URL, the transport refuses to start |
| G1 | no verifier: a permissive default | transport RED 4: G1: without a verifier and without AUTH_* configuration, the transport refuses to start |
| G2 | PRM names configured servers, not the issuer | auth RED 4: the protected-resource metadata document, at both well-known paths (G2) ; transport RED 4: /health and the metadata document stay reachable; the document names the verifier's issu |
| G3 | error code not in the challenge | auth RED 6: G3 a failed token: 401 with error=invalid_token; the reason reaches the audit seam and n ; transport RED 4: AU-2 wrong bearer → 401 with error=invalid_token |
| G3 | reason not audited | auth RED 7: unauthenticated /mcp: 401, WWW-Authenticate naming the metadata document, no error code |
| H1 | two Authorization headers allowed | auth RED 4: H1 two Authorization headers, both valid: 400 and nothing dispatched ; transport RED 7: F9 F10 F11 duplicate Host → 400; absolute-form target → 400; duplicate Authorization → 4 |
| §5.5 | token elsewhere allowed | auth RED 8: WO §5.5 a token in the header and the query: 400 invalid_request, and the query token is |
| §1.7 | principal not on call-scoped audit lines | auth RED 6: a containment refusal that fires after the handler returned carries the caller's princip ; containment RED 4: a null-domain tool that reaches is refused: -32603 names the kind, the audit seam gets t |

## Adversarial pass (fresh subagent, WO §5; its own scratch worktree, since removed)

The subagent attacked `2636073` with 122 probe tests of its own (not committed; the ones that found
something are now tests here). **No token was forged or accepted, and no `jku`/`x5u`/`jwk`/`x5c`/`x5t`
was ever followed.**

| # | Finding | Severity | Status |
|---|---|---|---|
| A1 | The key-set "timeout" was Node's socket **idle** timeout: a key set dripping one byte a second ran 10 s and wedged every lookup sharing the fetch (worst case, 64 KiB at under 3 s a byte: hours of `503`) | **high** | **Fixed:** a deadline on the whole fetch. Tested with a 400 ms drip: refused at 3002 ms, both concurrent lookups |
| A2 | A cold or expired cache with the issuer failing refetched on **every** request, including unauthenticated forged ones: clients set the rate at which a failing issuer is asked | medium | **Fixed:** after a failure, no fetch for 10 s (`JWKS_FAILURE_COOLDOWN_MS`). Tested: 30 requests, 1 fetch; after the cooldown, 1 more; recovery when the issuer is back |
| A3 | **My H8 test was vacuous.** Every test certificate had the same subject, so the concatenated CA bundle did not trust the attacker: a verifier that followed `jku` would have failed at TLS with the attacker's count still 0. It went red on a `jku` mutant only because the reason changed | medium (test) | **Fixed:** a unique subject per certificate; a test first proves the attacker's key set **is** reachable with that trust; the `jku` cases now run with a known kid and an attacker-only kid (the refetch path live). Both: attacker fetches 0 |
| A4 | `Authorization: Bearer A, Bearer B` got `401 invalid_request`; RFC 6750 says `400` | low | **Fixed** (D-3). Tested |
| A5 | `Basic` got `error="invalid_request"`; RFC 6750: no error code for an unsupported method | low | **Fixed** (D-3). Tested |
| A6 | One forged unknown `kid` spends the refetch window, so a genuinely new key can wait up to one TTL | low | **Documented** in CHECKS J3 as the trade-off of the ratified one-refetch rule. Issuers publish before signing |
| A7 | Only the last key under a `kid` was kept; RFC 7517 allows one `kid` across key types | low | **Fixed:** every key under the `kid` that fits is tried. Tested in both orders |
| A8 | `key_ops` was ignored | low | **Fixed:** when present, it must include `verify`. Tested |
| A9 | The cold-cache coalescing was untested (a mutant survived) | low (test) | **Fixed:** a cold burst of 50 costs one fetch. Tested; the mutant is now red |
| A10 | Three mutants survive by construction (`none`/`HS` clause, `isFinite(exp)`) | info | **Labelled** *(layer)* in CHECKS, with the check that covers each |
| A11 | Unused trailing bits in the signature gave a second spelling of a valid token; an ECDSA high-S twin also verifies | info | **Trailing bits fixed:** base64url must be canonical. Tested. **High-S not changed:** token strings are not used as keys anywhere; recorded under *decision-needed* |
| A12 | No maximum token lifetime (`exp` 1e308 accepted) | info | Recorded: the issuer signs it; policy, not a bypass. *Decision-needed* |
| A13 | `sub` length is in UTF-16 units; control characters and look-alikes are distinct principals | info | CHECKS says "UTF-16 code units". The audit seam JSON-escapes, so no log injection held. A character policy is *decision-needed* |
| A14 | An EC `x` of 33 bytes with a leading zero imports | info | Not changed: the key set is trusted input; lenient parsing only |
| A15 | `AUTH_JWKS_TTL_S` had no bounds | low | **Fixed:** 30 s to 86,400 s. Tested |
| A16 | `transport-error` lacked the principal | low | **Fixed** (D-5) |
| A17 | D-1 is better than the WO's wording, but `jwtVerifierFromEnv` cannot set a private CA | info | *Decision-needed* |
| A18 | An oscillating clock costs one fetch per step | info | A clock fault, not attacker-driven. No change |

**WO §5 items:** 1 HMAC with the public key (48 alg spellings × key forms): **pass**, all `alg`
with 0 fetches. 2 RS256 JWK for an ES256 token: **pass**, `key-mismatch`. 3 `jku`/`x5u`: **pass**
(and the test is now real, A3). 4 path-shaped and 10 KB `kid`: **pass**, no fetch. 5 two tokens:
never dispatched; status now `400` in every form (A4). 6 clock back 10 minutes: **pass**. 7 10 MB
key set: **pass**; the drip form was A1, fixed.

## External red-team findings (after parking): F1 to F6

The architect's external red team attacked PR #40. **Nothing critical or high:** no dispatch without
a valid token, no algorithm or key confusion, no forgery against a correct key set; the key-set
client held under every probe (70 unknown kids cost 2 fetches, 50 cold verifies 1, drip and hang cut
at 3 s, 50 MB cut at 64 KiB, no redirect). Six low findings; the architect verified F1 and F3.

| # | Finding | Severity | Disposition |
|---|---|---|---|
| F1 | `refuse()` never audited, so the 406, 415, 413, 400, 503 and 403 refusals and the duplicate-`Authorization` 400 left no line, contradicting CHECKS H1 | low | **Fixed.** Every HTTP-level refusal writes exactly one line (CHECKS G4). Tested per status and reason below; red-proofs below |
| F2 | `typ` accepts `JWT` and `at+jwt` only: `application/at+jwt` is refused, and there is no strict mode requiring `at+jwt` | low | **Deferred to `-1003a`** (architect): accept `application/at+jwt`; an optional strict mode |
| F3 | `importKey` rejected only RSA under 2048 bits: a key with `e = 1` makes the raw PKCS#1 v1.5 encoding of SHA-256(signing input) verify as a signature, with no private key; and a 16384-bit modulus imports, so 32 keys under one kid cost about 220 ms CPU per unauthenticated request | low (a correct issuer never serves such a key) | **Fixed.** An RSA key is used only with an odd exponent of at least 65537 and a 2048 to 8192 bit modulus. Red-proof below |
| F4 | No cap on how far in the future `exp` may be | low | **Deferred to `-1003a`** (architect): an `exp` horizon cap |
| F5 | The header, payload and key set decoded leniently (`buf.toString("utf8")`): `sub` bytes `75 FF`, `75 FE` and `75 EF BF BD` all became the principal `"u\uFFFD"` | low | **Fixed.** Strict UTF-8 (`TextDecoder`, `fatal: true`) for header, payload and key-set body. Red-proof below |
| F6 | The default audit sink does not escape U+2028, U+2029, U+0085 or bidi controls | low | **Deferred to `-1003a`** (architect) |

**Also deferred to `-1003a` by the architect, recorded here:** `jwks-unavailable` answered `503` with
`Retry-After` rather than `401 invalid_token`; `AUTH_JWKS_CA_FILE`; an audit line at start when
`AUTH_AUDIENCE` differs from the resource URL.

### F1: every HTTP-level refusal, one line each

`packages/core/test/transport/refusal-audit.test.ts`, pasted from its output. Each row asserts the
status and that the request wrote exactly that one line. Before authentication there is no
principal; after it, the line names the caller.

| status | case | audit line(s) |
|---|---|---|
| 400 | a target that is not origin-form | http-refused {"status":400,"reason":"request-target"} |
| 404 | an unknown route | http-refused {"status":404,"reason":"not-found"} |
| 400 | Host sent twice | http-refused {"status":400,"reason":"host-count"} |
| 405 | GET /mcp | http-refused {"status":405,"reason":"method"} |
| 405 | POST /health | http-refused {"status":405,"reason":"method"} |
| 403 | /health with a Host not allowed | http-refused {"status":403,"reason":"host-not-allowed"} |
| 403 | /mcp with a Host not allowed | http-refused {"status":403,"reason":"host-not-allowed"} |
| 403 | /mcp with an Origin not allowed | http-refused {"status":403,"reason":"origin-not-allowed"} |
| 400 | H1 Authorization sent twice | http-refused {"status":400,"reason":"duplicate-authorization"} |
| 401 | no Authorization (auth-refused only) | auth-refused {"reason":"refused"} |
| 400 | a token in the query too (auth-refused only) | auth-refused {"reason":"token-elsewhere"} |
| 406 | Accept without JSON | http-refused {"status":406,"reason":"not-acceptable","principal":"test-principal"} |
| 415 | Content-Type not JSON | http-refused {"status":415,"reason":"content-type","principal":"test-principal"} |
| 415 | a content coding | http-refused {"status":415,"reason":"content-coding","principal":"test-principal"} |
| 400 | a transfer coding other than chunked | http-refused {"status":400,"reason":"transfer-coding","principal":"test-principal"} |
| 413 | a body over the cap | http-refused {"status":413,"reason":"body-too-large","principal":"test-principal"} |
| 400 | a body that is not UTF-8 | http-refused {"status":400,"reason":"body-not-utf8","principal":"test-principal"} |
| 400 | a body that is not JSON | http-refused {"status":400,"reason":"parse-error","principal":"test-principal"} |
| 400 | a duplicate key | http-refused {"status":400,"reason":"duplicate-key","principal":"test-principal"} |
| 400 | a lone surrogate | http-refused {"status":400,"reason":"lone-surrogate","principal":"test-principal"} |
| 400 | nesting over the depth cap | http-refused {"status":400,"reason":"body-depth","principal":"test-principal"} |
| 400 | a batch (framing) | http-refused {"status":400,"reason":"framing","principal":"test-principal"} |
| 503 | at capacity | http-refused {"status":503,"reason":"capacity","principal":"test-principal"} |

The events that write their own line write only that one: a missing or failed token
(`auth-refused`), a token offered twice (`auth-refused`, `token-elsewhere`), a verifier timeout
(`verifier-timeout {"limitMs":50}` alone, with its `503`) and a verifier returning `ok` without a
principal (`verifier-contract` alone, with its `500`). `transport-error` already named the
principal; an unhandled crash now writes `transport-error {"reason":"unhandled"}` too.

**Scope, stated:** JSON-RPC errors that dispatch returns for a well-formed request (unknown tool,
invalid arguments, a handler error) are not HTTP-level refusals: their status is the era's
(`-1005b`), and their audit events are dispatch's own (`handler-error`, `validation-error`,
`containment-refused` and so on), which carry the principal. A line for every one of those is
*decision-needed*.

### The three red-proofs

- **F1:** with the pipeline's audit removed, the H1 row wrote nothing
  (`H1 row actual: []`) and 32 assertions went red. With the H1 reason changed, it wrote
  `http-refused {"status":400,"reason":"refused"}` and went red.
- **F3:** the test first shows the forgery is real: `node:crypto` verifies the `e = 1` encoding
  against that key. With the exponent floor removed, the verifier accepted it:
  `F3 | e=1 forged token (no private key) | ACCEPTED as forged`. With the check in place:
  `F3 | e=1 forged token (no private key) | key-mismatch`. Twenty 16384-bit keys under one kid (as
  many as fit the 64 KiB cap) are refused in 1.7 ms; with the ceiling removed they cost
  22.8 ms of signature work.
- **F5:** with lenient decoding, three different byte strings became one principal:
  `F5 | sub bytes 75ff | ACCEPTED as "u\uFFFD"`, the same for `75fe` and `75c0`, alongside the real
  `75efbfbd`. Strict: all three are `payload`, and `75efbfbd` alone is `"u\uFFFD"`. A key set with an
  invalid byte: `ACCEPTED` lenient, `jwks-unavailable` strict.

**The fix-up matrix,** 11 mutants on a committed tree, each limited to 300 s. **All 11 go red.**

| # | Mutant | Red in |
|---|---|---|
| F1 | pipeline refusals not audited | refusal-audit.test.ts RED 32: 403 /mcp with a Host not allowed ; *.test.ts RED 32: 403 /mcp with a Host not allowed |
| F1 | early refusals not audited | refusal-audit.test.ts RED 14: 400 a target that is not origin-form |
| F1 | principal left off after auth | refusal-audit.test.ts RED 26: 406 Accept without JSON |
| F1 | self-audited events written twice | refusal-audit.test.ts RED 11: 401 no Authorization (auth-refused only) ; transport.test.ts RED 6: G3 a failed token: 401 with error=invalid_token; the reason reaches the audit seam and never the c |
| F1 | H1 reason not duplicate-authorization | refusal-audit.test.ts RED 4: 400 H1 Authorization sent twice |
| F3 | exponent floor removed | verifier.test.ts RED 6: the e=1 forgery: node:crypto verifies it against that key, and the verifier refuses it |
| F3 | even exponent allowed | verifier.test.ts RED 4: exponents 3 and 65538 (even) and a 16384-bit modulus are never used; 65537 up to 8192 bits is |
| F3 | modulus ceiling removed | verifier.test.ts RED 6: exponents 3 and 65538 (even) and a 16384-bit modulus are never used; 65537 up to 8192 bits is |
| F3 | rsaKeyUsable not called | verifier.test.ts RED 11: K3 an RSA key of 1024 bits → invalid_token / key-mismatch |
| F5 | header and payload decode leniently | verifier.test.ts RED 6: sub bytes 75 FF, 75 FE and 75 C0 are refused; 75 EF BF BD (a real U+FFFD) is a different, valid pr… |
| F5 | key set decodes leniently | verifier.test.ts RED 4: a key set with an invalid byte is refused |

### The rebase onto `809a6b9`

`-1002a` changed the cage seam (`cageFor(domain, policy)`, the policy required) and asserted exact
`containment-refused` lines. After the rebase, `-1003`'s transport test passes the policy, and
`-1002a`'s two exact lines gain `"principal":"test-principal"`, which is `-1003`'s rule that every
call-scoped line carries the caller. `reach.test.ts` kept both changes. Nothing else moved.

## Decision-needed

- **What the MCP authorization page asks of a resource server that this WO does not build:**
  scope checks and `403 insufficient_scope`, and the `scope` parameter in `WWW-Authenticate`
  (scopes are entitlement, `-6xxx`; `scopes_supported` is empty on purpose).
- **The resource URL's configuration name.** It is the transport's `resourceUrl`; the node has no
  `AUTH_RESOURCE_URL`. Should there be one, and should the node refuse to start unless it equals
  `AUTH_AUDIENCE`? Today they are configured separately and not compared.
- **A private CA for the key-set URL in production** (A17): an `AUTH_JWKS_CA_FILE`, or
  `NODE_EXTRA_CA_CERTS` as the documented route.
- **Token policy beyond RFC 8725:** a maximum lifetime or `iat` age (A12); a character policy for
  `sub` (A13); ECDSA low-S (A11), which matters only if a token string ever becomes a key.
- **Ratify D-1 and D-3.**
- **A line for every JSON-RPC error dispatch returns** (F1's scope, above), or only the
  HTTP-level refusals as now.

## Gates

| Gate | Result |
|---|---|
| `npm run check` | exit 0 on Node v24.21.0 after the rebase and the fix-up: core **516** tests (28 files), spike 0102 69, spike 0101 8, `test:subset` 4 |
| CI | both runners, on the pull request |
| Network | the suite touches `127.0.0.1` only: the test issuer and the transport |
| Protected surfaces | The four steering documents, `LICENSE`, `NOTICE`, `scripts/**`, `.github/**`, `spikes/**`, `docs/canonical-form.md`, `packages/core/src/pinning/**`, `packages/core/src/capability/**` and `packages/core/src/containment/**` diff **empty** against their `main` (`7e11d0b`, then `809a6b9`). The transport changed at the verifier seam, the PRM route and the per-call audit binding, and, for red-team F1 as the architect ordered, where `server.ts` sends a refusal |
| Leak gate | `--tree` and `--history` exited 0 before the push, each checked by exit code |
| Credentials | Pushes went over the repository's write deploy key. A short-lived token was minted only to open this pull request, kept in a mode-0600 scratch file, and deleted straight after. The harness's client secret for the transcripts lived in a mode-0600 scratch file for the run and was deleted |

## What did not work, and why

- **The first red-proof matrix had four green mutants** beyond the two layers: a timeout mutant
  that could not be seen (it became A1), a cold-cache coalescing gap (A9), a warm cache dropped on a
  failed refetch (no test covered the refetch-fails path; now one does), and the kid-sharing order
  (the test signed with the last key only). Each has its test now.
- **Two G1 mutants went red only by hanging for 300 s:** the tests left an unexpectedly started
  transport open. They now close it, so a regression fails fast.
- **My H8 test proved nothing** until the adversarial pass showed why (A3).
- **The leak gate refused the first squash:** the certificate builder wrote X.509 object
  identifiers as dotted strings (the subject-name and extension OIDs), which the ipv4 rule reads as
  addresses. They are number arrays now; `--tree` and `--history` exit 0. Nothing was pushed before.
- **node-oidc-provider refused the client** until it was given `id_token_signed_response_alg:
  "ES256"`, the only algorithm its key set holds.

## What was deliberately not built

- **Scopes, `insufficient_scope`, entitlement:** `-6xxx`.
- **Dynamic client registration, refresh tokens, introspection, opaque tokens, mTLS, DPoP:** WO §4.
- **A production authorization server:** the harness is not one.
