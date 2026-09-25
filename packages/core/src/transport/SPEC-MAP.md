# SPEC-MAP: the core transport against MCP `2026-07-28`

Written **before** the code (CSR-WO-1005, spec-first) and reviewed with it. One line per normative
statement (MUST / MUST NOT / SHOULD / SHOULD NOT / REQUIRED / MAY where it matters) that this layer
**implements**, **refuses**, or **leaves out**, with the section anchor it comes from. A MUST on the
transport page that has no line here is a finding.

**Source of record:** the specification repository `modelcontextprotocol/modelcontextprotocol` at
`ab3a39c` (2026-09-24), `docs/specification/2026-07-28/` and `schema/2026-07-28/schema.ts`. The
published site renders the same files. **Where two pages disagree, `schema.ts` wins**, and the
disagreement is listed at the end.

Page keys: **SH** = `basic/transports/streamable-http`, **VR** = `basic/versioning`, **BI** =
`basic/index`, **DS** = `server/discover`, **MR** = `basic/patterns/mrtr`, **TL** = `server/tools`,
**CA** = `server/utilities/caching`, **AU** = `basic/authorization`, **SC** = `schema.ts`,
**LG** = the legacy revision's `2025-11-25/basic/lifecycle` and `2025-11-25/basic/transports`.

Disposition: **impl** (implemented, test named) · **refuse** (the layer refuses the case) ·
**n/a** (the statement binds clients or intermediaries, not this server) · **out** (not
implemented in this WO; the reason is given, and it never fails open) · **seam** (a named
interface that a later WO fills).

Tests live in `packages/core/test/transport/`. Each test title starts with the IDs it proves.

## SH — Streamable HTTP (every normative line)

Routing matches the raw request target, with no dot-segment or percent-encoding normalization:
`/x/../mcp` is not the endpoint, so a proxy that allows or denies by path sees the path this server
dispatches on. The client-side steps under *Client Behavior* (extract, append, inspect, encode,
append) and "clients MUST reject tool definitions…" bind clients: **n/a**. The server applies
the same annotation rules at registration (SH-27…SH-29).

