# FEEDBACK: CSR-WO-0100 (spike: what the official SDK actually serves in stateless mode)

## Proposed `architecture.md` §2.3 row (verbatim, to replace row one)

The measurement moves from "blocked" to measured. Every value below comes from
`node spikes/0100-protocol/probe.ts` on this branch (**SDK `@modelcontextprotocol/sdk` 1.30.1, Node
v24.21.0**). The finding id in brackets is the probe line that produced it.

| Measurement | Measured value | Harness that produced it |
|---|---|---|
| Which protocol revisions the official TypeScript SDK actually serves in stateless mode, and whether `server/discover` is reachable | **SDK 1.30.1 serves `2025-11-25` as its latest revision, and does not serve `2026-07-28`.** Its supported list is `2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07` [`sdk.SUPPORTED_PROTOCOL_VERSIONS`]. **`initialize` never refuses a revision.** Offered any supported one, it echoes it back. Offered `2026-07-28` or an unknown one, it answers HTTP 200 and counter-offers `2025-11-25` [`initialize.offer.*`]. After initialize, an `MCP-Protocol-Version` header outside the list is **refused, HTTP 400, JSON-RPC -32000**. That includes `2026-07-28`, and the check runs before the method is looked up [`header.mcp-protocol-version.*`, `header-gate.before-dispatch`]. A request with no header is served as `2025-03-26` [`sdk.DEFAULT_NEGOTIATED_PROTOCOL_VERSION`]. **`server/discover` is not reachable: HTTP 200 carrying JSON-RPC -32601 "Method not found"**, with or without a version header [`server/discover*`]. Stateless mode (`sessionIdGenerator: undefined`) runs on the pinned Node: no session header is ever set, and a client-supplied session id is ignored [`session.*`]. | Phase-0 spike `CSR-WO-0100`: `node spikes/0100-protocol/probe.ts`. The SDK is pinned exactly at 1.30.1 in `spikes/0100-protocol/package.json`. The result was identical across three runs, and every value was re-measured against 1.30.0 (unchanged for this row). |

**For §5 (*Transport hardening*), measured on the same run and not part of the row:**
- **DNS-rebinding protection is off by default.** A foreign `Origin` and a non-loopback `Host` are both served. With the SDK's `enableDnsRebindingProtection: true` plus exact allowlists, both are refused with 403, and so is `localhost:<port>`.
- **The body limit is 4 MiB by default in 1.30.1, and absent in 1.30.0.**
- **There is no concurrency limit.** 200 overlapping requests all succeeded, with 200 in flight.
- **JSON-RPC batches are accepted, capped at 100 in 1.30.1 and uncapped in 1.30.0.**
- **Stateless `GET` opens an event stream that never closes.**

Details are in the table.

## Crossed or parked

