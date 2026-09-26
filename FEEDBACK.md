# FEEDBACK: CSR-WO-1003a (auth corrections: outage semantics, lifetime, typ, log hygiene, scoped trust)

Branch `wo/CSR-WO-1003a`, cut from `main` at `802162e`, one commit. Parked as one unmerged pull
request. Built on Node v24.21.0.

## Gates

| Gate | Result |
|---|---|
| `npm run check` | exit 0 on Node v24.21.0: core **536** tests (29 files), spike 0102 69, spike 0101 8, `test:subset` 4 |
| CI | both runners, on the pull request |
| Protected surfaces | The four steering documents, `LICENSE`, `NOTICE`, `scripts/**`, `.github/**`, `spikes/**`, `docs/canonical-form.md`, `packages/core/src/pinning/**`, `packages/core/src/capability/**`, `packages/core/src/containment/**` and `auth/jws.ts` diff **empty** against `802162e`. The transport changed where it maps a verdict to a response (the `503`), renders the default audit sink, reads configuration at start (the audience line) and audits JSON-RPC errors (`server.ts`, and `dispatch.ts`/`jsonrpc.ts` for the no-double-logging mark) |
| Leak gate | `--tree` and `--history` exited 0 before the push, each checked by exit code |
| Credentials | Pushed over the repository's write deploy key. A short-lived token was minted only to open this pull request, kept in a mode-0600 scratch file, and deleted straight after. The harness's client secret for the transcript lived in a mode-0600 scratch file for the run and was deleted |

## §3.2 The outage, `curl -i` against the dev harness

node-oidc-provider on loopback (NOT FOR DEPLOYMENT), the real transport with the core's verifier,
`AUTH_JWKS_TTL_S=30` so the key-set cache expires within the run. `SIGUSR1` takes the authorization
server down and back up (added to the harness for this). The token is elided.

```
# issuer up, cache warm
$ curl -i -X POST $NODE -H "Authorization: Bearer <token>"
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 209
Cache-Control: no-store
X-Content-Type-Options: nosniff

{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"clearseal-dev-client"}],"resultType":"complete","_meta":{"io.modelcontextprotocol/serverInfo":{"name":"@clearseal/core","version":"0.0.0"}}}}


# authorization server DOWN (SIGUSR1), 32 s later: the 30 s key-set cache has expired
$ curl -i -X POST $NODE -H "Authorization: Bearer <same token>"
HTTP/1.1 503 Service Unavailable
Content-Type: application/json
Content-Length: 96
Cache-Control: no-store
X-Content-Type-Options: nosniff
Retry-After: 10

{"jsonrpc":"2.0","error":{"code":-32603,"message":"Authentication is unavailable; retry later"}}


# 4 s later, inside the cooldown
$ curl -i -X POST $NODE -H "Authorization: Bearer <same token>"
HTTP/1.1 503 Service Unavailable
Content-Type: application/json
Content-Length: 96
Cache-Control: no-store
X-Content-Type-Options: nosniff
Retry-After: 6

{"jsonrpc":"2.0","error":{"code":-32603,"message":"Authentication is unavailable; retry later"}}


# authorization server UP again, past the 10 s cooldown
$ curl -i -X POST $NODE -H "Authorization: Bearer <same token>"
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 209
Cache-Control: no-store
X-Content-Type-Options: nosniff

{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"clearseal-dev-client"}],"resultType":"complete","_meta":{"io.modelcontextprotocol/serverInfo":{"name":"@clearseal/core","version":"0.0.0"}}}}
```

The audit seam for the same run wrote one line per refused call:

```
[audit-seam] auth-unavailable {"reason":"jwks-unavailable","retryAfterS":10}
[audit-seam] auth-unavailable {"reason":"jwks-unavailable","retryAfterS":6}
```

`Retry-After` is the remaining failure cooldown in whole seconds, at least 1. The `503` carries **no
`WWW-Authenticate` at all**: nothing about the token was judged, so there is nothing to challenge
(the WO asks for no error code; a challenge without one would still invite a client to re-authenticate).
The same, from `corrections.test.ts` on the test issuer:

```
OUTAGE expired cache, issuer down: 503 Retry-After=10 WWW-Authenticate=undefined | auth-unavailable {"reason":"jwks-unavailable","retryAfterS":10}
OUTAGE 4 s into the cooldown: 503 Retry-After=6
OUTAGE issuer back: 200
```

