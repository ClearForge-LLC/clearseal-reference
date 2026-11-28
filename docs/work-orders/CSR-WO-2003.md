# CSR-WO-2003 — The capability ceiling and tiered windows: planned work without forty pings, and a line no window lifts

> **Status: written, NOT fireable.** The three owner calls in §0.3 are the gate's (Scotty's). **Call 1 is
> ruled (2026-11-28): shape C.** Calls 2 and 3 are unanswered. When they are ruled, the architect records each ruling and its date in §0.3, updates §1
> to match, and only then sends §8.

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD; it must
contain `-2008b`'s merge).
**Branch:** `wo/CSR-WO-2003`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P2 · **Phase exit gate:** *"a window opened for one principal is proven not to authorise
another"*, and the §8 row *Capability ceiling and tiered windows* reads *built* with its red-proof
(`docs/roadmap.md` P2).
**Grounds:**
- `docs/northstar.md` N1, N2, N5, N7.
- `docs/architecture.md`: §5 *Capability ceiling and tiered windows*, *Approval mechanism*, *Message
  provenance*; §7.1 *A prompt-injected model*; §8 rows *Capability ceiling and tiered windows* and
  *Approval gate*.
- The standard at the pinned edition `66b640d`: §3 (Rule-of-Two, elevated, provenance floor) and §8
  #11 and #12.
- The source of this WO's design: the architect's proposal in the gate's 2026-10-07 session, kept
  verbatim on the operator's machine and summarised in §0.
- Seams: `packages/core/src/approval/` (`listener.ts`, `policy.ts`, `service.ts`, `settings.ts`,
  `notifier.ts`, `RULES.md`), `packages/core/src/capability/` (`fields.ts`, `ladder.ts`,
  `RULES.md`), `test/deletion/controls.json`.

> **What this is:** approval as built (`-2001`) is one decision per call. That is right for a one-off
> dangerous action, and it wears an operator out during planned work. Forty config changes in an hour
> mean forty approvals, and the predictable response is to switch the control off, which is the
> failure the standard warns about most.
>
> A **window** is "for the next hour, principal X may use tools A and B, for this purpose". The
> **ceiling** is the line no window can lift. In kitchen terms: a window is "you're on sauté tonight,
> you don't need to ask before every pan"; the ceiling is "nobody touches the walk-in compressor
> wiring, whatever the shift".
>
> This WO builds both in the core, defaulted-safe, as an **operator option**. It is NOT the in-call
> approval tier (`-2001a`), NOT caller entitlement (P6), NOT an eleventh pinned field (that would be
> upstream; see §0.3 call 3), and NOT any general-purpose tool.

**Cadence:** build. One PR, left unmerged for review. Security-critical, so the architect reviews it
line by line, an external red-team runs before merge (roadmap *Standing cadence*), and it is not
batched with anything.

## 0. What is fixed before the build

### 0.1 What the standard constrains (pinned edition `66b640d`)

1. **§3 Rule-of-Two.** A Rule-of-Two obligation is discharged "by an elevated human confirmation
   **or** by demonstrable containment". A window is neither: it is an earlier, broader yes, not the
   confirmation of a call. **A window can never cover a Rule-of-Two approval.** This is APR-6's
   lesson applied before building.
2. **§3, the provenance floor.** "An effect above the floor (escalate, grant, **open a maintenance
   window**, lower a guard) is refused regardless of a valid signature." So **no message and no tool
   call can open a window.** A window opens only on the approval listener, which the caller cannot
   reach.
3. **§8 #11, unpinned authority.** A gate whose decision depends on something the manifest does not
   hash can be escaped without anyone noticing. A window is runtime state by nature, so the danger is
   a window that becomes an allowlist the pinning system does not know exists. **A window may only
   choose from tools the pinned data already makes eligible. It never makes a tool eligible.**
4. **§8 #12, the unspoken capability.** Decide who may open a window before shipping the code that
   honours one. Here: a human on the approval listener, and nobody else.

