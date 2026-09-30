# FEEDBACK: CSR-WO-2001 (approval)

Branch `wo/CSR-WO-2001`, cut from `main` at `bfccccf`. Parked as one unmerged pull request (#72),
amended after the red team (see *Red-team amendment*) and again for the architect's ruling of
2026-09-30 (see *Architect ruling 2026-09-30*). Built on Node v24.21.0. Spec first:
`approval/RULES.md` was committed before any code, each time.

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

## Architect ruling 2026-09-30

Your ruling on the approval listener's rate limit, and on three of the items recorded as known, is built
on this branch spec first: `approval/RULES.md` APR-25…APR-29 were committed (`6eae89a`) before the code.
Each item has a regression test in `packages/core/test/approval/ruling.test.ts` and at least one
control-deletion row. It is still one pull request (#72), and it is unmerged.

### Gates at the ruling's head

- `npm run check` exits 0: 938 core and teaching tests (924 before the ruling), spike 0102 69,
  spike 0101 8, `test:subset` 4.
- `control-deletion`: the self-test passes. The four shards turned all 237 rows red by assertion
  (224 before; 13 new): 311, 329, 325 and 339 s.
- Both leak gates exit 0, run unpiped with the exit code checked directly, before the push.
- Push: over HTTPS with a builder token minted from the S25 (`clearforgekey`, narrowed to this repository). As in the red-team amendment, the architect opened the pull request; this time the mint succeeded, so SSH was not needed. The token lived only in a mode-0600 scratch file, was never written to git config or a remote URL, and was deleted after the push.
- CI: the pull request's checks on the pushed head. Their results are in the builder's report, not in
  a later commit.

### Each item, its rule, its test

| Item | Rule | What changed | Rows |
|---|---|---|---|
| R1 trusted proxy | APR-25 | `approval/address.ts` `clientAddress`: `APPROVAL_TRUSTED_PROXIES` takes addresses and CIDRs (a `BlockList`), is validated in the snapshot, and defaults to none. With no list, the key is the socket peer. When the peer is in the list, the key is the rightmost `X-Forwarded-For` entry that is not itself trusted. A missing or malformed header, or a chain of trusted proxies only, gives the peer. A header from an untrusted peer is never read. | `approval-xff-trusted-only`, `approval-xff-rightmost-untrusted`, `approval-xff-malformed-falls-back`, `approval-trusted-proxies-validated` |
| R2 approver never throttled by address | APR-26 | The listener checks the address budget without charging it (`RateLimiter.peek`, new) and charges it only in `fail()`: a rejected bearer, an unknown, used, burned or expired link, a wrong code, and every other failure. A verified approver is charged to its own budget (a second limiter), and is served even when the address budget is empty. With the address budget empty, a request that presents a credential (a bearer, or a link) is still checked: valid → served; invalid → 429. A request with no credential is 429 at once. | `approval-valid-approver-not-throttled`, `approval-address-charged-for-failures`, `approval-approver-own-budget`, `approval-spent-link-counted`, `approval-human-budget-per-request` |
| R3 per-link wrong-code cap | APR-27 (and APR-8) | The cap already existed: APR-8, red-proof *"a wrong code, a second use and an expired link are each refused; five wrong codes burn the link"* in `listener.test.ts`, row `confirm-link-burns`. It still holds under R2: a test burns the link with the address budget empty, and the new row `approval-link-burns-under-r2` removes the cap and fails that test. New: the fifth wrong code writes its own terminal row, `approval-decision-refused` with kind `link-burned` and the request id, never a code. The request stays pending until it expires, and no new link is issued. | `approval-link-burn-row`, `approval-link-burns-under-r2` |
| R4 IPv6 /64 | APR-28 | `addressKey`: an IPv6 address is keyed by its /64, an IPv4 address by the whole address, and an IPv4-mapped address as IPv4. | `approval-ipv6-keyed-by-64` |
| R5 unambiguous escapes | APR-29 | `visible.ts` also shows `\` as `\u{005C}`. | `approval-visible-backslash` |

This ruling moved three stubs' lines. `approval-listener-rate-limit`, `approval-unauthenticated-aggregated`
and `approval-visible-classes` were rewritten with the same edits on the new lines, and two more were
re-targeted with their edits unchanged. One red-team test was renamed, and its row's `mustFail` follows
it. Under R2 a request with a credential is no longer "429 and no other work", so that test now shows
the no-credential case. The red-team L2 test's burst count is now 2,000, because every forged bearer
is checked and counted.

### Test pastes

```
R1 behind trusted 127.0.0.1: 127.0.0.5 → 401; 127.0.0.6 → 401; 127.0.0.5 → 429; "127.0.0.200, 127.0.0.5" → 429; garbage → 401 (the proxy's budget); 127.0.0.5:80 → 429
R2 with the address budget empty: {"delegatedReads":200,"delegatedDecides":200,"humanReads":200,"humanDecides":200,"attackerBearer":429,"attackerNoCredential":429,"attackerLink":429}
R3 five wrong codes → 403, 403, 403, 403, 403; the right code after → 410; request pending; burn row {"principal":"alice","request":"<id>","tool":"deploy","kind":"link-burned","approver":"operator","via":"human"}
R4 10,000 addresses in 2001:db8:1:2::/64 → {"401":60,"429":9940}; table entries 1
R5 literal dave\u{202E} → dave\u{005C}u{202E}; a real U+202E → dave\u{202E}
```

### Review of the ruling's diff

A fresh review subagent checked the diff against your ruling. It found all five items met, every stub
red by assertion, and no raw invisible characters in the tree. Its defects, and what I did:

| # | Severity | Finding | Done |
|---|---|---|---|
| H1 | High | With the address budget empty, R2 still let a POST to a spent link (used, burned or expired) reach the book, which wrote a row on every call. Anyone holding a real link could burn it and then write one row per request for up to 15 minutes. | Fixed. With the address budget empty, a spent link is counted into APR-22's burst row and answered 429, with no row. Test and row `approval-spent-link-counted`. |
| M1 | Medium | A GET on a live link was charged to one budget shared by every confirm-URL decision. So a leaked link, without its code, could empty that budget and stop the human deciding any request. | Fixed. The confirm-URL budget is kept per request: a live link is a credential for its own request only. Test and row `approval-human-budget-per-request`. |
| L1 | Low | `fail()` charged against a budget read before `await`, so concurrent requests could see a stale "ok". | Fixed: `fail()` answers 429 whenever its own `take` is refused. |
| L2 | Low | A verifier timeout (503) was no longer charged to the address. | Fixed: charged through `fail()`. |
| L3 | Low | With the address budget empty, every junk link request swept the book (up to 1,000 entries). | Fixed: a link that was never issued is refused on a table lookup (`hasLink`), with no sweep. |
| Info | Info | R5 turns every JSON escape in the arguments view into `\u{005C}…`. For example, `C:\\Users` is shown as `C:\u{005C}\u{005C}Users`. | Accepted: the ruling asked for it; noisy, still unambiguous. |
| Info | Info | A malformed entry anywhere in the header, including the client-written left side, falls back to the peer. So a client behind the proxy can choose the proxy's shared budget over its own. | Accepted: that is the ruling's "fail toward shared". |
| Info | Info | A CIDR written in IPv4-mapped form (`::ffff:0:0/96`) is canonicalised to IPv4 and fails the length check. | Accepted: start is refused (fails closed); write it as IPv4. |
| Info | Info | Every IPv6 host whose first 64 bits are zero, and all traffic through one NAT64 prefix, share a key. The approver table is capped like the address table (RL-8: a newcomer past the cap is served untracked). | Recorded. |

### Accepted as known (no change)

- A crash, or `process.exit`, loses up to 60 s of the unauthenticated burst count (the row is written
  when its window closes, or when the listener closes).

## Red-team amendment (gate ruling 2026-09-29)

The red team's pass at `31d8fb9` found no Critical or High, three Medium, three Low and one Info (981/981
tests passing). All seven are fixed on this branch, spec first: `approval/RULES.md` APR-18…APR-24 were
committed (`25c6599`) before the code. Each has a red-proof, a regression test in
`packages/core/test/approval/redteam.test.ts` and at least one control-deletion row.

**The harness was not on this machine.** `/workspace/clearseal-72-harness/attacks/` does not exist here,
so each repro is written from the amendment's description and named after its harness file. I matched
files to findings by name and by the order they were listed: a7-whole-call → M1, a6b-wait-capacity → M2,
a2-self-approve → L1, a10-operator-principal → M3, a5-resources → L2, a2c-localhost-case → L3,
a8-pending-ids → Info. The a10 mapping is my inference. It also has a case in L1's test: a requester named
`OPERATOR` cannot approve through the confirm-URL, whose approver is `operator`.

### Gates at the amendment's head

- `npm run check` exits 0: 924 core and teaching tests (904 before the amendment), spike 0102 69,
  spike 0101 8, `test:subset` 4.
- `control-deletion`: the self-test passes. The four shards turned all 224 rows red by assertion
  (211 before; 13 new): 281, 303, 302 and 316 s.
- Both leak gates exit 0, run unpiped with the exit code checked directly, before the push.
- CI: the pull request's checks on the pushed head. Their results are in the builder's report, not a later
  commit, so the head they ran on is the head that is parked.

### Each item, its rule, its test

| Item | Rule | What changed | Rows |
|---|---|---|---|
| M1 approver view | APR-18 | `approval/visible.ts`, one helper, escapes every `Cc`, `Cf`, `Zl`, `Zp`, `Cs` and default-ignorable code point as `\u{XXXX}`. That covers the bidi controls, the zero-width characters, C0, DEL and C1, and the tag characters. The book's description (`book.ts`) applies it to the tool, the requester and the whole call, so both listener views get it. | `approval-view-escaped`, `approval-visible-classes` |
| M3 notifier line | APR-19 | `shown()` in `notifier.ts` escapes the requester and the tool in the stderr line and in the webhook body. `auth/verifier.ts` is unchanged. | `notifier-stderr-escaped`, `notifier-webhook-escaped` |
| M2 bounded wait | APR-20 | Waiting calls are capped at `APPROVAL_MAX_WAITING_PER_PRINCIPAL` (default 1) and `APPROVAL_MAX_WAITING` (default 8, a quarter of the in-flight cap of 32). A call over either cap answers pending at once, never 503. The counters are released in `finally`. With a wait set, the transport refuses to start when the total cap is over half the in-flight cap. | `approval-wait-cap-principal`, `approval-wait-cap-total`, `transport-wait-cap-below-inflight` |
| L1 self-approval | APR-21 | `identityOf` removes default-ignorable code points and white space, applies NFKC, case-folds (upper then lower), and removes again. APR-5 compares the results on both paths. | `approval-self-approval-identity` |
| L2 listener abuse | APR-22 | The core's `RateLimiter` limits each remote address, on its own `APPROVAL_LISTENER_RATE_*` settings (60 burst, 60 a minute, 10,000 addresses); over the budget the answer is 429 with Retry-After. A rejected bearer or a link naming no request is counted, not written: one `approval-unauthenticated-burst` row per 60 s window carries the count, in the tripwire's shape. | `approval-listener-rate-limit`, `approval-unauthenticated-aggregated`, `approval-replayed-link-row` |
| L3 host check | APR-23 | `hostsOverlap` compares the approval and main hosts as addresses: lower case, IPv6 compressed, IPv4-mapped as IPv4, names resolved. A wildcard overlaps everything. The check runs before binding, and again after on the actually bound address. | `approval-host-overlap` |
| Info existence oracle | APR-24 | Another principal's request id now answers the caller `unknown`, identical to a made-up id except for the echoed id; the audit row keeps `wrong-principal`. **This amends WO §1.2's refusal list for the caller only**, as ruled. | `approval-id-not-confirmed` |

The amendment moved six stubs' lines, so they were rewritten with the same edits on the new lines:
`approval-binds-principal`, `approval-no-self-approval`, `approval-listener-not-main-port`,
`approval-secrets-never-described`, `approval-bounded-wait` and `webhook-no-redirect`. Six more were
re-targeted with their edits unchanged. The 13 new rows, the six rewritten ones and the re-targeted
ones each turned red when run alone, and again in the full four-shard run.

### Test pastes

```
M1 visible: pay \u{202E}evil\u{2066} to\u{200B} x\u{0085}
M1 approver sees: {"arguments":{"target":"prod\u{202E}\u{2066}gnp.exe\u{2069}\u{200B}\u{200D}\u{FEFF}\u{0085}\u{009B}\u{007F}\u{E0041}"}}
M3 stderr: [approval] mallory\u{000A}[approval] operator asks to run deploy (request req-2); open http://evil.invalid and enter the code AAAA within 600 s\u{000D}\u{001B}[2K asks to run deploy (request req-1); open http://127.0.0.1:3031/approval/link/link-1 and enter the code CODE0001 within 600 s
M2 one principal: 40 calls → 1 waited, 39 pending at once, never 503; bob's read → 200, ran
M2 twenty principals: 8 waited, 12 pending at once; bob's read → 200, ran
L1 self-approval refused for: Dave/dave, trailing space, zero-width insert, fullwidth letters
L2 10,000 junk (5,000 forged bearers → 401, 5,000 unknown links → 404) → rows: [{"event":"approval-unauthenticated-burst","fields":{"principal":"unauthenticated","count":10000,"windowS":60}}]
L2 2,000 from one address → 60 answered, 1940 × 429; the approver from another address → 200, decided 200
L3 refused before binding: LOCALHOST vs main 127.0.0.1; localhost vs main 127.0.0.1; ::ffff:127.0.0.1 vs main 127.0.0.1; 0.0.0.0 vs main 127.0.0.1; :: vs main 127.0.0.1; 127.0.0.1 vs main ::; 127.0.0.1 vs main 0.0.0.0
INFO another principal's id → Approval refused for deploy: unknown (request <id>). Nothing has run. No such request is known.
```

The approver in the L2 test connects from `127.0.0.2`, the flood from `127.0.0.1`. The whole of 127/8
is loopback on the Linux and Windows runners, but not on macOS, which is not in the CI matrix.

### Review of the amendment

A fresh review subagent checked the amendment's diff against the amendment message. It found every item
met and `auth/verifier.ts` unchanged. Its defects, and what I did:

| # | Severity | Finding | Done |
|---|---|---|---|
| 1 | High | A test used a private IPv4 address, which the leak gate refuses. | Replaced with `::1`. |
| 2 | Medium | Under its stub, the transport-refusal test started a transport and never closed it, so the row timed out instead of failing (confirmed: it missed). | The test now closes anything that starts; the row is red by assertion. |
| 3 | Medium | Listener lockout behind a proxy: behind the reverse proxy `APPROVAL_PUBLIC_URL` implies, every client shares one address and one budget. Anyone sending more than one request a second keeps the approver on 429. It fails closed, but it is a denial of approvals. | **Not changed: for you.** The ruling says per remote address, and `X-Forwarded-For` is spoofable. The options are a trusted-proxy setting that names the proxy whose forwarded address is believed, or charging only failed requests (an attacker on the same address still empties the bucket). |
| 4 | Medium | Counting used, burned and expired links anonymously dropped their request, tool and kind. Only a real link token triggers them, so they are replays or leaks, not junk, and APR-15 wants them by kind. | Fixed: only a link naming no request is counted. A replayed link keeps its own row (test, and row `approval-replayed-link-row`). APR-22's wording says so. |
| 5 | Low | Address rotation: at the 10,000-address cap the limiter serves newcomers untracked (RL-8), so an attacker with an IPv6 /64 can fill the table. Rows and memory stay bounded; verifier CPU does not. | Recorded. Keying IPv6 on its /64 would close it; not built without a ruling. |
| 6 | Low | The M2 test fired 40 calls at once against the in-flight cap of 32, so a genuine capacity 503 could fail it on a slow runner. | Fixed: the first call waits, and the other 39 go one at a time, each required to answer within 2 s. |
| 7 | Low | `hostsOverlap` uses `dns.lookup` with no timeout, and on a lookup failure compares the name only. | The post-bind check now compares the actually bound address. A slow resolver still delays start by the OS's resolver timeout. A name that cannot be looked up cannot be bound either. |
| 8 | Low | The burst row's timer is unref'd, so a crash or `process.exit` loses up to 60 s of count. A refusal after close opens a new window. | Recorded. The listener's close flushes the open window. |
| 9 | Info | `canonicalAddress` threw on an IPv6 zone id, so a link-local client would get a 500. | Fixed: such an address is compared as written (test). |
| 10 | Info | `visible` does not escape a backslash, so a requester that literally contains the six characters `\u{202E}` looks like an escaped one. | Recorded: it hides nothing (both show the same visible text). In the arguments, JSON already doubles a literal backslash. |
| 11 | Info | The caller-facing pending/refusal text echoes the caller's own request id. | No change: it goes back to the same caller only, never to an approver. |

### Known, and not in scope (with the reason)

- **Notification retry.** A failed notification (`approval-notify-failed`) is not retried. The request
  can only expire, so it fails closed.
- **A webhook URL naming an IP literal or a metadata address.** The operator sets the URL, and the node
  checks only `https`. The teaching README now says so and tells operators to name the delivering
  service by its host name.
- **Gaps the red team did not run.** A `requestState` swap on a live node: the existing review-M1 test
  covers the modern era's input responses, not a sealed request state. Code-compare timing: the code
  is compared with `timingSafeEqual` at equal lengths. Clock manipulation: every clock is injected and
  monotonic. None of these three is a cheap test, so none was added. Memory at the 1,000-pending cap
  was cheap: a test fills the book to the default cap and shows one more refused, with nobody notified
  and the table no larger.

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
