# FEEDBACK: CSR-WO-2001 (approval)

Branch `wo/CSR-WO-2001`, cut from `main` at `bfccccf`. Parked as one unmerged pull request. Built on
Node v24.21.0. Spec first: `approval/RULES.md` was committed before any code.

## Gates

- `npm run check` exits 0: 904 core and teaching tests (840 on `main`), spike 0102 69, spike 0101 8,
  `test:subset` 4.
- `control-deletion`: the self-test passes; the four shards turned all 211 rows red by assertion on the
  final code (262, 279, 280 and 288 s).
- `node scripts/leak-gate.mjs --tree` and `--history` exit 0, run unpiped with the exit code checked
  directly, before every push.
- CI on the pull request's first run (#72, at `f5f0f67`): `ci` green, twelve jobs: `test` on
  ubuntu-latest and windows-latest, `leak-gate`, `audit`, `sbom`, `control-deletion-self-test`,
  `control-deletion-plan`, the four `control-deletion` shards and the `control-deletion` aggregate;
  `provenance` green (`build`, `attest`; `release` skipped).
- The pull request was opened by the architect: the S25 connection needed re-authentication, so no
  builder token was minted.

## Read this first

- **The flag-and-stop, and your ruling.** Before building I stopped on WO §7's first condition. The
  standard at `66b640d` §3 says: *"Rule-of-Two: `untrusted_input_facing` AND (`state_change` |
  `arbitrary_exec`) ⇒ a human-in-loop obligation, discharged by an elevated human confirmation or by
  demonstrable containment."* Once this WO lifts the backend, approval discharges CAP-2 and CAP-3, and
  §1.3 let a delegated (non-human) approver decide any approval. **Your ruling:** the standard wins; a
  delegated approver decides only approvals no Rule-of-Two obligation depends on (elevated by CAP-7
  alone); an approval that discharges CAP-2 or CAP-3 is decided only through the human confirm-URL, and
  a delegated decision on one is refused and audited. That is APR-6, a documented case with its
  red-proof and two rows. You record the amendment in architecture §5 and propose the delegated-approver
  case upstream; I did not edit either file.
- **Two Medium findings from the review pass, both fixed.** The grant did not cover MRTR input
  responses or request state (M1), and an approver saw arguments cut at 4 KiB with nothing saying so
  (M2). The grant now binds the exact call, and a call too large to show whole is refused approval
  (APR-17).
- **The canary is per test file, not over the whole suite (review L7).** Each approval test file ends
  with a canary over every audit row and response it saw; node:test runs each file in its own process,
  so no single canary sees all of them. Every flow that issues a link or code lives in those two files.

## The standard's sentences, and the rules that answer them

| Sentence at `66b640d` §3 | Rules |
|---|---|
| *"Rule-of-Two … a human-in-loop obligation, discharged by an elevated human confirmation or by demonstrable containment."* | APR-6: an approval that discharges CAP-2 or CAP-3 is decided by a human only (your ruling). |
| *"`elevated` is pinned because the human-confirmation gate reads it: an allowlist held outside the manifest is authority the pinning system does not know exists."* | APR-1: whether a tool needs approval is its pinned `elevated`; APR-6's test reads the pinned class, flag and domain. |
| *"Human-in-loop rides standard rails. An elevated-confirmation tier for catastrophic operations targets the spec's Multi-Round-Trip Requests / Tasks extension rather than a bespoke round-trip."* | Deferred by you to `-2001a` (the in-call tier); this WO builds the out-of-band grant architecture §5 ruled. |

## Choices the WO left to me, with reasons

**§1.2, pending is a tool result with `isError: true`**, not a JSON-RPC error: the model that called
must see it and act (tell the user, re-invoke later), and MCP carries a tool's own failure in the result
for exactly that. One shape in both eras. The machine-readable part is in the result's
`_meta["clearseal/approval"]` (`status`, `requestId`, `retryAfterSeconds`); every refusal uses the same
shape and names its kind. The request id travels back in the call's `_meta["clearseal/approval"]`.

**§1.1, the binding digest** is the core's canonical argument digest (`argumentsDigest`) over the exact
call. The audit rows carry the store's keyed digest instead, as `tool-call` rows do.

**The confirm-URL's approver** is an operator-configured principal (`APPROVAL_HUMAN_APPROVER`, default
`operator`); APR-5 compares it with the requester as it compares a delegated token's `sub`.

**The gate's place:** the last step before the handler, after validation, the mirrored headers and the
MRTR request state, so a call refused for its own form never opens a request or spends a grant.

