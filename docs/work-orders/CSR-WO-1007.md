# CSR-WO-1007 — The core owns node assembly: an edition cannot build a gate, the checker's rules hold under aliasing, and the P1 evidence covers containment

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (must contain `-2008`, merged `290077a`).
**Branch:** `wo/CSR-WO-1007`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P1 · **Phase exit gate:** P1 exits after this merges and a targeted re-test of H1 comes back clean.
**Grounds:** `docs/northstar.md` N1, N2; `docs/architecture.md` §4 row *Core ↔ edition* (a supply
boundary, not a trust boundary against a hostile edition), §5 *Where OS primitives live*; the P1
exit red-team report (H1, L2, the exit-test gaps), recorded in §10 with this WO's docs.

> **What this is:** the P1 exit red-team's High, and the design defect under it — which is the
> architect's, from `-1004`'s WO. That WO defined an edition's "deploy scaffold" as a `start()` that
> calls `loadPinnedRegistry` and `startTransport` itself, so node assembly — reading the manifest,
> building the gate, choosing what the transport serves — lives in edition code. The red-team
> planted an edition that reached the core through `process.getBuiltinModule`, built a manifest in
> memory, admitted its own unpinned tool through a real `PinGate`, and served it; the static checker
> missed it because its rules match only bare identifiers (`process.X`, `import.meta.X`, `PinGate`)
> and not aliases or property access. **Two corrections, in order of importance.** First, the core
> owns assembly: a core `startNode` reads the manifest **from the committed file** the edition names
> and builds the registry itself, and editions stop importing any core value that assembles a node.
> Then the honest edition cannot get assembly wrong, and the checker's rule becomes short enough to
> hold: an edition imports types from the core, and nothing else except `startNode` in its `bin/`.
> Second, the checker's existing rules are made to hold under aliasing. It stays best-effort against
> a determined hostile author — JavaScript in one process cannot be sandboxed by reading it, and §4
> already says the seam is not a trust boundary against a hostile edition — and the P1 exit clause is
> reworded to claim exactly what it proves. It is NOT an in-process sandbox for editions and NOT the
> P2 hardening of supply-side tamper routes (C7, H7, `Function` via `.constructor`).

**Cadence:** build. One PR, left unmerged for review.

## 1. Scope — numbered, specific

1. **`startNode` in the core** (`packages/core/src/node/start.ts`, exported): takes an edition's
   `definitions`, its `manifestPath` (a `file:` URL or absolute path to a regular file — read once,
   parsed by the gate; anything else refuses start), and its `configSchema`; reads `PIN_STRICT`,
   `AUTH_*` and the transport configuration from the environment as today; builds the gate, the
   admission and the `PinnedRegistry` itself, and calls `startTransport`. It is the only public path
   from definitions to a serving node. `PinGate`, `PinnedRegistry`, `loadPinnedRegistry`,
   `buildManifest`, `serializeManifest` and `startTransport` stay exported for the core's own tests and
   the `pin` operator path, and the boundary checker forbids editions to import them (§1.3).
2. **The teaching edition stops assembling.** `packages/teaching` exports `definitions`,
   `manifestPath` and `configSchema` — no `start`. Its `bin/teaching-node.ts` calls the core's
   `startNode` with those three and nothing else. `package.json`'s `clearseal.exports` and the §5
   enumeration are updated to match (the deploy scaffold is the `bin/` plus configuration, not an
   export). Behaviour from outside is unchanged: the P1 evidence test still passes against the node the
   `bin/` starts.
3. **The checker's rule, restated so it can hold.** In edition source: (a) imports from
   `@clearseal/core` are `import type` only, except `startNode` in `bin/**`; (b) `process` and
   `import.meta` may not be referenced at all — by name, alias, destructuring, parenthesized or
   computed access — except the one `new URL(<literal>, import.meta.url)` form for `manifestPath`;
   (c) no property access on a namespace import of the core; (d) `getBuiltinModule`, `createRequire`,
   `loadEnvFile`, `report` and every other entry of `FORBIDDEN_PROCESS` are unreachable because (b)
   removes `process`. Each of the red-team's variants becomes a planted case that turns the test red:
   `(process).getBuiltinModule`, `const p = process`, `const { getBuiltinModule: g } = process`,
   `const m = import.meta; m.resolve`, `core.PinGate`, and the full H1 plant (self-built manifest,
   self-admitted tool, `startTransport`). The checker's header states in one sentence that static
   reading is best-effort against a hostile author and names the run-time boundaries.
