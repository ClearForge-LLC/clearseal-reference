# FEEDBACK: CSR-WO-2010 (spike: does an independent implementation of `2026-07-28` agree with ours?)

Branch `spike/CSR-WO-2010`, cut from `main` at `eab5890` (contains `-2008d`'s merge). Spike, then STOP:
nothing outside `spikes/2010-interop/` and this file changes, and no finding is fixed here. Run on Node
v24.21.0 on Furnace, 2026-11-28; every commit's author and committer is `clearforgekey[bot]`'s noreply
address. Parked as one unmerged pull request.

## Read this first

- **No security-relevant disagreement (§0.5).** Every refusal the specification or ClearSeal requires
  happened against the v2 client: no token, a wrong-audience token and another issuer's token each
  401; the 401 carries `WWW-Authenticate: Bearer resource_metadata="…"` (RFC 9728); arguments that fail
  the pinned schema are refused 400 before the handler. Nothing ours accepts was refused by the
  specification text quoted below.
- **The v2 client agrees with our server on every probe that ran** (§0.1, §0.2, §0.3 in part), once it
  is told to speak `2026-07-28`. **Its own default is the legacy era**: `versionNegotiation.mode`
  defaults to `'legacy'`, so a client built with no option sends `initialize` at `2025-11-25` and
  never probes `server/discover`. With `'auto'` it concludes `2026-07-28` from our `server/discover`;
  with `{ pin: "2026-07-28" }` every modern probe completes. Not a disagreement with our server (finding
  N1), but every deployment guide must say it.
- **The conformance alpha's scored failures are all primitives this server does not serve.** For
  `--requirements 2026-07-28`'s 37 server scenarios: **96 checks pass, 15 fail, 6 skip, 2 warn** (1
  info); by scenario, **24 without a failure and 13 with one**. Thirteen failing checks are resources,
  prompts and what rides on them (class (b), planned as `-2009`); two are classified (c) with the
  specification sentence: the suite fails a server for not serving `completion`, which the text makes
  optional, and for not sending progress, which the text makes a MAY.
- **Two probes are blocked, never estimated:** RFC 8707 resource indicators and RFC 9207 `iss`
  validation are client-side OAuth-flow behaviour; observing them needs an authorization server, and
  the local test issuer serves only a key set (WO §4 and §7 forbid a real or hosted one).

## How it ran