| ID | Anchor | Requirement | Level | Disposition |
|---|---|---|---|---|
| SH-1 | #streamable-http | Server provides a single HTTP endpoint path (the MCP endpoint) that supports POST | MUST | **impl**: one path, `/mcp` by default (`config.endpointPath`); every other path is `404` |
| SH-2 | #security--endpoint | Validate the `Origin` header on all incoming connections | MUST | **impl**: `config.allowedOrigins`, loopback only by default, on **every** route, `/health` and the metadata document included. A repeated `Origin` is refused |
| SH-3 | #security--endpoint | `Origin` present and invalid → `403 Forbidden`; body MAY be a JSON-RPC error with no `id` | MUST / MAY | **impl**: `403`, JSON-RPC error with no `id` (code `-32600`) |
| SH-4 | #security--endpoint | When running locally, bind only to localhost | SHOULD | **impl**: default bind `127.0.0.1`. `Host` is also checked against `config.allowedHosts` (**refuse** `403`), as the WO requires beyond the spec. A request with more than one `Host`, or with a target that is not origin-form (`/…`), is `400` (RFC 9112 §3.2, §3.2.2), so the check always sees the authority used |
| SH-5 | #security--endpoint | Implement proper authentication for all connections | SHOULD | **seam**: `Verifier`. This WO ships `RefuseAllVerifier` only, so every MCP request gets `401` (`-1003` replaces it). Dispatch requires `ok === true` **and** a non-empty principal id; any other verdict never dispatches. The verifier runs under `verifierTimeoutMs` (`503` on overrun). A repeated `Authorization` header is `400` |
| SH-6 | #sending-messages | Every JSON-RPC message from the client is a new POST | MUST (client) | n/a. The server side: `GET`, `DELETE` and every other method → `405`, `Allow: POST` |
| SH-7 | #sending-messages 2 | Client `Accept` lists both `application/json` and `text/event-stream` | MUST (client) | **refuse** (narrower than the spec): the server requires only that `Accept` admits `application/json` (`application/json`, `application/*` or `*/*`); otherwise `406`. It does not require `text/event-stream`, because it never sends it |
| SH-8 | #sending-messages 3 | Client includes the request metadata headers on each POST | MUST (client) | **refuse** when they are absent (see SH-20…SH-24) |
| SH-9 | #sending-messages 4 | Body is a single JSON-RPC request or notification; the client MUST NOT send responses | MUST (client) | **refuse**: a JSON array (batch) → `400`/`-32600`; a response-shaped body → `400`/`-32600` |
| SH-10 | #sending-messages 5 | Accepted notification → `202 Accepted`, no body | MUST | **impl**: only `notifications/initialized` on the legacy era is accepted |
| SH-11 | #sending-messages 5 | Notification not accepted → HTTP error status (e.g. `400`); body MAY be a JSON-RPC error with no `id` | MUST | **impl**: every other notification → `400`, error with no `id`, code `-32601` |
| SH-12a | (RFC 9110 §8.4, RFC 9112 §6.1) | Content and transfer codings | (HTTP) | **refuse**: a `Content-Encoding` other than `identity` → `415`; a `Transfer-Encoding` other than `chunked` → `400`, so no proxy that honours a coding sees a different body. A repeated `Content-Type` → `415` |
| SH-12 | #sending-messages 6 | Request → `Content-Type: application/json` **or** `text/event-stream` | MUST | **impl**: always `application/json`. **A JSON-only server is permitted**: the MUST is a choice between the two, and "the client MUST support both" binds the client |
| SH-13 | note after #sending-messages | No client-to-server notifications over Streamable HTTP in this revision | informative | **impl**: the modern era accepts no notification (`400`) |
| SH-14 | #receiving-messages | Notifications on an SSE stream MUST relate to the originating request; no independent requests on it; the final response SHOULD end the stream | MUST / SHOULD | **out**: no SSE is produced in this WO. Nothing is streamed, so nothing unrelated can be |
| SH-15 | #receiving-messages | `X-Accel-Buffering: no` when initiating SSE | SHOULD | **out**: no SSE |
| SH-16 | #receiving-messages | `subscriptions/listen` delivers change notifications on an open SSE stream | (feature) | **out**: `subscriptions/listen` → `404`/`-32601`, as for any method not implemented (SH-19). `capabilities` advertises no `listChanged` |
| SH-17 | #receiving-messages | Resumable SSE via `Last-Event-ID` is not supported | informative | **impl**: `Last-Event-ID` is ignored (SH-37) |
| SH-18 | #cancellation | Closing the SSE stream = cancellation; stop work; send nothing further | MUST / SHOULD | **impl (JSON analogue)**: a client disconnect aborts the handler's `AbortSignal` (audited as `client-disconnect`) and nothing is written after. A handler that ignores its signal keeps its concurrency slot until it settles. For SSE: out |
| SH-19 | #protocol-version-header | Requested RPC method not implemented → `404`, `-32601` | MUST | **impl** |
| SH-20 | #protocol-version-header | Every POST includes `MCP-Protocol-Version` | MUST (client) | **refuse** when absent → `400`/`-32020`. **One exception, D-1:** a legacy `initialize` request, which under `2025-11-25` carries no header (LG-3) |
| SH-21 | #protocol-version-header | Header value MUST match `_meta["io.modelcontextprotocol/protocolVersion"]`; mismatch → `400` `HeaderMismatch` | MUST | **impl**: `400`/`-32020` |
| SH-22 | #protocol-version-header | Version not implemented (unknown or not chosen) → `400` with `UnsupportedProtocolVersionError` listing supported versions | MUST | **impl**: `400`, code `-32022` (SC wins, see the disagreements section), `data: { supported, requested }` |
| SH-23 | #protocol-version-header | Server supporting pre-`2025-06-18` clients MAY treat a missing header as `2025-03-26`; a server that does not MUST reject per Server Validation | MAY / MUST | **refuse**: pre-`2025-06-18` clients are **not supported**. A missing header → `400`/`-32020` (except D-1) |
| SH-24 | #standard-request-headers | `Mcp-Method` (all requests) and `Mcp-Name` (`tools/call`, `resources/read`, `prompts/get`) are REQUIRED | REQUIRED | **impl** on the modern era: absent or mismatched → `400`/`-32020`. Legacy era: not required (they postdate `2025-11-25`). If present, they are still validated (D-3) |
| SH-25 | #standard-request-headers | `Mcp-Name` source not plain-ASCII-safe → the client Base64-sentinel-encodes it | MUST (client) | **impl** (server side): decoded before comparison (SH-31) |
| SH-26 | #custom-headers-from-tool-parameters | Servers MAY mirror parameters via `x-mcp-header`; clients MUST mirror them | MAY | **impl fully** (architecture §5, *Completeness bar*): SH-27…SH-35. No shipped tool declares one; a test fixture does |
| SH-27 | #schema-extension | `x-mcp-header` value: not empty; `1*tchar`; no CTLs (CR, LF); case-insensitively unique in the `inputSchema` | MUST | **impl**: the registry refuses a tool whose annotation breaks one |
| SH-28 | #schema-extension | Annotated only on primitive types (`integer`, `string`, `boolean`), never `number`; integers within ±(2^53−1) | MUST | **impl**: a registration check on the property's `type`. The safe range is enforced on the call's value (an unsafe integer in the body is refused as `-32020`) |
| SH-29 | #schema-extension | Annotated only on properties statically reachable through `properties` keys alone (not `items`, composition, conditionals, `$ref`) | MUST | **impl**: the registry walks the whole schema and refuses an annotation found anywhere else |
| SH-30 | #schema-extension | Extraction reads the value at the exact `properties` path; no value → header omitted | (definition) | **impl** |
| SH-31 | #value-encoding | Sentinel `=?base64?…?=`, case-sensitive lowercase markers; servers MUST decode `Mcp-Name` / `Mcp-Param-*` before comparing | MUST | **impl**: `=?BASE64?…?=` is not a sentinel, so the raw value is compared (and fails). Invalid Base64 inside the markers → `-32020` |
| SH-32 | #value-encoding | Client encodes a plain value that matches the sentinel pattern | MUST (client) | n/a (the server decodes any sentinel it receives) |
| SH-33 | #server-behavior-for-custom-headers | Unrecognized `Mcp-Param-*` headers: intermediaries forward and ignore | MUST (intermediary) | **impl**: the server ignores them too (WO §1.5) |
| SH-34 | #server-behavior-for-custom-headers | Reject a recognized `Mcp-Param-*` with invalid characters | MUST | **impl**: `400`/`-32020` |
| SH-35 | #server-behavior-for-custom-headers | Encoded header values (after decoding) match the body; else `400`/`-32020`. Value present → header required; `null` or absent → header not expected | MUST | **impl**, and a header sent when the value is null or absent is refused as a mismatch (D-4) |
| SH-36 | #case-sensitivity | Header **names** compared case-insensitively; **values** case-sensitive | MUST | **impl**: Node lower-cases names; values are compared byte for byte |
| SH-37 | #server-validation | Reject when header values do not match the body | MUST | **impl** (SH-21, SH-24, SH-35), and on the one accepted notification: `Mcp-Method` and any `_meta` version it carries must agree |
| SH-38 | #server-validation note | Integer parameters compared numerically (`42.0` = `42`) | SHOULD | **impl**: an integer body value is compared as a number against the header (strict decimal syntax) |
| SH-39 | #server-validation | Header validation failure → `400` and a JSON-RPC error `-32020` | MUST | **impl**. Error messages name the header, never the value (N6, and a mirrored value can be secret-shaped) |
| SH-40 | #server-validation notes | Intermediaries: error status; verify the version before trusting headers | MUST / SHOULD (intermediary) | n/a |
| SH-41 | #backward-compatibility | Client era detection by inspecting `400` bodies | SHOULD (client) | n/a. The server always sends a recognized modern error body on its `400`s, so a dual-era client stays modern |
| SH-42 | #earlier-streamable-http-revisions | `GET` or `DELETE` → `405` | SHOULD | **impl**: `405` with `Allow: POST` (this includes the legacy `GET` stream, which stays `405`) |
| SH-43 | #earlier-streamable-http-revisions | `Mcp-Session-Id`: ignore; never mint or echo | SHOULD | **impl**: ignored on both eras. No response carries it, **including the legacy `initialize`** |
| SH-44 | #earlier-streamable-http-revisions | `Last-Event-ID`: ignore | SHOULD | **impl** |
| SH-45 | #earlier-streamable-http-revisions | Interoperating with older counterparts: implement that revision's behavior | (normative by reference) | **impl** for `2025-11-25` as a pure function (VR-6, LG-*). Its sessions are not implemented: a session is a MAY in `2025-11-25` |
| SH-46 | #http-sse-transport-2024-11-05 | New implementations SHOULD NOT adopt the deprecated HTTP+SSE transport | SHOULD NOT | **impl**: not adopted |

