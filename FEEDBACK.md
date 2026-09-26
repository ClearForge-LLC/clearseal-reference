# FEEDBACK: CSR-WO-1005b (legacy-era JSON-RPC errors at HTTP 200; the status mapping is era-dependent)

Branch `wo/CSR-WO-1005b`, cut from `main` at `88b7435`, which carries SPEC-MAP LG-8. Parked as one
unmerged pull request. Built on Node v24.21.0.

## The era × error × status table (WO §3.3)

Pasted from `packages/core/test/transport/era-status.test.ts`, which sends each fault once per era
and asserts the status and the JSON-RPC code. A dash is a fault that cannot be expressed on that
era. Where two codes are shown, the first is the modern era's and the second the legacy era's.

| # | Error | Code | 2026-07-28 | 2025-11-25 |
|---|---|---|---|---|
| 1 | Host not allowed | -32600 | 403 | 403 |
| 2 | Origin not allowed | -32600 | 403 | 403 |
| 3 | no bearer | -32600 | 401 | 401 |
| 4 | wrong bearer | -32600 | 401 | 401 |
| 5 | Authorization sent twice | -32600 | 400 | 400 |
| 6 | verifier timeout | -32603 | 503 | 503 |
| 7 | verifier ok without a principal | -32603 | 500 | 500 |
| 8 | at capacity (maxInFlight) | -32603 | 503 | 503 |
| 9 | GET on the endpoint | (no body) | 405 | 405 |
| 10 | Accept without application/json | -32600 | 406 | 406 |
| 11 | Content-Type not JSON | -32600 | 415 | 415 |
| 12 | Content-Encoding | -32600 | 415 | 415 |
| 13 | Transfer-Encoding other than chunked | -32600 | 400 | 400 |
| 14 | body over maxBodyBytes | -32600 | 413 | 413 |
| 15 | malformed JSON | -32700 | 400 | 400 |
| 16 | body not UTF-8 | -32700 | 400 | 400 |
| 17 | duplicate key | -32700 | 400 | 400 |
| 18 | nested deeper than maxJsonDepth | -32600 | 400 | 400 |
| 19 | batch | -32600 | 400 | 400 |
| 20 | body not an object | -32600 | 400 | 400 |
| 21 | jsonrpc not 2.0 | -32600 | 400 | 400 |
| 22 | a response with an id (WO §5.2) | -32600 | 400 | 400 |
| 23 | id null (WO §5.1) | -32600 | 400 | 400 |
| 24 | id not a string or integer | -32600 | 400 | 400 |
| 25 | member JSON-RPC does not define | -32600 | 400 | 400 |
| 26 | method missing | -32600 | 400 | 400 |
| 27 | method empty | -32600 | 400 | 400 |
| 28 | params not an object | -32600 | 400 | 400 |
| 29 | notification not accepted | -32601 | 400 | 400 |
| 30 | notifications/initialized with a disagreeing _meta version | -32020 | — | 400 |
| 31 | MCP-Protocol-Version unsupported | -32022 | 400 | 400 |
| 32 | MCP-Protocol-Version missing (not initialize) | -32020 | 400 | 400 |
| 33 | MCP-Protocol-Version sent twice | -32020 | 400 | 400 |
| 34 | _meta protocol version disagrees with the header | -32020 | 400 | 400 |
| 35 | legacy initialize without the header, _meta naming another version | -32020 | — | 400 |
| 36 | Mcp-Method missing | -32020 | 400 | — |
| 37 | Mcp-Method disagrees with the body | -32020 | 400 | 400 |
| 38 | Mcp-Name disagrees with the body | -32020 | 400 | 400 |
| 39 | Mcp-Param-* disagrees with the arguments | -32020 | 400 | 400 |
| 40 | unknown method | -32601 | 404 | 200 |
| 41 | ping on the modern era | -32601 | 404 | — |
| 42 | params._meta missing | -32602 | 400 | — |
| 43 | params._meta not an object | -32602 | 400 | 200 |
| 44 | tools/list with a cursor | -32602 | 400 | 200 |
| 45 | tools/call without params.name (modern: the Mcp-Name gate answers first) | -32020 / -32602 | 400 | 200 |
| 46 | unknown tool | -32602 | 400 | 200 |
| 47 | arguments not an object | -32602 | 400 | 200 |
| 48 | arguments fail the input schema | -32602 | 400 | 200 |
| 49 | validation over validationTimeoutMs | -32602 | 400 | 200 |
| 50 | handler throws | -32603 | 500 | 200 |
| 51 | handler over handlerTimeoutMs | -32603 | 500 | 200 |
| 52 | result over maxResultBytes | -32603 | 500 | 200 |
| 53 | tool returned no result | -32603 | 500 | 200 |
| 54 | tool returned an unknown resultType | -32603 | 500 | 200 |
| 55 | tool returned no content | -32603 | 500 | 200 |
| 56 | result not serializable (ST-5: no id, so never 200) | -32603 | 500 | 500 |
| 57 | input_required on the legacy era (LG-8) | -32601 | — | 200 |
| 58 | input request of an unknown kind | -32603 / -32601 | 500 | 200 |
| 59 | input_required with nothing in it | -32603 / -32601 | 500 | 200 |
| 60 | input request needs an undeclared capability | -32021 / -32601 | 400 | 200 |
| 61 | requestState cannot be sealed (no key) | -32603 / -32601 | 500 | 200 |
| 62 | inputResponses not an object of objects | -32602 | 400 | — |
| 63 | requestState refused | -32602 | 400 | — |

