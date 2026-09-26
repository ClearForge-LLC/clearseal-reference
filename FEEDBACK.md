# FEEDBACK: CSR-WO-1001 (the pin gate: manifest, verify-before-register, strict default, operator path, cross-repo detector)

Branch `wo/CSR-WO-1001`, cut from `main` at `444d12c`; the base carries `-1000`'s `canonical.ts` and
`fields.ts`. Parked as one unmerged pull request. Built on Node v24.21.0.

## Refusal table (WO §3.2)

Pasted from the tests: `gate.test.ts`, `manifest.test.ts` and `startup.test.ts`.

| Case | Result |
|---|---|
| Edited description | `[{"name":"echo","reason":"drifted"}]`. Under **non-strict**, the tool is absent from `tools/list`, and a call gets `400`, `-32602`, `The tool "echo" is refused by the pin gate`. Under **strict**, the node does not start |
| Unknown tool definition | `[{"name":"echo2","reason":"unpinned"}]` |
| Manifest entry with no definition | `[{"name":"echo","reason":"removed"}]`. `diff` prints `removed    beta …`. **Strict:** `PinRefusedError: … echo (removed) …`, and the node does not start |
| Hand-edited `tool_hash` | `ManifestError: manifest_hash does not recompute: an entry was edited`; the load is refused |
| Unknown top-level field | `ManifestError: unknown top-level field(s): note` |
| `canonical_form_version: 2` / `manifest_version: 2` | `ManifestError: a canonical_form_version (manifest_version) this implementation does not implement` |
| Tools out of order / a name twice | `ManifestError: tools are not sorted by name in UTF-16 code units (A9)` / `… appears twice` |
| Two definitions, one name (WO §5.1) | `[{"name":"echo","reason":"duplicate"},{"name":"echo","reason":"duplicate"}]`: both are refused, never first-wins |
| Look-alike name: trailing NUL, homoglyph, case, trailing LF (WO §5.3) | `[{"name":"еcho","reason":"invalid","rule":"A5"}]`; never admitted as `echo` |
| A capability tag carrying `description`, `input_schema` or `name` (adversarial F1) | `[{"name":"echo","reason":"invalid","rule":"A6"}]` |
| A `tool_hash` differing only in its last digit | `[{"name":"echo","reason":"drifted"}]` |
| A missing or unparseable manifest, strict **or** non-strict (WO §5.5) | `ManifestError: the manifest cannot be read (ENOENT): a node without a manifest does not start` |
| A registry that is not a genuine `PinnedRegistry` (hand-made, from the prototype, or a subclass) | `startTransport` throws `the transport serves only a PinnedRegistry …`, or the constructor refuses the subclass |

### Strict against non-strict (WO §3.3)

The same drifted fixture under both settings.

**Strict, the default.** `startTransport` throws before it binds:

```
STRICT threw PinRefusedError: the pin gate refused 1 tool(s): echo (drifted); PIN_STRICT is on, so the node does not start
STRICT audit ["pin-refused {\"tool\":\"echo\",\"reason\":\"drifted\"}"]
```

**Non-strict.** The node starts:

```
NON-STRICT audit ["pin-refused {\"tool\":\"echo\",\"reason\":\"drifted\"}","pin-non-strict {\"admitted\":12,\"refused\":1}"]
NON-STRICT tools/list ["approve_target","ask","ask_big","ask_other","big","costly_schema","hold","needs_sampling","no_args","region_query","slow","throws_refusal"]
NON-STRICT call echo 400 {"jsonrpc":"2.0","id":2,"error":{"code":-32602,"message":"The tool \"echo\" is refused by the pin gate"}}
NON-STRICT health {"status":"ok","version":"0","protocolVersions":["2026-07-28","2025-11-25"],"pinned":{"admitted":12,"refused":1}}
```

- `/health` gives counts only; the names are in the log.
- A name the gate never saw still gets `Unknown tool` and is not echoed.

## CLI transcript (WO §3.4)