## VR — Versioning

| ID | Anchor | Requirement | Level | Disposition |
|---|---|---|---|---|
| VR-1 | #protocol-version-negotiation | Unsupported version → `UnsupportedProtocolVersionError` listing supported versions | MUST | **impl** (SH-22). `supported` = `["2026-07-28","2025-11-25"]`, measured by test (WO §1.13) |
| VR-2 | #protocol-version-negotiation | Servers MUST implement `server/discover` | MUST | **impl** (DS-*) |
| VR-3 | #extension-negotiation | Extension identifiers follow `_meta` key rules; an unsupported extension → revert to core or reject | MUST | **impl**: the server advertises no extensions and reads none. Client-declared extensions are ignored (core behaviour) |
| VR-4 | #backward-compatibility-with-initialization-based-versions | A server MAY implement both eras | MAY | **impl**: dual-era, on one endpoint |
| VR-5 | same | A modern-only server SHOULD name its versions in an error to `initialize` | SHOULD | n/a (the server is dual-era). `initialize` under the modern header → `404`/`-32601` (SH-19) |
| VR-6 | #compatibility-matrix | Dual-era server: `_meta` → stateless modern; `initialize` → legacy semantics "scoped to the session (HTTP)" | (definition) | **impl** with a narrowing (D-2): legacy semantics are served **without a session**. A legacy request is recognized by its `MCP-Protocol-Version: 2025-11-25` header, not by session state |
| VR-7 | #compatibility-matrix | Dual-era server MAY serve both eras concurrently on one endpoint | MAY | **impl** |
| VR-8 | (deprecation) | The legacy path is marked for removal at the end of the protocol's deprecation window | WO §1.7 | **impl**: `LEGACY_PATH_REVIEW_BY` in `config.ts`. A test fails from that date so the path cannot be forgotten (D-5 records how the date was chosen) |

