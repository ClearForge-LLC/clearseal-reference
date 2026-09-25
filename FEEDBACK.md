# FEEDBACK: CSR-WO-1005 (the transport, owned)

Branch `wo/CSR-WO-1005`, cut from `main` at `92ef214` (`v0.1`). Parked as one unmerged pull
request. Built on Node v24.21.0.

`SPEC-MAP.md` was committed before any code (`9677367`). Every commit carries the role identity
as author and committer. `leak-gate --tree` and `--history` were clean before every push.

## Served revision, measured (for `architecture.md` §2.1)

`test/transport/eras.test.ts` "WO §1.13 VR-1 DS-2" starts the server, sends `server/discover`,
and asserts the answer:

```
DISCOVER {"jsonrpc":"2.0","id":1,"result":{"resultType":"complete","supportedVersions":["2026-07-28","2025-11-25"],"capabilities":{"tools":{}},"instructions":"A ClearSeal reference node. Tools are pinned before they are listed.","ttlMs":60000,"cacheScope":"public","_meta":{"io.modelcontextprotocol/serverInfo":{"name":"@clearseal/core","version":"0.0.0"}}}}
HEALTH {"status":"ok","version":"0.0.0","protocolVersions":["2026-07-28","2025-11-25"]}
```

**`supportedVersions` = `["2026-07-28", "2025-11-25"]`**: `2026-07-28` natively, and
`2025-11-25` as a pure function with no session. The conformance suite agrees: its
`server-stateless` scenario reads the same list from the `-32022` error data.

## Conformance suite

`modelcontextprotocol/conformance` at <https://github.com/modelcontextprotocol/conformance/commit/7169291ec0b68eb370fddcd9947313ab0d5e4156> (2026-09-11),
built locally with `--ignore-scripts`.

It runs headless, needs no credentials, and makes no connections beyond loopback (measured with
`strace`). It **cannot send an `Authorization` header**, so the run uses
`packages/core/test/conformance/fixture-server.ts`. That file starts the real transport with the
tools the scenarios call and a test-only admit-all verifier. It is never shipped.

```
node packages/core/test/conformance/fixture-server.ts 3999
node <suite>/dist/index.js server --url http://127.0.0.1:3999/mcp --requirements 2026-07-28   → Total: 140 passed, 45 failed
node <suite>/dist/index.js server --url http://127.0.0.1:3999/mcp --requirements 2025-11-25   → Total: 48 passed, 19 failed
```

Both runs exit 1. **Every failing scenario covers something this WO leaves out** (listed below).
There are no transport failures.

The run was done twice: once before the adversarial fixes and once after. The per-scenario
results are identical (`diff` empty).

**Scored at `2026-07-28` (50 scenarios):**

| Result | Scenarios |
|---|---|
| ✓ pass | server-stateless 25/0 (5 subscription checks SKIPPED because discover advertises no `listChanged`), tools-list, tools-call-simple-text, -image, -audio, -embedded-resource, -mixed-content, -error, server-sse-multiple-streams, sep-2164-resource-not-found (MUST passed; 2 SHOULD warnings, resources), dns-rebinding-protection, input-required-result: basic-elicitation, basic-sampling, basic-list-roots, request-state, multiple-input-requests, multi-round, missing-input-response, result-type, unsupported-methods, tampered-state, capability-check, ignore-extra-params, validate-input |
| ✗ expected: resources | resources-list, -read-text, -read-binary, -templates-read |
| ✗ expected: prompts | prompts-list, -get-simple, -get-with-args, -get-embedded-resource, -get-with-image; input-required-result-non-tool-request (needs a prompt) |
| ✗ expected: completion | completion-complete |
| ✗ expected: SSE | tools-call-with-progress (progress notifications need an SSE response) |
| ✗ expected: resources and prompts lists | caching (4/3). The tools-list hints, ttl ≥ 0 and cacheScope checks pass; the prompts, resources and templates list checks fail with `-32601` |

**Not scored at `2026-07-28`:**
- ✓ json-schema-2020-12 8/0; ✓ http-header-validation 14/0; ✓ http-custom-header-server-validation 10/0.
- ✗ tasks-\* ×9 (extension, not implemented); ✓ tasks-status-notifications (always skipped).