**Nothing crossed. No §7 condition fired.**
- The SDK runs stateless on the pinned Node.
- Its whole tree installs under `ignore-scripts=true` (**0** install scripts in the spike's tree).
- The server binds `127.0.0.1` on an ephemeral port only, and was never exposed.
- No credential exists or was needed.
- The only root change is the one workspace entry.

## Findings

Legend:
- `[wire]` means the value came from an HTTP exchange with the running server.
- `[static]` means it came from the installed package or the lockfile.
- **Stable?** means byte-identical across three consecutive runs of the final probe, after ephemeral
  ports are normalised to `<port>`.
- **Version-sensitive?** compares one run against the previous release, **1.30.0**.
- Timings are separate lines, not findings (below the table).

| finding | value | command or request | stable across runs? | version-sensitive? |
|---|---|---|---|---|
| `sdk.version` [static] | 1.30.1 | package.json of the SDK module this probe imports | yes | yes (reads 1.30.0 on 1.30.0) |
| `node.version` [static] | v24.21.0 | process.version | yes | no |
| `sdk.LATEST_PROTOCOL_VERSION` [static] | 2025-11-25 | import from @modelcontextprotocol/sdk/types.js | yes | no |
| `sdk.SUPPORTED_PROTOCOL_VERSIONS` [static] | 2025-11-25,2025-06-18,2025-03-26,2024-11-05,2024-10-07 | import from @modelcontextprotocol/sdk/types.js | yes | no |
| `sdk.DEFAULT_NEGOTIATED_PROTOCOL_VERSION` [static] | 2025-03-26 | import from @modelcontextprotocol/sdk/types.js (used when a request carries no MCP-Protocol-Version header) | yes | no |
| `initialize.offer.2025-11-25` [wire] | HTTP 200 text/event-stream; result protocolVersion=2025-11-25 | POST / initialize protocolVersion=2025-11-25 | yes | no |
| `initialize.offer.2025-06-18` [wire] | HTTP 200 text/event-stream; result protocolVersion=2025-06-18 | POST / initialize protocolVersion=2025-06-18 | yes | no |
| `initialize.offer.2025-03-26` [wire] | HTTP 200 text/event-stream; result protocolVersion=2025-03-26 | POST / initialize protocolVersion=2025-03-26 | yes | no |
| `initialize.offer.2024-11-05` [wire] | HTTP 200 text/event-stream; result protocolVersion=2024-11-05 | POST / initialize protocolVersion=2024-11-05 | yes | no |
| `initialize.offer.2024-10-07` [wire] | HTTP 200 text/event-stream; result protocolVersion=2024-10-07 | POST / initialize protocolVersion=2024-10-07 | yes | no |
| `initialize.offer.2026-07-28` [wire] | HTTP 200 text/event-stream; result protocolVersion=2025-11-25 | POST / initialize protocolVersion=2026-07-28 | yes | no |
| `initialize.offer.1999-01-01` [wire] | HTTP 200 text/event-stream; result protocolVersion=2025-11-25 | POST / initialize protocolVersion=1999-01-01 | yes | no |
| `header.mcp-protocol-version.absent` [wire] | HTTP 200 text/event-stream; result | POST / tools/list, MCP-Protocol-Version absent | yes | no |
| `header.mcp-protocol-version.matching` [wire] | HTTP 200 text/event-stream; result | POST / tools/list, MCP-Protocol-Version = 2025-11-25 | yes | no |
| `header.mcp-protocol-version.architecture-target` [wire] | HTTP 400 application/json; error code=-32000 message="Bad Request: Unsupported protocol version: 2026-07-28 (supported versions: 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07)" | POST / tools/list, MCP-Protocol-Version = 2026-07-28 | yes | no |
| `header.mcp-protocol-version.unknown` [wire] | HTTP 400 application/json; error code=-32000 message="Bad Request: Unsupported protocol version: 1999-01-01 (supported versions: 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07)" | POST / tools/list, MCP-Protocol-Version = 1999-01-01 | yes | no |
| `server/discover` [wire] | HTTP 200 text/event-stream; error code=-32601 message="Method not found" | POST / server/discover, no MCP-Protocol-Version header | yes | no |
| `server/discover.with-latest-header` [wire] | HTTP 200 text/event-stream; error code=-32601 message="Method not found" | POST / server/discover, MCP-Protocol-Version = 2025-11-25 | yes | no |
| `header-gate.before-dispatch` [wire] | HTTP 400 application/json; error code=-32000 message="Bad Request: Unsupported protocol version: 2026-07-28 (supported versions: 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07)" | POST / server/discover, MCP-Protocol-Version = 2026-07-28 (the header check answers before the method is looked up) | yes | no |
| `origin.foreign.protection-off(default)` [wire] | HTTP 200 text/event-stream; result protocolVersion=2025-11-25 | raw POST initialize, Host loopback, Origin: http://evil.example | yes | no |
| `host.non-loopback.protection-off(default)` [wire] | HTTP 200 text/event-stream; result protocolVersion=2025-11-25 | raw POST initialize, Host: evil.example, no Origin | yes | no |
| `control.loopback-no-origin.protection-off(default)` [wire] | HTTP 200 text/event-stream; result protocolVersion=2025-11-25 | raw POST initialize, Host 127.0.0.1:<port>, no Origin | yes | no |
| `control.matching-origin.protection-off(default)` [wire] | HTTP 200 text/event-stream; result protocolVersion=2025-11-25 | raw POST initialize, Host 127.0.0.1:<port>, Origin http://127.0.0.1:<port> | yes | no |
| `host.localhost.protection-off(default)` [wire] | HTTP 200 text/event-stream; result protocolVersion=2025-11-25 | raw POST initialize, Host localhost:<port>, no Origin | yes | no |
| `origin.foreign.protection-on` [wire] | HTTP 403 application/json; error code=-32000 message="Invalid Origin header: http://evil.example" | raw POST initialize, Host loopback, Origin: http://evil.example | yes | no |
| `host.non-loopback.protection-on` [wire] | HTTP 403 application/json; error code=-32000 message="Invalid Host header: evil.example" | raw POST initialize, Host: evil.example, no Origin | yes | no |
| `control.loopback-no-origin.protection-on` [wire] | HTTP 200 text/event-stream; result protocolVersion=2025-11-25 | raw POST initialize, Host 127.0.0.1:<port>, no Origin | yes | no |
| `control.matching-origin.protection-on` [wire] | HTTP 200 text/event-stream; result protocolVersion=2025-11-25 | raw POST initialize, Host 127.0.0.1:<port>, Origin http://127.0.0.1:<port> | yes | no |
| `host.localhost.protection-on` [wire] | HTTP 403 application/json; error code=-32000 message="Invalid Host header: localhost:<port>" | raw POST initialize, Host localhost:<port>, no Origin | yes | no |
| `session.header-on-initialize` [wire] | absent | POST / initialize: response header mcp-session-id | yes | no |
| `session.client-supplied-id` [wire] | HTTP 200 text/event-stream; result; response mcp-session-id=absent | POST / tools/list with mcp-session-id: client-invented-session | yes | no |
| `session.GET-stream` [wire] | HTTP 200 text/event-stream; STREAM STILL OPEN after 1.5 s; body="" | GET / Accept: text/event-stream (read 1.5 s, then aborted) | yes | no |
| `session.DELETE` [wire] | HTTP 200 -; response ended; body="" | DELETE / (read 1.5 s, then aborted) | yes | no |
| `limit.body-10MB.declared-length` [wire] | HTTP 413 application/json; error code=-32000 message="Payload Too Large: Request body must not exceed 4194304 bytes"; response 125 bytes | POST / tools/call echo, 10485855-byte body with Content-Length | yes | **yes**: 1.30.0 answers HTTP 200 and echoes all 10,485,871 bytes |
| `limit.body-10MB.chunked` [wire] | HTTP 413 application/json; error code=-32000 message="Payload Too Large: Request body must not exceed 4194304 bytes" | raw POST tools/call echo, the same 10485855 bytes chunked, no Content-Length | yes | **yes**: 1.30.0 answers HTTP 200 |
| `limit.connections-200` [wire] | HTTP 200 ×200; server peak in flight 1 | 200 simultaneous POST / initialize | yes | no |
| `limit.concurrency-200-overlapping` [wire] | HTTP 200 ×200; server peak in flight 200 | 200 simultaneous POST / tools/call sleep 500 ms (requests genuinely overlap) | yes | no |
| `error.malformed-json` [wire] | HTTP 400 application/json; error code=-32700 message="Parse error: Invalid JSON" | POST / body `{not json` | yes | no |
| `error.unknown-method` [wire] | HTTP 200 text/event-stream; error code=-32601 message="Method not found" | POST / method no/such/method | yes | no |
| `error.missing-jsonrpc` [wire] | HTTP 400 application/json; error code=-32700 message="Parse error: Invalid JSON-RPC message" | POST / request without the jsonrpc member | yes | no |
| `input.notification-unknown-method` [wire] | HTTP 202 -; empty body | POST / notification (no id) for an unknown method | yes | no |
| `input.batch-of-2` [wire] | HTTP 200 text/event-stream; result + result | POST / JSON-RPC batch of two tools/list | yes | no |
| `input.batch-empty` [wire] | HTTP 202 -; empty body | POST / empty batch [] | yes | no |
| `input.batch-of-101` [wire] | HTTP 400 application/json; error code=-32600 message="Invalid Request: Batch must not exceed 100 messages" | POST / batch of 101 tools/list | yes | **yes**: 1.30.0 answers HTTP 200 with 101 results |
| `input.empty-body` [wire] | HTTP 400 application/json; error code=-32700 message="Parse error: Invalid JSON" | POST / empty body | yes | no |
| `input.content-type-text-plain` [wire] | HTTP 415 application/json; error code=-32000 message="Unsupported Media Type: Content-Type must be application/json" | POST / tools/list, Content-Type: text/plain | yes | no |
| `input.accept-json-only` [wire] | HTTP 406 application/json; error code=-32000 message="Not Acceptable: Client must accept both application/json and text/event-stream" | POST / tools/list, Accept: application/json (no text/event-stream) | yes | no |
| `deps.install-paths` [static] | 96 | npm ls --all --workspace @clearseal/spike-0100-protocol --parseable, minus the root and the workspace link | yes | no |
| `deps.distinct-name-at-version` [static] | 92 | the same paths, de-duplicated by name and version from each package.json | yes | no |
| `deps.tree-lines` [static] | 167 \| npm ls --all --workspace @clearseal/spike-0100-protocol | wc -l (non-blank; includes deduped and unmet-optional lines) | yes | no |
| `deps.sdk-direct` [static] | @hono/node-server,ajv,ajv-formats,content-type,cors,cross-spawn,eventsource,eventsource-parser,express,express-rate-limit,hono,jose,json-schema-typed,pkce-challenge,raw-body,zod,zod-to-json-schema | dependencies in the SDK's package.json | yes | no |
| `deps.sdk-peer` [static] | @cfworker/json-schema,zod | peerDependencies in the SDK's package.json | yes | no |
| `deps.install-scripts` [static] | 0 | package-lock.json hasInstallScript, restricted to the spike's install paths (ignore-scripts=true would suppress them) | yes | no |

Timings from the final run (three runs varied by under 10%, and they are not findings):

```
TIMING limit.body-10MB.declared | 21 ms | as below
TIMING limit.body-10MB.chunked | 24 ms | as below
TIMING limit.connections-200 | 294 ms | as below
TIMING limit.concurrency-200-overlapping | 679 ms | as below
```

**Command lines behind the dependency counts:**
- `npm ls --all --workspace @clearseal/spike-0100-protocol --parseable` prints 98 lines: the root
  project, the workspace link, and **96** install paths (`deps.install-paths`).
- Those paths hold **92** distinct name-and-version pairs (`deps.distinct-name-at-version`). The four
  duplicates are nested copies.
- The plain tree listing has **167** non-blank lines (`deps.tree-lines`). That includes lines
  marked `deduped`, and `UNMET OPTIONAL DEPENDENCY @cfworker/json-schema` (an optional peer that is
  not installed).
- Installing the SDK reported `added 87 packages`. That is the new packages only; the tree shares
  some packages the repository already had.

## Raw exchanges (WO §3.3 and §3.4)

**How to read this section:**
- `>>>` is the request, and `<<<` the response status, headers and body, verbatim.
- `<port>` replaces the ephemeral port.
- The Host and Origin cases were sent over a raw socket, because `fetch` cannot set `Host`.
- `initialize` never refuses. The refusal on the wire is the `MCP-Protocol-Version` header check,
  pasted as "refusal".
- The four Origin/Host combinations are each case with the SDK's DNS-rebinding protection off
  (the default) and on.

```
--- initialize offering LATEST (2025-11-25)
>>> POST / {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}
<<< HTTP 200
cache-control: no-cache, no-transform
content-length: 170
content-type: text/event-stream
x-accel-buffering: no

event: message
data: {"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{}},"serverInfo":{"name":"spike-0100","version":"0.0.0"}},"jsonrpc":"2.0","id":1}

--- initialize offering the architecture's target revision (2026-07-28): counter-offered, not refused
>>> POST / {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2026-07-28","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}
<<< HTTP 200
cache-control: no-cache, no-transform
content-length: 170
content-type: text/event-stream
x-accel-buffering: no

event: message
data: {"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{}},"serverInfo":{"name":"spike-0100","version":"0.0.0"}},"jsonrpc":"2.0","id":1}

--- refusal: post-initialize request with MCP-Protocol-Version 2026-07-28
>>> POST / {"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}; MCP-Protocol-Version: 2026-07-28
<<< HTTP 400
content-length: 198
content-type: application/json

{"jsonrpc":"2.0","error":{"code":-32000,"message":"Bad Request: Unsupported protocol version: 2026-07-28 (supported versions: 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07)"},"id":null}

--- server/discover
>>> POST / {"jsonrpc":"2.0","id":2,"method":"server/discover","params":{}}
<<< HTTP 200
cache-control: no-cache, no-transform
content-length: 100
content-type: text/event-stream
x-accel-buffering: no

event: message
data: {"jsonrpc":"2.0","id":2,"error":{"code":-32601,"message":"Method not found"}}

--- origin.foreign, protection-off(default)
>>> POST / initialize; Host loopback, Origin: http://evil.example
<<< HTTP 200
cache-control: no-cache, no-transform
content-type: text/event-stream
x-accel-buffering: no
content-length: 170

event: message
data: {"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{}},"serverInfo":{"name":"spike-0100","version":"0.0.0"}},"jsonrpc":"2.0","id":1}

--- host.non-loopback, protection-off(default)
>>> POST / initialize; Host: evil.example, no Origin
<<< HTTP 200
cache-control: no-cache, no-transform
content-type: text/event-stream
x-accel-buffering: no
content-length: 170

event: message
data: {"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{}},"serverInfo":{"name":"spike-0100","version":"0.0.0"}},"jsonrpc":"2.0","id":1}

--- origin.foreign, protection-on
>>> POST / initialize; Host loopback, Origin: http://evil.example
<<< HTTP 403
content-type: application/json
content-length: 106

{"jsonrpc":"2.0","error":{"code":-32000,"message":"Invalid Origin header: http://evil.example"},"id":null}

--- host.non-loopback, protection-on
>>> POST / initialize; Host: evil.example, no Origin
<<< HTTP 403
content-type: application/json
content-length: 97

{"jsonrpc":"2.0","error":{"code":-32000,"message":"Invalid Host header: evil.example"},"id":null}

--- error.malformed-json
>>> POST / {not json
<<< HTTP 400
content-length: 89
content-type: application/json

{"jsonrpc":"2.0","error":{"code":-32700,"message":"Parse error: Invalid JSON"},"id":null}

--- error.unknown-method
>>> POST / {"jsonrpc":"2.0","id":2,"method":"no/such/method","params":{}}
<<< HTTP 200
cache-control: no-cache, no-transform
content-length: 100
content-type: text/event-stream
x-accel-buffering: no

event: message
data: {"jsonrpc":"2.0","id":2,"error":{"code":-32601,"message":"Method not found"}}
```

## Opinion, not measurement: what P1 should know

These are the builder's reading of the measurements above. None is a finding.

1. **The SDK cannot serve the architecture's target revision.** 1.30.1 knows nothing of
   `2026-07-28`. It counter-offers `2025-11-25` on initialize, and hard-refuses the header
   afterwards. P1 either targets `2025-11-25` until an SDK release lists the new revision, or
   carries its own handling. That is the "Protocol revision" ruling's first real input.
2. **DNS-rebinding protection looks like a control, but it is off by default.** It stays off unless
   `enableDnsRebindingProtection` is set **and** the exact allowlists are given. When on, it
   matches `Host` exactly (`localhost:<port>` is refused when only `127.0.0.1:<port>` is listed),
   and it checks `Origin` only when one is sent. P1's transport should set it, or do its own check,
   and never rely on the default.
3. **Two limits are version-sensitive in a patch release.** The 4 MiB body limit and the 100-message
   batch cap are both **absent in 1.30.0**, and `npm run check` passes on either. A patch bump can
   add or remove a fail-closed default without any gate noticing. P1's own limits should not
   depend on the SDK's.
4. **Batches are accepted** even with a `2025-11-25` header, although JSON-RPC batching was removed
   from the protocol in 2025-06-18. An empty batch gets 202 with no body, and so does a
   notification for an unknown method. P1's fail-closed baseline should decide whether to accept
   batches at all.
5. **Stateless `GET` holds an event stream open indefinitely** with nothing ever sent on it. Every
   such connection is a held socket that no limit covers.
6. **There is no concurrency limit** (200 of 200 overlapping requests in flight), and no per-client
   rate limit on the transport.
7. **The SDK's published type declarations need the DOM library** (`HeadersInit` in
   `shared/transport.d.ts`). The spike's `tsconfig.json` adds `"lib": ["ES2024", "DOM"]` for that
   reason. The core's Node-only `lib` will hit the same thing when the core imports the SDK.