### 0.2 Ratified by the gate

- **2026-11-27: windows are an operator option, and the reference ships purpose-built tools only.**
  The reference may describe and implement a window. It ships no `run_command`, no general shell and
  no general-purpose tool in any edition (N7 and the northstar's non-goals; recorded in
  architecture §10).
  - What it means here: windows are **off unless the operator configures them**. With no window
    setting, the core behaves exactly as `-2001` does today, byte for byte.
  - `arbitrary_exec` stays refused by construction. A window never reaches it, and this WO never adds
    one.

### 0.3 Owner calls — the gate's, each with the architect's recommendation (call 1 RULED; calls 2 and 3 UNANSWERED)

**Call 1 — the shape. RULED 2026-11-28 by the gate: C (tiered).** The options are kept below as the record.
- **A. The window replaces approval.** Inside the window, eligible calls run with no per-call
  approval. Most autonomy. But an injected model running as that principal gets free use of the
  tools for the whole window, and the shape breaks the standard wherever it touches Rule-of-Two.
- **B. The window is an extra gate.** Elevated tools are refused outside a window and still need a
  per-call approval inside one. Safest, since an elevated tool is exposed only while a window is
  open. But it adds friction and does nothing for the problem windows exist to solve.
- **C. Tiered (the October recommendation).**
  - *Below the window line:* a tool that needs approval only because it is pinned `elevated` runs
    inside a window without a per-call approval. That means it is not Rule-of-Two obligated and not
    `arbitrary_exec`. Every such call is audited as "ran under window W".
  - *Above the ceiling, never lifted:* every Rule-of-Two approval, and `arbitrary_exec`. These always
    need a per-call human approval, window or not.
- **Architect's recommendation: C.** It is the only shape that solves the problem without breaching
  §0.1.1.

**Call 2 — the duration cap. UNANSWERED.**
- **Proposed:** a window's duration is required when it opens. The operator setting is a maximum,
  default 1 hour, and the core refuses any configured maximum over 8 hours. No window survives a
  restart.
- **Architect's recommendation: as proposed.** Eight hours covers a working shift. A longer need is
  a sign the tool should be `owned_state` or contained, not windowed.

**Call 3 — UNANSWERED. Tools that must never be windowed** (in a port: mint, merge, anything irreversible).
- The reference ships no mint or merge tool (§0.2). But a port inherits this ceiling, so the rule has
  to exist in the core.
- Under C, a trusted-facing `elevated` `state_change` tool would be windowable unless something says
  otherwise. The October options:
  - **(a)** Accept it, and rely on the operator pinning such tools `untrusted_input_facing`, which
    puts them above the ceiling through Rule-of-Two.
  - **(b)** Add a narrowing-only operator setting, "never windowed: these tools". It can only
    tighten, but it is a small list outside the manifest, which brushes against §8 #11.
  - **(c)** Propose an eleventh pinned field upstream.
  - October leaned **(b) now plus (c) proposed**.
- **New option (d), the architect's recommendation: let the rung decide.**
  - A tool is window-eligible only if it is pinned `elevated` **and** its `capability_class` is
    `owned_state`.
  - `owned_state` already requires a pinned, hashed, reviewed one-line `recoverability_basis` (CAP-5).
    So "a window may skip the per-call approval" becomes "this effect is recoverable, and the pinned
    record says how".
  - `state_change` tools (mint, merge, anything whose effect the node cannot undo) are never
    windowed, by pinned data, with no new field and no list outside the manifest.
  - **The cost:** an operator who wants a window over a `state_change` tool must first argue it down
    to `owned_state` with a basis a reviewer accepts, and that argument is the point.
  - (d) sits between B and C. It also leaves (c) unnecessary unless a port shows an irreversible
    `owned_state` tool, which would be a mis-pinned tool rather than a missing field.

## 1. Scope — numbered, specific (written for C, ruled, + call 2 as proposed + (d); revised when calls 2 and 3 are ruled)

