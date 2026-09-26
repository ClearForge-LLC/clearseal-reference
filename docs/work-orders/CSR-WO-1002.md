# CSR-WO-1002 — Containment: `containment_domain` as a sink set, exec refused a domain, and the reach harness

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD; the
base must contain `-1001`'s registry — this WO's construction-time checks run inside it).
**Branch:** `wo/CSR-WO-1002`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P1 · **Phase exit gate (the clauses this WO owns):** an `arbitrary_exec` definition
given a domain is refused at construction; a tool touching a sink outside its declared domain
turns the reach harness red with the sink named.
**Grounds:** `docs/northstar.md` N1, N4, N5, N7; `docs/architecture.md` §3.1 (the containment box:
"a sink SET or null; exec is refused a domain at construction; reach harness watches every declared
sink"), §4 row *Tool ↔ host* ("blast-radius boundary: `containment_domain` and the reach harness
bound it; the approval gate stands in front of what cannot be bounded"), §5 rows *Exec posture*,
*Where OS primitives live* (the `Cage` interface belongs to the core; editions implement it); §7.1
row *A prompt-injected model*; §8 rows *`containment_domain` as a sink set* and *Reach harness*;
`docs/canonical-form.md` A7; `docs/roadmap.md` P1. Code seams: `pinning/registry` (`-1001`),
`capability/fields`, the transport's `tools/call` dispatch.

> **What this is:** the control that bounds what a tool can *reach*, and the test that proves the
> bound is real. A tool's `containment_domain` is a pinned, hashed set of the sinks it may touch —
> file-system roots, network hosts, named services — or `null`, which means "this tool touches
> nothing outside the process." At registration the core turns that set into a `Cage` and every
> handler runs inside one; a handler that reaches for anything else is refused and the reach is
> recorded. The reach harness is the test side: it runs every registered tool's handler under a
> recording cage and fails when a tool touches a sink it did not declare. And the N7 line: a
> definition whose class is `arbitrary_exec` is refused a domain at construction — the reference
> ships no exec tool (N7) and the core will not pretend a shell can be caged by a list. It is NOT an
> OS sandbox (editions bring those behind the `Cage` interface — P3), NOT the approval gate, and
> NOT the capability ceiling.

**Cadence:** build. One PR, left unmerged for review.

## 1. Scope — numbered, specific

1. **The domain model** (`packages/core/src/containment/domain.ts`): a `containment_domain` entry is
   a string with a scheme — `fs:<absolute path>` (a root; everything under it), `host:<name>[:port]`
   (a network peer), `svc:<name>` (a named service the edition binds at deploy) — parsed and
   validated at registration; an unknown scheme, a relative or non-normalized path, a host with a
   scheme or path, or a `svc` name outside the tool-name pattern is a construction refusal naming
   the entry. `null` is the empty domain. The pinned string is the canonical one (A7 sorts and
   deduplicates it; this WO does not re-normalize — a non-canonical entry is refused, not fixed,
   because fixing it would make the served set differ from the hashed set).
2. **`Cage` interface** (`packages/core/src/containment/cage.ts`): `open(path, mode)`,
   `connect(host, port)`, `service(name)` — the only three ways a handler reaches outside the
   process — plus `reached(): readonly Reach[]`. The core ships **one** implementation,
   `RecordingCage`: it enforces the declared domain in-process (refuses an undeclared reach with a
   `ContainmentRefusal` naming the sink) and records every reach, allowed or refused. It is not an
   OS boundary and its docstring says so; editions implement `Cage` with OS primitives (P3/P4) and
   must pass the same harness.
3. **Handler contract.** A tool handler receives `(arguments, ctx)` where `ctx.cage` is the only
   sanctioned route to files, network and services — the fixture tools and the first shipped tool
   (`-1004`) use it. This WO does not and cannot stop a handler from calling `fs` directly; the
   reach harness (§1.5) is what catches that, and the edition's OS cage is what stops it.
4. **N7 at construction.** The registry refuses, at construction, a definition whose
   `capability_class` is `arbitrary_exec` and whose `containment_domain` is non-null — a shell
   cannot be caged by a list, and the reference ships no exec tool at all; it also refuses any
   `arbitrary_exec` definition outright under a flag that is on by default (`EXEC_TOOLS_FORBIDDEN`,
   by name in `.env.example`; an edition that turns it off must document why in its own tree).
5. **The reach harness** (`packages/core/test/containment/reach.test.ts` plus a reusable runner in
   `packages/core/src/containment/harness.ts` so editions can run it): for every registered tool,
   run its handler under a `RecordingCage` **and** under an OS-level observer where the runner has
   one (Linux: `strace`-free — a `fs`/`net` module shim installed for the test process that logs
   every open and connect; on the Windows runner the shim only) with a corpus of arguments (the
   tool's own fixture inputs), then assert every observed reach is inside the declared domain.
   An undeclared reach fails the test naming the tool and the sink. Tools with `null` domains
   must observe zero reaches.
6. **Dispatch wiring.** `tools/call` constructs the cage from the tool's pinned domain per call and
   passes it in `ctx`; a `ContainmentRefusal` thrown by a handler is a JSON-RPC error (`-32603`
   family, message names the sink class but never the path — the audit seam gets the full reach).
7. **Fixture tools** under `packages/core/test/fixtures/`: one `fs:` tool, one `host:` tool, one
   `null` tool, and one misbehaving tool (declares `null`, reaches for a file) that the harness must
   catch — kept out of the fixture manifest so it never registers except in the harness's own test.
8. **`FEEDBACK.md`** per §6.

## 2. Invariants — restated by number from the northstar

- **N7** — no `arbitrary_exec` tool in any edition; the core refuses it a domain and, by default,
  refuses it at all.
- **N4** — an undeclared reach is refused, never logged-and-allowed.
- **N5** — each construction refusal and the harness have red-proofs (the misbehaving fixture is
  the harness's red-proof).
- **N1** — the domain model, the cage interface and the harness are core; editions implement,
  never redefine.
- **N6** — fixture paths are synthetic (`/tmp`-style, never a real host path); hosts are
  `example.invalid`-style.

**Protected surfaces — must diff to empty:** the four steering documents, `LICENSE`, `NOTICE`,
`scripts/**`, `.github/**`, `spikes/**`, `docs/canonical-form.md`, `pinning/canonical.ts`,
`capability/fields.ts`, `pinning/gate.ts`, `pinning/manifest.ts`, the oracle and vectors. The
registry and dispatch may change only where they construct and pass the cage.

## 3. Tests / acceptance — what must be proven, not asserted

1. `npm run check` green on both runners.
2. Construction refusals pasted: unknown scheme; relative path; host with a path; non-canonical
   (unsorted or duplicated) domain; `arbitrary_exec` with a domain; `arbitrary_exec` at all under
   the default flag.
3. The harness output for the four fixtures: three pass with their reaches listed; the misbehaving
   one fails naming the tool and the sink.
4. A `null`-domain tool that reaches → refused in dispatch with the JSON-RPC error pasted and the
   full reach visible at the audit seam (log line pasted, path present there, absent from the
   response).
5. Red-proofs: remove the domain check in `RecordingCage` → harness passes the misbehaving fixture
   (red); remove the N7 check → an exec definition registers (red).
6. The Windows runner runs the harness with the shim only and reports the same verdicts.

## 4. Scope fence — what is NOT in this work order

- **An OS sandbox** (service-manager sandboxing, namespaces, job objects). Editions, P3/P4, behind
  `Cage`.
- **Approval, ceiling, audit.** Seams only; the audit row here is a log line.
- **Any shipped tool.** `-1004`.
- **Re-normalizing a domain.** Refused, not fixed (A7 is the canonical form's job).

## 5. Adversarial pass — try to break it before calling it done

Fresh subagent. Findings with severity into FEEDBACK.

1. A handler that reaches via a symlink inside its `fs:` root pointing outside it: confirm the
   cage resolves before checking (`realpath`) and refuses.
2. `fs:/data` declared; handler opens `/data/../etc/passwd`-shaped input: refused.
3. `host:example.invalid` declared; handler connects to an IP literal that resolves the same:
   record the verdict — the cage matches on the declared string, so this is refused; state that
   as the rule (names, not addresses) and whether an edition may widen it.
4. A handler that spawns a child process: the cage has no `spawn`; confirm the shim logs it as an
   undeclared reach.
5. A tool with a 10,000-entry domain: registration time and harness time measured.
6. Two tools, one `null` and one `fs:`, called concurrently: confirm cages do not leak across calls.

## 6. Upward-feedback directive

`FEEDBACK.md`: the construction-refusal table, the harness transcript, the dispatch refusal with
its audit line, the red-proofs, the adversarial verdicts (item 3's rule stated), then the standard
entries. Under *decision-needed*: any domain scheme the fleet's 26-tool reference node uses that
the three schemes here cannot express.

## 7. Flag-and-stop conditions

- The registry from `-1001` has no construction hook that can refuse a definition — record the
  shape needed and stop.
- The Windows runner cannot install the shim — run the recording-cage half, record, continue.
- A protected surface must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-1002` off current `main` where `containment_domain` entries are parsed under three schemes and refused when malformed or non-canonical, a `Cage` interface with a `RecordingCage` enforces and records every reach, an `arbitrary_exec` definition is refused a domain and refused outright under the default flag, `tools/call` runs every handler inside a per-call cage and refuses an undeclared reach, a reusable reach harness fails on the misbehaving fixture naming the tool and sink, red-proofs for each refusal exist, `npm run check` is green on both runners, and the work is parked as one unmerged pull request. Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-1002 origin/main`. Node 24.21.0. Cadence: **build**. Read `docs/work-orders/CSR-WO-1002.md` in full, `docs/architecture.md` §3.1 (containment), §4 (*Tool ↔ host*), §5 (*Exec posture*, *Where OS primitives live*), and `docs/canonical-form.md` A7. Ratified with reasons: three schemes; a non-canonical domain is refused, never fixed; `RecordingCage` is in-process and says so; N7 at construction with the forbid flag on by default; the harness is reusable by editions; sink paths reach the audit seam, never the response. Protected surfaces per WO §2. Leak gate before every push, exit code checked directly. Adversarial pass per §5 to a fresh subagent. Report the PR link, the refusal table, and the harness transcript.