**What changed:** exactly 19 legacy cells, rows 40, 43–55 and 57–61, all of them JSON-RPC errors
answering a well-formed request. They were `404`/`400`/`500` on `main` and are `200` now. No
HTTP-level row moved in either era.

**Measured against `main` (WO §5.3):** I ran the same test file against `main`'s `src` in a scratch
worktree and compared the printed bodies.
- The **59 rows with a modern cell have byte-identical modern bodies and statuses**.
- The **legacy bodies are byte-identical as well**, so only the status line changed (ST-4, N4).
- On `main` the file fails exactly those 19 legacy rows.
- The adversarial pass repeated this independently and got the same result.

The comparison ran on the 61-row version of the table. The two rows added afterwards (35 and 56)
were measured as unchanged from the base by the adversarial pass.

## The official SDK client (WO §1.5, §3.2)

`packages/core/test/sdk-client/sdk-client.test.ts` drives SDK 1.30.1's `Client` and
`StreamableHTTPClientTransport` in the legacy era against the transport, calling the MRTR tool
`ask`:

```
SDK-CLIENT at 200: negotiated=2025-11-25 error=McpError code=-32601 data={"requires":"2026-07-28"} onerror=[]
SDK-CLIENT at 400: error=StreamableHTTPError code=400 data=undefined onerror=["StreamableHTTPError"]
```

- **At 200** the client raises `McpError(-32601, data.requires)`. No transport error is raised.
- **At 400** it throws `StreamableHTTPError`. Its `code` is the HTTP status, and `data` is gone. The
  client also fires `onerror`. The raw body survives only inside the error's message string
  (`"Streamable HTTP error: Error POSTing to endpoint: {…}"`), not as a code or data a caller can
  use.

**The 400 test** re-serves the transport's own 200 body at 400 through a fetch shim. It asserts
that the shim rewrote exactly one body, and that the body carries `-32601`.

**The before-state, with the mapping switched off** (red-proof M1 below): the transport itself
serves 400, and the 200 test then fails with what the client received:

```
SDK-CLIENT at 200: negotiated=2025-11-25 error=StreamableHTTPError code=400 data=undefined onerror=["StreamableHTTPError"]
```

That is the F7 measurement, kept as a regression test.

## The dependency tree (WO §3.4)

- `@modelcontextprotocol/sdk` is pinned **exactly** at `1.30.1`, the version `-0100` measured, and
  **only** in `devDependencies` of `@clearseal/core`.
- **The lockfile gains 3 lines and 0 packages.** The tree already held 1.30.1 for
  `spikes/0100-protocol`, and `npm install` reported "up to date, audited 201 packages".
- **The SDK's own tree:** 37 unique packages, 8.7 MB on disk. All of it is dev-only.
- **The runtime tree of `@clearseal/core` is unchanged:** `z-schema` and its dependencies. `dist/`
  contains no SDK import (the adversarial pass grepped it).
- `leak-gate --history` passed after the pin, and again before every push. Each run was checked by
  its exit code.