1. **The eligibility function, pure, from pinned fields only.**
   - `windowEligible(tag)` is true iff `elevated`, **not** Rule-of-Two obligated (per `obligationOf`:
     no CAP-2 or CAP-3 requirement), **not** `arbitrary_exec`, and, under (d), `owned_state`.
   - It reads nothing outside the canonical field set. Extend `GATE_READ_FIELDS ⊆ canonicalFieldSet()`
     (the `test:subset` invariant) to cover it.
2. **Opening a window: the approval listener only, a human only.**
   - A window binds: one named principal (no wildcard); a list of tool names, each checked against
     `windowEligible` over the **pinned** set (no wildcard, and an ineligible name refuses the whole
     request rather than being dropped silently); a required purpose text, escaped the same way the
     approver's view is (`visible.ts`); a required duration ≤ the operator maximum; and an opener who
     is a human through the confirm-URL path.
   - The opener is never the window's principal. The delegated approver cannot open a window (APR-6
     reasoning: a window is broader than one approval).
   - Nothing on the main listener, no tool call and no signed message opens, extends or widens a
     window (§0.1.2).
3. **Honouring a window.**
   - An eligible call from the window's principal, inside its lifetime, to a listed tool runs without
     a per-call grant.
   - The audit row records `window` with the window's id, its opener, its purpose digest and the
     approval it stood in for.
   - Every other call takes `-2001`'s path unchanged.
4. **Closing.** The operator closes a window early on the approval listener. Expiry is checked per
   call against a monotonic clock. A restart closes every window: windows are in memory only, by
   construction, so none survives a crash.
5. **Settings.** `APPROVAL_WINDOW_MAX_SECONDS`:
   - unset means windows are off, and an open-window request is refused with that reason;
   - the default, when present without a value, is 3600;
   - the core refuses 0, a non-integer, or anything over 28,800 at start;
   - it is documented in `.env.example`.
   - Nothing else is configurable, so there is no list outside the manifest under (d).
