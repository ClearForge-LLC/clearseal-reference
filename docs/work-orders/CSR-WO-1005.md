# CSR-WO-1005 — The transport, owned: stateless Streamable HTTP written against `2026-07-28`, hardened by the core

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD; the
base must contain `spikes/0100-protocol` and a core that builds to `dist/`).
**Branch:** `wo/CSR-WO-1005`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P1 — first in the phase: every other P1 control is proven on this substrate.
**Phase exit gate (the clauses this WO owns):** a forged `Origin` and an extra request property are
each refused before any handler runs; `curl -i` unauthenticated returns `401` with resource metadata
(the `401` itself is `-1003`'s; this WO leaves the auth seam in place and returns `401` from a stub
verifier that accepts nothing — fail closed by construction).
**Grounds:** `docs/northstar.md` N1, N4, N5, N6, N8; `docs/architecture.md` §2.3 row one (the
`-0100` measurement), §5 rows *Language and SDK*, *Protocol revision*, *Transport hardening*,
*Runtime validation and output caps*, *Server-initiated requests*, *Dependencies*; §7.1 rows
*A compromised or impostor client* and *A prompt-injected model*; §8 rows *Stateless transport*,
*Transport hardening*, *Runtime input validation*; `docs/roadmap.md` P1.
**Specification of record:** `https://modelcontextprotocol.io/specification/2026-07-28/` — the pages
`basic/transports/streamable-http`, `basic/versioning`, `basic/index` (`_meta`, error codes),
`server/discover`, `basic/patterns/mrtr`, `server/tools` (JSON Schema 2020-12), and the `schema`
page for every error code. **Where two pages disagree, the `schema` page wins and the disagreement
is recorded in FEEDBACK** (the versioning page and a docs page were seen to give different codes for
`UnsupportedProtocolVersionError`; measure which the schema defines).

> **What this is:** the core's own HTTP layer — a single POST endpoint that speaks the current
> stateless revision natively and the legacy `2025-11-25` handshake as a pure function, with every
> limit the architecture requires enforced here and asserted by its own test. It is NOT auth (the
> verifier seam is a stub that refuses everything), NOT pinning (registration still goes through a
> placeholder registry that `-1001` replaces), NOT a control on what tools do, and NOT an SDK
> wrapper — the official SDK is not imported. Why now: the `-0100` spike measured that no
> published official SDK serves this revision; the gate ruled the reference serves it; so the
> transport is a build, and it is the substrate P1 proves everything else on.

**Cadence:** build, **spec-first**: before code, the builder writes `packages/core/src/transport/SPEC-MAP.md`
— one line per MUST/SHOULD in the pages above that this layer implements, refuses, or leaves out,
with the section anchor. That file is reviewed *with* the code; a MUST not in it is a finding.

## 1. Scope — numbered, specific

1. **Endpoint and methods.** One path (`/mcp`, configurable). `POST` only; `GET` and `DELETE` →
   `405` with `Allow: POST`. `Mcp-Session-Id` and `Last-Event-ID` on any request are ignored —
   never minted, never echoed. Loopback bind by default.
2. **Origin and Host.** `Origin`, when present, must match a configured allowlist or the request
   is `403` (JSON-RPC error body without `id`, per spec). `Host` must match the configured host
   set; otherwise `403`. Both default to loopback-only; both are configuration by name.
3. **Request framing.** Body must be exactly one JSON-RPC request or notification, UTF-8, under
   a configured byte cap (default 1 MiB — the SDK's 4 MiB was a patch-release accident, not a
   design). A JSON array (batch) → `400`, JSON-RPC `-32600`. A JSON-RPC *response* in the body →
   `400`. Malformed JSON → `400`, `-32700`. Duplicate keys → refused at parse (use a parser or a
   check that detects them; `JSON.parse` silently takes the last — a finding if you cannot detect,
   record the choice). Depth and size of the parsed value bounded.