From `cli.test.ts`, which calls `runPin` directly. The temporary directory is stripped from the
paths.

```
$ npm run pin -- approve --definitions definitions.mjs --manifest manifest.json   # without --yes
no manifest at manifest.json: every tool is new
new        alpha  (unpinned) 800b65afbed0
new        beta  (unpinned) 4a9a89eef337
(stderr) approve writes the manifest only with --yes, after the diff above has been read
exit 2
$ npm run pin -- approve --yes --definitions definitions.mjs --manifest manifest.json
...
approved: manifest.json written with 2 tool(s)
exit 0
$ npm run pin -- diff --definitions definitions.mjs --manifest manifest.json   # clean tree
unchanged  alpha  800b65afbed0
unchanged  beta  4a9a89eef337
exit 0
$ npm run pin -- verify --definitions definitions.mjs --manifest manifest.json
verify: 2 admitted, 0 refused
exit 0
$ npm run pin -- diff --definitions definitions.mjs --manifest manifest.json   # after an edit, an addition, a removal
drifted    alpha  800b65afbed0 → 09af865c66b9
removed    beta  4a9a89eef337
new        gamma  (unpinned) 7172125be659
exit 1
$ npm run pin -- verify --definitions definitions.mjs --manifest manifest.json
refused    alpha  drifted
refused    gamma  unpinned
refused    beta  removed
verify: 0 admitted, 3 refused
exit 1
```

- **Duplicate definitions:** `diff` prints `duplicate  alpha  (two definitions, one name: both refused)` and exits 1. `approve --yes` exits 1 and writes nothing.
- **The fixture manifest** (`packages/core/test/fixtures/manifest.json`, 13 tools) was generated by
  `npm run pin -- approve --yes --definitions packages/core/test/fixtures/tools.ts --manifest packages/core/test/fixtures/manifest.json`,
  and `verify` on it gives `13 admitted, 0 refused`.

## The detector (WO §3.5)

```
DETECTOR standard 66b640d ClearSeal-Standard-v0.8.md:108-108 lists 10 fields (states 10); core hashes 10; known divergence: none; unexpected: []
```

**The source.** `packages/core/test/fixtures/clearseal-section3.json` holds line 108 of
`ClearSeal-Standard-v0.8.md` (§3 *Controls*) from `ClearForge-LLC/ClearSeal-public` at `66b640d`,
copied verbatim. The full commit is recorded as a commit URL. The adversarial pass re-fetched that
line read-only and found it byte-identical.

**No known divergence (measured).** The WO expected a known divergence, but at `66b640d` the
standard lists the same ten fields the core hashes, and says "Ten fields". `KNOWN_DIVERGENCE` is
therefore empty, so the test asserts plain equality.
- The mechanism is still in place: a dated entry, with both sides named.
- The "nine" in `fields.ts`'s header describes the standard before its v0.8 amendment.
- **For the architect to acknowledge:** the WO's premise did not hold.

**Red both ways.** A field added to the copy gives `only in the standard: ["rate_limit_tier"]`. A
field removed gives `only in the core: ["elevated"]`. A field named twice is refused as well.

**The refresh cadence** is documented in the fixture's `source.refresh` and here, and is not
automated. When `architecture.md`'s pinned public commit moves:
1. re-copy the line verbatim;
2. update `commit_url`, `lines` and `copied`;
3. run `npm run check`.

**Decision-needed (WO §6): the standard's §3 wording can be read two ways.** The sentence says
"`recoverability_basis` (null unless `owned_state`)". A plain reading of the backticked names
counts `owned_state` as an **eleventh field**; the first run of the detector did exactly that and
went red. The detector now drops parenthetical asides before reading names, and it cross-checks
against the standard's own count word ("Ten fields").
- That count check is the backstop: a new field hidden in parentheses would make the list one
  short of the stated count.
- The standard should write the aside so it cannot be misread, for example by not backticking a
  value inside the field list.