## BI — Base protocol (`basic/index`)

| ID | Anchor | Requirement | Level | Disposition |
|---|---|---|---|---|
| BI-1 | #messages | All messages follow JSON-RPC 2.0 | MUST | **impl**: `jsonrpc` must be exactly `"2.0"`, else `400`/`-32600` |
| BI-2 | #requests | Request `id` is a string or integer, never `null` | MUST | **refuse**: any other `id` → `400`/`-32600`, error with no `id` |
| BI-3 | #result-responses | Result responses include the same `id` and a `result` with `resultType` | MUST | **impl**: every modern result carries `resultType` (`"complete"` unless the handler returned `"input_required"`) |
| BI-4 | #error-responses | Error responses carry the request `id` (unless it could not be read); `code` is an integer; `message` is a string | MUST | **impl** |
| BI-5 | #error-codes | Do not emit legacy-range `-32000…-32019` codes | SHOULD NOT | **impl**: none are emitted |
| BI-6 | #error-codes | Emit reserved-range codes only as defined (`-32020`, `-32021`, `-32022`) | MUST | **impl** |
| BI-7 | #error-codes | Do not emit `-32002` or `-32042` | MUST NOT | **impl** |
| BI-8 | #_meta | A request missing a required per-request field (`protocolVersion`, `clientCapabilities`) → `-32602`, HTTP `400` | MUST | **impl** on the modern era |
| BI-9 | #_meta | Do not rely on capabilities the client has not declared; one that is required but undeclared → `-32021` with `data.requiredCapabilities`, `400` | MUST | **impl**: an MRTR `inputRequests` needing an undeclared capability is refused with `-32021` |
| BI-10 | #_meta | Include `io.modelcontextprotocol/serverInfo` in every result's `_meta` | SHOULD | **impl** on the modern era (name and version from the package; no host identity, N6) |
| BI-11 | #_meta note | Do not use `clientInfo` for behaviour or security decisions | SHOULD NOT | **impl**: `clientInfo` is never read |
| BI-12 | #statelessness | Do not rely on prior requests over the same connection | MUST | **impl**: no state crosses requests. Only the in-flight counter is global, and it holds no request data (WO §5.7 measures memory) |
| BI-13 | #statelessness | State spanning requests is referenced by an explicit identifier on each request | MUST | **impl**: MRTR `requestState` (MR-4) |
| BI-14 | #json-schema-usage | Support 2020-12 for schemas with no `$schema`; validate by the declared dialect; handle unsupported dialects gracefully | MUST | **impl**: 2020-12 only. A tool whose `inputSchema` declares any other `$schema` is refused at registration with a stated reason. The dialects supported are documented here: 2020-12 only |
| BI-15 | #schema-validation | Schemas are valid under their dialect | MUST | **impl**: compiled strictly at registration; an invalid one is refused |
| BI-16 | #ref-resolution | Never dereference a `$ref` that resolves to a network URI; any fetch opt-in is off by default | MUST NOT | **impl**: no loader is configured (and the validator refuses to run if one is installed). A `$ref`/`$dynamicRef` outside the schema's own document is refused at registration, found by a keyword-aware walk (`schema-walk.ts`): names under `properties`, `$defs` and the like are names, so neither a property called `const` nor one called `$ref` hides or fakes a reference |
| BI-17 | #ref-resolution | A schema failing on an unresolved external `$ref` is rejected, not treated as permissive | SHOULD | **impl**: refused at registration (WO §5.5) |
| BI-18 | #composition-keyword-resource-use | Bound schema depth, subschema count, or validation time | SHOULD | **impl, all three**: `maxSchemaDepth` and `maxSchemaNodes` at registration, and **validation time**: every validation runs in a worker thread (`schema-pool.ts`) that is terminated at `validationTimeoutMs` → `400`/`-32602`. The body and depth caps alone do **not** bound validation time (uniqueItems, recursive composition, regular expressions: FEEDBACK) |

