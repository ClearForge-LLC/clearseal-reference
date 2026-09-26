# CSR-WO-1006 — Core corrections from the `-1004` adversarial pass: frozen admitted tools, regular files only, and a Windows cage that resolves links

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD; the
base must contain `-1004`, merged `bfeb418`).
**Branch:** `wo/CSR-WO-1006`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P1 · **Phase exit gate:** P1 does not exit until this merges — each item touches an
invariant the phase exists to prove (N2 served-as-hashed; N4 containment).
**Grounds:** `docs/northstar.md` N2, N4; `docs/architecture.md` §5 *Containment matching*,
*Unhashed tool fields*, §10 row for `-1004`; `-1004` FEEDBACK (adversarial A6, A10, the §1.3 Windows
measurement).

> **What this is:** three core repairs the `-1004` builder found and correctly did not make,
> because the core was protected in an edition's WO. **A6:** `PinnedRegistry.list()` hands out the
> registry's own tool objects, and neither they nor their definitions are frozen, so any code
> holding the registry — an edition's start scaffold, the transport — can rewrite the description
> the node serves after it was hashed. Handlers never receive the registry, so this is a supply-
> boundary hole, not a model-reachable one; it still breaks "served exactly as hashed." **A10:** a
> FIFO (or a device) inside a declared root blocks the open, pinning a worker and a concurrency
> slot past the handler timeout; enough of them leave the node answering `503` until restart.
> **Windows:** on `windows-latest` a symlink planted inside the notes root let `notes.read` return
> a file outside it, because the in-process cage resolves no links on Windows. It is NOT the
> check-then-open race on Windows (that stays the edition OS cage's job, as stated), NOT an OS
> sandbox, and NOT a change to the domain grammar.

**Cadence:** build, small. One PR, left unmerged for review.

## 1. Scope — numbered, specific

1. **Admitted tools are immutable.** Every `RegisteredTool` the pinned registry holds — the object,
   its `definition`, the definition's `inputSchema` (already a frozen snapshot; confirm), its
   `paramHeaders` — is deeply frozen at construction; `list()` and `get()` return those frozen
   objects (or frozen copies — choose, record why). A test tries to rewrite a served description,
   schema property, handler reference and header through every value `list()`/`get()` return, and
   asserts `tools/list` still serves the hashed values byte for byte.
2. **Regular files only.** `RecordingCage.open` opens with `O_NONBLOCK` on POSIX (so a FIFO cannot
   block the open), `fstat`s the descriptor, and refuses — recorded and audited as a containment
   refusal naming the file type — anything that is not a regular file, closing it first. For a
   write mode on a FIFO with no reader (`ENXIO`), the same refusal. A test plants a FIFO and a
   device path under a root and shows each refused in well under the handler timeout, with the
   concurrency slot released.
3. **The Windows cage resolves links.** On `win32`, `resolveReal` resolves with `realpathSync.native`
   (which follows symlinks and junctions) instead of returning the path unchanged, and the lstat
   leaf check applies there too. **Measure first, on `windows-latest` in CI:** that a symlink and a
   junction planted inside a root are refused, and that roots and targets compare correctly with
   drive letters and case. Record exactly what is and is not closed; the check-then-open race on
   Windows remains the OS cage's job and the docstring keeps saying so. The `-1004` test that
   currently asserts the outside read as a known limit flips to asserting the refusal.
4. **`FEEDBACK.md`** per §6.

## 2. Invariants

- **N2** — what `tools/list` serves is what was hashed, and nothing inside the process can change
  it after admission.
- **N4** — a planted FIFO, device or link is refused, not waited on and not followed.
- **N5** — each item has a red-proof.

**Protected surfaces — must diff to empty:** the four steering documents, `LICENSE`, `NOTICE`,
`scripts/**`, `.github/**`, `spikes/**`, `docs/canonical-form.md`, `pinning/canonical.ts`,
`pinning/gate.ts`, `pinning/manifest.ts`, `capability/**`, `containment/domain.ts`, `auth/**`,
`transport/**` except where `prepareTool` builds the object item 1 freezes, and
`packages/teaching/src/**`. `pinning/registry.ts` and `containment/cage.ts` are the working
surface. Tests may grow; the one `-1004` known-limit assertion flips.

## 3. Tests / acceptance

1. `npm run check` green on both runners; both leak-gate modes exit 0.
2. The mutation attempts in §1.1 and the unchanged `tools/list` bytes — pasted.
3. FIFO and device refusals with their timings and the slot count after — pasted.
4. The `windows-latest` measurement for §1.3 — symlink, junction, drive-letter case — pasted from
   CI.
5. Every red-proof pasted.

## 4. Scope fence

- **The Windows check-then-open race.** The edition OS cage's job (P4).
- **Hard links.** Stated in the cage docstring as not detectable here; unchanged.
- **Any change to the gate, the canonical form, auth, or the teaching edition's source.**

## 5. Adversarial pass

Fresh subagent; every attempt uses the operation that matters.

1. Change what `tools/list` serves after start by any route: the values `list()`/`get()` return,
   `Object.defineProperty`, a prototype, a `Proxy` passed in before admission, a schema object
   shared with the caller's definition.
2. Make the cage wait: a FIFO opened for read and for write, a named socket, `/dev/tty`, a file
   that becomes a FIFO between the lstat and the open.
3. On Windows (in CI): a junction to outside the root, a symlink to a UNC path, `\\?\` prefixes,
   8.3 short names, case variants of the root.

## 6. Upward-feedback directive

`FEEDBACK.md`: gates line, the pastes in §3, the choices in §1.1 and §1.3 with reasons, adversarial
findings with severity, what was not built.

## 7. Flag-and-stop conditions

- Freezing admitted tools breaks a transport path that must write to them.
- `realpathSync.native` on `windows-latest` does not follow junctions, or changes case or drive
  letters in a way the root comparison cannot handle honestly.
- A protected surface must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-1006` off current `main` where every admitted tool the pinned registry holds
> and serves is deeply frozen so nothing in the process can change what `tools/list` serves after
> admission, the cage opens without blocking and refuses any non-regular file as a recorded
> containment refusal, the Windows cage resolves symlinks and junctions and refuses a planted link
> with the result measured on `windows-latest`, red-proofs exist for every item, `npm run check` is
> green on both runners, and the work is parked as one unmerged pull request. Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-1006 origin/main`. Node 24.21.0. Cadence:
> **build**, small. Read `docs/work-orders/CSR-WO-1006.md` in full and your own `-1004` FEEDBACK
> (A6, A10, the §1.3 measurement). Three core repairs with red-proofs; protected surfaces per WO
> §2. P1 exits only after this merges. Leak gate before every push, exit code checked directly.
> Adversarial pass per §5 to a fresh subagent. Report the PR link and the pastes.