## Gates

| Gate | Result |
|---|---|
| `npm run check` | exit 0 on v24.21.0: core **207** tests (12 files; +61 era-status rows net, +2 SDK-client, the ban split in two, +2 rows from the adversarial pass), spike 0102 69, spike 0101 8 |
| CI | both runners, on the pull request |
| Protected surfaces | The steering documents, `LICENSE`, `NOTICE`, `scripts/**`, `.github/**` and the governance files diff **empty**. Under `packages/core/src` only `dispatch.ts` (the response-mapping path: `statusForEra` and the comment on LG-8) and `SPEC-MAP.md` changed. `spikes/**` has **one** changed line (D-1) |
| Credentials | Pushes went over the repository's write deploy key. A short-lived token was minted **only** to open this pull request, kept in a mode-0600 scratch file for that call, and **deleted** straight after |

## The change

- **One rule, in one place.** `statusForEra` in `dispatch.ts` is applied where a request's refusal
  is returned. On `2025-11-25` a refusal is re-issued at `200` with code, message, `data` and
  headers unchanged, except `-32020` (the version and mirrored-header gates). Everything refused
  before the era is known keeps its own status: framing, auth, media types, capacity, and `-32022`.
  Notifications never pass through it (LG-9: a rejected notification is an HTTP error).
- **SPEC-MAP.**
  - It gains **ST-1…ST-5** with an era table.
  - **LG-9** quotes the legacy page's sentence ("If the input is a JSON-RPC _response_ or
    _notification_ … it **MUST** return an HTTP error status code").
  - **ST-1** quotes the modern page's explicit `4xx` cases.
  - **LG-8** now says `200`. **D-6** is amended to cover the modern era only.
  - The Limits table notes that its statuses are the modern era's.
- **Tests.** Three `corrections.test.ts` assertions (LG-8) moved from `400` to `200`.

## Deviations

| # | Deviation | Ruling |
|---|---|---|
| D-1 | `spikes/0101-approval/test/approval.test.ts:93`: `[400, -32601]` → `[200, -32601]` | Permitted by WO §1.4. It is the only change under `spikes/**` |
| D-2 | **The SDK ban test (`eras.test.ts`, §1.15) was narrowed.** It walked all of `packages/` and refused any file or manifest naming the SDK, which WO §1.5 makes impossible (the import and the dev dependency must be in `packages/core`). Now: no file under `packages/` names it except `test/sdk-client/sdk-client.test.ts` (and the ban test itself). The only manifest naming it is core's, and there only as an exact `devDependency`: never `dependencies`, `peer`, `optional` or `bundled`. Its extension list also gained `.tsx` and `.jsx`. Both halves are red-proofed (M4, M5) | Recorded, not flagged. `packages/core/test` is not a protected surface, and the kickoff states the ban's intent as "no SDK in src". **For the architect to confirm** |
| D-3 | **The SDK test has its own directory and `tsconfig.json`** (`packages/core/test/sdk-client/`). The SDK's declarations need the DOM lib (`HeadersInit`, as `-0100` found). Adding DOM to core's `tsconfig.json` would type-check `src` against browser globals, so core's config excludes that directory and `typecheck` runs a second `tsc -p` over it. The adversarial pass confirmed DOM does not leak: `HeadersInit` in `src` still fails `TS2304` | Recorded |

## Red-proofs (N5)

Each mutant was applied to the committed tree and restored from it:

| Mutant | Result |
|---|---|
| M1: the mapping switched off (`return refusal`) | **24 red**: both SDK-client tests, the three LG-8 tests, all 19 legacy-200 rows; spike `-0101` red on its D-1 row |
| M2: no HTTP-level exception (`-32020` also mapped to 200) | **5 red**: the legacy `-32020` rows (`_meta` version, `Mcp-Method`, `Mcp-Name`, `Mcp-Param-*`, the header-less `initialize`) |
| M3: the mapping applied to the modern era too | **40 red**, including 21 modern era-status rows and the modern-era tests of every earlier WO |
| M4: an SDK import in `src/index.ts` | the ban test's import half red |
| M5: the SDK in core's `dependencies` | the ban test's runtime-dependency half red |

## Adversarial pass (fresh subagent, WO §5)