## DS — `server/discover`, **CA** — caching

| ID | Anchor | Requirement | Level | Disposition |
|---|---|---|---|---|
| DS-1 | #discovery | Servers MUST implement `server/discover` | MUST | **impl** |
| DS-2 | #response / SC `DiscoverResult` | `resultType: "complete"`, `supportedVersions`, `capabilities`, optional `instructions`, `ttlMs`, `cacheScope` | (schema) | **impl** |
| DS-3 | #discoverresult | `_meta["io.modelcontextprotocol/serverInfo"]` included | SHOULD | **impl**. SC places `serverInfo` under `_meta`, **not** top-level as the WO's §1.6 wording suggests (SC wins; recorded) |
| CA-1 | #cacheable-results | Caching hints on `complete` results of `server/discover` and `tools/list` | MUST | **impl**: `ttlMs` and `cacheScope` on both |
| CA-2 | #time-to-live | `ttlMs ≥ 0` | MUST | **impl**: configuration refuses a negative value |
| CA-3 | #cache-scope | `"public"` responses may be shared across callers | MUST (awareness) | **impl**: `server/discover` is `"public"` (identical for every caller); `tools/list` is `"private"`, because `-1003` may filter tools by authorization |
| CA-4 | #cacheable-results | Results of retries carrying `inputResponses` or `requestState` MUST NOT be cached | MUST (client) | n/a |