8. **The SDK pulls a web-framework stack into any consumer's tree** (`express`, `hono` with
   `@hono/node-server`, `cors`, `express-rate-limit`, `jose`, `pkce-challenge`, `cross-spawn`,
   `eventsource`, and more: 17 direct dependencies, 92 distinct packages). Even a server that uses
   none of them installs them. That is relevant to the architecture's *Dependencies: necessary and
   limited* row.

## Other findings

Schema: `finding · where · type · recommendation · decision-needed`.

1. **The test runner ignores the spike because of its path.** `scripts/test.mjs` globs
   `packages/*/test/**/*.test.ts` (`scripts/test.mjs:18`), and the spike lives in `spikes/`. It has
   no `test/` directory either, but that is not why it is skipped. · §3.1 · note · None. ·
   decision-needed: no
2. **The spike defines `build` and `typecheck`, both `tsc -p tsconfig.json`**, which emits nothing
   (the base sets `noEmit`). The root `build` and `typecheck` run every workspace without
   `--if-present`, so a workspace without the script fails the root command, and root config is
   protected. · `spikes/0100-protocol/package.json` · note · None. · decision-needed: no
3. **The provenance workflow's `npm pack --workspaces` will also pack the private spike.** `private`
   only blocks publishing, not packing. So a tag run's release would carry a spike tarball, with an
   attestation, beside the core's. `.github/**` is protected here. · `.github/workflows/provenance.yml`
   · risk · Before the P0 tag, either narrow the pack to `packages/*` or remove the spike from
   `workspaces` once its findings are lifted. · **decision-needed: yes**
