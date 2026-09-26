# CSR-WO-1001 — The pin gate: manifest, verify-before-register, drift and unpinned refused, and the cross-repo detector

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD; the
base must contain `packages/core/src/pinning/canonical.ts` and `packages/core/src/capability/fields.ts`
from `-1000`).
**Branch:** `wo/CSR-WO-1001`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P1 · **Phase exit gate (the clauses this WO owns):** an edited description makes the tool
absent from `tools/list` and refused on call; an unpinned tool is refused; a node with a missing,
unparseable or drifted manifest refuses to start under the strict default; the detector is red when
the standard's list is edited locally.
**Grounds:** `docs/northstar.md` N2 (verify-before-register; drift and unpinned refused), N3, N4, N5;
`docs/architecture.md` §3.2 (the cross-repo enumeration detector), §3.3 (refuse to start), §4 row
*Pin verifier ↔ tool registry* ("the boundary is before registration; a verifier that runs after
registration has already failed open"), §5 rows *Manifest schema*, *Key identity and rotation*,
*Gate-read fields*; §8 rows *Verify-before-register*, *Cross-repo enumeration detector*, *Manifest
`build` block*; `docs/canonical-form.md` v1 (A9, A10); `docs/upstream.md` entries 1 and 5;
`docs/roadmap.md` P1. Code seams: `pinning/canonical` (built), `capability/fields` (built),
`transport/registry.ts` — the `ToolRegistry` interface and `PlaceholderRegistry` this WO replaces.

> **What this is:** the control that makes pinning *mean* something. `-1000` says what bytes a tool
> hashes to; this WO says what happens when the hash is wrong: the tool is not there. The manifest
> is a file the operator approved; at start the core hashes every tool definition it is asked to
> serve, compares to the manifest, and **registers only what matches** — a tool with no manifest
> entry is unpinned and refused, a tool whose hash differs is drifted and refused, and under the
> strict default a single refusal stops the node from starting at all. The operator path is
> `approve` (write the manifest from the current definitions, after a human has read the diff) and
> `diff` (show what would change). And the detector: one test that reads the standard's own §3
> field list at the pinned public commit and compares it to `canonicalFieldSet()`, so the sentence
> "if these diverge the executable form is authoritative" is finally checked by something. It is
> NOT signing (slots only), NOT the entitlement map, and NOT any tool.

**Cadence:** build. One PR, left unmerged for review.

## 1. Scope — numbered, specific

1. **Manifest format** (`packages/core/src/pinning/manifest.ts`, with a JSON Schema 2020-12 in
   `packages/core/schemas/manifest.schema.json` validated with the core's own validator, remote
   refs off). Fields: `manifest_version: 1`; `canonical_form_version: 1` (A10); `generated_at`
   (RFC 3339, informational, **not hashed**); `tools: [{name, tool_hash}]` sorted by name (A9);
   `manifest_hash` = `manifestHash()` over the `{canonical_form_version, tools}` object exactly as
   `-1000` defines it — so a hand edit to any entry is detectable without a signature; and a `build`
   block with slots `commit`, `distribution_digest`, `signature`, `kid`, `key_valid_from`,
   `key_valid_to` — **present, nullable, unenforced** (a comment in the schema says which WO
   enforces each). Loading refuses: unknown top-level fields; a `manifest_version` or
   `canonical_form_version` not implemented; a `manifest_hash` that does not recompute; tools out
   of order or duplicated.
2. **The gate** (`packages/core/src/pinning/gate.ts`): `PinGate.load(manifestText)` then
   `PinGate.admit(definitions[]) → {admitted, refused[]}` where each refusal names the tool and
   the reason (`unpinned`, `drifted`, `invalid` with the `CanonicalRefusal` rule). `admit` hashes
   each definition with `toolHash()` and compares by **constant-time equality** on the hex.
   **Verify-before-register is structural:** the registry constructor accepts only the gate's
   `admitted` list — there is no code path that registers a definition without passing through
   `admit`, and a test proves it by trying (the registry's constructor type does not accept a raw
   definition).
3. **The registry** (`packages/core/src/pinning/registry.ts`) implementing the transport's
   `ToolRegistry` interface, replacing `PlaceholderRegistry` (which is deleted; the transport's
   tests move to the real one behind a fixture manifest). Compiles each admitted tool's
   `input_schema` with the core's validator at construction, as the placeholder did.
4. **Strict default and start-up refusal.** Configuration `PIN_STRICT` (default `true`, by name in
   `.env.example`): strict → any refusal, or a missing/unparseable manifest, makes `startTransport`
   throw before binding, with every refusal listed once in the log at the audit seam; non-strict →
   refused tools are absent from `tools/list` and refused on call with `-32602` naming the tool,
   the node starts, and the log says so at start. A `/health` field `pinned: {admitted, refused}`
   counts only (no names — N6-adjacent hygiene for a public reference; names are in the log).
5. **Operator path** (`packages/core/src/pinning/cli.ts`, exposed as `npm run pin -- <cmd>`):
   `diff` prints, per tool, `unchanged | drifted (old → new hash) | new (unpinned) | removed` and
   exits non-zero when anything but `unchanged` appears; `approve` writes a new manifest from the
   current definitions **only after** printing the diff and receiving `--yes` (no interactive
   prompt — a flag, so it is auditable in shell history); `verify` loads the manifest and admits
   the definitions, exit 0 only when every tool is admitted. `approve` never runs at node start.
6. **The cross-repo enumeration detector** (`packages/core/test/pinning/spec-check.test.ts`):
   a test fixture holds the standard's §3 pinned-field list **copied verbatim** from
   `ClearForge-LLC/ClearSeal-public` at the commit the architecture header pins (`66b640d`), with
   the file path and line range recorded; the test asserts it equals `canonicalFieldSet()`. **A
   known divergence is expected** — the fleet's standard enumerates a different count than the
   core hashes (`capability/fields.ts` says why). The detector does not paper over it: it carries a
   dated `KNOWN_DIVERGENCE` entry naming each field present on one side only, citing
   `docs/upstream.md` entry 1, and asserts the divergence is **exactly** that set — any other
   difference, in either direction, is red. When the standard's next version lands, the entry is
   deleted and the test asserts plain equality. A second assertion re-fetches nothing: the copy is
   the fixture, and a separate maintenance-cadence check (documented, not automated here) refreshes
   it when the pinned commit moves.
7. **Fixture manifest and fixture tool** for the tests only: `packages/core/test/fixtures/` holds
   one tool definition and its approved manifest generated by the CLI; the transport tests use it.
8. **`FEEDBACK.md`** per §6.

## 2. Invariants — restated by number from the northstar

- **N2** — no path registers a tool that did not pass `admit`; drift and unpinned refuse.
- **N4** — strict default; a missing manifest is a refusal to start, never an empty registry.
- **N5** — every refusal in §1 has a test that goes red when the check is removed; the detector
  is shown red by editing the fixture copy.
- **N3** — the manifest hashes only the canonical object; `generated_at` and `build` are outside
  the hash and a test proves changing them does not change `manifest_hash`.
- **N6/N8** — no identities, no key material; `build.signature` and `kid` stay null.

**Protected surfaces — must diff to empty:** the four steering documents, `LICENSE`, `NOTICE`,
`scripts/**`, `.github/**`, `spikes/**`, `docs/canonical-form.md`, `packages/core/src/pinning/canonical.ts`,
`packages/core/src/capability/fields.ts`, `packages/core/test/oracle/**`,
`packages/core/test/vectors/**`. The transport may change only where it consumes the registry.

## 3. Tests / acceptance — what must be proven, not asserted

1. `npm run check` green on both runners.
2. Refusal table pasted: edited description → absent from `tools/list` and `-32602` on call;
   unknown tool definition → `unpinned`; manifest entry with no definition → `removed` in `diff`
   and a start-up refusal under strict; hand-edited `tool_hash` → `manifest_hash` mismatch refuses
   the load; unknown top-level field → refused; `canonical_form_version: 2` → refused.
3. Strict vs non-strict: the same drifted fixture stops the node under strict (thrown before bind,
   pasted) and starts it with the tool absent under non-strict (pasted `tools/list` and `/health`).
4. The CLI transcript: `diff` on a clean tree (exit 0), after an edit (exit 1 with the drift line),
   `approve --yes`, `verify` (exit 0); `approve` without `--yes` refuses.
5. The detector: pasted output naming the known divergence exactly; then the fixture copy edited
   (one field added, one removed) and the test red both ways.
6. The `manifest_hash` invariance test: `generated_at` and `build` changed, hash unchanged.
7. A test that the registry cannot be constructed from a raw definition (a type-level and a
   runtime check).

## 4. Scope fence — what is NOT in this work order

- **Signing the manifest, key management, the release-integrity check.** Slots only.
- **The entitlement map** (a second pinned artifact, P6).
- **Any shipped tool.** `-1004`. The fixture tool lives under `test/`.
- **Automated refresh of the standard's copy.** Documented cadence step, not a job.
- **Containment, reach, auth.** `-1002`, `-1003`.

## 5. Adversarial pass — try to break it before calling it done

Fresh subagent. Findings with severity into FEEDBACK.

1. Two definitions with the same name, one pinned: confirm the gate refuses both (ambiguity is a
   refusal, not first-wins).
2. A manifest whose `tools` array is sorted by code point rather than UTF-16 for an astral-character
   name: confirm the load refuses (A9 order), and that `approve` never writes such a manifest.
3. A definition whose canonical bytes equal a pinned tool's but whose `name` field differs by a
   trailing NUL or a homoglyph: confirm `admit` refuses (name pattern) rather than admitting under
   the other name.
4. Timing: measure `admit` on a pinned vs unpinned hash with 10,000 iterations; confirm the
   comparison is constant-time (no early exit on first differing byte).
5. Start the node with `PIN_STRICT=false` and no manifest at all: confirm it still refuses to start
   (non-strict relaxes drift, never absence).
6. Edit the manifest between `load` and `admit` on disk: confirm the gate works from the loaded
   copy, not the file.

## 6. Upward-feedback directive

`FEEDBACK.md`: the refusal table first, then the CLI transcript, then the detector's output with
the divergence named, then the invariance and constructor proofs, then the standard entries.
Under *decision-needed*: anything in the standard's §3 wording that the fixture copy could read
two ways.

## 7. Flag-and-stop conditions

- The standard's §3 list at `66b640d` cannot be located or is ambiguous — record what you found
  and stop the detector at that finding; build the rest.
- A protected surface must change (in particular, if `canonical.ts` needs an export it lacks —
  record the missing export; do not add it here).
- Replacing `PlaceholderRegistry` requires changing a transport limit or refusal.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-1001` off current `main` where the manifest format is defined and schema-validated with unenforced build slots, a PinGate admits only matching definitions with drift and unpinned refused, the registry cannot be built from anything but the gate's admitted list, the strict default refuses to start on any refusal or a missing manifest, `npm run pin -- diff|approve --yes|verify` works as specified, the cross-repo detector compares the standard's copied §3 list to `canonicalFieldSet()` with the known divergence named exactly and goes red on any other difference, every refusal has a red-proof, `npm run check` is green on both runners, and the work is parked as one unmerged pull request. Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-1001 origin/main`. Node 24.21.0. Cadence: **build**. Read `docs/work-orders/CSR-WO-1001.md` in full, `docs/canonical-form.md` A9–A10, `docs/architecture.md` §3.2, §4 (*Pin verifier ↔ tool registry*), §5 (*Manifest schema*); fetch `ClearForge-LLC/ClearSeal-public` at `66b640d` read-only for the §3 list and record its path and lines. Ratified with reasons in the WO: verify-before-register is structural (the registry's constructor accepts only the gate's output); strict default, non-strict never excuses a missing manifest; `approve` needs `--yes`; constant-time hash comparison; the detector names the known divergence exactly and is red on any other. Protected surfaces per WO §2 — `canonical.ts` and `fields.ts` are frozen. Leak gate `--tree` and `--history` before every push, exit code checked directly. Flag-and-stop: WO §7. Adversarial pass per §5 to a fresh subagent. Report the PR link, the refusal table, and the detector's divergence line.
