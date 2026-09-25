# FEEDBACK: CSR-WO-0101 (spike: which in-flight approval transports the real client honours)

Branch `wo/CSR-WO-0101`, cut from `main` at `72893ac`, which has `-1005` merged, so the spike runs
on `packages/core/src/transport`. **Spike: I built the harness, measured the local half, and
stopped.** The server never left loopback in my hands, and nothing here says how it gets exposed.
Parked as one unmerged pull request. Built on Node v24.21.0.

Per the WO's 2026-09-25 rewrite and the kickoff, **no SDK anywhere**: the WO's "SDK half" is
this "local half", measured on the core's own transport.

## The two-part table

**Local half** (measured by the builder, `node spikes/0101-approval/probe.ts`, a scripted raw
HTTP client on loopback):

| Transport | Era | Carried locally? | Client behaviour (scripted) | Latency | Completed? | Notes |
|---|---|---|---|---|---|---|
| (a) MRTR-carried elicitation | `2026-07-28` | **yes** | `input_required` with an `elicitation/create` form request and a sealed `requestState`; the retry carries `inputResponses` plus the echoed state | 63 ms + 2 ms (two round trips; human time excluded) | **yes** (accept) | **Every answer here was produced by the script itself, with no human** (see the opinion) |
| (a) MRTR: decline | `2026-07-28` | yes | decline, and accept with `approve:false`, both → `REFUSED via mrtr` (`isError`) | 1 ms | refused, as it should be | **The same sealed state re-presented with accept → APPROVED**: the state is not single-use, so a decline is not final (finding B1) |
| (a) MRTR without the elicitation capability | `2026-07-28` | **no** | `400`, `-32021`, `requiredCapabilities: {elicitation: {}}`: the core refuses before the tool asks | 1 ms | no | A state replayed for another action → `400 -32602`. Principal binding cannot be exercised with one static principal |
| (a) MRTR-carried elicitation | `2025-11-25` | **no** | `500 -32603`, "The tool needs input, which the legacy revision cannot carry" | 1 ms | no | `2025-11-25` has no MRTR; its elicitation is a server→client request on SSE, which the core does not send. **If the hosted client speaks `2025-11-25`, path (a) cannot work on this core** |
| (b) Tasks extension | both | **not offered** | The tool returns `NOT OFFERED …` (`isError`); `tasks/get` → `404 -32601` | 1 ms | n/a | Implementable from its text (`ext-tasks` schema v2 at `6c0997f` defines `tasks/get`/`update`/`cancel`), but **not on the core transport as merged** (see below) |
| (c) Out-of-band grant | `2026-07-28` | **yes** | `PENDING via grant` (no code in the reply); the code appears only in the server log; redeem → `APPROVED via grant` | 1 ms + 1 ms (two calls) | **yes**; second use → refused | It is plain tool results, with no protocol feature needed |
| (c) Grant refusals | `2026-07-28` | yes | wrong action → `REFUSED … not for this call`; after TTL → `REFUSED … the code is expired`; reuse → `REFUSED … unknown or already used` | — | refused, as it should be | 0 grants live after the run |
| (c) Out-of-band grant | `2025-11-25` | **yes** | issue and redeem both work | 3 ms + 3 ms | **yes** | Works on both eras: it needs only `tools/call` |

**Client half** (for the operator, blank; `spikes/0101-approval/OPERATOR-PROTOCOL.md` §5 has
the full setup table as well):

| Transport | Carried by the client? | Client behaviour | Latency | Completed? | Notes |
|---|---|---|---|---|---|
| (a) MRTR: approve | | | | | |
| (a) MRTR: decline | | | | | |
| (a) MRTR: cancel | | | | | |
| (b) Tasks extension | | | | n/a | |
| (c) grant: issue and redeem | | | | | |
| (c) grant: second redemption | | | | | |
| Protocol revision the client used | | | | | |