## TL — tools

| ID | Anchor | Requirement | Level | Disposition |
|---|---|---|---|---|
| TL-1 | #capabilities | Declare `tools` when tools are supported | MUST | **impl**: `capabilities.tools = {}` (no `listChanged`: nothing is sent) |
| TL-2 | #capabilities | `tools/list` returns the currently available set; never varies per connection or by side effect | MUST / MUST NOT | **impl**: read from the registry seam per request |
| TL-3 | #capabilities | Deterministic order | SHOULD | **impl**: by name |
| TL-4 | #data-types / `inputSchema` | `inputSchema` is a valid JSON Schema object, not `null` | MUST | **impl**: refused at registration |
| TL-5 | #tool-names | Names 1–128 characters from `[A-Za-z0-9_.-]`; unique | SHOULD | **impl** as a MUST at registration (fail closed) |
| TL-6 | #x-mcp-header | The same constraints as SH-27…SH-29 | MUST | **impl** |
| TL-7 | #x-mcp-header | Do not mark sensitive parameters with `x-mcp-header` | SHOULD NOT | n/a (no shipped tool declares one) |
| TL-8 | #error-handling | Unknown tool → `-32602`; malformed `CallToolRequest` → protocol error | (definition) | **impl**: `400`/`-32602` (D-6 records the HTTP status choice) |
| TL-9 | #error-handling | Input validation failures MAY be tool execution errors (`isError: true`) | (definition) | **refuse** as a protocol error instead: `400`/`-32602`. Architecture §5: validation happens **before** the handler, so no handler result exists to carry `isError` |
| TL-10 | #security-considerations | Validate all tool inputs | MUST | **impl**: 2020-12 validation before the handler; `unevaluatedProperties: false` added at the root when the schema declares neither `additionalProperties` nor `unevaluatedProperties` (D-7) |
| TL-11 | #security-considerations | Access controls; rate limiting; output sanitizing | MUST | **seam**: access control is the `Verifier` (`-1003`); rate limit is `-2002`/`-2007`; the output **size** cap is here (`config.maxResultBytes`). Sanitizing is not a transport concern |
| TL-12 | #output-schema | Structured results conform to `outputSchema` | MUST | **out**: no shipped tool. A handler-side obligation, validated when `-1004` adds the first tool |

## MR — Multi round-trip requests (carriage only)

| ID | Anchor | Requirement | Level | Disposition |
|---|---|---|---|---|
| MR-1 | #supported-requests | `InputRequiredResult` only on `tools/call`, `resources/read`, `prompts/get` | MUST NOT | **impl**: only `tools/call` passes one through; the core serves neither of the others |
| MR-2 | #server-requirements-basic-workflow 2 | `inputRequests` keys unique; values are Elicit, CreateMessage or ListRoots requests | MUST | **impl**: other methods → `500`/`-32603` (a handler bug, never sent) |
| MR-3 | #server-requirements-basic-workflow 3 | `requestState` is an opaque string | (definition) | **impl**: a sealed token, `base64url(payload).base64url(HMAC-SHA256)` |
| MR-4 | #server-requirements-basic-workflow 4 | Treat `requestState` as attacker-controlled; protect its integrity (HMAC/AEAD); reject what fails verification | MUST | **impl**: HMAC-SHA256 under `CLEARSEAL_REQUEST_STATE_KEY` (named in `.env.example`, never valued). A tampered or foreign state → `400`/`-32602`. With no key configured, every `requestState` is refused, and a handler that asks for one fails closed |
| MR-5 | #server-requirements-basic-workflow 5 | Bind principal, short expiry, and the originating request inside the state; verify each | SHOULD | **impl**: the payload binds the principal id, the method, the tool name, a SHA-256 digest of the canonical `arguments`, and an expiry (`config.requestStateTtlMs`). A state replayed on another tool, or on the same tool with other arguments, is refused (WO §5.6) |
| MR-6 | same, warning | At-most-once consumption enforced server-side where needed | MUST (conditional) | **out**: no single-use state exists in this WO. `-2001` owns approval semantics |
| MR-7 | #server-requirements-basic-workflow 6 | At least one of `inputRequests` / `requestState` in every `InputRequiredResult` | MUST | **impl**: otherwise `500`/`-32603` |
| MR-8 | #server-requirements-basic-workflow 7 | Never send `inputRequests` for a capability the client did not declare | MUST NOT | **impl**: refused with `-32021` (BI-9) |
| MR-9 | #error-handling | Validate `inputResponses` is an object; ignore unrecognized content | SHOULD | **impl**: it must be an object of objects, else `400`/`-32602`. Its contents go to the handler untouched |

