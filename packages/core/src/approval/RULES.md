# Approval: a grant bound to one call, redeemed once, decided on a channel the caller cannot reach (CSR-WO-2001)

A tool whose pinned tag is `elevated` runs only after a **different principal** has approved **this exact
call**: this caller, this tool, these arguments, once, before an expiry. The decision is made on a
separate listener the calling principal cannot reach, so a prompt-injected model can ask for approval but
never give it (architecture §7.1 *A prompt-injected model*). The call does not hold open: it answers
*approval pending* with a request id, and the caller re-invokes after the decision (**grant, then
reinvoke**, architecture §5 *Approval mechanism*), with an optional bounded wait.

It is not the in-call (MRTR) tier (`-2001a`, deferred), not the ceiling or windows (`-2003`), and not
caller entitlement (P6).

## The standard, at the pinned edition (`66b640d`), §3

| Sentence | Rules |
|---|---|
| *"Rule-of-Two: `untrusted_input_facing` AND (`state_change` \| `arbitrary_exec`) ⇒ a human-in-loop obligation, discharged by an elevated human confirmation **or** by demonstrable containment."* | APR-6: an approval that discharges CAP-2 or CAP-3 is decided only by a human, through the confirm-URL. (The architect's ruling on the WO's flag-and-stop, 2026-09-28: the standard wins; the delegated approver decides only approvals no Rule-of-Two obligation depends on.) |
| *"`elevated` is pinned because the human-confirmation gate reads it: an allowlist held outside the manifest is authority the pinning system does not know exists."* | APR-1: whether a tool needs approval is read from its pinned `elevated`, and APR-6's test from its pinned class, flag and domain; nothing outside the manifest decides it. |
| *"Human-in-loop rides standard rails. An elevated-confirmation tier for catastrophic operations targets the spec's Multi-Round-Trip Requests / Tasks extension rather than a bespoke round-trip."* | Deferred by the architect to `-2001a` (the in-call tier), with a named trigger; this WO builds the out-of-band grant the architecture ruled for `-2001`. |

## Rules

One rule per line, each with its red-proof (`test/approval/`) and a control-deletion row.

| Rule | Statement | Red-proof |
|---|---|---|
| APR-1 | A call to a tool whose pinned tag is `elevated`, with no valid grant, never enters its handler: it answers *approval pending* with a request id and a retry hint. | no grant → pending, and a handler that records every entry recorded none |
| APR-2 | A grant redeems only for the principal that requested it, the same tool and the same canonical argument digest, before its expiry. Each mismatch is refused by name: `wrong-principal`, `wrong-tool`, `wrong-arguments`, `expired`, `unknown`; none consumes the grant. | each mismatch refused by name, and the grant still redeems for the right call |
| APR-3 | A grant is consumed by its first redemption; a second answers `used`. | approved, re-invoked → runs once; again → `used` |
| APR-4 | A decline is terminal: a declined request can never later be approved (`-0101` B1). | declined, then approved → the approval refused; the call answers `declined` |
| APR-5 | The approver is never the requester: a decision whose approver equals the requesting principal is refused and audited (`self-approval`), on both paths (`-0101` C1). | the human approver's principal as requester, and a delegated token whose `sub` is the requester → each refused, one row each |
| APR-6 | An approval that discharges Rule-of-Two (CAP-2 or CAP-3, read from the pinned tag) is decided only through the human confirm-URL; a delegated decision on one is refused and audited (`human-required`). A delegated approver decides only approvals required by CAP-7 alone. | a delegated approval of an untrusted `arbitrary_exec` tool → refused, one row; the same through the confirm-URL → granted |
| APR-7 | The approval routes are served on the approval listener only: the main listener serves none, and the approval listener refuses to start on the main listener's address and port. | every approval path on the main listener → 404; the same address and port → start refused |
| APR-8 | Confirm-URL: the link alone does not decide (reading it describes the request only); a decision needs the link and the code. A wrong code is refused, and after 5 wrong codes the link is burned; a second use and an expired link are refused. | wrong code, second use, expired link, burned link → each refused |
| APR-9 | A delegated approver presents a bearer the core's verifier accepts for the approval audience, which must differ from the node's (start refused if equal); its `sub` is the approver. A token for any other audience, the node's own included, is refused. | a token for the node's audience → 401; `APPROVAL_AUDIENCE` equal to `AUTH_AUDIENCE` → start refused |
| APR-10 | The link and the code go to the notifier only: never into an audit row, never into a response to the caller, never into the listener's own responses. | a canary over every flow: no issued link token or code in any row or response |
| APR-11 | Notifications are bounded per principal: a principal holds at most `maxPendingPerPrincipal` pending requests; one more is refused (`too-many`) and not notified. A repeat of a pending request (same principal, tool and arguments) reuses it and is not notified again. | the cap's worth notified, the next refused unnotified; a repeat notifies nothing |
| APR-12 | State is bounded and expires: at most `maxPending` requests in all; a pending request expires after the request lifetime, a grant after the grant lifetime, and a record is dropped once neither can matter. | a pending request past its lifetime → `expired`, one row; the table never exceeds its cap |
| APR-13 | With a bounded wait set, the first call waits up to that long for a decision: approved inside it, the call runs in one round; otherwise it answers pending at the limit. The wait is capped below the handler timeout. | a decision inside the wait → one call runs; none → pending after the wait |
| APR-14 | Fail closed without a backend: the registry refuses an `elevated` tool unless an approval backend is configured in the settings snapshot; the transport refuses to start when a registered tool needs approval and it was given no backend; dispatch refuses such a call without one. | no backend → refused at construction, as before `-2001`; a registry that says configured with no backend → start refused |
| APR-15 | Every step is audited: requested, notified, approved, declined, redeemed (with its approver, `-0101` B2), expired, and every refusal by kind, with the principal, the approver, the tool, the keyed argument digest and the request id; never a link, a code or an argument value. | each event written with those fields |
| APR-16 | The webhook notifier posts only to an `https` URL, verifies TLS, and follows no redirect. | an `http` URL → start refused; a redirect → not followed, the failure audited |