4. **Protocol version.** `MCP-Protocol-Version` header required and must equal
   `params._meta["io.modelcontextprotocol/protocolVersion"]`; mismatch → `400` `HeaderMismatch`
   (`-32020`). Supported set: `["2026-07-28", "2025-11-25"]`. Unsupported → `400` with
   `UnsupportedProtocolVersionError` listing `supported` and `requested` (code per the schema page —
   record it). Absent header → refused (pre-2025-06-18 clients are not supported; say so in
   SPEC-MAP).
5. **Mirrored headers.** `Mcp-Method` required and must equal `method`; `Mcp-Name` required for
   `tools/call` / `resources/read` / `prompts/get` and must equal `params.name` / `params.uri`
   after Base64-sentinel decoding (`=?base64?…?=`, case-sensitive markers); any mismatch or invalid
   characters → `400` `-32020` with a message naming the header, never the secret-shaped value.
   `Mcp-Param-*` headers: **implemented fully on the server side** (`architecture.md` §5,
   *Completeness bar*): the registry validates `x-mcp-header` annotations against every constraint
   in the spec's Schema Extension section (non-empty, token syntax, unique case-insensitively,
   primitive types only, statically reachable through `properties` only) and refuses a tool whose
   annotation breaks one; at call time a recognized `Mcp-Param-{Name}` must be present when the
   value is in the body, absent when it is `null` or missing, decoded from the Base64 sentinel when
   encoded, compared numerically for integers, and any mismatch is `400` `-32020`. Unrecognized
   `Mcp-Param-*` headers are ignored. No shipped tool declares one; a test fixture tool does.
