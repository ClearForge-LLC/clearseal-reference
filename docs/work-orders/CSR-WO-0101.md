# CSR-WO-0101 — Spike: which in-flight approval transports the real client honours

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD;
`CSR-WO-0100` should have merged first so its SDK pin and findings are available — if it has not,
say so and stop).
**Branch:** `wo/CSR-WO-0101`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree
— **for the harness only.** The measurement against the hosted client is the **operator's**
(§1.4): the builder never exposes anything.
**Phase:** P0 · **Phase exit gate:** the §2.3 row on approval transport replaced with a measured
value.
**Grounds:** `docs/architecture.md` §2.3 row two, §5 rows *Approval mechanism* ("do not decide
the transport yet — spike it") and *Approval binding* (the channel-separation rule the result is
judged against), §7.1 row *A prompt-injected model*; `docs/roadmap.md` P0 and P2 (`-2001`).

> **What this is:** the harness for a measurement, and the measurement's protocol. An `elevated`
> tool needs a human approval while a call is in flight. The specification offers spec-native paths
> — the client-mediated **elicitation** request, and the **tasks** extension for long-running,
> resumable calls — and the reference node uses an **out-of-band grant** (a link and code delivered
> off-channel, then the call is re-invoked). Which of the spec-native paths the hosted client
> actually honours is unmeasured; the SDK's support for each is measurable locally. This work order
> builds a server that offers all three and a written protocol for the operator to run it against
> the real client; the findings decide `-2001`. It is NOT the approval gate, NOT a ruling on which
> path wins, and NOT something the builder exposes. Why now: the reference node's history shows
> this question, unmeasured, costing a rebuild.

**Cadence:** spike — build the harness, run the local half, hand the operator the protocol,
**STOP**. The operator's findings are appended by the architect.

> **Rewritten 2026-09-25, before it ran.** The `2026-07-28` revision removed server-initiated
> requests on streams: elicitation now travels *inside* a Multi Round-Trip Request — the server
> returns `resultType: "input_required"` with `inputRequests` and an opaque `requestState`, and the
> client re-issues the call with `inputResponses` and the echoed state. So the three transports
> this spike offers are now: **(a) MRTR with an elicitation-type input request** (the spec-native
> path, carried by `-1005`'s transport; the `requestState` is HMAC'd by the core so a resumed call
> cannot be altered), **(b) the Tasks extension** (`io.modelcontextprotocol/tasks`, negotiated via
> capabilities — offer it only if the harness can implement `tasks/get`/`update`/`cancel` from the
> extension text; otherwise record it as not offered), and **(c) the out-of-band grant** as written.
> The spike now **depends on `-1005`** and runs on the core's own transport, not on the SDK; every
> mention of the SDK below is superseded. §1.1's `approve_via_elicitation` becomes
> `approve_via_mrtr`. The channel-separation question in §6 is sharper for (a): the client that
> holds the token both carries the input request and answers it, so MRTR-carried approval can only
> be a *lower* assurance tier than an out-of-band grant, whatever the hosted client does with it —
> the spike measures behaviour; the architecture decides the tier.

## 1. Scope — numbered, specific

1. **`spikes/0101-approval/`** — private workspace package, SDK pinned to the same exact version
   `-0100` recorded. `server.ts` on loopback with **three tools**, each an `elevated`-shaped call
   that must wait for a human before returning:
   - `approve_via_elicitation` — the tool issues an elicitation request to the client (a yes/no
     with a short schema) and returns only after the answer arrives; records timing and the raw
     answer.
   - `approve_via_task` — if the pinned SDK exposes the tasks extension, the tool returns a task
     that completes when a local approval endpoint is hit; if the SDK does not expose it, the
     tool returns a clearly labelled "not supported by SDK <version>" result and the fact is a
     finding, not a failure.
   - `approve_via_grant` — the out-of-band shape: the tool returns a pending result carrying a
     one-time code; a second call with the code redeems it (grant and redemption are two events,
     the grant expires in 120 s, the code is single-use). No notifier — for the spike the code is
     printed to the server log the operator can see.
   Every tool's result states which path it used and what the client did.
2. **Local measurement (`probe.ts`)** — a scripted MCP client against the loopback server that
   records, for each tool: whether the SDK client can carry the exchange at all, the raw messages,
   and timings. This is the SDK half of the finding.
3. **A bearer for the operator's run, by name only.** The server accepts a single static bearer
   read from an environment variable named in `.env.example` (blank), because the hosted client
   will not be talking to an unauthenticated server on the open internet. This is a spike
   credential: static, no OAuth, no AS — and the README in the spike directory says in its first
   line that this is why the harness must never be left running.