**At the caps:** a principal holds at most 3 pending requests, and a repeat of one reuses it without a
new notification; the table holds at most 1,000. A request beyond either is refused (`too-many`) and
notifies nobody.

**The code:** 8 characters from a 31-symbol alphabet with no 0/O or 1/I/L, compared in constant time,
behind a 256-bit link token; five wrong codes burn the link.

**No console backend** (architecture §5 as amended): the backends are the approval-listener backend
and a deterministic test backend.

### Every default, with its reason

| Variable | Default | Why |
|---|---|---|
| `APPROVAL_BACKEND` | `none` | Fail closed: no `elevated` tool is served until the operator configures `listener`. |
| `APPROVAL_LISTENER_HOST` | `127.0.0.1` | Off the network by default; the separation itself is the link and code and the distinct audience (review L4). |
| `APPROVAL_LISTENER_PORT` | `3031` | Beside the teaching edition's 3030; never the main listener's. |
| `APPROVAL_PUBLIC_URL` | the listener's `http://host:port` | The link's base; set it behind a proxy. |
| `APPROVAL_AUDIENCE` | unset | No delegated approvers until the operator names their audience. |
| `APPROVAL_HUMAN_APPROVER` | `operator` | The principal a link-and-code decision is recorded as. |
| `APPROVAL_REQUEST_TTL_SECONDS` | 600 | Ten minutes for a person to see a notification and act. |
| `APPROVAL_GRANT_TTL_SECONDS` | 300 | Five minutes to re-invoke: a grant is not a standing permission. |
| `APPROVAL_WAIT_SECONDS` | 0 | No call holds open unless asked; at most 25, and shorter than the request lifetime. |
| `APPROVAL_NOTIFIER` | `stderr` | Development; `webhook` (https) for a deployment. |
| `APPROVAL_MAX_PENDING` | 1,000 | Bounds the table. |
| `APPROVAL_MAX_PENDING_PER_PRINCIPAL` | 3 | An injected model can put three questions in front of the approver, not three hundred. |

Every reader takes the snapshot's frozen copy with no `process.env` default, so the `process.env`
inventory test passes unchanged; the review confirmed no new read.

## Scope

Every changed file is on the working surface (the review listed them). `transport/registry.ts` gains
the `approval` field on a registered tool, and `test/fixtures/pin.ts` passes the registry's new option.
No protected surface changed.

## §3.2 The documented cases, pasted

Each is a test; the transport's handlers record every entry, so "never reaches its handler" is observed.

```
APPROVAL no grant → 200 {"content":[{"type":"text","text":"Approval pending for deploy (request e8616d7222a4b6ea205b1371). Nothing has run. Once it is approved, call deploy again with the same arguments and _meta {\"clearseal/approval\": {\"requestId\": \"e8616d7222a4b6ea205b1371\"}}; check again in 5 s."}],"isError":true,"resultType":"complete","_meta":{"io.modelcontextprotocol/serverInfo":{"name":"@clearseal/core","version":"0.0.0"},"clearseal/approval":{"status":"pending","requestId":"e8616d7222a4b6ea205b1371","retryAfterSeconds":5}}}; handler entries: 0
APPROVAL approved, re-invoked → ran; again → used; handler entries: ["deploy prod"]
APPROVAL declined, then approved → 409 {"error":"declined"}; the call → declined
APPROVAL wrong-principal: Approval refused for deploy: wrong-principal (request a8d4fdb84a76d369ee9a2bec). Nothing has run. It was requested by another principal.
APPROVAL wrong-tool: Approval refused for publish: wrong-tool (request a8d4fdb84a76d369ee9a2bec). Nothing has run. It was requested for another tool.
APPROVAL wrong-arguments: Approval refused for deploy: wrong-arguments (request a8d4fdb84a76d369ee9a2bec). Nothing has run. It was requested for other arguments: a grant covers exactly the arguments it was asked for.
APPROVAL unknown: Approval refused for deploy: unknown (request 0123456789abcdef01234567). Nothing has run. No such request is known.
APPROVAL unknown: Approval refused for deploy: unknown. Nothing has run. No such request is known.
APPROVAL expired: expired
APPROVAL self-approval: confirm-URL → 403; delegated → 403 {"error":"self-approval"}; rows [{"principal":"operator","request":"580e14697a32d8f447643394","tool":"deploy","kind":"self-approval","approver":"operator","via":"human"},{"principal":"carol","request":"180c718b69d417020a029bdc","tool":"deploy","kind":"self-approval","approver":"carol","via":"delegated"}]
APPROVAL Rule-of-Two: a delegated approval of publish (untrusted-facing state_change, no containment) → 403 {"error":"human-required"}; through the confirm-URL → ran; a delegated approval of deploy (CAP-7 only) → 200, ran
APPROVAL exact call: approved with one host, redeemed with every host → wrong-arguments; with the input responses approved → ran
APPROVAL a 17 KB call → too-large, nobody notified; a 15 KB call → pending
APPROVAL bounded wait 1 s: approved inside it → ran in one call; no decision → pending after 1 s
APPROVAL notification cap 3: three requests notified, a repeat → pending (not notified), a fourth → too-many (not notified); bob → pending (notified)
APPROVAL canary: 38 link tokens and codes issued; 144 audit rows and responses scanned; none carries one
LISTENER main listener: GET /approval/link/<link> → 404; POST /approval/link/<link> → 404; GET /approval/requests/<id> → 404; POST /approval/requests/<id> → 404; GET /approval → 404; POST /approval → 404; GET /approval/ → 404; POST /approval/ → 404; GET /approval/link → 404; POST /approval/link → 404; GET /approval/requests → 404; POST /approval/requests → 404
LISTENER same address and port → ApprovalListenerError: the approval listener cannot share the main listener's address and port (127.0.0.1:<port>): the approval channel must be one the caller cannot reach
LISTENER confirm-URL: wrong code → 403 {"error":"wrong-code"}; second use → 410 {"error":"link-used"}; five wrong then right → 410 {"error":"link-burned"}; expired → 410 {"error":"link-expired"}
LISTENER delegated approver: a token for the node's audience → 401 {"error":"unauthenticated"}; for the approval audience → 200, approver bot-approver recorded on redemption
LISTENER no backend → refused at construction: elevated requires an approval backend; none is configured
APPROVAL node: no APPROVAL_BACKEND → refused at construction; APPROVAL_BACKEND=listener → started, approval listener on its own port, deploy → pending
```

