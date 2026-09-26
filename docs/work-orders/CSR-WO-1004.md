# CSR-WO-1004 — The teaching edition's skeleton, its first tool, its manifest, and the supply-boundary test

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD; the
base must contain `-1001`, `-1002`, `-1002a` and `-1003`).
**Branch:** `wo/CSR-WO-1004`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P1 · **Phase exit gate (the clauses this WO owns):** the supply-boundary test exists and
goes red on a planted edition-side control; a hand-edited description leaves that tool absent from
`tools/list` on restart; and the P1 gate's `curl` clauses (unauthenticated `401` with
`resource_metadata`, wrong-audience `401`) run against a real edition rather than a test fixture.
**Grounds:** `docs/northstar.md` N1, N2, N4, N7; `docs/architecture.md` §3.1 (layout: "editions are
thin"), §3.3 *Teaching*, §4 row *Core ↔ edition* (the supply boundary), §5 rows *Where OS
primitives live* (the enumeration the boundary test enforces), *One repository or three*,
*Containment matching*; `docs/roadmap.md` P1 and its exit gate.

> **What this is:** the first edition. An edition is a tool set, a manifest, a configuration
> schema and a deploy scaffold — nothing else — and it reaches the network only through the core's
> gate. This WO builds the teaching edition's skeleton with one tool, `notes.read` (`read_only`,
> contained to the notes store), pins it, starts it as a real node, and writes the test that keeps
> every future edition thin: an edition that exports a control of its own goes red. It also
> gathers the P1 exit gate's clauses into one evidence test run against this edition, so the phase
> exit is a command, not a claim. It is NOT the other three teaching tools (P2), NOT the approval
> path, NOT a host edition, and NOT a deploy to any real machine.

**Cadence:** build. One PR, left unmerged for review.

## 1. Scope — numbered, specific

1. **The package.** `packages/teaching/`, a workspace depending on `@clearseal/core` through its
   package exports only — no deep import into `packages/core/src`. Its public entry exports, and
   may only export: the tool definitions, the path to its manifest, its configuration schema, and
   its deploy scaffold (for this WO: a `start()` that reads configuration and calls the core's
   `loadPinnedRegistry` and `startTransport`). Annotated for a reader: every module names the
   ClearSeal clause it serves, as §3.3 promises.
2. **`notes.read`.** `read_only`, `untrusted_input_facing: true` (a note's text is untrusted
   content handed to a model), containment domain the notes root, reading through `ctx.cage`
   only. Input: a note name matching a narrow pattern; the handler never builds a path from
   anything but that name under the root. Output capped by the core's result cap.
3. **Where the notes root lives — ruled prior.** The domain is pinned and hashed, so the root's
   path is part of the tool's approved contract: moving the store is a re-approval, which is what
   pinning reach means. The edition declares a default root; an operator who changes it re-pins.
   Tests build their own manifest over a temporary root (`pinForTest` pattern). **Measure, then
   decide or stop:** the `fs:` grammar accepts POSIX absolute paths only (`domain.ts`), so on the
   Windows runner a drive path cannot be declared. Record what the file-reading tests do on
   `windows-latest` (skip with a stated reason, or run against a POSIX-style path the cage
   normalizes) — and if neither keeps the test honest, flag and stop. Do not widen the grammar.
4. **The manifest.** `pins/teaching.json`, produced by the core's `pin` path, committed. A test
   asserts the committed manifest matches the edition's definitions, so drift fails CI rather than
   the first start.
5. **The supply-boundary test** (`packages/core/test/boundary/` or a root `test/` — choose and
   record): for every package under `packages/` other than `core`, it loads the public entry and
   asserts every export is one of the enumerated kinds (§5 *Where OS primitives live*): a tool
   definition, a manifest path, a configuration schema, a deploy scaffold, or a registered
   implementation of `Cage`, `ApprovalNotifier` or `AuditStore`. It also asserts statically that
   no edition source imports a core path outside the package exports, and that no edition
   constructs a `Verifier`, a `PinGate` or a registry of its own. **Red-proof:** a fixture edition
   planted in the test with (a) an exported verifier, (b) a deep import into `core/src`, and (c) a
   function that serves a tool without the gate — each turns the test red, naming the file and
   the rule. The enumeration is data in one place, so the next edition extends it by argument,
   not by editing the check.