4. **The bill of materials and the audit now include the SDK's tree.** The `sbom` job now lists
   183 components, and the SDK is checked as a direct dependency of the spike workspace.
   · `ci.yml` (unchanged) · note · Expected. · decision-needed: no

## Gates line

| Gate | Result |
|---|---|
| SDK measured | **`@modelcontextprotocol/sdk` 1.30.1**, the npm `latest` at spike time. Pinned exactly in `spikes/0100-protocol/package.json`. Previous release 1.30.0 measured once for comparison |
| `npm ci && npm run check` | exit 0 with the spike present. Typecheck and lint cover `spikes/0100-protocol/*.ts`, the directive check scans 10 files, and there is still exactly 1 test |
| Probe | `node spikes/0100-protocol/probe.ts`: exit 0 and **53 findings**, none "unknown". It runs from any directory, and `npm run probe -w @clearseal/spike-0100-protocol` also exits 0 |
| Stability (§5.1) | three runs of the final probe: every `FINDING` line and the whole raw section byte-identical; only the separate `TIMING` lines vary |
| Previous release (§5.2) | 1.30.0: only `sdk.version`, both 10 MB body findings and the 101-message batch changed (table). `npm run check` also passes on 1.30.0 |
| Error shapes (§5.3) | in the table: `error.*` and `input.*` |
| Dead port (§5.4) | a server that cannot bind makes the probe exit 1 with "no findings printed" and **0** `FINDING` lines. Findings are buffered and emitted only when every measurement succeeded |
| Loopback | the server binds `127.0.0.1` on an ephemeral port only. The stability pass saw exactly one listener, with no wildcard or IPv6 bind |
| Protected surfaces | `git diff origin/main...HEAD --stat -- docs README.md LICENSE NOTICE packages scripts .github eslint.config.js tsconfig.json tsconfig.base.json` is **empty**. The root `package.json` change is the one workspace entry (`"spikes/0100-protocol"`); the lockfile gained the SDK's tree |
| Leak gate | `--tree` and `--history` clean before every push. Identity: role only on every commit |
| CI | the run for the final commit shows on the PR |