**Scored at `2025-11-25` (33 scenarios):**
- ✓ server-initialize (INFO: no session id), ping, tools-list, the six tools-call content and error
  scenarios, dns-rebinding-protection, and server-sse-multiple-streams (0/0: a session WARNING only).
- ✗ expected:
  - logging-set-level and tools-call-with-logging (logging);
  - completion-complete;
  - resources ×6, including subscribe and unsubscribe;
  - prompts ×5;
  - tools-call-with-progress, tools-call-sampling, tools-call-elicitation,
    elicitation-sep1034-defaults and elicitation-sep1330-enums. These need SSE or server→client
    requests on SSE, which `2025-11-25` allows and this JSON-only server does not send.
- Not scored: ✓ server-session-lifecycle, json-schema-2020-12, server-sse-polling.

**False-pass check.** I read the passes whose checks could succeed on any 4xx in `checks.json`,
and they are real:
- **dns-rebinding.** The evil `Host` got **403 "Host is not allowed"** and the valid one got 200.
  Probed by hand, a foreign `Origin` with a good `Host` → 403.
- **tampered-state.** The refusal is the transport's HMAC ("integrity check failed").
- **server-stateless.** Each check carries its expected code: `-32602`, `-32022` with data, `-32020`, `-32021` with `requiredCapabilities`, and `404`/`-32601` for `initialize`, `ping`, `logging/setLevel` and `resources/(un)subscribe` under the modern header.

**Vacuous ✓, not counted as passes:**
- `2025` server-sse-multiple-streams: no checks, only a session WARNING.
- tasks-status-notifications: always skipped.

## WO §3.3 refusal table

One `REFUSAL` line per case, pasted from `test/transport/refusals.test.ts` on the final code.

| Case | Status | Content type | Code | Test (refusals.test.ts unless noted) |
|---|---|---|---|---|
| forged `Origin` | 403 | application/json | -32600 (no `id`) | "SH-2 SH-3 forged Origin" |
| foreign `Host` | 403 | application/json | -32600 | "SH-4 foreign Host" |
| missing version header | 400 | application/json | -32020 | "SH-20 SH-23 missing MCP-Protocol-Version" |
| header/body mismatch: version | 400 | application/json | -32020 | "SH-21 version header does not match _meta" |
| header/body mismatch: method | 400 | application/json | -32020 | "SH-24 Mcp-Method does not match method" |
| header/body mismatch: name (plain) | 400 | application/json | -32020 | "SH-24 Mcp-Name does not match params.name (plain)" |
| header/body mismatch: name (Base64 sentinel) | 400 | application/json | -32020 | "SH-31 Mcp-Name … (Base64 sentinel)" |
| sentinel markers in the wrong case | 400 | application/json | -32020 | "SH-31 sentinel markers in the wrong case" |
| unsupported version | 400 | application/json | -32022, `data: {supported, requested}` | "SH-22 VR-1 unsupported version" |
| batch body | 400 | application/json | -32600 | "SH-9 batch body" |
| response-shaped body | 400 | application/json | -32600 | "SH-9 response-shaped body" |
| malformed JSON | 400 | application/json | -32700 | "malformed JSON" |
| duplicate key | 400 | application/json | -32700 | "duplicate key" |
| oversize body | 413 | application/json | -32600 | "oversize body"; edges in limits.test.ts |
| over-depth body | 400 | application/json | -32600 | "over-depth body"; edges in limits.test.ts |
| unknown method | 404 | application/json | -32601 | "SH-19 unknown method" |
| unknown notification | 400 | application/json | -32601 (no `id`) | "SH-11 SH-13 unknown notification" |
| `GET` | 405, `Allow: POST` | (no body) | — | "SH-42 GET" |
| `DELETE` | 405, `Allow: POST` | (no body) | — | "SH-42 DELETE" |
| `Mcp-Session-Id` present | 200; **no** `Mcp-Session-Id` in the response | application/json | — | "SH-43 Mcp-Session-Id present" |
| `Last-Event-ID` present | 200 (ignored) | application/json | — | "SH-44 Last-Event-ID present" |
| extra request property vs the tool schema | 400 | application/json | -32602 | "TL-10 D-7 extra request property" |
| oversize result | 500 | application/json | -32603 | "oversize result"; edges in limits.test.ts |
| handler timeout | 500 | application/json | -32603, plus a `handler-timeout` audit event | "handler timeout" |
| concurrency overflow | 503, `Retry-After: 1` | application/json | -32603 | "concurrency overflow" (the held calls then complete with 200) |
| tampered `requestState` | 400 | application/json | -32602 | "MR-4 tampered requestState" |
| missing bearer | 401, `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp"` | application/json | -32600 | "AU-2 missing bearer" |
| wrong bearer | 401, challenge plus `error="invalid_token"` | application/json | -32600 | "AU-2 wrong bearer" |

