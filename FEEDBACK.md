# FEEDBACK: CSR-WO-1005a (a pool that closes, and a clean refusal for MRTR under the legacy era)

Branch `wo/CSR-WO-1005a`, cut from `main` at `b95d9e2`; `spikes/0101-approval` is on the base.
Parked as one unmerged pull request. Built on Node v24.21.0.

It contains two repairs, each with a red-proof, and one list. Every commit carries the role
identity, and `leak-gate --tree` and `--history` were clean before every push (checked by exit
code).

## Gates line

| Gate | Result |
|---|---|
| `npm run check` | exit 0 on v24.21.0: core **141** tests (10 files; +6 in `corrections.test.ts`), spike 0102 69, spike 0101 8 |
| CI | both runners, on the pull request |
| Protected surfaces | the steering documents, `LICENSE`, `NOTICE`, `scripts/**`, `.github/**` and the governance files diff **empty**. Under `packages/core/src` only three files changed: `server.ts` (server lifecycle), `dispatch.ts` (the result-mapping path), and `SPEC-MAP.md` (the line WO §1.2 requires). `packages/core/test` only grew: a new `corrections.test.ts`, and `helpers.ts` has additions only (`git diff` shows no removed line). `spikes/**` has **one** changed line, by the architect's ruling (D-1) |
| Credentials | pushes over the repository's write deploy key. A short-lived token was minted **only** to open this pull request, kept in a mode-0600 scratch file for that call, and **deleted** straight after |

## Deviation

| # | Deviation | Ruling |
|---|---|---|
| D-1 | `spikes/0101-approval/test/approval.test.ts:93` changed from `assert.equal(ex("legacy mrtr call").status, 500)` to `assert.deepEqual([status, error.code], [400, -32601])`. `spikes/**` is protected (WO §2), and the spike's test pinned the exact defect this WO repairs. That fired WO §7's flag-and-stop, so the work stopped and asked | **Ruled by the architect:** change that single assertion to the corrected shape, asserting the status **and** the code. "A spike's test tracks the core it runs on; a protected surface exists to stop scope creep, not to preserve a recorded defect." Nothing else under `spikes/**` changed |

## Paste 1: the handle count (WO §3.2)

The test `corrections.test.ts`, "after close(), the process's active handles return to the
baseline within two seconds", printed:

```
HANDLES baseline=["PipeWrap","PipeWrap"] (2)  while serving=["MessagePort","MessagePort","PipeWrap","PipeWrap","SimpleShutdownWrap","TCPServerWrap","TCPSocketWrap"] (7)  after close()=["PipeWrap","PipeWrap"] (2) in 3 ms
```

**Before `close()`: 7 handles. After: 2, equal to the baseline, 3 ms later.**

**The root cause, measured:** `unref()` releases the `Worker`, but each worker's `MessagePort`
stays active until the worker exits:

```
before: []   after new ValidationPool: ["MessagePort"]   after use: ["MessagePort"]   after pool.close(): []
```

**The repair:**
- `TransportOptions.validationPool`: once handed over, the transport owns the pool.
- `close()` closes the server and its connections, then awaits `pool.close()`, which awaits every
  worker's `terminate()`. So `close()` resolves only after the workers have exited.
- A transport that fails to start closes the pool too, both on a listen error and on a
  configuration error (adversarial F2 below).

## Paste 2: the legacy-era MRTR refusal (WO §3.3)

```
LEGACY-MRTR status=400 type=application/json body={"jsonrpc":"2.0","id":7,"error":{"code":-32601,"message":"This tool needs a multi round-trip request, which protocol revision 2025-11-25 cannot carry; use 2026-07-28","data":{"requires":"2026-07-28"}}}
```

- **Status:** 400, `application/json`, `-32601`, with `data.requires`. The tool name is logged at
  the audit seam as `legacy-input-required`.
- **Before this WO:** `500 -32603 "The tool needs input, which the legacy revision cannot carry"`.
- **SPEC-MAP line:** LG-8 (and MR-1 now says "never on the legacy era").
- **The era refusal wins over the result cap** (WO §5.2): a legacy call to `ask_big`, whose input
  request is 400 KB, gets the same 400 in a 203-byte body, and nothing of the result is sent.
- **It covers state-only results too:** a legacy call to `ask_other` or `approve_target` (no
  `inputRequests`, only `state`) gets the same refusal, and no sealed state reaches the legacy
  client (adversarial F1).

