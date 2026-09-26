# CSR-WO-1002a — Containment corrections from the `-1002` review: a kernel refusal is a recorded refusal, and a `read_only` tool's cage reads only

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD; the
base must contain `-1002`, merged `e95048f`).
**Branch:** `wo/CSR-WO-1002a`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P1 · **Phase exit gate (the clause this WO owns):** none new — it closes the two gaps the
`-1002` review recorded in `docs/architecture.md` §5, *Containment matching*.
**Grounds:** `docs/northstar.md` N4, N5; `docs/architecture.md` §5 *Containment matching* (its v1
limit line), §10 row of 2026-09-26 for `-1002` (R-1); `docs/roadmap.md` `-1002a`; `-1002` FEEDBACK
R-1.

> **What this is:** two small repairs to the in-process cage. First: since R-1, a symlink leaf
> swapped in between the cage's check and the open is refused by the kernel (`O_NOFOLLOW`), but
> that refusal surfaces as a plain `ELOOP` handler error — the call fails safely, yet the audit
> seam never hears that a tool tried to reach outside its domain. An attempted escape must be
> recorded as one. Second: an `fs:` root currently grants every open mode, so a tool classed
> `read_only` can open a file inside its root for writing; the class and the cage must agree. It is
> NOT an OS sandbox, NOT a new scheme, NOT a per-entry mode grammar in the domain (that would be a
> canonical-form change), and NOT a change to any other capability class.

**Cadence:** build, small. One PR, left unmerged for review.

## 1. Scope — numbered, specific

1. **A kernel link refusal is a containment refusal.** In `RecordingCage.open`, when the effect's
   open rejects with `ELOOP` (and `EMLINK`, which the BSDs return for `O_NOFOLLOW` on a link) while
   the flags carry `O_NOFOLLOW`, the cage records the reach as refused — `{ kind: "fs", sink, mode,
   allowed: false }` — which fires `onRefused` and throws `ContainmentRefusal`, exactly as a
   pre-check refusal does. Any other open error passes through unchanged. Through dispatch, the
   call fails with the containment error and one `containment-refused` audit line naming the
   sink (the transport already does both for a recorded refusal; confirm, do not re-implement).
2. **A `read_only` tool's cage admits read modes only.** The registry passes the tool's
   `capability_class`, taken from the same frozen snapshot as the domain, to the cage factory. For
   `read_only`, `open` admits `r` only; every other mode (`r+`, `w`, `w+`, `wx`, `wx+`, `a`, `a+`,
   `ax`, `ax+`) is a refused reach that names the mode, even under a declared root. `connect` and
   `service` are unchanged — a network or service reach is not a write by itself, and the class
   does not say otherwise. Other classes keep today's behaviour.
3. **The seam editions implement.** The `cageFor` option's signature gains the class (or a small
   frozen policy object carrying it — choose one, record which, and why). An edition's OS-level
   cage receives the same information and must honour it; the reach harness gains a case that
   fails an edition cage which lets a `read_only` tool write.
4. **`FEEDBACK.md`** per §6.

## 2. Invariants

- **N4** — an attempted escape is refused *and* recorded; a `read_only` tool cannot write through
  its cage. Neither is logged-and-allowed.
- **N5** — each repair has a red-proof: remove the `ELOOP` mapping → the swap test sees a plain
  handler error and no audit line; remove the class check → the `read_only` write test succeeds.

**Protected surfaces — must diff to empty:** the four steering documents, `LICENSE`, `NOTICE`,
`scripts/**`, `.github/**`, `spikes/**`, `docs/canonical-form.md`, `pinning/canonical.ts`,
`pinning/gate.ts`, `pinning/manifest.ts`, `capability/**`, `containment/domain.ts`, everything
under `packages/core/src/auth/**` and `packages/core/src/transport/**`. `pinning/registry.ts` may
change only where it hands the class to the cage factory. `containment/cage.ts` and
`containment/harness.ts` are the working surface. `packages/core/test` may grow; an existing
assertion changes only where the new signature requires it.

## 3. Tests / acceptance

1. `npm run check` green on both runners; both leak-gate modes exit 0.
2. Swap-then-open through dispatch in `w`: the outside victim byte-identical, the response the
   containment error, exactly one `containment-refused` audit line with the sink — pasted.
3. A `read_only` fixture tool with an `fs:` root: `r` inside the root allowed; each write mode
   inside the root refused with the mode named — the table pasted.
4. A `state_change` fixture tool with the same root still writes inside it (no regression).
5. Both red-proofs pasted.

## 4. Scope fence

- **A per-entry mode in the domain grammar** (e.g. `fs:/data:ro`). That changes what is hashed; it
  is a canonical-form proposal, not this WO.
- **Intermediate-directory swaps.** Stated as the edition OS cage's job in *Containment matching*;
  do not attempt `openat2` emulation.
- **Any change to the auth code or the transport.** `-1003` is in review against the same `main`.
- **Network or service restrictions by class.**

## 5. Adversarial pass

Fresh subagent. The lesson of R-1 applies: every bypass attempt uses the operation that matters —
a write for the write check, a mutating open for the swap — never a harmless stand-in.

1. A `read_only` tool that opens `r` and then tries to write through the returned handle: record
   what happens and state the rule (the cage governs the open; a read-only descriptor refuses
   writes at the OS).
2. A `read_only` tool passing a numeric flags value or a mode string with odd case or whitespace
   (`"W"`, `" w"`, `"rw"`): refused, never widened.
3. The swap race with `a` and `wx`: victim unchanged, refusal recorded.
4. A handler that catches the `ContainmentRefusal` from item 1 and returns success: the call still
   fails (N4), and the audit line is still written.

## 6. Upward-feedback directive

`FEEDBACK.md`: gates line, the pastes in §3, the seam choice in §1.3 with its reason, the
adversarial findings with severity, what was not built.

## 7. Flag-and-stop conditions

- Recording the kernel refusal requires changing the transport or dispatch.
- The class cannot reach the cage without touching a protected surface.
- A protected surface must change for any other reason.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-1002a` off current `main` where a symlink leaf the kernel refuses under
> `O_NOFOLLOW` is recorded and audited as a containment refusal instead of surfacing as a plain
> handler error, a `read_only` tool's cage admits read modes only while other classes are
> unchanged, the edition cage seam carries the class and the reach harness fails a cage that lets
> a `read_only` tool write, red-proofs exist for both repairs, `npm run check` is green on both
> runners, and the work is parked as one unmerged pull request. Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-1002a origin/main`. Node 24.21.0. Cadence:
> **build**, small. Read `docs/work-orders/CSR-WO-1002a.md` in full and `docs/architecture.md` §5
> *Containment matching*. Two repairs with red-proofs, one seam change, nothing else; protected
> surfaces per WO §2 — `auth/**` and `transport/**` included, because `-1003` is in review. If the
> Adversary review of `-1003` returns findings while this is in progress, park this PR first, then
> take the `-1003` fix-up. Leak gate before every push, exit code checked directly. Adversarial
> pass per §5 to a fresh subagent. Report the PR link and the pastes.
