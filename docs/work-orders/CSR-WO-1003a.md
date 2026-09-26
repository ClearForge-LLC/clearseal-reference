# CSR-WO-1003a — Auth corrections from the `-1003` review and red-team: outage semantics, lifetime, `typ`, log hygiene, scoped trust

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD; the
base must contain `-1003`, merged `c4ee2f0`).
**Branch:** `wo/CSR-WO-1003a`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P1 · **Phase exit gate (the clause this WO owns):** none new — it closes the items the
`-1003` review and the external red-team deferred.
**Grounds:** `docs/northstar.md` N4, N5; `docs/architecture.md` §5 *Authorization server*, *Key-set
fetching*, *Token acceptance* (added with this WO's docs), §10 row for `-1003`; `-1003` FEEDBACK
(red-team F2, F4, F6, the outage note, decision-needed rows); `packages/core/src/auth/CHECKS.md`.

> **What this is:** six small, separate corrections to a verifier that already held under an
> external red-team. When the issuer's key set is unreachable and the cache has expired, the node
> answers `401 invalid_token` today, which tells a correct client to throw away a good token; it
> should answer `503` and say when to retry. A token's `exp` can sit a century out. `typ` accepts
> anything JWT-shaped and refuses the registered media-type spelling. The audit sink escapes JSON
> but lets line-separator and bidirectional-control characters through. A private-CA issuer can
> only be trusted process-wide. And nothing says so at start when the audience and the resource
> URL differ. Plus one scope call the builder raised: JSON-RPC errors dispatch returns write no
> `http-refused` line. It is NOT scopes or `403 insufficient_scope` (P2, caller entitlement), NOT a
> revocation mechanism, and NOT a change to any check that held.

**Cadence:** build, small. One PR, left unmerged for review.

## 1. Scope — numbered, specific

1. **Issuer outage is `503`, not `401`.** When the verifier's key lookup fails with
   `jwks-unavailable` (cache expired and the fetch failed, or inside the failure cooldown with no
   valid cache), the transport answers `503` with `Retry-After` (the remaining cooldown in whole
   seconds, minimum 1) and no `WWW-Authenticate` error code, and audits `auth-unavailable`. Every
   other verifier refusal is unchanged. The verdict type carries the distinction; the transport
   does not parse reason strings to find it.
2. **Token lifetime horizon.** `AUTH_MAX_TOKEN_LIFETIME_S`, default `86400`, bounds 60 to 604800:
   a token whose `exp` lies further than that beyond now (plus skew) is refused `invalid_token`,
   reason `exp-horizon`. It needs no `iat`. A stated constant, with its negative test at the edge.
3. **`typ`.** Accept, case-insensitively, `JWT`, `at+jwt`, and `application/at+jwt` (RFC 7515
   §4.1.9 lets the `application/` prefix be omitted); absent stays accepted by default.
   `AUTH_REQUIRE_AT_JWT=true` refuses anything but the two `at+jwt` spellings (RFC 9068), which
   closes red-team F2 for issuers that set it. CHECKS.md H10 updated.
4. **Audit-line hygiene.** The default audit sink escapes, in addition to what JSON escapes,
   U+2028, U+2029, U+0085 and the bidirectional controls U+202A–U+202E and U+2066–U+2069, as
   `\uXXXX`. A test shows `user-‮nimda` and a U+2028 in `sub` each land on one line, escaped.
   The structured fields a custom sink receives are unchanged — the escaping is the default
   sink's rendering, not a mutation of the principal.
5. **Scoped trust for a private-CA issuer.** `AUTH_JWKS_CA_FILE`: a PEM file read once at start,
   passed to the key-set client's `ca` option (the D-1 mechanism); unreadable or not PEM refuses
   start. Never `NODE_EXTRA_CA_CERTS`, never a process-wide switch. Note in `.env.example` that
   setting it replaces the default roots for that one client.
6. **Audience and resource URL.** At start, when `AUTH_AUDIENCE` differs from the configured
   resource URL, one audit line `auth-audience-differs` names both; the node still starts
   (authorization servers that issue an audience identifier rather than a URL are legitimate).
7. **JSON-RPC errors are audited.** Every JSON-RPC error response dispatch returns for a
   well-formed, authenticated request writes one `rpc-refused {code, method}` line with the
   principal, unless dispatch already wrote a specific line for that refusal (the same
   no-double-logging rule as `http-refused`). A test covers method-not-found, invalid params, and
   one refusal that already audits.
8. **`FEEDBACK.md`** per §6.

## 2. Invariants

- **N4** — every refusal still refuses; the `503` is a refusal that does not invite the client to
  discard its token, not an acceptance.
- **N5** — each item has a red-proof: removing it turns its test red.

**Protected surfaces — must diff to empty:** the four steering documents, `LICENSE`, `NOTICE`,
`scripts/**`, `.github/**`, `spikes/**`, `docs/canonical-form.md`, `packages/core/src/pinning/**`,
`packages/core/src/capability/**`, `packages/core/src/containment/**`, `auth/jws.ts`. The
transport may change only where it maps a verdict to a response, renders the default audit sink,
reads configuration at start, and audits JSON-RPC errors.

## 3. Tests / acceptance

1. `npm run check` green on both runners; both leak-gate modes exit 0.
2. `curl -i` against the dev harness with the issuer stopped and the cache expired: `503`,
   `Retry-After`, no error code — pasted; the same with the issuer up: `200`.
3. The lifetime edge: `exp` at the horizon accepted, one second past refused — pasted.
4. The `typ` matrix under both settings — pasted.
5. The two escaped audit lines — pasted.
6. Every red-proof pasted.

## 4. Scope fence

- **Scopes, `insufficient_scope`, or any caller entitlement.** P2/P6.
- **Revocation, introspection, or token binding.**
- **Changing any `-1003` check that the red-team found holding.**
- **`jws.ts`.** The key rules are settled.

## 5. Adversarial pass

Fresh subagent; every attempt uses the operation that matters.

1. Make the outage path answer `401 invalid_token` again: an expired cache plus a key set that
   returns `200` with garbage, a slow drip past the deadline, and a DNS failure.
2. Try to get a `503` for a forged token when the issuer is *up* (it must stay `401`).
3. `exp` as a float just under the horizon, and a skew-edge token at the horizon.
4. `typ` spellings with whitespace, mixed case, and a trailing parameter.
5. Audit injection through `sub` with every character class in §1.4 and with lone surrogates.
6. A CA file that is a directory, empty, a private key, or a symlink to `/dev/zero`.

## 6. Upward-feedback directive

`FEEDBACK.md`: gates line, the pastes in §3, adversarial findings with severity, what was not built.

## 7. Flag-and-stop conditions

- Distinguishing the outage requires changing `jws.ts` or the verifier's check order.
- A protected surface must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-1003a` off current `main` where an issuer outage answers `503` with
> `Retry-After` instead of `401 invalid_token`, a token lifetime horizon refuses an `exp` too far
> out, `typ` accepts the registered spellings with an optional strict at+jwt mode, the default
> audit sink escapes line-separator and bidirectional-control characters, a private-CA issuer is
> trusted through `AUTH_JWKS_CA_FILE` for the key-set client only, a differing audience and
> resource URL are audited at start, JSON-RPC errors write one `rpc-refused` line each, red-proofs
> exist for every item, `npm run check` is green on both runners, and the work is parked as one
> unmerged pull request. Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-1003a origin/main`. Node 24.21.0. Cadence:
> **build**, small. Read `docs/work-orders/CSR-WO-1003a.md` in full, `-1003`'s FEEDBACK red-team
> section, and `docs/architecture.md` §5 *Token acceptance*. Seven items, each with its red-proof;
> protected surfaces per WO §2. Leak gate before every push, exit code checked directly. Adversarial
> pass per §5 to a fresh subagent. Report the PR link and the pastes.