- The architect has noted this for review.

## Invariance and constructor proofs (WO §3.6, §3.7)

**Invariance.**

```
INVARIANCE manifest_hash before=3a9bcac39407 after=3a9bcac39407 (generated_at and build changed)
```

The loaded manifest's hash also equals `-1000`'s `manifestHash()` over the same tools.

**The constructor.**
- **Type level:** three `@ts-expect-error` lines in `startup.test.ts`. If any of them compiled, the
  type check would fail:
  - a raw definition list given to `new PinnedRegistry`;
  - an object shaped like an Admission (`Admission` has a private brand, so its type is nominal);
  - a hand-made `ToolRegistry` given to `startTransport`.
- **Run time:**
  - `TypeError` for a raw list or a look-alike;
  - `new Admission(<any symbol>, …)` throws, because the issuing token is module-private;
  - a subclass is refused;
  - `Object.create(PinnedRegistry.prototype)` is refused by `startTransport`;
  - the prototype and every instance are frozen, so `get()` cannot be patched and `pinning` cannot
    be reassigned.

## What was built

- **`packages/core/src/pinning/manifest.ts`** and **`packages/core/schemas/manifest.schema.json`:**
  - validated by the core's own validator, with remote references off;
  - `build` slots are nullable and unenforced, and each slot's `$comment` names the control that
    will enforce it. No work order holds manifest signing yet, and the schema says so rather than
    inventing one;
  - the RFC 3339 check on `generated_at` is in code, because z-schema's ReDoS guard refuses the full
    pattern;
  - `schemas/` is added to the package's published `files`.
- **`gate.ts`:** `PinGate.load` / `admit` returns an `Admission` with five refusal reasons:
  `unpinned`, `drifted`, `invalid` (with the rule), `duplicate` and `removed`.
  - The comparison is constant-time (`timingSafeEqual`).
  - Each admitted tool is a **deep-frozen snapshot of the canonical object the gate hashed**, and
    it is all the registry serves.
- **`registry.ts`:** `PinnedRegistry` accepts only an issued `Admission`.
  - `loadPinnedRegistry` reads the manifest file.
  - `PIN_STRICT` is read from the environment unless given: strict unless exactly `false`. It is
    named in `.env.example`.
- **The transport consumes the registry, and only there:**
  - `startTransport` accepts only a genuine `PinnedRegistry`, logs each refusal once at the audit
    seam, and throws `PinRefusedError` before binding when strict;
  - `/health` gains `pinned: {admitted, refused}`;
  - `dispatch` names a gate-refused tool in its `-32602` message;
  - `PlaceholderRegistry` is deleted, and its static checks survive unchanged as `prepareTool`, no
    longer exported from the package index.
- **`cli.ts`:** `npm run pin -- diff | approve --yes | verify`.
- **Tests:**
  - the transport tests serve `test/fixtures/tools.ts` through the gate, against the CLI-generated
    `test/fixtures/manifest.json`;
  - tests with ad-hoc tools go through `test/fixtures/pin.ts`, which approves in memory with the
    CLI's own `buildManifest`, then `load`, `admit`, registry;
  - the conformance fixture server does the same.

## Deviations

| # | Deviation | Ruling |
|---|---|---|
| D-1 | `spikes/0101-approval/server.ts`, 6 lines added and 3 removed. The `PlaceholderRegistry` import went, three imports came in (`PinGate`, `buildManifest`/`serializeManifest`, `PinnedRegistry`), and the two registration lines were replaced by an in-memory approve plus `admit`. The spike's tools get a read-only capability tag inline | **Ruled by the architect:** "the protected surface on spikes/** exists to stop scope creep, not to preserve a registration path around the gate … it builds its manifest in memory at start (approve semantics, never written to disk) and registers through PinGate.admit like everything else." Nothing else under `spikes/**` changed |
| D-2 | A third `.leak-gate-allow` line: `packages/core/test/fixtures/*.json long-hex digests of committed public test inputs, not secrets`. The fixture manifest carries `tool_hash` and `manifest_hash` digests | Not listed as protected for this WO. It has the same justification you ruled for the vectors, but it is **yours to confirm** |
| D-3 | The served description is the **A4-normalized** text, and the served schema is in **JCS member order**. Both are exactly what was hashed (adversarial F2). One transport test (`x-mcp-header`) compared an order that depends on the schema's key order; it is now order-insensitive | Recorded. Serving the hashed bytes is the fix |
| D-4 | `title` and `annotations` are not part of a pinnable definition, so nothing the manifest does not hash is served | Recorded. If tools need them, they either join the hashed set (a version bump of the canonical form) or stay off |