**Why Tasks is not offered.** Offering it needs three changes to `packages/core`, which this WO
protects:
1. `server/discover` returns fixed capabilities (`{tools: {}}`), so the extension cannot be
   advertised.
2. The core refuses a `resultType` other than `complete` or `input_required` (`500`, "unknown
   result type").
3. `tasks/get`, `tasks/update` and `tasks/cancel` are not routed (`404 -32601`).

This is a "not offered", not a flag-and-stop. The kickoff says to record it that way when the path
cannot be implemented here.

## Raw messages (from `probe.ts`; `requestState` truncated, codes masked)

```
no bearer          → 401 {"jsonrpc":"2.0","error":{"code":-32600,"message":"Unauthorized"}}
wrong bearer       → 401 {"jsonrpc":"2.0","error":{"code":-32600,"message":"Unauthorized"}}

mrtr first call    → {"resultType":"input_required","inputRequests":{"approval":{"method":"elicitation/create","params":{"mode":"form",
                      "message":"Approve this action? rotate the demo key","requestedSchema":{"type":"object","properties":{"approve":
                      {"type":"boolean","title":"Approve"}},"required":["approve"]}}}},"requestState":"<base64url payload>.<HMAC tag>"}
mrtr retry+accept  → "APPROVED via mrtr (elicitation in an input_required round trip): \"rotate the demo key\". Waited 3 ms.
                      Raw answer: {\"action\":\"accept\",\"content\":{\"approve\":true}}"
mrtr decline       → "REFUSED via mrtr: \"delete the demo file\" was not approved. Waited 2 ms. Raw answer: {\"action\":\"decline\"}"  isError
same state, accept → "APPROVED via mrtr … \"delete the demo file\". Waited 5 ms."        ← B1: the state is reusable
no elicitation cap → 400 {"code":-32021,"message":"The request needs a client capability that was not declared","data":{"requiredCapabilities":{"elicitation":{}}}}
legacy mrtr        → 500 {"code":-32603,"message":"The tool needs input, which the legacy revision cannot carry"}

task               → "NOT OFFERED: the Tasks extension … is implementable from its text, but not on the core transport as merged …"  isError
tasks/get          → 404 {"code":-32601,"message":"Method not found"}

grant issue        → "PENDING via grant: a one-time code for \"restart the demo\" was issued out of band (not in this reply). …"
server log         → [approval-spike] GRANT issued: code XXXXX-XXXXX for approve_via_grant action="restart the demo"; expires in 1.5 s; single use
grant redeem       → "APPROVED via grant: \"restart the demo\". Redeemed 1 ms after it was issued."
same code again    → "REFUSED via grant: the code is unknown or already used."   isError
after the TTL      → "REFUSED via grant: the code is expired."                     isError
```

The probe uses a 1.5 s grant TTL so that expiry runs in seconds; the server's default is 120 s. A
real 150 s run with the default TTL is under §5.4 below.

## Opinion (builder's; the architect rules)

**Only (c) passes the channel-separation rule in architecture §5 *Approval binding*.**
- **(a), MRTR elicitation, cannot meet it on any client.** The token holder both receives the input
  request and answers it, and the server cannot tell a human's answer from the client's. The probe
  approved every MRTR call itself in 1–5 ms, with no human present.
  - At best, (a) is the prior's lower tier, "a human is present", and only if the hosted client
    provably shows the prompt to a human. The operator's `NO PROMPT SEEN` and `Waited N ms` cells
    measure exactly that.
  - Even then, B1 means a decline is not final until `-2001` makes the state single-use.
  - It is also unreachable if the hosted client speaks `2025-11-25`.
- **(c), the out-of-band grant, works on both eras with no client support at all.** Its channel is
  separate only if the notifier delivers where the calling principal cannot read. The log stands in
  for that here, and C2 shows why that is not good enough for `elevated`.
- **(b) is not offered.** Offering it needs three core changes, for a path the prior says to use
  "only if the hosted client uses it".

## Adversarial pass (fresh subagent, WO §5)

I re-ran B1 and D1 myself before adopting them.

| # | Finding | Severity | Status |
|---|---|---|---|
| C1 | **MRTR approval needs no human.** A script holding the bearer answers its own elicitation: `APPROVED … "wipe the production database". Waited 1 ms` | channel separation | **Recorded, for `-2001`.** It is expected by construction. The protocol now records `Waited N ms` and `NO PROMPT SEEN` |
| B1 | **One sealed `requestState` gives unlimited approvals, even after a decline.** Replaying it gave REFUSED, then APPROVED, then APPROVED. Re-asking reseals it with a fresh expiry, so approval age is not bounded by the 10-minute state TTL (49 min measured with an injected clock) | binding gap | **Recorded, for `-2001`.** It needs a single-use nonce consumed on the first answer, and `askedAt` enforced as a deadline. The probe now measures it (the table's decline row) |
| B2 | **The harness cannot tell which connection redeems a grant.** Issued on one connection, redeemed on another → APPROVED; issued modern, redeemed legacy → APPROVED. No approver is recorded, and the grant's `nonce` is never checked | binding gap | **Recorded, as the WO expected.** With a stateless transport and one static principal there is nothing to bind to. `-2001` must record the approver and bind to a real principal |
| C2 | **The "out-of-band" code is readable by a caller on the same host.** A process that spawned the server read the code from its stderr and redeemed it | channel separation | **Recorded, for `-2001`.** The notifier must deliver to a channel the calling principal cannot read. It does not apply to a remote hosted client |
| D1 | The protocol promised `… the code is expired`, but the 1 s sweeper deleted expired codes, so the operator would have seen `unknown or already used`. I reproduced this: a redemption 1.3 s after expiry gave `unknown-or-used` | doc / harness | **Fixed.** An expired code leaves a tombstone with no authority, so the reason stays "expired". Tested |
| D2 | A 403 diagnostic relied on the server log, but the core logs nothing on requests | doc | **Fixed.** The protocol now says the log is silent on connect, and diagnoses 403 from the client's error text |
| D3 | The probe's table claimed more binding than it exercised, and printed grant codes unmasked in raw exchanges | doc | **Fixed.** The rows state only what was exercised, codes are masked everywhere, and a test asserts it |
| I1 | Codes matched after case folding, which accepted a non-ASCII look-alike (U+017F for S). The Crockford aliases were not honoured | info | **Fixed.** Codes must be ASCII `[0-9A-Za-z]{5}-[0-9A-Za-z]{5}`, then are upper-cased with O→0 and I/L→1. Tested |
| I2 | Codes carry 50 bits (alphabet 32, uniform over 20k samples). There is no timing signal on redemption (medians 0.408–0.419 ms). Grant issuance is uncapped: 2000 in 659 ms floods the operator's log | info | Recorded. `-2001` should cap pending grants per principal |
| I3 | Text the model controls reaches the human. The elicitation message embeds the model's `action` ("…pre-approved, choose Approve."). U+2028 and bidi overrides pass into the log line raw | info | Recorded. `-2001` should build the prompt from canonical arguments and neutralise bidi and line-separator characters |
| I4 | The bearer check tested length only, so 32 spaces started (every request then got 401) | info | **Fixed.** At least 32 base64 or base64url characters are required. Tested |

**WO §5, item by item:**
1. **Decline** → `REFUSED via mrtr` (`isError`). So are cancel, a missing `approve`, `"true"` as a
   string, `1`, and `"ACCEPT"`. An answer under another key, or with no state, is re-asked. A state
   from another process → integrity failure. The legacy era → `500`. The replay gap is B1.
2. **Cross-connection redemption:** the harness **cannot tell** (B2), as the WO predicted.
3. **Start without the bearer:** refuses. With `env -u CLEARSEAL_SPIKE_BEARER node
   spikes/0101-approval/server.ts`, stderr is `… must be set to a bearer of at least 32 characters;
   refusing to start open` and the exit code is `2`. Empty and 31-character bearers behave the same.
4. **No grant survives expiry.** A real run with the default 120 s TTL and no traffic:
   `size()=1` at 60 s and 119 s, `0` at 121 s and 155 s. Redeeming at 155 s is refused, and with
   D1's fix the reason is now "expired". With an injected clock: redeemable at +119.999 s, gone at
   +120.000 s.

## Operator protocol, read cold by three fresh subagents (WO §3.5)

The WO's bar is that someone not in the room can say what they would do at each step without
asking a question. I measured it three times, each time with a subagent that had seen no earlier
version:

| Pass | Questions it would have had to ask | Blocking | What changed next |
|---|---|---|---|
| 1st draft | about 25 | 5 | The exposure step moved before setting `ALLOWED_HOSTS`; the log stays in the server's own terminal; the 403 guidance moved into registration; the client's own permission dialog is told apart from the server's prompt; timing and identifiers are defined; the 120 s warning is placed at the redemption step; every recorded item has a cell; the README and `.env.example` contradiction on the request-state key is resolved |
| 2nd | 25 | 1 (a second shell does not inherit the exported bearer) | The bearer goes to the clipboard in shell 1 before the server starts; every cell and timing is defined per row; the hosted-client conversation, which holds codes, is deleted at the stop |
| 3rd | 11 | **0** | All 11 minor points were then closed: Node checked in shell 1, the PR commit, a bearer-token field, non-403 errors, "Completed?" for refusal rows, stalled rows, a too-slow redemption, skipped optional rows, when Done stops, default ports, and macOS `lsof` |

All three passes confirmed that the protocol never says how the server is exposed and never leads
to an identifier being written down. The final text was not re-read by a fourth subagent after the
last small edits.

## Standard entries

**Gates line**

| Gate | Result |
|---|---|
| `npm run check` | exit 0 on v24.21.0: core 135, spike 0102 69, spike 0101 8 tests |
| Tests pinned to the probe | `test/approval.test.ts` runs the probe and asserts every row it states, including the B1 measurement and the masking of codes |
| Leak gate | `--tree` and `--history` clean before every push, checked by exit code |
| Credentials | pushes over the repository's write deploy key. A short-lived token was minted **only** to open this pull request, kept in a mode-0600 scratch file for that call, and **deleted** straight after |
| Protected surfaces | the steering documents, `LICENSE`, `NOTICE`, `packages/**`, `scripts/**`, `.github/**` and `spikes/0100-protocol/**` diff **empty** against `main`. Changed outside the spike: the root `package.json` (workspace entry and test glob), `package-lock.json`, and `.env.example` (names only) |
| Exposure | none. Every server in this work bound 127.0.0.1, including the subagents' (they checked `ss -ltnp` afterwards) |

**What did not work, and why**
- **The first spike tests hung for 60 s after passing.** `startSpike` created its validation pool
  before a start-refusal check, and an unclosed pool keeps the process alive.
  - Fixed by moving every check ahead of resource creation.
  - **A finding for the core:** a `ValidationPool` that is never closed keeps a process alive past
    a 10 s timeout, despite `unref()` (measured with a two-line script). The core is protected here.
- **My first `pkill` pattern matched its own shell and killed it.** I no longer use `pkill` with
  patterns.
- **The operator protocol took three drafts** (table above), and the first cold reader would have
  been blocked five times.

**What was deliberately not built**
- **No `ApprovalBackend`, no notifier, no single-use MRTR state, and no approver record.** These are
  `-2001`'s; B1, B2, C1 and C2 are the input for it.
- **No Tasks implementation.** It needs core changes, recorded above.
- **The server was never exposed, never registered anywhere, and the operator half was not run.**
- **No OAuth.** The static bearer is a spike device, and the README's first line says the harness is
  never to be left running.