## §3.3 Red-proofs and control-deletion rows

Every rule APR-1 to APR-17 has a red-proof test and at least one row: 35 rows, 211 in the
manifest. Each stub deletes or weakens exactly its row's control, and each named test goes red by its
own assertion; all 211 went red in the four shards on the final code.

| Row | Control |
|---|---|
| `approval-gate-before-handler` | APR-1: a call to an elevated tool with no valid grant never enters its handler; it answers pending |
| `approval-binds-principal` | APR-2: a grant redeems only for the principal that requested it |
| `approval-binds-tool` | APR-2: a grant redeems only for the tool it was requested for |
| `approval-binds-arguments` | APR-2: a grant redeems only for the canonical argument digest it was requested for |
| `approval-grant-expires` | APR-2, APR-12: a grant lapses after its lifetime |
| `approval-redeemed-once` | APR-3: a grant is consumed by its first redemption |
| `approval-decline-terminal` | APR-4: a decline is terminal; a declined request is never approved (-0101 B1) |
| `approval-no-self-approval` | APR-5: the approver is never the requester (-0101 C1) |
| `approval-human-for-rule-of-two` | APR-6 (the architect's ruling on the standard §3): an approval that discharges Rule-of-Two is refused to a delegated approver |
| `approval-human-only-from-tag` | APR-6: whether only a human may decide is computed from the pinned tag (CAP-2, CAP-3) |
| `main-listener-no-approval-route` | APR-7: the main listener serves no approval route |
| `approval-listener-not-main-port` | APR-7: the approval listener refuses to start on the main listener's address and port |
| `confirm-needs-code` | APR-8: a confirm-URL decision needs the code as well as the link |
| `confirm-link-once` | APR-8: a confirm-URL link is spent by its first decision |
| `confirm-link-burns` | APR-8: five wrong codes burn a link |
| `delegated-verifier-own-audience` | APR-9: the delegated approvers' verifier is built for APPROVAL_AUDIENCE, never the node's audience |
| `approval-audience-differs` | APR-9: APPROVAL_AUDIENCE equal to AUTH_AUDIENCE refuses start |
| `approval-secrets-never-described` | APR-10: the listener's description of a request never carries its link or code |
| `approval-notify-cap` | APR-11: a principal holds at most maxPendingPerPrincipal pending requests; one more is refused unnotified |
| `approval-repeat-not-renotified` | APR-11: a repeat of a pending request reuses it and notifies nothing |
| `approval-total-cap` | APR-12: at most maxPending requests in all |
| `approval-request-expires` | APR-12: a pending request expires after the request lifetime |
| `approval-drops-records` | APR-12: a record is dropped once neither its request nor its grant can matter |
| `approval-bounded-wait` | APR-13: with a bounded wait, a decision inside it runs the call in one round |
| `transport-refuses-without-backend` | APR-14: the transport refuses to start when a registered tool needs approval and it has no backend |
| `node-backend-from-snapshot` | APR-14: the registry's approval backend comes from the snapshot's APPROVAL_BACKEND |
| `approval-redeem-records-approver` | APR-15: every redemption records its approver (-0101 B2) |
| `webhook-no-redirect` | APR-16: the webhook notifier follows no redirect |
| `webhook-https-only` | APR-16: the webhook URL must be https |
| `approval-binds-whole-call` | APR-2 (review M1): a grant covers the exact call: its input responses and request state as well as its arguments |
| `approval-refuses-too-large` | APR-17 (review M2): a call too large to show an approver whole is refused approval, never shown cut |
| `approval-gate-last` | Review L3: the gate is the last step before the handler, so a call refused for its own form opens no request |
| `transport-genuine-approval` | APR-14 (review L1): the transport takes only the core's own ApprovalService |
| `approval-wait-reports-expiry` | Review L5: a request that expires during the bounded wait answers expired |
| `approval-wait-shorter-than-ttl` | Review L5: the bounded wait must be shorter than the request's lifetime |

Ten earlier stubs were re-targeted at this WO's new context with the same edits (`approval-backend-none`
at the renamed default `DEFAULT_APPROVAL_BACKEND`, and nine whose neighbouring lines moved). The job
caught two defects in my own first stubs and tests: one stub broke TypeScript's narrowing, so its copy
did not build; one test left a started transport open, so its row timed out instead of failing by
assertion. Both are fixed and re-proven.