## Red-proofs (N5)

33 mutants, each removing or weakening one check, were run against the pinning and transport
tests, each run limited to 300 s. The script refuses to start on a tree with uncommitted changes.

| Mutant | Goes red in |
|---|---|
| manifest | unknown top-level field check removed |
| manifest | version checks removed |
| manifest | manifest_hash recompute removed |
| manifest | order check removed |
| manifest | duplicate-entry check removed |
| manifest | RFC 3339 check removed |
| gate | unpinned admitted |
| gate | drift not compared |
| gate | duplicates first-wins |
| gate | removed entries not reported |
| gate | invalid silently skipped |
| gate | Admission token not checked |
| registry | issued-admission check removed |
| registry | missing manifest not a ManifestError |
| server | any registry accepted |
| server | instanceof instead of the private brand |
| server | strict does not stop the node |
| server | /health without pinned counts; transport RED 1 |
| dispatch | refused tool not named |
| cli | approve without --yes writes |
| cli | diff always exit 0 |
| cli | verify ignores refusals |
| F1 | capability extra keys allowed |
| F1 | green alone: **equivalent** while the extra-key check stands; with both F1 layers removed, the F1 test goes red (run by hand) |
| F2 | registry serves the live definition, not the snapshot |
| F3 | subclassing allowed |
| F3 | prototype not frozen |
| F4 | instance not frozen |
| F5 | strict default ignores the environment |
| F6 | diff ignores duplicates |
| F7 | approve writes duplicates |
| F7 | hash compared on its first 8 bytes only |
| detector | parentheticals read as fields |

## Adversarial pass (fresh subagent, WO §5; its own scratch worktree, since removed)

| # | Finding | Severity | Status |
|---|---|---|---|
| F1 | **A key inside `capability` replaced a hashed field.** `canonicalInput` spread the tag after the real fields, so `capability.description` became the hashed description while the registry served `tool.description`. `verify` passed it (`13 admitted, 0 refused`). N2 was not met | **high** | **Fixed:** the seven tag fields are picked by name, any other key is refused (`invalid`, A6), and the registry serves the snapshot (F2). Tested, and red-proofed twice: with the extra-key check removed, and with the original spread restored |
| F2 | Nothing was snapshotted. A getter, or mutation after `admit` or after start, changed what was served | medium | **Fixed:** one read, a canonical object, a deep-frozen snapshot, hashed and served. Tested (getter, mutation after admit, a frozen schema) and red-proofed |
| F3 | The "structural" claim held only against the type checker: a subclass, `Object.create(prototype)`, or a patched prototype served an unpinned tool | medium/low | **Fixed:** subclassing is refused, the prototype and instances are frozen, `startTransport` checks a private brand plus the exact prototype, and `prepareTool` is no longer exported. Tested and red-proofed |
| F4 | `registry.pinning` could be reassigned, hiding refusals from a strict start | low | **Fixed:** instances are frozen |
| F5 | `pinStrictFromEnv` was not wired; `strict` was a required boolean | medium/low | **Fixed:** `strict` is optional and defaults to the environment. Tested, including `PIN_STRICT=false` with no manifest |
| F6 | `diff` collapsed duplicate definitions and exited 0 | low | **Fixed:** `duplicate` status, exit 1 |
| F7 | Two checks could be removed with every test still green: approve's duplicate check, and a comparison of only the first 8 bytes | low | **Fixed:** a test for each, and both now in the mutant table |
| F8 | Three regressions hung the suite rather than failing it: a strict test left an unexpectedly started server open | low | **Fixed** before the report arrived: those tests close any transport that starts, and the mutant runs are time-limited |
| F9 | Non-strict naming a refused tool confirms that it exists. `PinRefusedError`'s message is a plain string | info | By design (WO §1.4). The audit seam is JSON |
| F10 | The loader is permissive where it is harmless: `2026-02-31T…` passes, there is no size cap (200k entries in about 3.3 s), `1.0` counts as version 1, approve writes non-atomically | info | Recorded. `generated_at` is informational and unhashed. A size cap is a proposed follow-up |
| F11 | The detector found no divergence, although the WO expected one; parenthetical stripping could hide a field written inside parentheses | info | Recorded above. The count word is the backstop |
| F12 | The conformance fixture server and the spike approve their own tools in memory, so pinning cannot fail there | info | Test-only and ruled (D-1). Stated here |