**The code choice, recorded as WO §1.2 asks.** The `2025-11-25` schema defines only the standard
codes plus `-32042` (`URL_ELICITATION_REQUIRED`, which is URL-elicitation-specific, and which
`2026-07-28` forbids emitting). There is nothing closer in the schema, so the code is `-32601`:
- JSON-RPC defines it as "the method does not exist / **is not available**";
- `2025-11-25` itself mandates it for the same situation: a tool that needs an interaction mode
  the request does not use (`basic/utilities/tasks`, "`taskSupport` is `"required"` … Servers
  **MUST** return a `-32601`").

## Red-proofs (N5)

These ran in a scratch copy of `packages/core`, running `corrections.test.ts`:

```
=== 1: close() no longer closes the pool
HANDLES … after close()=["MessagePort","MessagePort","PipeWrap","PipeWrap"] (4) in 2014 ms
  ✖ after close(), the process's active handles return to the baseline within two seconds
✖ test/transport/corrections.test.ts (59961 ms)   ← and the file then hangs: the unclosed pool keeps the process alive

=== 2a: the old line restored (Refusal(500, INTERNAL_ERROR, …))
LEGACY-MRTR status=500 … "code":-32603 …
  ✖ LG-8 legacy tools/call to an MRTR tool → 400, application/json, -32601, …
  ✖ WO §5.2 an oversized input_required on the legacy era: the era refusal wins …

=== 2b: the era check removed entirely
LEGACY-MRTR status=400 … "code":-32021 … "requiredCapabilities":{"elicitation":{}}   ← a modern-only code served to a legacy client
  ✖ LG-8 … ✖ WO §5.2 …
  (state-only tools fall through to 200 input_required with a sealed requestState; caught by the F1 test)

=== F1 mutant: the era check only when inputRequests is present
  ✖ LG-8 a state-only input_required (no inputRequests) on the legacy era is refused the same way   (actual 200, expected 400)

=== F2 mutant: the pool not closed on a configuration error
  ✖ a transport refused at configuration closes the pool it was handed   ← and the file hangs 60 s
```

With the era check removed, the result is **not** "the 500 returns", as the WO's N5 wording
supposes. Instead the legacy client gets a modern-only `-32021`, or a `200 input_required` with a
sealed state. Both are red.

## The Tasks extension: three core changes, recorded not built (WO §1.3)

Measured by `-0101` on the core as merged; the text is `ext-tasks` schema v2:
1. **`server/discover` capabilities must be configurable**, so the server can advertise
   `extensions: { "io.modelcontextprotocol/tasks": {} }`. Today they are fixed at `{ tools: {} }`
   in `dispatch.ts`.
2. **A tool result with `resultType: "task"`** (`CreateTaskResult`: `taskId`, status,
   `pollIntervalMs`) must pass the result-mapping path. Today `shapeResult` refuses any
   `resultType` other than `complete` and `input_required` with `500`.
3. **The methods `tasks/get`, `tasks/update` and `tasks/cancel` must be routed** to a task store on
   the modern era. Today they are `404 -32601`.

## Adversarial pass (fresh subagent, WO §5)

| # | Finding | Severity | Status |
|---|---|---|---|
| F1 | The tests pinned the legacy refusal only for tools with `inputRequests`. A mutant checking the era only when `inputRequests` is present passed the whole suite (138/138) and served `200 input_required` with a sealed state to a legacy client | medium | **Fixed:** a state-only test, red-proofed |
| F2 | A `startTransport` refused by `resolveConfig`, which runs before `listen`, leaked the handed-over pool. The process stayed alive until it was killed | low–medium | **Fixed:** configuration errors close the pool too. Tested and red-proofed |
| F3 | Ownership is opt-in: `validationPool` is optional, and a caller who creates a pool but does not hand it over has the old defect. The conformance fixture server does exactly that (it survives only because it calls `process.exit`). One pool shared by two transports fails closed (500 after the first closes) | design | **Recorded.** Making the field required, or having the transport create the pool, is an API change beyond this WO |
| F4 | A protected surface changed (`spikes/**`), and `helpers.ts` changed existing lines | process | The spike line was flagged, stopped on, and ruled (D-1). `helpers.ts` has been made additions-only |
| F5 | The §5.1 test ("close while a validation is in flight") passes even without the repair | info | Recorded. It shows the in-flight request fails cleanly and `close()` resolves. The evidence for the repair is the handle test and its red-proof |
| F6 | On the legacy era, the refusal also covers a handler bug (an empty or unknown input request) and a missing request-state key. The modern era answers those with `500`; the legacy era says "use 2026-07-28". The handler has already run by then, as before this WO | low | Recorded. It is never a 500 on legacy (N4 holds), but the message can be untrue in those cases |
| F7 | **At HTTP 400, the official SDK client (1.30.1, `2025-11-25`) loses the JSON-RPC error.** It throws `StreamableHTTPError(code=400)` with no `data` and fires `onerror`. **At 200 with the same body it raises `McpError(-32601, data)`.** The `2025-11-25` transport page prescribes an HTTP error status only for rejected notifications and responses | **decision-needed** | Not changed here. The 400 follows the standing D-6 rule (client-correctable → 400), and F7 applies to **every** legacy-era JSON-RPC error (unknown tool, invalid arguments, …), not just this one. Proposed: legacy-era JSON-RPC errors for requests at 200. That is a ruling on D-6 |

**Held (run by the subagent):**
- `close()` resolved in about 3 ms, and the process exited cleanly (rc 0, no unhandled
  rejections), in each case: while a validation or a `hold` handler was in flight, closed twice,
  and closed concurrently.
- Handles were at the baseline immediately after `await close()`, with no polling.
- On `EADDRINUSE`, the pool was closed and the process exited.
- Modern-era behaviour for every shared tool is byte-identical to `origin/main`. Only the legacy
  rows changed (500/-32603 → 400/-32601).

## What did not work, and why

- **My first F1 red-proof "failed" only on syntax.** The `\&\&` inside single quotes stayed
  literal, so the mutant file did not parse. Rerun with a plain `&&`, it goes red on the new test.
- **My first `helpers.ts` change rewrote the helper's `close()`,** which is more than "tests may
  grow". It was reverted to an additions-only diff: one `validationPool: pool` line and the
  `ask_big` fixture.

## What was deliberately not built

- **The Tasks extension** (the three changes are listed above).
- **Any approval logic or `requestState` semantics** (`-2001`).
- **Any change to a limit or default.**
- **Changes to the spike's harness beyond D-1's single line.**
- **A change of HTTP status for legacy errors** (F7 waits for a ruling).
- **Making `validationPool` required** (F3).