4. **`OPERATOR-PROTOCOL.md`** in the spike directory — the operator's checklist, written so a
   person not in the room can run it: start the server with the bearer set; expose it by whatever
   means the operator chooses (**nothing about that means is written here** — N6); register it in
   the hosted client; invoke each of the three tools from a conversation; record for each what the
   client showed (a prompt? a spinner? an error? nothing?), how long it waited, and whether the
   call completed; then stop the server and remove the registration. A results table with blank
   cells for the operator to fill.
5. **`FEEDBACK.md`** per §6, leading with the *local* findings and the empty results table for the
   operator's half.

## 2. Invariants — restated by number from the northstar

- **N6** — the harness carries no hostname, tunnel, path, or identifier, and the operator protocol
  does not say how the server was exposed. Leak gate before every push.
- **N8** — the bearer is named in `.env.example`, never valued; the spike README's first line says
  the harness is not to be left running.
- **N7** — none of the three tools executes anything; they *wait* and return a string.

**Protected surfaces — must diff to empty:** the four steering documents, `LICENSE`, `NOTICE`,
`packages/**`, `scripts/**`, `.github/**`, `spikes/0100-protocol/**`.

## 3. Tests / acceptance — what must be proven, not asserted

1. `npm ci && npm run check` green with the new spike package.
2. `probe.ts` output pasted: for each tool, the SDK-client result — carried, refused, or
   unsupported — with raw messages.
3. `approve_via_grant`: a redeemed code is refused the second time; an expired code is refused;
   both pasted.
4. The server refuses a request without the bearer (`401`) and with a wrong bearer; pasted.
5. `OPERATOR-PROTOCOL.md` reads correctly to a fresh subagent asked to "run this as the operator"
   in dry-run — it should be able to say what it would do at each step without asking a question.
6. All three CI jobs green.

## 4. Scope fence — what is NOT in this work order

- **Exposing the server, registering it anywhere, or running the operator half.** The operator
  does that; the builder stops at the protocol.
- **The `ApprovalBackend` interface or any core code.** `-2001`.
- **A notifier.** The grant path prints its code to the log for the spike.
- **OAuth, an AS, or the resource-server verifier.** `-1003`. The static bearer is a spike device.
- **Ruling on which transport wins.** The architect, from the combined findings.

## 5. Adversarial pass

1. Call `approve_via_elicitation` from the scripted client and *decline*; confirm the tool returns
   a refusal, not a success.
2. Redeem a grant code from a *different* client connection than the one that requested it;
   record whether the harness can tell (it probably cannot — that is a finding for `-2001`'s
   binding design, not something to fix here).
3. Start the server without the bearer variable set; confirm it refuses to start rather than
   running open.
4. Leave the server running for ten minutes with no traffic; confirm no grant survives its expiry.

## 6. Upward-feedback directive

`FEEDBACK.md`: lead with a two-part table — **SDK half** (measured by the builder) and **client
half** (blank, for the operator) — with rows for the three transports and columns
`carried by SDK · client behaviour · latency · completed? · notes`. Then the raw messages. Then,
labelled *opinion*: which path looks viable against the channel-separation rule in
`architecture.md` §5 (*Approval binding*) — elicitation is client-mediated, so the token holder
*is* the channel; say what that implies. Then the standard entries.

## 7. Flag-and-stop conditions

- The pinned SDK cannot issue an elicitation request from a tool handler at all — record how and
  stop the elicitation tool at that finding; build the other two.
- Anything that needs a hostname, a tunnel, or a credential other than the named bearer.
- A protected surface that must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-0101` off current `main` with a private spike package offering three
> approval transports (elicitation, task if the SDK supports it, out-of-band grant with single-use
> expiring codes) behind a bearer named only in `.env.example`, a scripted probe whose output
> records what the SDK client can carry for each, an operator protocol a stranger could run, the
> results table half-filled with the local findings, `npm run check` green, and the work parked as
> one unmerged pull request without the server ever being exposed. Build, measure locally, STOP.
> Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-0101 origin/main`; confirm
> `spikes/0100-protocol` exists on the base (if not, `-0100` has not merged — stop). Cadence:
> **SPIKE** — harness plus local measurement, then stop; the operator runs the client half. Read
> `docs/work-orders/CSR-WO-0101.md` in full and `docs/architecture.md` §5 (*Approval mechanism*,
> *Approval binding*). Three transports, one server, loopback, bearer by name only, never exposed
> by you, no notifier, no core code. The protocol you write must not say how the server gets
> exposed. Leak gate before every push. Flag-and-stop: WO §7. Report the PR link and the SDK-half
> table.