Also refused, with tests: missing `_meta` (400/-32602); `_meta` at the top level (400/-32600,
never read); `Accept` without `application/json` (406); a legacy request without the header
(400/-32020).

**Legacy exchange (§3.4)**, from eras.test.ts:

```
LEGACY initialize 200 session=none {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{}},"serverInfo":{"name":"@clearseal/core","version":"0.0.0"},"instructions":"…"}}
LEGACY notifications/initialized 202 body=""
LEGACY tools/list 200 session=none tools=12
LEGACY GET 405 Allow=POST
REFUSEALL 401 Bearer resource_metadata="http://127.0.0.1:<port>/.well-known/oauth-protected-resource/mcp"
```

## Red-proofs (N5): every limit and every refusal

A matrix script disables each check in turn, in a scratch copy of `packages/core`, runs the
transport suite, and requires the test that names the check to go red. **62 of 62 go red** on the
final code. The checks covered:

- **HTTP layer:** Origin, Host, POST only, the concurrency cap, and the principal requirement.
- **Auth:** the verifier's 401, the RefuseAll default, the verifier deadline, the slot taken after
  auth, and the slot held until the handler settles.
- **Framing:** Accept, the body cap (declared and streamed), duplicate keys, parse depth, lone
  surrogates, batch, response-shaped bodies, extra JSON-RPC members, and a missing version header.
- **Headers:**
  - version: unsupported version, `_meta` required, header = `_meta`;
  - mirrored names: `Mcp-Method`, `Mcp-Name`, sentinel case;
  - `Mcp-Param-*`: required, must match, and absent when there is no value (D-4).
- **Dispatch:** unknown method, unknown notification, argument validation, the root
  `unevaluatedProperties` default, the result cap, and the handler timeout.
- **Request state:** its MAC, its binding, its expiry, and its binding to the arguments.
- **Capabilities:** an undeclared capability (-32021).
- **`x-mcp-header` rules:** reachability, token syntax, uniqueness, and primitive type.
- **Schema checks:** external `$ref`, the schema-reader guard, root type, schema depth, schema
  nodes, and the keyword-aware walk.
- **Other adversarial fixes:** the validation deadline, legacy and notification header checks,
  one Host, origin-form only, one Authorization, one Content-Type, no content coding, chunked only,
  masked handler errors, `requested` not echoed, the raw-path match, and Origin on `/health`.

Three things are worth knowing about how the proof was made:
- **The handler-timeout row goes red by hanging.** With the race removed, the `slow` fixture never
  returns, and the run is killed at the matrix's 180 s limit. It never passes.
- **An earlier version of the matrix wrapped checks as `if (false && a || b)`.** That parses as
  `(false && a) || b`, so any check containing `||` was never actually disabled. It is now
  `if (false) if (…)`.
- **The batch and response-shaped refusals are enforced by two or three checks.** Those two tests
  now also assert the refusal reason, so the specific check goes red on its own.

## Adversarial pass (WO §5, fresh subagent)

I re-ran the headline probes myself before adopting them. **All were fixed, each with a test in
`test/transport/adversarial.test.ts` and a row in the matrix.**