**Held (measured by the subagent):**
- **§5.2:** code-point order for an astral name is unreachable. The schema's name pattern and A5
  refuse non-ASCII names first; the order check itself uses UTF-16 order.
- **§5.4:** constant time. Over 10,000 admits, a matching hash, one differing at the first byte, and
  one differing at the last byte all take about 15.5–15.9 µs, with no ordering between them.
  `timingSafeEqual` runs at a flat 89–98 ns. Every hash is computed from public definitions, so
  timing does not leak a secret.
- **§5.6:** the gate uses its loaded copy.
- **The loader** refuses: a BOM, duplicate keys, `__proto__`, upper-case hashes, extra keys in an
  entry, a numeric build slot, a missing or extra build slot, trailing garbage, depth over 64.
- **Hash invariance** held.
- **Protected surfaces** diff empty apart from D-1.
- **Leak gate** `--tree` and `--history` exit 0.

## Gates

| Gate | Result |
|---|---|
| `npm run check` | exit 0: core **332** tests (21 files), spike 0102 69, spike 0101 8, `test:subset` 4 |
| CI | both runners, on the pull request |
| Protected surfaces | The four steering documents, `LICENSE`, `NOTICE`, `scripts/**`, `.github/**`, `docs/canonical-form.md`, `canonical.ts`, `fields.ts`, the oracle and the vectors diff **empty**. `spikes/**` has only D-1's lines. The transport changed only where it consumes the registry: `server.ts` (the start check, `/health`), `dispatch.ts` (naming a refused tool), `registry.ts` (`PlaceholderRegistry` became `prepareTool`), `index.ts` |
| Leak gate | `--tree` and `--history` exited 0 before every push, each checked by exit code |
| Credentials | Pushes went over the repository's write deploy key. A short-lived token was minted only to open this pull request, kept in a mode-0600 scratch file, and deleted straight after |

## What did not work, and why

- **The first manifest schema did not compile.** z-schema's ReDoS guard refused the RFC 3339
  pattern, so the full check moved into code.
- **The first detector run read eleven fields:** the parenthetical case above.
- **My first red-proof run hung for about 40 minutes** on the drift mutant. The strict test left an
  unexpectedly started server open. I stopped that process by its PID and restored the one mutated
  file from the commit. I fixed the tests to close any started transport, limited each mutant run
  to 300 s, and re-ran the matrix against the commit.
- **My first `Admission` design exposed its factory** through a `Symbol.for` key, which anyone
  could call. I replaced it before any commit with a module-private token.

## What was deliberately not built

- **Signing the manifest, key management, and the release-integrity check.** The slots are there
  and unenforced.
- **The entitlement map (P6), any shipped tool (`-1004`), containment, reach and auth.**
- **Automated refresh of the standard's copy.** The cadence is documented instead.
- **A manifest size cap** (F10), proposed.
