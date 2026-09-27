# CSR-WO-1007a — The operator names the manifest: the approved manifest comes from configuration, never from the edition being approved

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (must contain `-1007`, merged `cc9cd0b`).
**Branch:** `wo/CSR-WO-1007a`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P1 · **Phase exit gate:** P1 exits after this merges and the H1 re-test comes back clean.
**Grounds:** `docs/northstar.md` N2; `docs/architecture.md` §4 (*Core ↔ edition*, *Pin verifier ↔
tool registry* — "the load-bearing trust boundary"); the H1 re-test report against `cc9cd0b` (F1, F2),
recorded in §10 with this WO's docs.

> **What this is:** the correction of the architect's own `-1007` design. `-1007` moved assembly into
> the core but still let the edition export `manifestPath` — so the edition named the manifest that
> approves it. The re-test used exactly that lever twice: F1, a `bin/` file importing definitions and a
> self-written manifest from `dist/` (which the checker never reads; `startNode` checks the file's type
> and links but not where it is); F2, a package entry that prints `[]` and exits when the checker's
> child process loads it, faking a clean result. Both are hostile-author routes, and the static checker
> can be patched against each — but that is the wrong layer. **The trust root for "what is approved"
> is the operator, never the thing being approved.** So: `startNode` takes the manifest path from the
> operator's configuration, requires it, and logs the file's hash at start; editions stop exporting
> `manifestPath`. A hostile edition's definitions then fail to hash against the operator's manifest and
> are refused at start — whatever the checker saw. The checker stays, as defense in depth, and says so.
> It is NOT an in-process sandbox (a hostile edition running arbitrary code in the process is out of
> scope by §4), and NOT the P2 supply-side hardening.

**Cadence:** build, small. One PR, left unmerged for review.

## 1. Scope — numbered, specific

1. **The manifest comes from the operator.** `startNode` no longer accepts a manifest path from the
   edition. It reads `CLEARSEAL_MANIFEST` from the environment — an absolute path or `file:` URL,
   required; missing or empty refuses start — and applies the existing file checks (regular file, no
   link on the path). At start it writes one audit line, `manifest-loaded`, with the resolved path and
   the file's SHA-256, so the operator can compare it with the manifest they approved. Signature:
   `startNode({ definitions, configSchema })`.
2. **Editions export definitions and a configuration schema only.** The teaching edition drops the
   `manifestPath` export; its README and `.env.example` name `pins/teaching.json` as the manifest an
   operator points `CLEARSEAL_MANIFEST` at. `bin/` calls `startNode({ definitions, configSchema })`.
   The supply-boundary enumeration and `clearseal.exports` drop the manifest-path kind; with it goes
   the one `import.meta` exception, so the checker bans `import.meta` outright.
3. **The re-test's routes, end to end, now refused at start.** P1 evidence gains a clause that
   reproduces F1 as a real node: an edition whose `bin/` imports definitions from `dist/` with its own
   manifest beside them, started with `CLEARSEAL_MANIFEST` pointing at the committed
   `pins/teaching.json` — the node refuses the unpinned tool (absent from `tools/list` with
   `PIN_STRICT=false`; start refused under the default). The same for F2's entry. The clause names the
   exit-gate sentence it proves.
4. **Two cheap checker hardenings, stated as defense in depth.** (a) `bin/` may import only the
   edition's own package entry by name and the core's `startNode` — no relative import into `dist/`
   or anywhere else; (b) the export check does not trust the child's stdout: the child reports through
   a channel the loaded entry cannot write to before the check runs (choose; record why), and anything
   short of a well-formed result is a failure. The checker's header states that a hostile author with
   arbitrary code in the process can defeat static checking, and that the runtime guarantee is §1.1.
5. **`FEEDBACK.md`** per §6, and `-2008` rows for §1.1 and §1.4.

## 2. Invariants

- **N2** — the node serves only tools whose definitions hash to the manifest the operator configured.
  Nothing the edition exports can choose that manifest.
- **N5** — every item has a red-proof and a control-deletion row.

**Protected surfaces — must diff to empty:** the four steering documents, `LICENSE`, `NOTICE`,
`spikes/**`, `docs/canonical-form.md`, everything under `packages/core/src/**` except `node/**` and
the one export line in `index.ts`, and `test/deletion/controls.json` except added rows. Working
surface: `node/**`, `packages/teaching/**`, `packages/core/test/boundary/**`, the P1 evidence test,
`.env.example`.

## 3. Tests / acceptance

1. `npm run check` green on both runners; both leak-gate modes exit 0; `control-deletion` green.
2. F1 and F2 reproduced end to end and refused at start — pasted, with the `manifest-loaded` line.
3. `startNode` without `CLEARSEAL_MANIFEST`, with a relative path, a symlink, a directory — each
   refused — pasted.
4. Red-proofs for each item — pasted.

## 4. Scope fence

- **In-process sandboxing** of editions (§4). **The P2 supply-side hardening** (C7, H7, `Function`
  via `.constructor`, SIGINT shutdown).
- **Manifest signing.** Where the operator's approval is recorded cryptographically belongs to
  provenance (`-2004`); this WO makes the operator the one who names the file.
- **Any change to the gate, the registry, the transport or auth.**

## 5. Adversarial pass

Fresh subagent; every attempt uses the operation that matters — serving a tool not in the manifest
the operator configured.

1. Make `startNode` read any manifest other than `CLEARSEAL_MANIFEST`: an edition export, a default,
   a relative path resolved against a directory the edition controls, an environment read the edition
   influences before `startNode` runs.
2. Replay F1 and F2 and every variant you can build from them.
3. Change the file between the hash in `manifest-loaded` and the gate's read of it.

## 6. Upward-feedback directive

`FEEDBACK.md`: gates line, the pastes in §3, the choice in §1.4(b) with its reason, adversarial
findings with severity, what was not built.

## 7. Flag-and-stop conditions

- The hash logged and the bytes the gate parses can differ (read the file once; flag if the design
  prevents it).
- A protected surface must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-1007a` off current `main` where startNode takes the manifest path only from the
> operator's CLEARSEAL_MANIFEST, requires it, and audits the file's path and hash at start, editions
> export only definitions and a configuration schema, the re-test's F1 and F2 routes are reproduced end
> to end and refused at start, bin may import only its own package entry and startNode, the export check
> does not trust the child's stdout, red-proofs and control-deletion rows exist for every item, `npm run
> check` is green on both runners, and the work is parked as one unmerged pull request. Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-1007a origin/main`. Node 24.21.0. Cadence:
> **build**, small. Read `docs/work-orders/CSR-WO-1007a.md` in full. The design defect is the
> architect's (`-1007` let the edition name its own manifest). Leak gate before every push, exit code
> checked directly. Adversarial pass per §5 to a fresh subagent. Report the PR link and the pastes.