6. **Dispatch (modern era).** `server/discover` (MUST): `resultType: "complete"`,
   `supportedVersions`, `capabilities`, `serverInfo` (name and version from the package, no
   host identity), `instructions`, `ttlMs`, `cacheScope`. `tools/list` with `ttlMs`/`cacheScope`;
   `tools/call` through the registry seam with **runtime validation of `arguments` against the
   tool's `inputSchema` (JSON Schema 2020-12)** before the handler runs — `additionalProperties:
   false` applied at the root unless the pinned schema says otherwise, external `$ref` never
   dereferenced, depth and validation time bounded (§10 of the spec's tools page) — and a result
   size cap after. Unknown method → `404`, `-32601`. Notifications: the core defines none over
   HTTP; an unknown notification → `400`. Every result carries `resultType: "complete"`.
7. **Dispatch (legacy era, `2025-11-25`).** `initialize` served as a pure function: echoes a
   supported legacy version, capabilities, `serverInfo`; **no session id**, ever.
   `notifications/initialized` → `202`. Subsequent requests carrying the legacy header are served
   by the same handlers with the legacy result shape. `GET` for the legacy stream stays `405`.
   This path is marked in SPEC-MAP with the deprecation window's end and a test that fails on
   that date so it cannot be forgotten.
8. **Responses.** `application/json` single object, always, in this WO. SSE (`text/event-stream`)
   is *not* produced; `Accept` must list `application/json` or the request is `406` — record
   whether the spec permits a JSON-only server (it says the client MUST support both; measure and
   note). `subscriptions/listen` → `404` `-32601` (not implemented; SPEC-MAP says so).
9. **MRTR carriage (no semantics).** The transport passes through `resultType: "input_required"`
   results a handler returns, and delivers `inputResponses` + `requestState` from a re-issued call
   to the handler. `requestState` is produced and consumed only through a core helper that
   **HMACs** it with a server key named in env — a state the client echoes back is untrusted until
   its MAC verifies; a tampered or foreign state → refused. No approval logic here (`-2001`).
10. **Limits, all in this layer, all asserted** (defaults per `architecture.md` §5: body 1 MiB,
    parse depth 64, in-flight 32, handler timeout 30 s, result 256 KiB — each configurable by name):
    body byte cap; parse depth cap; concurrency cap (excess → `503` with `Retry-After`); per-call
    handler timeout (a handler that never returns → the call ends with a JSON-RPC error and an audit
    event — audit is a seam here, a log line is acceptable until `-2002`); result size cap; header
    count and size caps beyond Node's defaults are *not* re-implemented (record Node's).
11. **The auth seam.** A `verifier` interface with one method; this WO ships only
    `RefuseAllVerifier`, so every request that reaches dispatch has passed a verifier that, today,
    passes nothing: the server answers `401` with `WWW-Authenticate` carrying a
    `resource_metadata` URL for everything except `/health` and the protected-resource metadata
    document itself. `-1003` replaces the stub; the contract is that a verifier returns a
    principal or a refusal, and the transport never dispatches without a principal.
12. **`/health`** — bearer-free, `200`, reports the package version and the served revisions;
    nothing else (no host identity, no uptime that fingerprints).
13. **The served revision is measured, not declared.** A test starts the server, sends
    `server/discover`, and asserts the `supportedVersions` it *answers* equal the set the
    architecture states; the value is written into FEEDBACK for `architecture.md` §2.1.
14. **The official conformance suite.** Fetch `github.com/modelcontextprotocol/conformance`
    at a pinned commit and run its server-side scenarios against the running transport. Every
    scenario's pass/fail is pasted. Failures in scenarios covering things this WO leaves out
    (SSE, `subscriptions/listen`) are expected and listed; any other failure is a finding with
    decision-needed. If the suite cannot run headless in CI, run it locally, paste, and record why.
15. **Dependencies.** Runtime: a JSON Schema 2020-12 validator, pinned exactly, chosen for the
    smallest tree that supports `$ref`/`$defs`/composition with remote refs disabled — name the
    candidates you measured and the tree size of the one chosen. Nothing else at runtime beyond
    `node:` modules. The SDK is not imported anywhere in `packages/`.
16. **`FEEDBACK.md`** per §6.

## 2. Invariants — restated by number from the northstar

- **N4** — fail closed: absent header, wrong version, mismatch, oversize, batch, unknown method,
  no principal → refusal, never a degraded success. The `RefuseAllVerifier` is the proof that the
  transport cannot dispatch without auth even before auth exists.
- **N5** — every limit and every refusal in §1 has a test that goes red when the check is
  removed; the served revision is asserted by a test, not by a constant.
- **N1** — the transport is a core module; editions will not touch it.
- **N6** — no hostname, path, or identity in `serverInfo`, `/health`, error messages, or tests.
  Leak gate before every push.
- **N8** — the `requestState` key and any test bearer are named in `.env.example`, never valued.

**Protected surfaces — must diff to empty:** the four steering documents, `LICENSE`, `NOTICE`,
`scripts/**`, `.github/**`, `spikes/**`, the governance files. `packages/core/src` is this WO's
to build; `packages/core/test` grows.

## 3. Tests / acceptance — what must be proven, not asserted

1. `npm run check` green with the transport and its tests (both runners in CI).
2. `SPEC-MAP.md` exists and every MUST on the streamable-http page has a line.
3. For each of: forged `Origin`, foreign `Host`, missing version header, header/body mismatch on
   version, on method, on name (plain and Base64-sentinel), unsupported version, batch body,
   response-shaped body, malformed JSON, oversize body, over-depth body, unknown method, unknown
   notification, `GET`, `DELETE`, session header present, `Last-Event-ID` present, extra request
   property against a tool schema, oversize result, handler timeout, concurrency overflow,
   tampered `requestState`, missing bearer, wrong bearer — the exact status, content type, and
   error code pasted, and the test named that asserts it.
4. The legacy `initialize` exchange pasted: no session header in the response; a legacy
   `tools/list` served afterwards; `GET` still `405`.
5. `server/discover` and `/health` responses pasted; `supportedVersions` equals
   `["2026-07-28", "2025-11-25"]`.
6. The conformance-suite results pasted per scenario.
7. The validator's dependency listing pasted with the alternatives measured.

## 4. Scope fence — what is NOT in this work order

- **A real verifier, JWKS, `401` semantics beyond the stub.** `-1003`.
- **Pinning, the manifest, verify-before-register.** `-1001`. The registry is a placeholder that
  `-1001` replaces; the transport talks to it through an interface.
- **Any tool.** `-1004` adds the first. Tests use a fixture tool registered only by the suite.
- **SSE responses, `subscriptions/listen`, progress notifications.** Recorded as not implemented.
- **Approval semantics on MRTR.** `-2001`. Only carriage and `requestState` integrity here.
- **Audit, rate limit, tripwire.** `-2002`, `-2007`. Log lines mark the seams.
- **Importing the official SDK for anything.**

## 5. Adversarial pass — try to break it before calling it done

Fresh subagent. Findings with severity into FEEDBACK.

1. Send `Mcp-Name` Base64-encoded for a name that *is* plain ASCII; confirm it still validates
   (decode before compare), and that a value with the sentinel markers in the wrong case does not.
2. Put `_meta` at the top level instead of under `params`; confirm the version check fails
   closed rather than reading the wrong place.
3. Send a body of exactly the byte cap, cap+1, and a chunked body with no `Content-Length`;
   confirm all three behave as specified.
4. Open the concurrency cap plus one connections and hold them; confirm the extra one gets `503`
   and the held ones complete.
5. Register a fixture tool whose `inputSchema` has an external `$ref`; confirm registration is
   refused, not dereferenced.
6. Replay a captured `requestState` from a different fixture tool's call; confirm refusal.
7. Send the same request 1,000 times sequentially and measure memory; confirm nothing per-request
   is retained (no session, no stream table growth).

## 6. Upward-feedback directive

`FEEDBACK.md`: lead with the served-revision measurement (for `architecture.md` §2.1) and the
conformance-suite table. Then the §3.3 refusal table. Then SPEC-MAP deviations (any SHOULD not
followed, with reason). Then the validator measurement. Then any spec-page disagreement found. Then
the standard entries: gates line, what did not work and why, what was deliberately not built.

## 7. Flag-and-stop conditions

- The specification of record requires SSE for a case this WO must handle (not merely permits
  it) — record the section and stop that case.
- A JSON Schema 2020-12 validator cannot be found under fifty transitive packages with remote refs
  disabled — record the candidates and stop; the architect rules.
- The conformance suite requires a credential or a network the sandbox does not have — run what
  can run, record the rest as blocked.
- A protected surface must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-1005` off current `main` where `packages/core` serves a single POST endpoint
> speaking `2026-07-28` natively and the legacy `2025-11-25` handshake as a pure function with no
> session, refuses every case in the WO's §3.3 table with the specified status and code, validates
> `tools/call` arguments against the tool's JSON Schema 2020-12 with external refs refused, HMACs
> `requestState`, dispatches nothing without a principal (a refuse-all verifier stub), reports the
> served revisions from `server/discover` in a test, has a SPEC-MAP covering every MUST on the
> transport page, runs the official conformance suite and records every scenario, imports no SDK,
> `npm run check` green on both runners, and is parked as one unmerged pull request. Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-1005 origin/main`. Node 24.21.0. Cadence:
> **BUILD, spec-first** — write `SPEC-MAP.md` from the specification pages named in the WO before
> code; where two pages disagree, the schema page wins and you record it. Read
> `docs/work-orders/CSR-WO-1005.md` in full and `docs/architecture.md` §5 (*Language and SDK*,
> *Protocol revision*, *Transport hardening*, *Runtime validation*), §7.1. Ratified with reasons in
> the WO: no SDK import anywhere in `packages/`; both eras on one endpoint, no session ever; every
> limit in this layer with its own red-proof; `RefuseAllVerifier` so nothing dispatches without a
> principal before `-1003` exists; JSON-only responses this WO; `requestState` HMAC'd; one exactly
> pinned validator with remote refs off, tree measured. Protected surfaces per WO §2. Leak gate
> `--tree` and `--history` before every push. Flag-and-stop: WO §7. Delegate the adversarial pass
> to a fresh subagent and the conformance-suite run to another if it helps. Report the PR link, the
> served-revision measurement, and the conformance table.
