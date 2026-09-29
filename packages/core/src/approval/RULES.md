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
| APR-2 | A grant redeems only for the principal that requested it, the same tool and the same exact call (the canonical digest of its arguments, and on the modern era any input responses and request state: review M1), before its expiry. Each mismatch is refused by name: `wrong-principal`, `wrong-tool`, `wrong-arguments`, `expired`, `unknown`; none consumes the grant. | each mismatch refused by name, and the grant still redeems for the right call |
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
| APR-14 | Fail closed without a backend: the registry refuses an `elevated` tool unless an approval backend is configured in the settings snapshot; the transport refuses to start when a registered tool needs approval and it was given no backend, and takes only a genuine, frozen `ApprovalService` (review L1); dispatch refuses such a call without one. | no backend → refused at construction, as before `-2001`; a registry that says configured with no backend → start refused; an object that merely has a gate → start refused |
| APR-15 | Every step is audited: requested, notified, approved, declined, redeemed (with its approver, `-0101` B2), expired, and every refusal by kind, with the principal, the approver, the tool, the keyed argument digest and the request id; never a link, a code or an argument value. | each event written with those fields |
| APR-16 | The webhook URL is `https` (an `http` one refuses start: the check is where the URL is configured, `approvalFromEnv`; a direct caller constructing `WebhookNotifier` is trusted with its URL, review L2); the notifier verifies TLS and follows no redirect. | an `http` URL → start refused; a redirect → not followed; an unverifiable certificate → refused |
| APR-17 | An approver sees the whole call or decides nothing: a call whose serialized form exceeds 16 KiB is refused approval (`too-large`), never shown cut (review M2). | a 17 KB call → refused, nobody notified; a 15 KB call → pending |


### The red-team amendment (gate ruling 2026-09-29)

An external red team's pass over this build found three Medium, three Low and one Info. Each is fixed by
a rule below, with its red-proof and a control-deletion row. Two of them amend a rule above: APR-24
changes what APR-2's `wrong-principal` tells the caller, and APR-21 widens APR-5's comparison.

| Rule | Statement | Red-proof |
|---|---|---|
| APR-18 | The approver's view shows every invisible or control code point as a visible `\u{XXXX}` escape: C0, DEL and C1 controls, format characters (the bidi controls U+202A–202E, U+2066–2069, U+200E/F and U+061C, the zero-width U+200B–200D, U+2060 and U+FEFF, and the tag characters), line and paragraph separators, lone surrogates, and every other default-ignorable code point. Applied to the tool, the requester and the call on the approval listener. One helper, `approval/visible.ts` (red team M1). | a call carrying each class → shown escaped on the listener, none raw in the response bytes; plain text unchanged |
| APR-19 | The notifiers put every caller-influenced field (the requester and the tool) through the same helper, in the stderr line and in the webhook body, so a requester cannot forge a line with a newline, a carriage return or an escape sequence (red team M3). | a requester carrying `\n`, `\r` and ESC → one stderr line, escaped; the webhook body escaped |
| APR-20 | The bounded wait is capped: at most `maxWaitingPerPrincipal` calls per principal (default 1) and `maxWaiting` in all (default 8, a quarter of the default in-flight cap of 32) wait at once. A call over either cap answers pending at once, never `503`. The transport refuses to start with a wait set when `maxWaiting` exceeds half its in-flight cap (red team M2). | one principal fires 40 calls and many principals one each → at most one and eight wait; another principal's `read_only` call is served |
| APR-21 | APR-5's comparison is on identities, not bytes: approver and requester are compared after removing default-ignorable code points and white space, NFKC, and a Unicode case fold; equal after that is refused as `self-approval`. It only widens a refusal, so matching too much is the safe direction (red team L1). | `Dave`/`dave`, a trailing space, an inserted zero-width space, fullwidth letters → each refused, on both paths |
| APR-22 | The approval listener is rate limited per remote address, by the core's own limiter on its own settings; over the budget a request answers `429` with `Retry-After` and does no other work. Refusals that nothing is behind (a bearer the verifier rejects; a link that names no request) are audited as one `approval-unauthenticated-burst` row per 60-second window, with the count (the tripwire's shape), not one row each. A link that names a request but is used, burned or expired is a real link replayed or leaked, and keeps its own row naming the request, the tool and the kind (APR-15) (red team L2). | 10,000 junk requests → bounded rows and a bounded table; an approver from another address is served; a replayed link → its own row |
| APR-23 | APR-7's same-address check compares hosts case-insensitively and by what they resolve to: `localhost`, `127.0.0.1`, `::1` and `::ffff:127.0.0.1` are compared as addresses, and a wildcard (`0.0.0.0`, `::`) overlaps every address, so the approval listener cannot start on any address the main listener already serves on its port (red team L3). | `LOCALHOST`, `localhost`, `::ffff:127.0.0.1` and `0.0.0.0` against a main listener on `127.0.0.1`, and `127.0.0.1` against a main on `::` → each refused before binding |
| APR-24 | A request id held by another principal answers the caller `unknown`, exactly as an id that does not exist, so an id's existence is never confirmed to a principal that did not request it; the audit row keeps `wrong-principal` (red team Info; amends APR-2 for the caller only). | another principal's id → `unknown`, the row says `wrong-principal`, and the grant still redeems for its requester |

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

**The operator's obligation (review L6).** APR-6 holds only if the notifier's channel reaches a person:
the link and the code decide as a human, whoever holds them. A notification says when only a human may
decide; an operator must not point the webhook at an agent, the delegated approver included.

**No console backend.** Architecture §5 as amended 2026-09-28: a service has no console. The backends
are the approval-listener backend and a deterministic test backend.

## Settings and defaults (read in the snapshot, `node/settings.ts`)

| Variable | Default | Why |
|---|---|---|
| `APPROVAL_BACKEND` | `none` | Fail closed: no `elevated` tool is served until the operator configures one (`listener`). |
| `APPROVAL_LISTENER_HOST` | `127.0.0.1` | Loopback keeps the listener off the network by default. It is not what separates the channels: the main listener defaults to loopback too, so callers may come from there. The separation is the link and code only the notifier holds, and a delegated token for an audience the node never accepts (review L4). |
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
| `APPROVAL_MAX_WAITING_PER_PRINCIPAL` | 1 | APR-20: one principal holds at most one in-flight slot in a wait; its other calls answer pending at once. |
| `APPROVAL_MAX_WAITING` | 8 | APR-20: a quarter of the default in-flight cap (32), so waiting calls can never take the slots other calls need; at most half the cap, or start is refused. |
| `APPROVAL_LISTENER_RATE_BURST` | 60 | APR-22: a person reading and deciding makes a handful of requests; sixty at once is far more than any approver needs. |
| `APPROVAL_LISTENER_RATE_REFILL_PER_MINUTE` | 60 | APR-22: one a second, sustained. |
| `APPROVAL_LISTENER_RATE_MAX_ADDRESSES` | 10,000 | APR-22: bounds the limiter's table, as `RATE_LIMIT_MAX_PRINCIPALS` does the main listener's. |

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