| # | Finding | Severity | Status |
|---|---|---|---|
| A1 | FEEDBACK was not yet written when the pass ran | process | **This file** |
| A2 | A handler result that cannot be serialized (`BigInt`, a cycle, a throwing `toJSON`) is `500`, `-32603`, **no `id`**, in both eras. The result-size check's `JSON.stringify` throws a plain error, which the server's last-resort handler answers. So the legacy client loses it and no `200` can carry it. This predates the WO | low–medium | **Recorded, not changed.** Making it a refusal with the `id` would be a new refusal, outside the §4 fence. Now a table row (56) and SPEC-MAP ST-5. **Proposed follow-up** |
| A3 | A legacy `initialize` **without** the header, whose `_meta` names `2026-07-28`, is `400 -32020` ("MCP-Protocol-Version does not match the request body"), though no header was sent. Keyed by code, it falls in the gate class; a `_meta` that is not an object is `-32602` and goes to `200` | low | Consistent with WO §1.2 read literally. Now a table row (35) and a line in ST-3. **Decision-needed** if the architect wants it at `200` |
| A4 | The code comment and ST-3 credited the legacy page with keeping mirrored-header mismatches at `400`. That page defines no mirrored headers; the rule is WO §1.2's | low (documentation) | **Fixed:** the comment and ST-3 now say so and cite SH-24…SH-38 |
| A5 | `-32022` in the HTTP-level set could never fire: it is thrown before the era is assigned | info | **Fixed:** removed, and the comment says why |
| A6 | SPEC-MAP said 61 modern rows are byte-identical; 59 rows have a modern cell | low | **Fixed** |
| A7 | The 400 SDK test would pass without touching the transport's mapping (the shim passed any non-200 through) | low | **Fixed:** the shim now asserts it rewrote exactly the transport's one 200 body. M1 gives the real switched-off measurement (above) |
| A8 | The string-based SDK ban can be evaded by a computed dynamic import, and it did not scan `.tsx`/`.jsx`. Neither is a regression: the SDK was already hoisted for `-0100` | info | `.tsx`/`.jsx` **added**. A lint rule (`no-restricted-imports` on `src`) plus a `dist` grep is **proposed**, not built |
| A9 | The SDK client waits 60 s on a `200` JSON-RPC error that has no `id` | info | No path produces one. The era-status test asserts the request `id` on every `200`, which is the guard |

**Held (measured by the subagent):**
- **WO §5.1:** `id` `null`, object, array, `true`, `1.5`, 2^53 → `400 -32600` with no `id`.
- **WO §5.2:** response-shaped bodies (result, error, id `null`, no id) → `400`.
- **Notifications:** notifications bypass the mapping (`202` / `400`).
- **N4:** every legacy `200` from a refusal carries both `error` and the request `id`. A handler that
  throws a `Refusal(400, -32020)` is still wrapped to `-32603`.
- **The legacy page:** no MUST-`4xx` case on it is served at `200`.
- **Spec quotations:** SPEC-MAP's quotations match both pages.

## What did not work, and why

- **The SDK's typings failed core's type check** (`TS2304: Cannot find name 'HeadersInit'`). That
  led to D-3's separate tsconfig rather than DOM in core's.
- **My first cut of the enumeration had two wrong rows.**
  - `params.name` missing on the modern era is answered first by the `Mcp-Name` gate (`-32020`),
    and the row now says so.
  - The no-key row needed a state-only tool, because `ask` hits the capability check first.
- **My mutant script cost me an edit.** It restores each file with `git checkout`, and that silently
  reverted an uncommitted `dispatch.ts` fix (A4/A5). I re-applied the fix, committed, and re-ran the
  whole matrix against the commit; the table above is from that run.
- **`main` moved during the work.** It is now `e85556a`, adding a roadmap and `CSR-WO-1000`, docs
  only. The branch stays on the kickoff base `88b7435`; nothing overlaps.

## What was deliberately not built

- **Any change to a refusal's code, message or gate** (§4), including A2's missing `id` and A3's
  classification.
- **The modern era's mapping.**
- **An SDK import outside `packages/core/test/sdk-client/`.**
- **A lint rule for the SDK ban** (A8, proposed).
- **The Tasks extension** (still as listed in `-1005a`'s FEEDBACK).