| # | Finding | Severity | Fix |
|---|---|---|---|
| F1 | One unauthenticated connection pipelining requests it never reads held all 32 slots for about 90 s, and could renew them | DoS, pre-auth | The slot is now taken **after** authentication |
| F2 | Argument validation was synchronous, outside the handler deadline, and super-linear for ordinary shapes. `uniqueItems` over 20k objects took 17 s and **blocked `/health`**; a recursive `anyOf` doubled per nesting level; z-schema's regex guard missed `(a\|a)*$` | DoS | Validation runs in **worker threads**, terminated at `validationTimeoutMs` (2 s) → 400/-32602. Measured: `VALIDATION-DEADLINE status=400 call=319ms health=1ms` |
| F3 | A handler that timed out or was abandoned released its slot, so handler work grew without bound | DoS | The slot is held until the response closes **and** the handler settles |
| F4 | A verifier verdict of `ok: true` with no principal, or `ok: "yes"`, dispatched | **fail-open** | Dispatch requires `ok === true` and a non-empty principal id. Anything else → 500 plus an audit event |
| F5 | A verifier that never answers held a slot forever | DoS | `verifierTimeoutMs` (5 s) → 503; no slot is held while authenticating |
| F6 | The schema walk treated property **names** `const`/`default`/`examples` as data keywords, so an external `$ref` under a property named `const` registered (it still failed closed at validation). It also falsely refused properties named `$ref` or `$schema` | spec deviation | Keyword-aware walk (`schema-walk.ts`), shared by the `$ref`, size and `x-mcp-header` checks |
| F7 | `requestState` was not bound to the arguments: an approval for `file-A` was accepted on `file-B` | spec deviation (MRTR SHOULD) | A SHA-256 of the canonical arguments is sealed and compared |
| F8 | On the legacy era, `Mcp-Param-*` was not checked; notifications skipped every header and `_meta` check | spec deviation | Legacy calls check every annotated header once any is present; `notifications/initialized` checks `Mcp-Method` and `_meta` |
| F9 | Duplicate `Host` → first one wins; an absolute-form target bypassed the Host check | spec deviation (RFC 9112) | 400 for either |
| F10 | Duplicate `Authorization`/`Content-Type` → first one wins | info | 400 / 415 |
| F11 | `Content-Encoding: gzip`, and `Transfer-Encoding: gzip, chunked`, were parsed raw | info | 415 / 400 |
| F12 | A handler that threw an error shaped like a `Refusal` passed through verbatim, including its code and a 300 KB message | info | Anything a handler throws → a fixed 500/-32603 |
| F13 | The `-32022` data echoed up to 16 KiB of the version header | info (N6) | A value that is not version-shaped is replaced |
| F14 | `/x/../mcp` and `/./mcp` routed to the endpoint | info | The raw path is matched exactly |
| F15 | Audit labels were wrong after a disconnect | info | `client-disconnect`, and the timer is cleared |
| F16 | `/health` and the metadata document did not check `Origin` | info | Checked |
| F17 | A quoted `charset="utf-8"` was refused | info | Accepted |
| F18 | SPEC-MAP claimed more than the code did (BI-16/17/18, MR-5, the in-flight row, SH-2, SH-37) | review | Rows corrected |

**What held under attack** (run, not assumed):
- **Parser:** a 300,000-mutant differential fuzz of the strict parser against `JSON.parse` found
  no divergence beyond its deliberate refusals.
- **Framing:** CL+TE, lying `Content-Length`, truncated or overlong UTF-8, and a BOM all fail closed.
- **Errors:** throwing verifiers, registries and handlers produced no crash and no leaked slot.
- **Headers:** duplicates of every mirrored header are refused, and so is every `Origin` variant tried.
- **Legacy:** `initialize` under the modern header → 404, and no session id is ever sent.
- **Memory:** 1,000 sequential requests with `--expose-gc` showed about 33 B/request, consistent
  with JIT warm-up and not retention. Without forced GC my test sees 5.2 MiB of uncollected
  garbage, with in-flight back at 0.

**§5 items 1–7:**
1. Base64 `Mcp-Name` for a plain name → 200; wrong-case markers → 400/-32020.
2. `_meta` at the top level → 400/-32600, never read.
3. Exactly the cap → 200; cap+1 → 413; chunked over the cap → 413; chunked under → 200.
4. cap+1 → 503 and the held calls complete. The pre-auth exhaustion (F1) is fixed.
5. External `$ref` → registration refused, and nothing is fetched (network trap).
6. A state replayed on another tool, on other arguments, or after its TTL → refused.
7. Memory: as above.

## SPEC-MAP deviations and decisions needed

These are in full in `SPEC-MAP.md`:

