# CSR-WO-2001 — Approval: a grant bound to one call, redeemed once, decided on a channel the caller cannot reach, by a human or by a delegated approver that is never the caller

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (must contain `-2007`).
**Branch:** `wo/CSR-WO-2001`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P2 · **Phase exit gate (the clauses this WO owns):** §8 row *Approval gate; grant ≠
redemption; expiry* reads *built*; "an unapproved `elevated` call is proven not to execute"; "a grant
redeemed twice is refused the second time"; each control has a `-2008` row.
**Grounds:** the ClearSeal standard at the pinned edition (`66b640d`) §3 (the elevated confirm) — cite
the sentences you implement; `docs/architecture.md` §5 *Approval mechanism* (as amended 2026-09-28),
*Approval binding*, *Headless approval path*, *Key identity and rotation*, §7.1 *A prompt-injected
model*, §8; `spikes/0101-approval/` (its findings B1, B2, C1 are acceptance lines here);
`packages/core/src/capability/RULES.md` (the `APPROVAL_BACKEND = "none"` refusal this WO lifts).

> **What this is:** the control that stands in front of what cannot be contained. A tool whose rung
> or flags require approval (`elevated`, and what `-2000`'s obligation table names) runs only after a
> **different principal** has approved **this exact call**: this caller, this tool, these arguments,
> once, before an expiry. The decision is made on a **separate listener** the calling principal cannot
> reach, so a prompt-injected model can ask for approval but can never give it. The approver may be a
> human (a one-time link and a short code, delivered by a notifier) or a **delegated approver** — an
> agent or service holding its own credential for the approval listener — because the autonomous era
> needs approval that does not wait on a person, and what makes approval meaningful is that the
> approver is not the caller, not that the approver is human. The call does not hold open: it answers
> *approval pending* with an id, and the caller re-invokes after the decision (**grant, then
> reinvoke**), with an optional short bounded wait so a fast delegated approver can complete in one
> call. With no approver present, a pending approval expires and the caller gets a terminal answer;
> every tool that needs no approval keeps working. It is NOT the in-call (MRTR) approval tier
> (`-2001a`, deferred with a named trigger), NOT the capability ceiling or windows (`-2003`), NOT
> caller entitlement (P6).

**Cadence:** build, spec-first: `packages/core/src/approval/RULES.md` first, one rule per line with its
red-proof. One PR, left unmerged for review. **Adversarial discipline:** regression tests for every
documented case in §3, and a fresh review subagent against §1 and §2. **This WO also gets an external
red-team pass after it parks** (the external review cadence names approval).

## 1. Scope — numbered, specific

1. **The binding** (`packages/core/src/approval/`): an approval *request* is created for (requesting
   principal, tool name, canonical argument digest, nonce, expiry). A *decision* (approve or decline)
   records the approver's principal. A *grant* is redeemable **once**, only by the requesting
   principal, only for the same tool and argument digest, only before its expiry; **a decline is
   terminal** (the same request can never later be approved — `-0101` B1); **the approver must differ
   from the requester** (refused, and audited, if equal — `-0101` C1). Redemption is its own audited
   event, separate from the grant (`-0101` B2: the approver is recorded on every redemption). Reuse the
   core's existing canonical argument digest; if that needs a protected file changed, flag and stop.
2. **The call flow.** A call to a tool that requires approval, with no valid grant, does not run: it
   answers *approval pending* with the request id and a retry hint, in the era's shape (choose the
   shape — a tool result with `isError` or a JSON-RPC error — record why). The caller re-invokes the
   same tool with the same arguments, carrying the request id in `_meta` (never in the arguments,
   whose schema is pinned); a valid grant is consumed and the call runs. Every refusal names its kind
   (pending, declined, expired, used, wrong principal, wrong tool, wrong arguments, unknown id) and is
   audited. **Optional bounded wait:** an operator setting (default 0, capped below the handler
   timeout) lets the first call wait that long for a decision before answering *pending*.