4. **P1 evidence covers what the gate claims.** `p1-exit.test.ts`: the refusal clause (test 7)
   asserts each refusal also writes its audit line; a new containment clause against the teaching
   node — a name escaping the root, a planted symlink to outside, a FIFO — each refused with `500`
   and a `containment-refused` line; test 11 runs the H1 plant and its variants.
5. **Two small auth corrections from the same report.** L2: the key-set request passes
   `rejectUnauthorized: true` explicitly, so `NODE_TLS_REJECT_UNAUTHORIZED=0` in the environment
   cannot turn off verification for it; a test sets the variable and shows an impostor issuer
   refused. Info: an `AUTH_JWKS_URL` carrying `user:password@` refuses start.
6. **`FEEDBACK.md`** per §6.

## 2. Invariants

- **N2** — the only path from definitions to a serving node reads the committed manifest file.
- **N1** — an edition carries no control and assembles nothing; the checker's rule is short enough
  to be enforced.
- **N5** — every item has a red-proof, and each new control gets its `-2008` manifest row.

**Protected surfaces — must diff to empty:** the four steering documents, `LICENSE`, `NOTICE`,
`spikes/**`, `docs/canonical-form.md`, `pinning/canonical.ts`, `pinning/gate.ts`,
`pinning/manifest.ts`, `capability/**`, `containment/**`, `auth/verifier.ts`, `auth/jws.ts`,
`transport/**`. The working surface is the new `packages/core/src/node/**`, the core's `index.ts`
export line, `pinning/registry.ts` only if `startNode` needs a hook it lacks (flag first),
`auth/jwks.ts` for §1.5, `packages/teaching/**`, `packages/core/test/boundary/**`, the teaching
tests, and `test/deletion/**` for new rows.

## 3. Tests / acceptance

1. `npm run check` green on both runners; both leak-gate modes exit 0; `control-deletion` green
   with the new rows.
2. The H1 plant and each variant, red, with the checker's message — pasted.
3. `p1-exit.test.ts` output, one line per clause, including the new containment clause — pasted.
4. The L2 reproduction, now refused — pasted.

## 4. Scope fence

- **An in-process sandbox for editions** (vm contexts, realms, SES). Named as out of scope in §4.
- **The deferred supply-side routes** (C7, H7, `Function` via `.constructor`): the P2 hardening WO.
- **`typ` defaults** (the report's L3): ruled at `-1003a`, unchanged.
- **Hard links** (L1): stated in the cage, unchanged.

## 5. Adversarial pass

Fresh subagent; every attempt uses the operation that matters — serving a tool that is not in the
committed manifest, from edition source that passes the checker.

1. Every aliasing form of `process` and `import.meta` you can write; `globalThis` spellings;
   `eval`, `Function`, template-literal tags.
2. Reach an assembling core value from edition source: re-export chains inside the edition, a
   default import, `import * as` with destructuring, a type import used as a value.
3. Make `startNode` read something other than the committed file: a symlink, a directory, a data
   URL, a path that changes between check and read.

## 6. Upward-feedback directive

`FEEDBACK.md`: gates line, the pastes in §3, any variant the checker cannot catch honestly (stated,
not hidden), adversarial findings with severity, what was not built.

## 7. Flag-and-stop conditions

- `startNode` needs a change to the gate, the registry's construction, or the transport.
- The edition needs a core value other than `startNode`.
- A protected surface must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-1007` off current `main` where a core `startNode` builds the gate, registry and
> transport from an edition's definitions and its committed manifest file, the teaching edition
> exports only definitions, manifest path and config schema and its bin calls `startNode`, the
> supply-boundary checker refuses every core value import but `startNode` in `bin/` and every
> reference to `process` or `import.meta` however aliased, the red-team's H1 plant and its variants
> each turn it red, the P1 evidence test gains a containment clause and audits every refusal, the
> key-set request cannot be unverified by the environment, red-proofs and `-2008` rows exist for every
> item, `npm run check` is green on both runners, and the work is parked as one unmerged pull request.
> Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-1007 origin/main`. Node 24.21.0. Cadence:
> **build**. Read `docs/work-orders/CSR-WO-1007.md` in full and `docs/architecture.md` §4 and §5.
> The design defect is the architect's (`-1004`'s WO put node assembly in the edition). Leak gate
> before every push, exit code checked directly. Adversarial pass per §5 to a fresh subagent. Report
> the PR link and the pastes.