## AU — Authorization (the seam only)

| ID | Anchor | Requirement | Level | Disposition |
|---|---|---|---|---|
| AU-1 | #authorization-flow-steps 4 | Implement OAuth 2.0 Protected Resource Metadata (RFC 9728) | MUST | **seam**: `/.well-known/oauth-protected-resource` (and the path-suffixed form for the endpoint) is served bearer-free from configuration. Its content is `-1003`'s |
| AU-2 | #token-handling | Invalid or missing tokens → `401` | MUST | **impl** (stub): `RefuseAllVerifier` → `401` with `WWW-Authenticate: Bearer resource_metadata="…"` on every MCP request |
| AU-3 | #token-handling | Validate audience; accept only own tokens | MUST | **seam**: `-1003` |

## LG — The legacy era (`2025-11-25`), served as a pure function

| ID | Anchor | Requirement | Level | Disposition |
|---|---|---|---|---|
| LG-1 | lifecycle #initialization | Respond to `initialize` with `protocolVersion`, `capabilities`, `serverInfo` | MUST | **impl**: echoes the requested version if it is one the server serves on the legacy era (`2025-11-25`), otherwise answers `2025-11-25` (the negotiation rule) |
| LG-2 | transports #session-management | A server MAY assign a session | MAY | **out, deliberately**: no `Mcp-Session-Id` is ever minted (D-2) |
| LG-3 | transports #protocol-version-header | The client sends `MCP-Protocol-Version` on requests **subsequent** to `initialize` | MUST (client) | **impl**: legacy requests after `initialize` require the header (`2025-11-25`), otherwise `400`. `initialize` itself may omit it (D-1) |
| LG-4 | transports #protocol-version-header | Invalid or unsupported header → `400` | MUST | **impl** (SH-22) |
| LG-5 | lifecycle #initialized | `notifications/initialized` | (flow) | **impl**: `202`, no body, no state recorded |
| LG-6 | basic/utilities/ping | `ping` → empty result | MUST | **impl** on the legacy era only; `2026-07-28` has no `ping`, so a modern `ping` is `404` |
| LG-7 | transports #listening-for-messages-from-the-server | `GET` stream | MAY | **out**: `405` (SH-42) |

## Limits (WO §1.10, architecture §5): all in this layer, all asserted