## Choices, and why

**Pending is a tool result with `isError: true`, not a JSON-RPC error.** The model that made the call must
see it and act on it (tell the user, re-invoke later); MCP carries a tool's own failure in the result so
the model sees it, and a JSON-RPC error is a protocol failure a client may not show the model. It also
keeps one shape in both eras (the legacy era turns JSON-RPC errors into `200` anyway). The machine-readable
part is in the result's `_meta["clearseal/approval"]` (`status`, `requestId`, `retryAfterS`), so a
tool's `structuredContent` and output schema are untouched. Every approval refusal (`declined`, `used`,
`wrong-arguments` and the rest) uses the same shape, naming its kind.

**The request id travels in `_meta["clearseal/approval"]` on the re-invocation, never in the
arguments**, whose schema is pinned.

**The binding digest is the core's canonical argument digest** (`argumentsDigest`, SHA-256 of the
canonical JSON, the one MRTR's request state binds to). The audit rows carry the store's **keyed** digest
instead, as the `tool-call` row does, since an unkeyed digest of a short argument can be guessed.

**The confirm-URL's approver is an operator-configured principal** (`APPROVAL_HUMAN_APPROVER`): the
person holding the notifier's channel. APR-5 compares it with the requester, as it compares a delegated
token's `sub`.

**No console backend.** Architecture §5 as amended 2026-09-28: a service has no console. The backends
are the approval-listener backend and a deterministic test backend.

## Settings and defaults (read in the snapshot, `node/settings.ts`)

| Variable | Default | Why |
|---|---|---|
| `APPROVAL_BACKEND` | `none` | Fail closed: no `elevated` tool is served until the operator configures one (`listener`). |
| `APPROVAL_LISTENER_HOST` | `127.0.0.1` | Loopback: the approval channel is reached out of band, never from where callers come. |
| `APPROVAL_LISTENER_PORT` | `3031` | Beside the teaching edition's default (3030); any port but the main listener's. |
| `APPROVAL_PUBLIC_URL` | the listener's own `http://host:port` | The base of the link a notifier delivers; set it when the listener sits behind a proxy. |
| `APPROVAL_AUDIENCE` | unset: no delegated approvers | A delegated approver needs its own audience; without one only the confirm-URL decides. |
| `APPROVAL_HUMAN_APPROVER` | `operator` | The principal recorded for a confirm-URL decision. |
| `APPROVAL_REQUEST_TTL_SECONDS` | 600 | Ten minutes for a person to see a notification and act; the MRTR state's lifetime. |
| `APPROVAL_GRANT_TTL_SECONDS` | 300 | Five minutes to re-invoke after an approval: a grant is not a standing permission. |
| `APPROVAL_WAIT_SECONDS` | 0 | No call holds open unless the operator asks (architecture §5); at most 25, below the 30 s handler timeout. |
| `APPROVAL_NOTIFIER` | `stderr` | Development; `webhook` for a deployment. |
| `APPROVAL_WEBHOOK_URL` | unset | Required, `https`, when the notifier is `webhook`. |
| `APPROVAL_MAX_PENDING` | 1,000 | Bounds the table; a request is a few hundred bytes. |
| `APPROVAL_MAX_PENDING_PER_PRINCIPAL` | 3 | An injected model can have three questions in front of the approver, not three hundred. |

## Inputs to the decision (standard §9 step 6)

| Input | Class | Control |
|---|---|---|
| Whether a tool needs approval (`elevated`) | **pinned** | the canonical hash |
| Whether it must be a human (the class, `untrusted_input_facing`, `containment_domain`) | **pinned** | the canonical hash |
| The requesting principal; a delegated approver's `sub` | out of scope, with a named control | the verifier (`auth/`), against two distinct audiences |
| The confirm-URL approver | out of scope, with a named control | the operator's configuration, and possession of the link and code, which only the notifier receives |
| The arguments | out of scope, with a named control | the canonical argument digest the grant binds to |
| The time | out of scope, with a named control | the injected monotonic clock |
| The settings | out of scope, with a named control | the snapshot (`-1007b`), validated |