A cold cache with the issuer down, and a key set answering `200` with garbage, are `503` too. With the
issuer **up**, a forged token (payload altered) and an unknown `kid` stay `401 invalid_token`. The
verdict carries the distinction as a field, `{ ok: false, reason: "jwks-unavailable", unavailable:
{ retryAfterS: 10 } }`; the transport never reads the reason string to find it.

## §3.3 The lifetime edge

`AUTH_MAX_TOKEN_LIFETIME_S` (default 86400, bounds 60 to 604800), skew 60:

```
HORIZON exp = now+60+86400: ok | +1 s: exp-horizon | -0.001 s: ok | +1 s without iat: exp-horizon
```

`59`, `604801`, `abc` and `-1` refuse start; `60` and `604800` start. At 60 s: `exp` 120 s out is
accepted, 121 s refused.

## §3.4 The `typ` matrix

| typ | default | `AUTH_REQUIRE_AT_JWT=true` |
|---|---|---|
| typ | default | AUTH_REQUIRE_AT_JWT=true |
|---|---|---|
| absent | accepted | typ |
| JWT | accepted | typ |
| jwt | accepted | typ |
| at+jwt | accepted | accepted |
| AT+JWT | accepted | accepted |
| application/at+jwt | accepted | accepted |
| Application/AT+JWT | accepted | accepted |
| application/jwt | typ | typ |
| JOSE | typ | typ |
| " at+jwt" | typ | typ |
| "at+jwt " | typ | typ |
| "at+jwt; v=1" | typ | typ |
| the number 1 | typ | typ |

`application/jwt` is not in the WO's list and stays refused; see *decision-needed*.
`AUTH_REQUIRE_AT_JWT` must be `true`, `false` or empty: `yes`, `1`, `TRUE` and `" true"` refuse start.

## §3.5 The escaped audit lines

```
ESCAPED [audit-seam] rpc-refused {"code":-32601,"method":"x","principal":"user-\u202enimda"}
ESCAPED [audit-seam] rpc-refused {"code":-32601,"method":"x","principal":"line\u2028break"}
DEFAULT-SINK [audit-seam] rpc-refused {"code":-32602,"method":"tools/call","principal":"user-\u202enimda\u2028x"}
```

Every character the WO names (U+2028, U+2029, U+0085, U+202A–U+202E, U+2066–U+2069) is escaped
wherever it appears in the line, the event name included. Lone surrogates were already escaped by
`JSON.stringify` (`"a\ud800b\udc00c"`), and C0 controls by JSON. A custom sink receives the
principal unchanged: the escaping is the default sink's rendering.

## §1.5, §1.6 Scoped trust and the audience line

```
CA-FILE verifier: verified | a plain https request in the same process: DEPTH_ZERO_SELF_SIGNED_CERT
CA-FILE refused at start: missing, empty, private key, certificate and key, malformed, not PEM, a directory, a symlink to /dev/zero
AUDIENCE auth-audience-differs {"audience":"urn:example:clearseal","resource":"https://mcp.example.invalid/mcp"}
```

The CA file is read once at start, must be a regular file of at most 1 MiB, and must hold PEM
certificates and nothing else, each of which parses (`X509Certificate`). `stat` follows a symlink,
so a link to `/dev/zero` is refused as not a regular file before anything is read. `.env.example`
says that setting it replaces the default roots for that one client.

## §1.7 One `rpc-refused` line per JSON-RPC error

| case | status | audit line(s) |
|---|---|---|
| case | status | audit line(s) |
|---|---|---|
| method not found | 404 | rpc-refused {"code":-32601,"method":"nope/nope","principal":"test-principal"} |
| invalid params (a cursor) | 400 | rpc-refused {"code":-32602,"method":"tools/list","principal":"test-principal"} |
| a header that disagrees with the body | 400 | rpc-refused {"code":-32020,"method":"tools/call","principal":"test-principal"} |
| unknown tool, legacy era (answered 200) | 200 | rpc-refused {"code":-32602,"method":"tools/call","principal":"test-principal"} |
| a handler error (already audited) | 500 | handler-error {"tool":"throws_refusal","principal":"test-principal"} |
| a handler error on the legacy era (already audited, mapped to 200) | 200 | handler-error {"tool":"throws_refusal","principal":"test-principal"} |