## What did not work, and why

- **The first probe hung.** Stateless `GET` opens an event stream that never ends, and the probe
  awaited its body. That became a finding (`session.GET-stream`), measured with a 1.5 s bound.
- **The SDK's type declarations failed the repository's strict typecheck** (DOM `HeadersInit`).
  Fixed in the spike's own `tsconfig.json` (opinion 7), not by loosening library checking.
- **The first probe was not honest enough, and the stability pass said so.**
  - It read the SDK version from a hard-coded path, and crashed on the nested 1.30.0 install.
  - It needed the repository root as its working directory.
  - It counted dependencies one off its own label.
  - It called 200 simultaneous connections "concurrency" when the server never had more than
    one request in flight.
  - Its 10 MB test only exercised the declared-length check.
  - Its DNS-rebinding test had no positive control.
  - Its timings and an ephemeral port made runs differ.
  - It printed static findings before discovering a dead server.

  All of it was fixed before these findings were taken, and the whole measurement was re-run.
- **My first attempt to install the SDK into the new workspace** added only the workspace link. The
  second, naming the workspace by package, pinned it.

## What was deliberately not built

- **No transport module, auth, Origin or Host validation, body limit, batch policy, or any
  control.** Those are P1 (`CSR-WO-1005`, `-1003`). This spike measured what the SDK gives.
- **No measurement that needs the hosted client.** That is `CSR-WO-0101`.
- **No SDK version policy.** One version is pinned; the maintenance cadence owns bumps.
- **No edit to `architecture.md`.** The row above is proposed, for the architect to lift.
- **The spike server was never exposed.** It is loopback on an ephemeral port, with no auth and no
  credential.
- **No change to `packages/**`, `scripts/**`, `.github/**`, or the root lint and TypeScript
  configuration.**