6. **P1 exit-gate evidence** (`packages/teaching/test/p1-exit.test.ts`): against a real teaching
   node on an ephemeral port with the in-process issuer — unauthenticated `401` with
   `resource_metadata`; a wrong-audience token `401`; a valid token lists `notes.read` and reads a
   note; a description hand-edited in the definitions after pinning leaves `notes.read` absent
   from `tools/list` on restart under `PIN_STRICT=false` and stops the node under the default; a
   forged `Origin` and an extra request property each refused before any handler runs. Each
   clause names the exit-gate sentence it proves.
7. **`FEEDBACK.md`** per §6.

## 2. Invariants

- **N1** — an edition carries no control; the boundary test is the enforcement.
- **N2** — `notes.read` reaches the network only through the gate; the evidence test proves the
  drift case.
- **N4** — every refusal in §1.6 refuses before a handler runs.
- **N7** — the edition ships no exec tool (the boundary test's allowlist has no place for one).

**Protected surfaces — must diff to empty:** the four steering documents, `LICENSE`, `NOTICE`,
`scripts/**`, `.github/**`, `spikes/**`, `docs/canonical-form.md`, everything under
`packages/core/src/**`. If the edition needs a core export that does not exist, flag and stop —
the core does not grow to fit an edition inside an edition's WO. `packages/core/test` may grow
(for the boundary test only). Root `package.json` may change only to add the workspace.

## 3. Tests / acceptance

1. `npm run check` green on both runners; both leak-gate modes exit 0.
2. The boundary test's three red-proofs pasted, each naming its rule.
3. The P1 evidence test's output pasted, one line per exit-gate clause.
4. `curl -i` transcripts against a started teaching node: unauthenticated, wrong audience, a
   valid read — pasted.
5. The Windows measurement from §1.3 and what was decided.
6. The committed manifest and the drift test's red-proof (edit a description, CI red).

## 4. Scope fence

- **The other three teaching tools, the approval path, the audit store.** P2.
- **Any change to the core, including a new export.** Flag and stop instead.
- **Widening the `fs:` grammar to drive paths.** Recorded for P4 and the upstream ledger.
- **A host edition, a service unit, or a deploy to any machine.**

## 5. Adversarial pass

Fresh subagent; every attempt uses the operation that matters.

1. Read outside the notes root through `notes.read`: `..`, an absolute name, a symlink planted in
   the root, a name with a NUL or a backslash, a very long name.
2. Defeat the boundary test: re-export a core control under an innocent name, export a class
   whose prototype carries a verifier method, import core through a relative path that resolves
   into `src`, a dynamic `import()` with a computed specifier.
3. Serve a tool the gate did not admit: construct the transport with a hand-built registry from
   inside the edition.
4. Make the committed manifest and the definitions disagree without the drift test noticing.

## 6. Upward-feedback directive

`FEEDBACK.md`: gates line, the pastes in §3, the choices in §1.3 and §1.5 with reasons, adversarial
findings with severity, what was not built.

## 7. Flag-and-stop conditions

- The edition needs a core export that does not exist.
- The Windows measurement in §1.3 leaves no honest way to run the file tests there.
- The boundary test cannot distinguish a registered interface implementation from a control
  without a judgement call.
- A protected surface must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-1004` off current `main` where `packages/teaching` is a thin edition
> exporting only tool definitions, its manifest path, a configuration schema and a start scaffold,
> `notes.read` is a contained `read_only` tool pinned in a committed `pins/teaching.json` with a
> drift test, a supply-boundary test fails on a planted edition-side verifier, deep core import and
> ungated tool, a P1 exit-gate evidence test runs every P1 gate clause against a real teaching node,
> the Windows behaviour of the file tests is measured and recorded, `npm run check` is green on
> both runners, and the work is parked as one unmerged pull request. Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-1004 origin/main`. Node 24.21.0. Cadence:
> **build**. Read `docs/work-orders/CSR-WO-1004.md` in full and `docs/architecture.md` §3.1, §3.3,
> §4 (*Core ↔ edition*) and §5 (*Where OS primitives live*, *Containment matching*). Ratified with
> reasons: editions are thin and reach the network only through the gate; the notes root is part of
> the pinned contract; the boundary check reads its allowed kinds from one list; no core change
> inside this WO. Protected surfaces per WO §2. Leak gate before every push, exit code checked
> directly. Adversarial pass per §5 to a fresh subagent. Report the PR link and the pastes.