A refusal dispatch has already audited (`handler-error`, `handler-timeout`, `client-disconnect`,
`validation-timeout`, `validation-error`, `containment-refused`, `legacy-input-required`,
`request-state-unsealable`, `result-over-cap`) is marked, and the legacy era's `200` mapping carries
the mark, so it is never written twice. An existing pinning test that asserts the complete audit log
now also sees the refused call's `rpc-refused` line; its expectation gained that one line.

## Red-proofs (§3.6)

29 mutants: 21 for the WO's seven items and 8 for the adversarial fixes, each run on a committed
tree against `corrections.test.ts`, limited to 300 s. **All 29 go red.** The A9 mutant (the CA file
opened blocking) goes red by hanging to the kill: the FIFO open blocks the whole thread, which is
the defect. Not run: removing the CA file's regular-file check, because the red test would then read
`/dev/zero` without bound.

| § | Mutant | Red in `corrections.test.ts` |
|---|---|---|
| §1.1 | transport ignores the outage field | RED 3: cache expired and the issuer down: 503, Retry-After from the cooldown, no challenge, one auth-unavailable li |
| §1.1 | verifier reports an outage as invalid_token | RED 4: cache expired and the issuer down: 503, Retry-After from the cooldown, no challenge, one auth-unavailable li |
| §1.1 | Retry-After is always the whole cooldown | RED 1: cache expired and the issuer down: 503, Retry-After from the cooldown, no challenge, one auth-unavailable li |
| §1.1 | outage keeps the challenge | RED 1: cache expired and the issuer down: 503, Retry-After from the cooldown, no challenge, one auth-unavailable li |
| §1.2 | horizon check removed | RED 2: exp at the horizon (now + skew + 86400) is accepted; one second past is refused exp-horizon |
| §1.2 | horizon without the skew | RED 2: exp at the horizon (now + skew + 86400) is accepted; one second past is refused exp-horizon |
| §1.2 | lifetime bounds not checked | RED 1: AUTH_MAX_TOKEN_LIFETIME_S is bounded 60 to 604800 and moves the edge |
| §1.3 | typ case-sensitive | RED 1: the matrix under both settings |
| §1.3 | strict mode ignored | RED 1: the matrix under both settings |
| §1.3 | strict mode accepts an absent typ | RED 1: the matrix under both settings |
| §1.3 | application/at+jwt not accepted | RED 1: the matrix under both settings |
| §1.3 | AUTH_REQUIRE_AT_JWT value not validated | RED 1: AUTH_REQUIRE_AT_JWT is true or false; anything else refuses start |
| §1.4 | sink escaping removed | RED 3: user-\u202Enimda and a U+2028 in sub each land on one line, escaped; every listed character and lone surroga |
| §1.4 | only the line separators escaped | RED 3: user-\u202Enimda and a U+2028 in sub each land on one line, escaped; every listed character and lone surroga |
| A2 | only the WO set escaped (no C1, no other Cf) | RED 1: A2: DEL, the C1 controls and every format character are escaped too, astral ones as surrogate pairs |
| A2 | astral format characters escaped as one unit | RED 1: A2: DEL, the C1 controls and every format character are escaped too, astral ones as surrogate pairs |
| A1 | a failed unknown-kid refetch is a bad token | RED 1: valid cache, a new kid, the issuer down: 503; the issuer back past the cooldown: 200 in the same TTL window  |
| A1 | a failed refetch spends the window | RED 1: valid cache, a new kid, the issuer down: 503; the issuer back past the cooldown: 200 in the same TTL window  |
| A3 | the method logged unbounded | RED 1: A3: a request's method reaches the audit line only as a method-shaped name of at most 128 characters |
| A5 | other PEM armour allowed outside blocks | RED 1: A5: other PEM armour in any case is refused; commentary between certificates is not |
| A6 | numeric settings parsed with Number() | RED 1: A6: the numeric settings are plain decimal digits |
| A9 | the CA file opened blocking | RED (hang, killed at 300 s) |
| §1.5 | the CA file is ignored | RED 2: a PEM certificate file: the key set is fetched through it and a token verifies; the rest of the process stil |
| §1.5 | non-certificate blocks allowed | RED 1: WO §5.6: missing, a directory, empty, a private key, a certificate with a key, a malformed certificate, or / |
| §1.5 | certificates not parsed | RED 1: WO §5.6: missing, a directory, empty, a private key, a certificate with a key, a malformed certificate, or / |
| §1.6 | audience difference not audited | RED 1: one auth-audience-differs line naming both; none when they match; the node starts either way |
| §1.7 | rpc-refused not written | RED 3: through the transport: the default sink writes the escaped line, while a custom sink receives the principal  |
| §1.7 | audited mark lost in the legacy mapping | RED 1: method not found, invalid params, a header mismatch, legacy-era errors, and a handler error that already aud |
| §1.7 | handler error not marked audited | RED 1: method not found, invalid params, a header mismatch, legacy-era errors, and a handler error that already aud |

