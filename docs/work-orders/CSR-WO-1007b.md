# CSR-WO-1007b — The core owns the process entry: every operator setting is read before any edition code loads

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (must contain `-2002`, PR #59).
**Branch:** `wo/CSR-WO-1007b`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P1 · **Phase exit gate:** P1 exits after this merges and the H1 re-test comes back clean.
**Grounds:** `docs/northstar.md` N2; `docs/architecture.md` §4 (*Core ↔ edition*); the third pass of
the H1 re-test against `31a2bf3` (H-1, High), recorded in §10 with this WO's docs.

> **What this is:** the rest of the correction `-1007a` began, and the architect's third miss on the
> same trust root. `-1007a` made the operator name the manifest, but `startNode` still reads
> `process.env` when it is *called* — after the edition's `bin/` has imported the edition's entry, whose
> module-load code runs first. The re-test set `process.env.CLEARSEAL_MANIFEST` from a file the checker
> never reads (under `test/`, under `node_modules/`, an extensionless entry, an extensionless import)
> and a real node loaded the edition's own manifest and served `notes.exfil` under the strict default.
> After `-1007a` the architect deferred "the core captures configuration before edition code loads" to
> P2 hardening while the re-test brief put exactly that route in scope; the brief was right and the
> deferral was wrong. **The fix is ordering, not reading:** the core owns the process entry, reads every
> operator setting and the manifest's bytes into a frozen snapshot, and only then loads the edition.
> Nothing the edition runs at load can change a setting already read. The checker's gaps are closed
> too, as defense in depth. It is NOT an in-process sandbox: edition code that patches the process's
> own built-ins at load (hashing, JSON, prototypes) is hostile code already inside the node — out of
> scope by §4 and named in the P2 hardening WO.

**Cadence:** build, small. One PR, left unmerged for review.

## 1. Scope — numbered, specific

1. **The core's node entry.** A core executable (`clearseal-node`, in `packages/core`) is the only way
   a node starts. In this order, before any edition module is imported: it reads **every** setting the
   node uses — `CLEARSEAL_MANIFEST`, `PIN_STRICT`, `AUTH_*`, `AUDIT_*`, the request-state key, the
   transport configuration, and the edition's name `CLEARSEAL_EDITION` (a package name, resolved from
   the operator's install, never a path the edition supplies) — into one frozen snapshot; reads the
   manifest file once, hashes it and parses it; opens the audit store. Only then does it
   `import()` the edition's package entry, check its exports (definitions and configSchema, nothing
   else), read the edition's own settings from the snapshot's copy of the environment, and admit.
2. **`startNode` reads no environment.** It takes the snapshot and the edition's two values. After the
   snapshot is taken, no core code reads `process.env`; a test mutates `process.env` after capture and
   shows every setting unchanged, and a static test over `packages/core/src` names every `process.env`
   read and requires each to be inside the capture step.
3. **Editions lose `bin/`.** The teaching edition's `bin/` goes; its README, `.env.example` and the
   P1 evidence start nodes through `clearseal-node` with `CLEARSEAL_EDITION=@clearseal/teaching`. The
   supply-boundary rule tightens with it: an edition imports types from the core and nothing else.
4. **H-1 reproduced and refused end to end.** P1 evidence gains a clause running each of the re-test's
   four variants as a real edition started by `clearseal-node` against the committed
   `pins/teaching.json`: the log names the operator's manifest and its hash, and `notes.exfil` is absent
   from `tools/list` and refused on `tools/call`, under the strict default and under `PIN_STRICT=false`.
5. **The checker's gaps, as defense in depth.** It reads every file an import from the edition's
   shipped code can reach: an import into `test/` or `node_modules/` from shipped code is a finding; an
   extensionless file anywhere in the tree is read as a module or is a finding (choose; record why); a
   package entry or `exports` target the checker did not read is a finding.
6. **The re-test's two Lows.** `manifest-loaded` is written only after the parse succeeds; a manifest
   that is read but refused writes `manifest-refused` with its path and hash. A rename during the open
   is refused with a message that says the file changed, not that it is a link.
7. **Control-deletion rows** for §1.1, §1.2, §1.5 and §1.6, and **`FEEDBACK.md`** per §6.

## 2. Invariants

- **N2**: the node serves only tools whose definitions hash to the manifest the operator configured,
  and every setting that decides it is read before any edition code runs.
- **N5**: every item has a red-proof and a `-2008` row.

**Protected surfaces (must diff to empty):** the four steering documents, `LICENSE`, `NOTICE`,
`spikes/**`, `docs/canonical-form.md`, `pinning/**`, `capability/**`, `containment/**`, `auth/**` except
moving an environment read into the capture step, `audit/**` except the same, and `transport/**`
except the same. Working surface: `node/**`, the new core entry and its `package.json` `bin`,
`index.ts` export lines, `packages/teaching/**`, `packages/core/test/boundary/**`, the P1 evidence test,
`.env.example`, `test/deletion/**`.

## 3. Tests / acceptance

1. `npm run check` green on both runners; both leak-gate modes exit 0; `control-deletion` green.
2. The four H-1 variants, end to end, refused, with the `manifest-loaded` line: pasted.
3. The environment-mutation test and the `process.env` inventory: pasted.
4. Red-proofs for each item: pasted.

## 4. Scope fence

- **In-process sandboxing** and **freezing built-ins** against edition load-time code (§4; the P2
  hardening WO).
- **Manifest signing** (`-2004`).
- **Any change to what the gate, registry, transport, auth or audit decide.** This WO moves reads;
  it changes no decision.

## 5. Adversarial pass

Fresh subagent; every attempt uses the operation that matters: serving a tool not in the manifest the
operator configured, from an edition started by `clearseal-node`.

1. Replay H-1's four variants and every other way to run edition code before the snapshot: a
   `postinstall`, a `package.json` `imports` map, a conditional export, a symlinked or `file:` edition
   dependency, `NODE_OPTIONS` or `--import` set by anything the edition ships.
2. Make the core read any setting after the edition loads, or resolve `CLEARSEAL_EDITION` to a path
   the edition chooses.
3. Every checker variant: an import that reaches a file it did not read.

## 6. Upward-feedback directive

`FEEDBACK.md`: gates line, the pastes in §3, the choice in §1.5 with its reason, adversarial findings
with severity, what was not built.

## 7. Flag-and-stop conditions

- A setting can only be read after the edition loads (name it).
- Moving a read changes a decision in a protected module.
- A protected surface must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-1007b` off current `main` where a core `clearseal-node` entry reads every
> operator setting and the manifest into a frozen snapshot before importing the edition named by
> CLEARSEAL_EDITION, startNode and the rest of the core read no environment after that snapshot,
> editions have no bin, the re-test's four H-1 variants are reproduced end to end and refused, the
> checker reads every file an import can reach, manifest-loaded is written only after a successful
> parse, red-proofs and control-deletion rows exist for every item, `npm run check` is green on both
> runners, and the work is parked as one unmerged pull request. Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-1007b origin/main`. Node 24.21.0. Cadence:
> **build**, small. Read `docs/work-orders/CSR-WO-1007b.md` in full. The design defect is the
> architect's (`startNode` read the environment after edition code had run). The re-test's repro is
> described in §1.4; build the four variants yourself. Leak gate before every push, exit code checked
> directly. Adversarial pass per §5 to a fresh subagent. Report the PR link and the pastes.