| # | Deviation | Decision-needed |
|---|---|---|
| D-1 | A legacy `initialize` **without** `MCP-Protocol-Version` is accepted. Under `2025-11-25` the header only follows `initialize`, and refusing it (WO §1.4's text) would make the legacy path unreachable for every conforming legacy client. The conformance suite's `server-initialize` confirms it | **yes** |
| D-2 | Legacy semantics are served without a session (the versioning page says "scoped to the session"): the WO's ratified choice | no |
| D-3 | Legacy era: mirrored headers are not required but are validated when present. A client can pick the legacy era per request, which is the spec's design; SH-40 tells intermediaries to distrust old versions | no |
| D-4 | An `Mcp-Param-*` header sent when the body value is null or absent → refused. The spec says only that the server "MUST NOT expect" it | no |
| D-5 | `LEGACY_PATH_REVIEW_BY = 2027-07-28`. The spec's deprecated-features registry gives no removal date for `2025-11-25`, so I set one year after the current revision, with a test that fails from that date | **yes** (confirm the date) |
| D-6 | HTTP status for JSON-RPC errors after validation: client-caused → 400 (unknown tool, invalid arguments, bad state, validation timeout); server-side → 500 (timeout, oversize result, handler error). The spec fixes the status only where SPEC-MAP says | no |
| D-7 | The root default is `unevaluatedProperties: false`, not `additionalProperties: false`. The two are identical for a flat schema, but only the first is right under root composition (tested). The advertised schema is unchanged | no |

**SHOULDs not followed:**
- **JSON-only responses (SH-12).** The spec permits them, since "server MUST return either"
  JSON or SSE. So progress notifications (SSE) are not sent.
- **SH-7 is enforced narrower.** The server requires only that `Accept` admits
  `application/json`; it does not require `text/event-stream`.
- **The request-state key is optional.** With no key, no state is issued or accepted (MR-4
  fails closed), so a server with no MRTR tools needs no key.

**New limits added beyond WO §1.10**, each named, defaulted and red-proofed:
- `validationTimeoutMs` 2 s and `validationWorkers` 2 (F2);
- `verifierTimeoutMs` 5 s (F5);
- `requestTimeoutMs` 30 s, replacing Node's 300 s `requestTimeout`, which bounds a slow-drip body.

**Node's own header limits**, recorded rather than re-implemented (§1.10), measured on v24.21.0:
`maxHeaderSize` 16,384 B, `maxHeadersCount` null (Node's internal 2000), `headersTimeout` 60 s.

## Validator measurement

The measurement was delegated. I re-ran the chosen candidate's suite myself: **`zschema/formatOff:
pass 1252/1252`**. I also checked its tree, the absence of code generation, and its remote-ref
behaviour.

The test suite is JSON-Schema-Test-Suite `5b0ee16` (2026-09-21), `tests/draft2020-12/*.json`
(required only). **Skipped identically for every candidate:** `refRemote.json`, plus 8 groups (18
tests) whose `$ref` points at a remote document not embedded in the schema.

| Candidate | Version | Packages | Install scripts | Size | Codegen | 2020-12 pass | Remote `$ref` |
|---|---|---|---|---|---|---|---|
| **z-schema** (chosen) | 12.4.6 | 5 (+ optional `commander`, CLI only) | none | 2.0 MB | none | **1252/1252** (format as annotation) | never fetched; unresolved → invalid |
| @hyperjump/json-schema | 1.17.8 | 12 | none | 0.9 MB | none | 1248 | **fetches by default** (http, https, file) until plugins are removed process-wide |
| json-schema-library | 11.6.2 | 10 | none | 3.9 MB | none | 1250 (formats off) | lazy failure at validate |
| @exodus/schemasafe | 1.3.0 | 1 | none | 0.1 MB | **yes** | 1215 (spec mode) | compile throws |
| @cfworker/json-schema | 4.1.1 | 1 | none | 0.2 MB | none | 1203 | lazy failure |
| ajv (`dist/2020`) | 8.20.0 | 5 | none | 1.3 MB | **yes** | 1196 (strict: false) | compile throws |
| jsonschema | 1.5.0 | 1 | none | 0.1 MB | none | 978 | throws at validate |

Dependency listing, from `npm ls -w packages/core --all`:

```
@clearseal/core@0.0.0 -> ./packages/core
└─┬ z-schema@12.4.6
  ├── commander@15.0.0      (optional; the CLI)
  ├── punycode@2.3.1
  ├─┬ safe-regex2@5.1.1
  │ └── ret@0.5.0
  └── validator@13.15.35
```

`grep -c hasInstallScript package-lock.json` → 0.

**Caveats:**
- The 2020-12 line is recent: 12.0.0 is from 2026-02, with one maintainer.
- Its ReDoS guard refuses some legitimate patterns (the common Base64 regex, lookbehind) and
  misses some unsafe ones. The worker deadline (F2) is the real bound.
- Its schema reader is a process-global static. The transport refuses to compile or validate if
  anything has installed one (red-proofed).

## Specification-page disagreements (the schema page wins)

- **`UnsupportedProtocolVersion`.** `schema.ts`, the versioning page and `basic/index` all say
  **`-32022`** at `ab3a39c`. `changelog.mdx` item 12 records the renumbering from **`-32004`**, as
  it does `HeaderMismatch` `-32001` → `-32020` and `MissingRequiredClientCapability` `-32003` →
  `-32021`. A page still carrying the pre-renumber code is what the WO saw; `-32022` is used.
- **`serverInfo` placement.** WO §1.6 lists `serverInfo` as a field of the discover result.
  `schema.ts` and the discover page place it at `_meta["io.modelcontextprotocol/serverInfo"]`, and
  the code follows the schema.
- **The conformance suite still names `2026-07-28` "draft"** (`LATEST_SPEC_VERSION = '2025-11-25'`),
  so `--requirements 2026-07-28` must be passed explicitly. This is recorded for whoever automates
  the run.

## Gates line

| Gate | Result |
|---|---|
| `npm run check` | exit 0 on v24.21.0: `packages/core` 135 tests in 9 files; the spike's 69 |
| CI | green on both runners on the pushed commits, with this file's commit on the PR. The first push failed on Windows (`URL.pathname` → `D:\D:\…` in the no-SDK test); fixed with `fileURLToPath` |
| No SDK | `eras.test.ts` "WO §1.15" walks `packages/` for `@modelcontextprotocol/sdk`: none |
| Built output | `dist/` smoke test: the validation worker resolves as `.js` and validates |
| Leak gate | `--tree` and `--history` clean before every push |
| Credentials | pushes over the repository's write deploy key. A short-lived token was minted **only** to open this pull request, kept in a mode-0600 scratch file for that call, and **deleted** straight after |
| Protected surfaces | the steering documents, `LICENSE`, `NOTICE`, `scripts/**`, `.github/**`, `spikes/**` and the governance files diff **empty** against `main`. Changed: `packages/core/**`, `CHANGELOG.md` (the WO entry and the dependency's reason), `.env.example` (new: key names only), and `package-lock.json` |

## What did not work, and why

- **The first red-proof matrix wrapped checks as `if (false && a || b)`.** That parses as
  `(false && a) || b`, so six checks were "disabled" without effect. The misses exposed it; the
  wrapper is now `if (false) if (…)`.
- **The first F1 regression test was too weak.** 2,000 pipelined requests fit in socket buffers,
  so nothing piled up, and the matrix showed that the test passed with the fix removed. It now
  pipelines 60,000.
- **The first adversarial-regression F7 test used a fixture that accepts no arguments.**
  Rewritten with `approve_target`.
- **`http.request` will not send two `Host` headers,** so that case uses a raw socket.
- **Windows:** `new URL(...).pathname` is not a path. See the gates line.
- **I pushed one commit that the leak gate had refused.** I piped the gate into `tail`, so its exit
  status was lost and `&&` went ahead. The finding was the conformance suite's full commit SHA,
  written bare in this file. It is a public reference, but the gate refuses 40-hex outside a
  platform commit URL. That tip commit (this file's, before any pull request existed) was amended
  to use the URL form and replaced with `--force-with-lease`. From then on, the gate's exit status
  was checked on its own before every push.

## What was deliberately not built

- **The following are recorded as out of scope, and each fails closed:** SSE responses,
  `subscriptions/listen`, progress, resources, prompts, completion, logging, and the tasks
  extension.
- **No real verifier, JWKS or audience check** (`-1003`); **no pinning** (`-1001`); **no approval
  semantics or single-use state** (`-2001`); **no audit or rate limit** (`-2002`/`-2007`). A log
  line marks the audit seam.
- **No shipped tool.** Every tool is a test fixture.
- **The conformance run is not in CI.** It needs a 230 MB suite build and a fixed port; it is
  reproducible from the fixture server and the two commands above.