- `spikes/2010-interop/package.json` pins `@modelcontextprotocol/client` **2.4.0** and
  `@modelcontextprotocol/conformance` **0.2.0-alpha.12**, exactly (both checked on the registry: 2.4.0
  is the client's latest; alpha.12 exists, after 0.1.16 stable). It is not a workspace, so the root
  lockfile and every `packages/*/package.json` are untouched.
- `probe.ts`: a real teaching node through the core's `startNodeFromEnv` with the local `TestIssuer`
  and a JSON-lines audit (the teaching test harness, imported, unchanged); the client's `fetch` is
  wrapped so every exchange is recorded verbatim in `results/probe.json` (bearer tokens redacted). The
  MRTR round trip runs against the core's conformance fixture server, since the teaching edition has
  no `input_required` tool.
- `conformance.ts`: the suite's `server --requirements 2026-07-28` against
  `packages/core/test/conformance/fixture-server.ts` (the real transport with the fixture tools the
  suite's scenarios call, admit-all verifier because the suite sends no `Authorization`; the same
  target as the run §2.1 records). On the teaching node the scenarios would only measure "tool not
  found". Summary in `results/conformance-summary.json`; run twice, identical counts.

## Answers to §0

| § | Question | Outcome (recorded in `results/`) |
|---|---|---|
| 0.1 | `server/discover` | 200: `supportedVersions ["2026-07-28","2025-11-25"]`, `capabilities {tools}`, `ttlMs 60000`, `cacheScope`; `mode: "auto"` negotiates `2026-07-28` from it |
| 0.1 | `tools/list`, TTL and `cacheScope` | 200 with `ttlMs 60000`, `cacheScope "private"`; the client's second `listTools()` made **no** request (served from its cache) |
| 0.1 | `tools/call`, `read_only` | 200, `notes.read` returns the note |
| 0.1 | MRTR `input_required` round trip | fixture server: `server/discover`, `tools/call` → `input_required`, the client fulfils the elicitation and retries, → `Hello, spike!` (3 exchanges) |
| 0.1 | a tool error | 200 with `isError: true` (*There is no note named missing.md.*); arguments failing the schema: 400 -32602, surfaced as `ProtocolError` |
| 0.1 | `Mcp-Method`, `Mcp-Name` | the client sends `mcp-method: tools/call` and `mcp-name: notes.read` with `mcp-protocol-version: 2026-07-28`, matching the body and `_meta` |
| 0.2 | the `2025-11-25` fallback | completes in the client's default mode: `initialize`, `notifications/initialized` 202, `GET` 405 (no stream), `tools/list`, `tools/call` |
| 0.3 | 401 + protected-resource metadata | 401 with `WWW-Authenticate: Bearer resource_metadata="https://mcp.example.invalid/.well-known/oauth-protected-resource/mcp"`; with a token-only `AuthProvider` the client surfaces the 401 and does not fetch the metadata |
| 0.3 | wrong audience | 401, `UnauthorizedError` |
| 0.3 | `iss` | another issuer's token: 401. RFC 9207 (the client validating `iss` in an authorization response) **blocked**: needs an OAuth flow |
| 0.3 | resource indicators (RFC 8707) | **blocked**: the client sends `resource` only in an OAuth authorization/token request, which needs an authorization server |
| 0.4 | conformance, by scenario and check | above and in the findings |
| 0.5 | security-relevant | none |

## Findings table

Classes: (a) a defect in ours; (b) an unimplemented primitive already planned (`-2009`); (c) the
suite or SDK disagreeing with the specification text; (d) a ClearSeal control deliberately stricter
than the specification. Specification text from `https://modelcontextprotocol.io/specification/2026-07-28/`.

| # | What | Where | Class | Specification sentence | Recommendation |
|---|---|---|---|---|---|
| D1 | `resources-list`, `resources-read-text`, `resources-read-binary`, `resources-templates-read`: *Method not found* (4 checks) | conformance | (b) | server/resources, *Capabilities*: "Servers that support resources **MUST** declare the `resources` capability" (ours does not yet) | `-2009` |
| D2 | `prompts-list`, `prompts-get-simple`, `-with-args`, `-embedded-resource`, `-with-image` (5) | conformance | (b) | server/prompts, *Capabilities*: "Servers that support prompts **MUST** declare the `prompts` capability in their [`DiscoverResult`]" | `-2009` |
| D3 | `caching`: `prompts/list`, `resources/list`, `resources/templates/list` have no caching hints (3; `resources/read` skipped) | conformance | (b) | server/utilities/caching, *Cacheable Results*: "Servers MUST include caching hints on results with `resultType: "complete"` returned by the following operations:" (the list names these). `tools/list` and `server/discover` carry them and pass | `-2009`, with its list TTLs |
| D4 | `input-required-result-non-tool-request` (1): *prompts/get returns InputRequiredResult with inputRequests* | conformance | (b) | the request is `prompts/get`, which ours does not serve yet (D2) | `-2009` |
| D5 | `sep-2164-resource-not-found`: warnings, code -32601 not -32602, and no `data.uri` | conformance | (b) for the code; (c) for `data.uri` | server/resources, *Error Handling*: "If the requested resource does not exist, servers **MUST** return a JSON-RPC error with code `-32602` (Invalid Params)." No sentence makes `data.uri` MUST or SHOULD: it appears only in the example error object, while the suite calls it "a SHOULD requirement" | `-2009` returns -32602 and may include `data.uri`; the suite's SHOULD is the suite's, not the text's |
| D6 | `completion-complete` (1): *Method not found* | conformance | (c) | server/utilities/completion, *Capabilities*: "Servers that support completions **MUST** declare the `completions` capability"; *Error Handling*: "Servers **SHOULD** return standard JSON-RPC errors for common failure cases: … Method not found: `-32601` (Capability not supported)". Ours does not declare `completions` and answers -32601: what the text prescribes. The suite requires a primitive the text makes conditional | none in ours (the roadmap keeps `completion` out until a tool needs it); report to the suite that a server without the capability is scored as failing |
| D7 | `tools-call-with-progress` (1): *Unknown tool* | conformance | (c) | basic/utilities/progress, *Behavior Requirements*: "Servers receiving a request with a progress token **MAY**: Choose not to send any progress notifications". The fixture server has no progress tool, by design (no SSE progress); the suite requires progress notifications the text makes optional | none in ours (SSE progress stays out until a tool needs it, roadmap); report to the suite |
| D8 | `server-stateless`: 5 checks skipped (`subscriptions/listen`) | conformance | none: skipped, not failed | basic/patterns/subscriptions, *Acknowledgment*: "Notification types the server does not support are omitted." No capability key makes it mandatory | none |
| D9 | the Tasks extension (10 scenarios, unscored for `2026-07-28`): 30 failing checks | conformance | not scored: an extension `2026-07-28` does not require | the suite itself lists them as *extension*, not scored | the roadmap's `-0101` line keeps the Tasks extension conditional; no action from this spike |
| N1 | the v2 client defaults to `versionNegotiation.mode: 'legacy'` | client | not a disagreement with our server | (the client's own documented default; our server serves both eras) | deployment notes for ClearSeal nodes say to configure `'auto'` or `{ pin: "2026-07-28" }` |
| B1 | RFC 8707 resource indicators, RFC 9207 `iss` in authorization responses | client | blocked | (needs an authorization server) | a later probe with a local OAuth test authorization server, if the architect wants it; it is not this spike's (WO §4) |

There is no (a) and no (d): no defect in ours turned up, and no ClearSeal control refused something
the client or the suite needed.

## §2.1's served-revision row, re-recorded (for the architect to apply: `docs/` is out of this spike)

> Official conformance suite `@modelcontextprotocol/conformance` 0.2.0-alpha.12, `--requirements
> 2026-07-28`, run 2026-11-28 against the core's fixture server: 37 required server scenarios, 24 with
> no failure, 13 with a failure; checks 96 pass, 15 fail, 6 skip, 2 warn. Every failure is resources,
> prompts and their caching hints (`-2009`), or `completion` and progress, which the text makes
> optional (CSR-WO-2010 D6, D7). The official v2 client, `@modelcontextprotocol/client` 2.4.0, completes
> discover, list, call, MRTR, tool errors, mirrored headers and the legacy fallback against a teaching
> node, once configured for `2026-07-28` (its default is the legacy era).

## -2008d's findings, promoted

| -2008d finding | Durable home |
|---|---|
| 1: the statelessness test cannot see an argument-only leak on CI | `-2008f` (ruled: intent) |
| 2: the canary times the validator on the main thread | needs-none (note) |
| 3: a validator that caches by shape would make the fixture cheap | needs-none (the canary fails as itself) |
| 4: the heap test exercises one tool with a short argument | needs-none (note; `-2008f` may widen it) |

## Adversarial pass (WO §5)

«ADV»

## Gates

- `npm run check` is not affected (nothing outside the spike changed); the spike lints clean under the
  root ESLint.
- Leak gate: `--self-test`, `--tree` and `--history` exit 0 before each push.
- Protected surfaces, against `eab5890`: only `spikes/2010-interop/` and this file differ;
  `packages/*/package.json` and the root lockfile diff to empty.
- Reduction pass (diff): nothing to remove.

## Deliberately not built

- A fix for any finding; resources and prompts (`-2009`); a local OAuth authorization server for B1.
- The spike as a CI check (a later ruling).