## Deviations

| # | Deviation | Why |
|---|---|---|
| D-1 | **An outage also covers a valid cache whose unknown-`kid` refetch does not land** (adversarial A1). WO §1.1 defines the outage as the cache expired, or inside the cooldown with no valid cache. But when an issuer rotates to a new key and then goes down, a genuine token signed with the new key got `401 invalid_token`, and the failed refetch used up the once-per-TTL window, so the token kept failing for up to a TTL after the issuer came back. Now that case is `503` with `Retry-After`, and the window is spent only by a refetch that landed. With the issuer **up**, an unknown `kid` is still `401` (tested) | Architecture §5 *Key-set fetching*: "so a correct client keeps its token". **For the architect to ratify** |
| D-2 | **The default sink escapes more than the WO's set:** DEL, all C1 controls, and every format character (`\p{Cf}`), which includes the WO's bidirectional ranges (adversarial A2). Astral format characters are escaped as surrogate pairs | C1 CSI/OSC can drive a terminal that honours them; LRM/RLM/ALM and zero-width characters reorder or hide text as the WO's set does |
| D-3 | **The `503` carries no `WWW-Authenticate` header at all,** not a challenge without an error code | Nothing about the token was judged; a challenge invites re-authentication, which is what the `503` exists to avoid |
| D-4 | **The numeric settings are plain decimal digits,** including the existing `AUTH_CLOCK_SKEW_S` and `AUTH_JWKS_TTL_S` (adversarial A6). `0x3c`, `" 60 "`, `6e1`, `60.5` now refuse start | Configuration parsing, not a token check; no `-1003` token check changed |
| D-5 | **The dev harness gains a `SIGUSR1` outage switch,** and reads `AUTH_JWKS_TTL_S`, for the §3.2 transcript | §3.2 asks for the issuer stopped with the cache expired |
| D-6 | **The logged `method` is bounded** to a method-shaped name of at most 128 characters, otherwise `(not a method name)` (adversarial A3) | One request could write a megabyte into the audit log |

## Adversarial pass (fresh subagent, WO §5; its own scratch worktree, since removed)

The subagent attacked `8224ab0` with six probe files of its own (not committed), every attempt using
the operation that matters: a real token through the real transport, the default sink's real stderr
bytes read from a child process, real https fetches for the CA file. **Nothing it tried breaks what
the WO requires.** Every outage condition the WO defines (garbage, a bad or oversized key set, too
many keys, a redirect, drip and hang cut at 3 s, a DNS failure, a TLS failure, a cold node) gave
`503` with `Retry-After`, no challenge and one `auth-unavailable` line; with the issuer up, every
forged token stayed `401`; the horizon was exact under float `exp` and a fractional clock; no
Unicode lowercase bypassed `typ` (only the Kelvin sign lowercases to an ASCII letter, `k`, in no
accepted spelling); no character split an audit line; across 35 JSON-RPC error paths on both eras,
none wrote zero lines or two.