3. **The approval listener.** A second HTTP listener, on its own operator-configured address and port
   (default loopback), refusing to start if it equals the main listener's. It serves the approval
   routes and nothing else; **the main listener serves no approval route** (proven by test over every
   approval path). Two approver kinds:
   - **Human, confirm-URL:** a one-time link plus a short code (§5 *Headless approval path*); the link
     alone does not decide; wrong code, second use and expired link are each refused.
   - **Delegated approver:** a bearer token verified by the core's existing verifier against a
     **distinct audience** configured for the approval listener (never the node's audience); its
     `sub` is the approver principal, and it may never equal the requester.
4. **Notifier** (interface): a stderr notifier (development) and a webhook notifier (POST to an
   operator URL, verified TLS, no redirects followed). The link and the code go to the notifier only —
   **never to the audit store, never into a response to the caller**. Notifications are bounded per
   principal so an injected model cannot flood the approver.
5. **Backends.** `ApprovalBackend` interface; a deterministic test backend; the approval-listener
   backend above. (The console backend §5 names is dropped: a service has no console — record it.)
6. **Lifting the construction refusal.** `APPROVAL_BACKEND` stops being the constant `"none"`: the
   registry takes whether an approval backend is configured from the settings snapshot. Without one,
   every tool that requires approval is still refused at construction exactly as today. Pending
   requests and grants are bounded in number, expire, and are dropped when expired.
7. **Settings** in the `-1007b` snapshot: listener address and port, approver audience, request and
   grant TTLs, the bounded wait, notifier kind and webhook URL, the caps — validated, each default
   stated with its reason. The `process.env` inventory names each read.
8. **Audit.** Events for requested, notified, approved, declined, redeemed, expired and every refusal
   kind, in `audit/RULES.md`'s table: principal, approver, tool, argument digest, request id — no link,
   no code, no argument value.
9. **Control-deletion rows** for every rule, and **`FEEDBACK.md`** per §6.

## 2. Invariants

- **N4**: a call that needs approval and has no valid grant never reaches its handler (proven with a
  handler that records any entry).
- **Channel separation**: the calling principal can neither reach the approval routes nor be the
  approver.
- **One call, once**: a grant authorises exactly the call it was made for, one time.
- **Nothing secret leaves by the wrong door**: links and codes go only to the notifier.
- **N5**: every rule has a red-proof and a `-2008` row.

**Protected surfaces (must diff to empty):** the four steering documents, `LICENSE`, `NOTICE`,
`spikes/**`, `docs/canonical-form.md`, `pinning/canonical.ts`, `pinning/gate.ts`, `pinning/manifest.ts`,
`containment/**`, `auth/**` (use the verifier, do not change it), `audit/**` except `RULES.md` and the
event policy, `packages/core/test/boundary/**`, `.github/**`. Working surface: the new
`approval/**`, `capability/ladder.ts` and `capability/RULES.md` for the `APPROVAL_BACKEND` change only,
`pinning/registry.ts` where it reads that input, `transport/**` where the call is gated and the second
listener is started, `node/**` for settings and start-up, `index.ts` export lines, `.env.example`,
`packages/teaching/README.md`, tests, `test/deletion/**`.

## 3. Tests / acceptance

1. `npm run check` green on both runners; both leak-gate modes exit 0; every control-deletion shard and
   the aggregate green.
2. Documented cases, each a test, each pasted:
   - an approval-requiring call with no grant → *pending*, handler never entered;
   - approved, then re-invoked → runs once; re-invoked again → refused (used);
   - declined, then the same request approved → refused (decline terminal);
   - grant redeemed by another principal, for another tool, with other arguments, after expiry, with
     an unknown id → each refused by name;
   - approver equals requester (confirm-URL session or delegated token) → refused and audited;
   - every approval path on the main listener → not found; the approval listener on the main
     listener's address and port → start refused;
   - confirm-URL: wrong code, second use, expired link → each refused;
   - delegated approver with the node's own audience → refused;
   - the bounded wait: a decision inside the wait runs in one call; none → *pending* at the limit;
   - no approval backend configured → approval-requiring tools refused at construction, as today;
   - no link or code in any audit row or caller response, by a canary test over the whole suite;
   - notifications per principal capped.
3. Red-proofs for every rule: pasted.

## 4. Scope fence

- **The in-call (MRTR) approval tier** — `-2001a`, deferred; trigger: a client this reference must
  serve that honours in-call approval and a tool class whose claim is "a human is present".
- **The ceiling and windows** (`-2003`), **caller entitlement** (P6), **provenance** (`-2004`).
- **The teaching edition's `elevated` tool** (`-2005`); tests here use fixtures.
- **Any change to an existing refusal's status, message or order.**

## 5. Review pass

A fresh subagent reads the diff against §1 and §2 and reports: the handler is unreachable without a
valid grant on every path; the main listener has no approval route; the approver can never equal the
requester; no secret reaches the audit store or the caller; every documented case present.

## 6. Upward-feedback directive

`FEEDBACK.md`: gates line, the pastes in §3, the choices in §1.2 and every default in §1.7 with its
reason, the standard's sentences with their rules, review findings, what was not built.

## 7. Flag-and-stop conditions

- The standard's text at `66b640d` requires something §1 does not, or forbids something it allows —
  quote it and stop.
- Reusing the canonical argument digest or the verifier needs a protected file changed.
- A protected surface must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-2001` off current `main` where a call needing approval never reaches its handler
> without a grant bound to its principal, tool, argument digest and expiry, the grant is redeemed once
> and a decline is terminal, decisions are made only on a separate approval listener by a human
> through a confirm-URL or by a delegated approver with its own audience, the approver can never be
> the requester, links and codes reach only the notifier, the construction refusal lifts only when an
> approval backend is configured, every documented case in the WO is a test, control-deletion rows
> exist for every rule, `npm run check` is green on both runners, and the work is parked as one
> unmerged pull request. Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-2001 origin/main`. Node 24.21.0. Cadence:
> **build**, spec-first. Read `docs/work-orders/CSR-WO-2001.md` in full, the standard's §3 at the
> pinned edition, `docs/architecture.md` §5 (the approval rows, as amended) and §7.1, and
> `spikes/0101-approval/` FEEDBACK. Regression tests for the documented cases and a review subagent, no
> open-ended attack pass; an external red team follows. Delegate to subagents where it helps. Leak gate
> before every push, exit code checked directly. Report the PR link and the pastes.