| Limit | Name | Default | On breach |
|---|---|---|---|
| Body bytes | `maxBodyBytes` | 1 MiB (1,048,576) | `413`, `-32600`. A `Content-Length` over the cap is refused before any read; a chunked body is cut off at cap+1 |
| Parse depth | `maxJsonDepth` | 64 | `400`, `-32600` |
| In-flight requests | `maxInFlight` | 32 | `503`, `Retry-After: 1`, `-32603`. A slot is taken **after** authentication (an unauthenticated client holds none) and is held until the response has closed **and** any handler it started has settled, so a timed-out or abandoned handler still counts |
| Handler time | `handlerTimeoutMs` | 30,000 | `500`, `-32603`. The handler's `AbortSignal` fires, and an audit seam line is logged |
| Result bytes | `maxResultBytes` | 256 KiB (262,144) | `500`, `-32603`; the result is not sent. Error bodies are the transport's own short texts: whatever a handler throws becomes a fixed `-32603` message |
| Validation time | `validationTimeoutMs` / `validationWorkers` | 2,000 ms / 2 workers | `400`, `-32602`; the worker is terminated and replaced |
| Verifier time | `verifierTimeoutMs` | 5,000 ms | `503`, `Retry-After: 1` |
| Request receive time | `requestTimeoutMs` | 30,000 ms (Node's `requestTimeout`, replacing its 300 s default) | Node answers `408` |
| Schema depth / nodes | `maxSchemaDepth` / `maxSchemaNodes` | 32 / 2,000 | tool registration refused |
| Header count / size | Node's own | `maxHeaderSize` 16,384 B; `maxHeadersCount` `null` (Node's internal 2000); `headersTimeout` 60 s (measured on v24.21.0) | not re-implemented (WO §1.10); Node answers `431`/`408` |

## Deviations from the WO text (decision-needed where marked)

- **D-1**: a legacy `initialize` without `MCP-Protocol-Version` is accepted. WO §1.4 says "absent
  header → refused", but under `2025-11-25` the header is sent only on requests *after*
  `initialize` (LG-3). Refusing it would make the legacy path unreachable for every conforming
  legacy client. Only `initialize` is exempt, and only on the legacy era. **decision-needed.**
- **D-2**: legacy semantics without a session (VR-6 says "scoped to the session (HTTP)"). This is
  the WO's ratified choice ("no session, ever"), recorded here because the versioning page words it
  otherwise.
- **D-3**: on the legacy era, `Mcp-Method`/`Mcp-Name` are not required, but they are validated when
  present, because an intermediary may route on them. The same holds for `Mcp-Param-*`: once any
  annotated header is present on a legacy call, every annotated header is checked. **A client can
  choose the legacy era per request** (no `initialize` is needed), so a legacy request carries no
  required mirrored headers. That is the spec's design, and it is why an intermediary should
  distrust mirrored headers on old versions (SH-40).
- **D-4**: an `Mcp-Param-*` header sent when the body value is `null` or absent is refused as a
  mismatch. The spec says only that the server "MUST NOT expect" it. Accepting it would let a
  header route on a value the body does not carry.
- **D-5**: the legacy path's review date. The spec's deprecated-features registry gives no removal
  date for `2025-11-25`. The date in `config.ts` is set by this WO and named for the architect to
  confirm. **decision-needed.**
- **D-6**: HTTP status for JSON-RPC errors raised after transport validation. Client-caused
  refusals (unknown tool, invalid arguments, bad `requestState`) → `400`. Server-side failures
  (timeout, oversize result, handler error) → `500`. The spec fixes the status only where this map
  says so.
- **D-7**: the root default is `unevaluatedProperties: false`, where the WO says
  `additionalProperties: false`. The two are identical for a flat schema, but only the first is
  correct under composition at the root (`allOf` with `additionalProperties: false` would reject
  every property). The advertised schema is the registered one, unchanged.

## Disagreements between pages (SC wins)

- **`UnsupportedProtocolVersion`**: VR, BI and SC all say **`-32022`**. `changelog.mdx` item 12
  records the renumbering from **`-32004`**, as it does `HeaderMismatch` `-32001` → `-32020` and
  `MissingRequiredClientCapability` `-32003` → `-32021`. A page carrying the pre-renumber codes
  (the WO noted one) disagrees with SC; `-32022` is used.
- **`serverInfo` placement**: WO §1.6 lists `serverInfo` as a `DiscoverResult` field. SC and DS
  place it at `_meta["io.modelcontextprotocol/serverInfo"]`. SC is followed.