6. **The approval-subsystem items carried from `-2001`'s red team** (they live on the same listener):
   1. The webhook notifier refuses link-local, cloud-metadata and private addresses unless the
      operator explicitly allows them (a guarded default for Grok's info item).
   2. One retry with backoff on a failed notification, before the request is left to expire.
   3. Four checks the red team did not run, each becoming a test: swapping `requestState` on a live
      node; the timing of the code comparison; clock manipulation (wall-clock jumps must not extend a
      grant or a window); and memory at the 1,000-pending cap.
7. **Rules.** A `packages/core/src/ceiling/RULES.md` written before the code, one rule per sentence
   of §0.1, each with its red-proof and its control-deletion row. **One row per control in the same
   PR** (`test/deletion/README.md`).
8. **§8 row and teaching.** The architecture's §8 row's red-proofs become tests. The teaching edition
   gains nothing executable here (`-2005` owns the tour), but `RULES.md` is written to be read.
9. **`FEEDBACK.md`** per §6.

## 2. Invariants

- **N1.** Every tool still passes the core's gate; a window never serves a tool the registry did not
  admit.
- **N2.** No unpinned authority: eligibility is derived from pinned fields, and the subset invariant
  is extended to prove it.
- **N5.** Every new control has a row whose stub makes the suite fail by assertion.
- **N6.** The leak gate runs before every push.
- **N7.** No `arbitrary_exec`, no general shell and no general-purpose tool. The ceiling makes
  `arbitrary_exec` unwindowable even in a port.
- **Additive when unwired.** With `APPROVAL_WINDOW_MAX_SECONDS` unset, every existing test passes
  unchanged and approval behaves byte for byte as on `main`.
- **Fail closed.** A malformed window setting refuses start; an unknown window id refuses the call;
  an ineligible tool in an open request refuses the whole request.

**Protected surfaces, which must diff to empty:** the four steering documents; `pinning/**` and the
canonical form (no new pinned field: call 3); `transport/**`; `auth/**`; `provenance/**`;
`containment/**`; existing rows and stubs in `test/deletion/`, which may be added to but not edited.
`approval/**` and `capability/**` change only as §1 names.

## 3. Tests / acceptance — proven, not asserted

1. **A window for one principal does not authorise another.** It is refused, audited, and the
   handler-entry counter reads 0. This is the phase gate's clause.
2. **Above the ceiling, refused under a window:**
   - an untrusted-facing `state_change` tool (Rule-of-Two) inside an open window still answers
     *approval pending*;
   - under (d), a trusted `elevated` `state_change` tool does too;
   - an `arbitrary_exec` fixture is refused at construction as today, and never appears in any
     window's eligible set.
3. **A window cannot be opened** from the main listener, by a tool call, by a signed message, by the
   delegated approver, or by its own principal. Each attempt is refused by name.
4. **Wildcard principal, wildcard tools, an unpinned tool name, a missing purpose, and a duration
   over the maximum** are each refused.
5. **Restart closes windows**, early close works, and expiry holds against a wall-clock jump forward
   and backward.
6. **Unset setting means byte-identical behaviour:** the full `-2001` suite on `main` passes on the
   branch with the setting unset.
7. **§1.6's four checks and two hardenings** each have a test that fails without the change.
8. **Every new row is red by assertion**, `--self-test` passes, and every shard is under five minutes.

## 4. Scope fence — NOT in this work order

- The in-call (MRTR) tier (`-2001a`); caller entitlement (P6).
- An eleventh pinned field or any canonical-form change: if call 3 is ruled (c), this WO builds (b)
  or (d) and the architect carries (c) upstream separately.
- Any window that persists across a restart; any window over more than one principal.
- Any general-purpose tool, mint tool, merge tool, or exec tool, including as a fixture beyond the
  existing construction-refused exec fixture.
- The P2 hardening list (frozen built-ins, C7, H7, SIGINT, versions): its own WO.
- The S25 node's own window mechanism. It is that node's design and out of this repository.

## 5. Adversarial pass

A fresh subagent, then the external red team before merge. Attack:
- **Widening.** Try every way to make a window authorise more than it names: principal aliasing
  (case, Unicode, the token's `sub` versus `azp`); a tool renamed between the opening and the call;
  a manifest reload while a window is open; two windows whose union reaches a tool neither lists.
- **Opening.** Reach the approval listener from the main listener's principal, by any route: a
  proxy header, `127.0.0.1` versus `::1`, a redirect from the notifier.
- **Time.** A wall-clock jump; a window opened at the exact maximum; a call already in flight when
  the window expires.
- **Unpinned authority.** Hunt for any input to `windowEligible` or to the honour path that the
  manifest does not hash.
- **The unwired path.** With the setting unset, look for any byte-level difference from `main`.

Fix the reversible findings; record all of them.

## 5a. Reduction pass

Subsystem-sized (this WO is the last control before P2's exit gate).

## 6. Upward feedback

`FEEDBACK.md`:
- promote-or-needs-none for `-2008b`'s findings first;
- the standard schema per finding;
- a gates line;
- *deliberately not built*.
- Lead with anything in §0.1 the code could not honour exactly as written.

## 7. Flag-and-stop

- Any eligibility input outside the canonical field set. That is unpinned authority: stop.
- Any path that opens, extends or widens a window without a human on the approval listener.
- A Rule-of-Two approval that a window would discharge.
- Any need to change the canonical form, `pinning/**` or `transport/**`.
- Behaviour with the setting unset that differs from `main` in any test.
- A secret or a deployment identifier anywhere in the diff.

## 8. Kickoff prompt

*Written when §0.3 is ruled.* The `/goal` will name, in the architect's words, what would make a
"done" refusable: a window that authorises anyone or anything it does not name, or any route to
opening one that is not a human on the approval listener.