## Review pass (WO §5)

A fresh subagent read the diff against §1, §2 and your ruling, ran the suites, and ran experiments
against a real transport. **No High.** The handler is unreachable without a grant on every path it tried
(both eras, malformed `_meta` in six shapes, the bounded wait with an abort); the main listener serves
no approval route; the approver never equals the requester; APR-6 is computed correctly for every class,
flag and domain; no link or code reaches a row or a response.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| M1 | Medium | the grant did not cover `inputResponses` or `requestState`: an approved call ran with input responses the approver never saw | **fixed**: the digest covers the exact call; the approver reads it; a test and a row |
| M2 | Medium | an approver saw arguments cut at 4 KiB, unmarked: padding hid a dangerous field | **fixed**: APR-17, a call over 16 KiB is refused approval, never shown cut; a test and a row |
| L1 | Low | the transport accepted any object with a `gate`: a fake one ran an elevated tool | **fixed**: only a genuine, frozen `ApprovalService`; a test and a row |
| L2 | Low | "the webhook notifier posts only to https" held only where the URL is configured | **stated**: APR-16 says the check is at configuration; a direct caller is trusted with its URL |
| L3 | Low | a refusal after redemption (a malformed request state) spent the grant | **fixed**: the gate is the last step before the handler; a test and a row |
| L4 | Low | the listener's loopback default was said to keep callers out, but callers can be on loopback too | **stated**: the separation is the link and code and the distinct audience |
| L5 | Low | a request that expired during the wait answered pending; the wait could outlast the request | **fixed**: it answers expired; the wait must be shorter than the lifetime; tests and rows |
| L6 | Low | APR-6 holds only if the notifier reaches a person | **stated** as the operator's obligation in RULES.md |
| L7 | Low | the canary is per file, not over the whole suite | recorded above |
| I1 | Info | `wrong-principal` versus `unknown` reveals whether a 96-bit id exists | kept: the WO names both kinds; no state leaks |
| I2 | Info | the post-bind same-port check is unreachable | kept as a second line; the row targets the pre-bind check |
| I3 | Info | two stubs add a behaviour rather than delete one | accepted: those properties are absences |
| I4 | Info | dispatch's no-backend branch tells the caller `unknown` | unreachable through `startTransport` |
| I5 | Info | an already-aborted wait still waited | **fixed** |
| I6 | Info | the cap bounds concurrent requests, not their rate | recorded: the approver's decisions pace it |
| I7 | Info | the 25 s wait cap is a constant, not checked against the configured handler timeout | recorded |
| I8 | Info | with `AUDIT_STORE=seam-only` and the stderr notifier, the link and code share stderr with audit lines | recorded: development only |

## What was not built

- The in-call (MRTR) approval tier (`-2001a`); the ceiling and windows (`-2003`); caller entitlement
  (P6); provenance (`-2004`); the teaching edition's `elevated` tool (`-2005`).
- No change to an existing refusal's status, message or order.
- A notification rate limit beyond the per-principal cap (I6).