| # | Finding | Severity | Status |
|---|---|---|---|
| A1 | Valid cache, the issuer rotates to a new `kid` and goes down: a genuine token got `401 invalid_token`, and the failed refetch spent the window, so it stayed `401` for up to a TTL after the issuer came back | medium | **Fixed** (D-1): `503`, and the window is not spent. Tested through the transport; two red-proofs |
| A2 | The sink let DEL, C1 controls (CSI, OSC, DCS, ST), U+061C, LRM/RLM, the BOM, zero-width characters and U+206A–F through raw, via `sub` and via a request's `method`. No line split | low | **Fixed** (D-2). Tested; two red-proofs |
| A3 | A request's `method` reached `rpc-refused` unbounded: one request wrote a 1,000,080-byte line | low | **Fixed** (D-6). Tested; red-proof |
| A4 | During an outage, anyone who can build a structurally valid token (any `kid`, empty payload, zero signature) gets `503` rather than `401`: an issuer-health oracle. No token, `Basic`, garbage and `alg none` stay `401`; fetches stay capped by the cooldown (6 for 60 requests over 60 s; 30 concurrent cold requests share 1) | low/info | **Recorded.** The key lookup precedes the signature by design, and moving the claim checks before it is the verifier's check order, which WO §7 makes a flag-and-stop. *Decision-needed* |
| A5 | A CA file with a certificate plus trailing junk, or a private key under a lower-case label, started (only the certificates reached `ca`, so no trust impact) | low | **Fixed:** no other PEM armour in any case; commentary between certificates is allowed. Tested; red-proof |
| A6 | `Number()` accepted `0x3c`, `" 60 "`, `6e1`, `60.5`, `0b111100` and a trailing newline for the numeric settings | info | **Fixed** (D-4). Tested; red-proof |
| A7 | After the cache expires, a key set answering `200` with `{keys: []}` or without the `kid` gives `401 unknown-kid`: the issuer answered, but a botched rotation that publishes an empty set makes every client discard its token | info | *Decision-needed* |
| A8 | A tool with two refused reaches writes two `containment-refused` lines and no `rpc-refused` line: the WO's "dispatch already wrote a specific line" rule, not literally one line per error | info | **Recorded;** the rule as written |
| A9 | The CA file was `stat`ed, then read: a swap to a FIFO in between blocks start, and growth past 1 MiB after the `stat` was read in full | info | **Fixed:** opened once without blocking, judged by `fstat` on the descriptor, read with a cap. Tested with a real FIFO; red-proof |

**WO §5 items:** 1 the outage path back to `401`: **pass** for every condition the WO defines; A1 was
the residual, fixed. 2 a `503` for a forged token with the issuer up: **pass**. 3 `exp` at the
horizon: **pass** (16 rows). 4 `typ` spellings: **pass**. 5 audit injection: **pass** for the §1.4
set; A2 and A3 fixed. 6 the CA file: **pass**; A5 and A9 fixed. §1.6 and §1.7: **pass**.

**Tests the adversary named as not using the operation that matters,** and what was done: the §1.2
and §1.3 tests call the verifier directly (the transport maps every `invalid_token` the same way, and
the red-proofs cover the checks); §1.4's transport test replaces `console.error` rather than reading
stderr bytes (the adversary's child-process probe confirmed the bytes); A3 now covers `method` as a
second channel; §1.5's "replaces the default roots" was confirmed by the adversary in a child process
with `NODE_EXTRA_CA_CERTS` and is stated in `.env.example`.

## Decision-needed

- **Ratify D-1** (an unlanded unknown-`kid` refetch is an outage) and **D-2** (the wider escape set).
- **The outage oracle (A4):** accept it as documented, or check the unsigned `iss`, `aud` and `exp`
  before the key lookup to narrow it (a check-order change).
- **An empty key set after expiry (A7):** `401 unknown-kid` as now, or `503`.
- **`typ: application/jwt`:** RFC 7515's prefix rule makes it the same media type as `JWT`; the WO's
  list does not include it, so it stays refused.


## What did not work, and why

- **My first cut of the A1 fix compared fetch timestamps,** which a fixed test clock leaves equal, so
  every successful refetch looked like a failure; it now counts fetches that landed.
- **The leak gate refused the first squash:** the A5 test wrote a private key's PEM armour as a
  string literal. It is built by pattern now; `--tree` and `--history` exit 0. Nothing was pushed
  before.
- **A `tools/call` without a name** fails the `Mcp-Name` header check (`-32020`) before invalid
  params (`-32602`); the invalid-params case uses a `tools/list` cursor instead.

## What was not built

- **Scopes, `insufficient_scope`, caller entitlement:** P2/P6.
- **Revocation, introspection, token binding.**
- **Any change to a `-1003` check the red team found holding, or to `jws.ts`.**
