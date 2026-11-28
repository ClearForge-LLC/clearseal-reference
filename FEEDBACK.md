# FEEDBACK: CSR-WO-2008c (every built control fails its own row, and a detector keeps it that way)

Branch `wo/CSR-WO-2008c`, cut from `main` at `3332570` (contains `-2008b`'s merge `81a7d5d` and the
docs PR that adds this work order). Built on Node v24.21.0 on Furnace, as `forge`. Every commit's
author and committer is `clearforgekey[bot]`'s noreply address. Parked as one unmerged pull request.

## Read this first: what could not be stubbed honestly

Seven controls have no row whose stub deletes them, because no honest stub exists. Each is either an
absence (a stub would have to add code) or a layer (with its own line deleted, a check below or
beside it refuses the same input with the same status, so a test can go red only on a message):

| Control | Why no row | Where it is proven instead |
|---|---|---|
| **H8**: `jku`, `x5u`, `jwk` and `x5c` are never read | An absence: no code reads them, so a stub would have to add a fetch | `verifier.test.ts` *the attacker's key set … is never fetched*; `exempt.json` carries `{check: "H8", reason}` |
| **Batch refusal** (`jsonrpc.ts:82`) | A layer: with its line deleted, `isPlainObject` refuses the array, and below it the `jsonrpc` check does; the status, code and audit reason are the same. Only SH-9's message regex noticed | `refusals.test.ts` SH-9 (the message) |
| **Legacy `initialize` returns no session header** (`dispatch.ts:231`) | An absence: no code sets the header | `eras.test.ts` LG-1, `refusals.test.ts` SH-43 |
| **The manifest's unknown-field and version checks** (`manifest.ts:120–122`) | A layer behind `manifest.schema.json`: with either deleted, the schema check refuses the same manifest; the tests go red only on their message validator | `manifest.test.ts` (listed by `manifest-schema` and the other manifest rows) |
| **`startNode`'s port range** (`start.ts:184`) | A layer behind Node's own `listen`, which refuses a port over 65535 | `config.test.ts` *a port over 65535* |
| **G1's resource URL** (`server.ts:310`) | A layer: with the check deleted the transport still refuses to start; only `auth/transport.test.ts`'s message regex noticed | `auth/transport.test.ts` *with the core's verifier and no resource URL …* |
| **A2: the cage refuses a symlink leaf before the open** (`cage.ts:310`) | A layer behind `O_NOFOLLOW`: with the check deleted the kernel refuses the same open, and no test goes red | `containment/adversarial.test.ts` A2; the `O_NOFOLLOW` row is `cage-o-nofollow` |

Each is recorded in `test/deletion/exempt.json` as `{control, reason}` (H8 as `{check, reason}`), so
the list lives in the data the detector reads, not only here.

Two rows are **layered but kept**, because the check's audit reason is its own specified output
(`CHECKS.md`'s *Reason* column; G4 requires it), and that is what their tests see:

- **H2** (`auth-h2-missing`): with the line gone, H3's scheme check answers the same 401 with the same
  challenge; the audit reason is `scheme`, not `missing`.
- **H9** (`auth-h9-kid`): with the check gone, the kid goes to the key set and is refused
  `unknown-kid`, so the client still sees `invalid_token`. **What is lost is H9's point: the refusal
  now costs a fetch.** No test asserts that H9 refuses *without a fetch* (finding 3).
- *decision-needed: yes*: ratify these two as red for their control, or drop them and exempt H2 and
  H9 as layers.

Every other new row's stub lets the refused input through, checked by hand for the auth rows (the
forbidden token is accepted: `actual: true` on every table-driven verifier case) and from the failing
assertion for the rest (the request is served, the manifest loads, the configuration starts,
*Missing expected rejection*, *registration was accepted*).

## -2008b's findings, promoted

| -2008b finding | Durable home |
|---|---|
| 0: a validation straight after a timeout counts the replacement worker's start-up | `CSR-WO-1005c` (ruled 2026-11-27); the test-side settle stands until then |
| The §5 coverage sweep | this WO |
| 1: the corrections close-in-flight test does not discriminate the deadline | needs-none: the file stays in `validation-deadline`'s baseline, unnamed |
| 2: the heap test cannot see the WO's plant | `CSR-WO-2008d` (ruled) |
| 3: the canary fails most runs on Furnace | `CSR-WO-2008d` (ruled; the fixture margin is -2008d's, not -2003's) |
| 4: `reach.test.ts` failed once under heavy load | needs-none: it has not recurred, on CI or in this WO's local runs |
| 5: `ci.yml`'s stale shard comment | this WO §1.6 |
| 6: `forge`'s git identity | the operator, as a furnace777 change (ruled); every commit here sets it |

## Findings

Schema: *finding · where · type · recommendation · decision-needed*.

1. **The sweep missed controls; the unlisted files and the adversarial pass found them.** · coverage ·
   - The `-2008b` sweep looked at transport files only; 16 test files, not 4, were in no row.
   - From the unlisted files: `manifest-schema`, `manifest-generated-at`, `manifest-tools-sorted`,
     `manifest-hash-recomputes`, `edition-config-schema` (startNode validates the edition's variables,
     N4) and `pin-approve-needs-yes`.
   - From the adversarial pass (operator ruling: build them here): the `CHECKS.md` clauses
     (`auth-g1-algs`, `-skew`, `-lifetime`, `auth-j2-ttl-bounds`, `auth-j3-shared-fetch`, `auth-g5-ca-file`,
     `-audience-differs`, `-log-escaping`, `-decimal`); containment (`cage-o-nofollow` R-1,
     `cage-descriptor-recheck` A3, `cage-backslash-drive` A13, `cage-port-bounds` A15, `cage-frozen` A8,
     `domain-fs-nul-backslash`, `domain-host-not-address`, `domain-port-range`); the reach harness
     (`harness-one-run` A7, `harness-shim-counted` A5, `harness-corpus-required` A12); the canonicalizer
     (`canonical-nesting-cap` A1 with cycles, `canonical-data-members`, `canonical-array-extra`); the eras
     (`era-legacy-status-200` ST-2, `legacy-input-required` LG-8).
   - Recommendation: none further; the detector now names a file that drops out or proves nothing. ·
     *decision-needed: no*
2. **A receive timeout fires on Node's 30 s sweep, not at its setting.** · `server.ts:560`,
   `listener.ts:274` · control semantics ·
   - Measured: `requestTimeout: 200` answered 408 at 30,008 ms; the transport at 1,000 ms answered at
     30,004–30,010 ms; the listener's fixed 10 s at 30,006–30,007 ms.
   - Node checks request timeouts every `connectionsCheckingInterval` (30 s by default). So
     production's `requestTimeoutMs` 30,000 ends a stalled request 30 to 60 s after it starts, and the
     listener's 10 s ends one at about 30 s.
   - No seam was added (operator ruling; WO §1.1 had asked for one on the listener). Each test waits for
     the real sweep, in its own file, listed only by its own row, with its own 45 s deadline so the stub
     reads red by assertion.
   - **What the tests cannot tell apart** (adversarial pass): any timeout under about 30 s. With
     `requestTimeout: 25_000` hardcoded in both files the tests stayed green (408 at 30,006 and
     30,011 ms). The rows prove the timeout is there, not that it is the configured value.
   - Recommendation: if the documented figure must hold, set `connectionsCheckingInterval` alongside
     `requestTimeout`; that is a behaviour change, outside this WO. · *decision-needed: yes*
3. **H9's test does not see its point.** · `verifier.test.ts` H9 rows · test strength · H9 refuses a
   bad `kid` *before any fetch*. Under its stub the kid is fetched and refused `unknown-kid`, and the
   tests notice only the reason. Recommendation: assert the fetch count in the H9 cases. ·
   *decision-needed: no* (a test addition for a later WO)
4. **A check id names one row; its other clauses have rows of their own.** · `CHECKS.md` · coverage
   depth · The row named in `checks` deletes the check's central decision. G1's and G5's other
   clauses, J2's TTL bound and J3's shared fetch now have rows (finding 1), without an id. What has no
   row: H5's and C1's JSON-object clause (an array header is refused by the `alg` check anyway).
   Clauses with no test (adversarial pass, by reading): `request-state-binding`'s method (dispatch
   always binds `tools/call`), `manifest-generated-at`'s `Date.parse`, and POST to the metadata
   document under `health-get-only`. Recommendation: split the ids in `CHECKS.md` (G1a, G5a …) if each
   clause should be named. · *decision-needed: yes*
5. **J6's stub stretches rather than deletes.** · `auth-j6-deadline` · stub form · Deleting the 3 s
   deadline runs the two J6 tests into their own `{ timeout: 10_000 }`, which the runner correctly does
   not count as an assertion. ×2.5 (7.5 s) breaks both bounds (6 s and 4.5 s) inside that timeout:
   read 7,500 and 7,502 ms. The `verifier-timeout` and `handler-timeout` precedent. The tests' bounds
   pass a stretch of about ×1.4 (adversarial pass). · *decision-needed: no*
6. **An existing row gained a `mustFail` name.** · `drift-refused` · protected surface · §2 lets
   existing rows gain `tests`; to satisfy the detector's new rule (a listed file must prove
   something), `drift-refused` also names *the same check refuses a definition whose description was
   edited after pinning* from the teaching `manifest.test.ts`, which its stub turns red. Its stub is
   unchanged. · *decision-needed: no* (ratify or revert)
7. **`adversary-windows.test.ts` proves a control the Linux runners cannot turn red.** · allowlist ·
   On Linux its one test asserts the platform and returns. Recommendation: a Windows control-deletion
   shard if the Windows cage needs N5. · *decision-needed: yes*

## The detector (§1.5)

`scripts/deletion-coverage.mjs` and its test, run first in `npm test` (so in `npm run check` and in
both CI `test` jobs). It is pure functions over their inputs, plus one test over the repository.

- **Why `scripts/`, not `test/deletion/coverage.test.ts`:** the root `tsconfig.json` includes
  `scripts/**/*.mjs`, and ESLint's project service refuses a file outside a tsconfig; a `.ts` under
  `test/` would need new configuration, and one under `packages/*/test` would have to list itself.
  `scripts/control-deletion.test.mjs` is the house precedent.
- **Why `section8` and `checks` on the rows, not a reverse map:** every row already carries
  `section8`, and the runner ignores fields it does not read, so a `checks` list on the row that
  deletes a check keeps the map next to the stub that proves it.
- **It fails when:**
  - (a) a `packages/*/test/**/*.test.ts` file is in no row and not in `test/deletion/unlisted.json`
    (or an entry there is stale or has no reason);
  - (b) a *built* §8 row has no row and is not in `test/deletion/exempt.json` (or a row's `section8`
    names no §8 title, or an exemption is stale);
  - (a′) a file a row lists has no test that any row names in `mustFail` (listed, it runs, but proves
    nothing). Titles are read from the source; a template literal matches by its text before `${`;
  - (c) a `CHECKS.md` id is named by no row's `checks` or by two, unless exempt by `{check, reason}`
    (H8), which goes stale when a row names it;
  - and it refuses to skip: an empty glob, no built §8 row, no `CHECKS.md` id, a §8 status that
    mentions *built* without leading with it (`partly built`, `✅ built`), and a `CHECKS.md` line whose
    first cell looks like an id in another form (`**G6**`, `G7 (layer)`) are each a failure.
- **Its red-proofs, on the real tree, applied by hand and reverted:**
  - a planted `packages/core/test/transport/planted.test.ts` → exit 1,
    `(a) packages/core/test/transport/planted.test.ts: a test file in no row's tests …`;
  - a planted `| Planted control | … | **built** — planted |` row in §8 → exit 1,
    `(b) docs/architecture.md §8 row "Planted control" is marked built and has no deletion row`;
  - reverted: exit 0, 13 of 13.
  - The same failures, the stale cases and every refuse-to-skip case are permanent planted-input tests
    in the file (19 of its 20 tests; the 20th runs over the repository).
- **What it cannot see:** a sub-control inside a bundled §8 row (say, batches within *Transport
  hardening*) losing its row while a sibling row keeps the title, since only the `CHECKS.md` ids are
  tracked finer than the §8 title; whether a row's stub really deletes what its `control` line and
  `checks` claim (that is the stub's review); and a title built some other way than a literal or a
  template.
- **The exemptions** (`exempt.json`): the four §8 rows outside the stub mechanism (*Leak gate*,
  *Supply chain*, *Control-deletion job*, *Property-based tests*), each with the proof it has
  instead, and `H8`. **The allowlist** (`unlisted.json`): six files, each with its reason.

## Where the 16 unlisted files went (§1.4)

| File | Now |
|---|---|
| `transport/json.test.ts` | `json-duplicate-key`, `json-depth`, `json-lone-surrogate` |
| `transport/mrtr.test.ts` | `request-state-integrity`, `-binding`, `-expiry` |
| `transport/refusal-audit.test.ts` | the 415, 405, JSON, H1, H3a and G4 rows |
| `teaching/notes.test.ts` | `arguments-schema-refused` |
| `teaching/config.test.ts` | `edition-config-schema` |
| `pinning/manifest.test.ts` | the four `manifest-*` rows |
| `pinning/cli.test.ts` | `pin-approve-needs-yes`; and `drift-refused`, whose stub turns its whole-path test red |
| `sdk-client/sdk-client.test.ts` | `era-legacy-status-200` (first on the allowlist with a wrong reason; the adversarial pass showed its ST-2 test goes red without the mapping) |
| `containment/adversarial.test.ts` | the cage, domain and harness rows above, each naming its own test; also in `cage-undeclared-reach` and `reach-harness-verdict`'s baselines |
| `pinning/boundaries.test.ts` | `canonical-nesting-cap`, `canonical-data-members`, `canonical-array-extra`; also in `canonical-hash`'s baseline |
| `teaching/manifest.test.ts` | `drift-refused`, which now names its edited-description test (finding 6) |
| `containment/adversary-windows.test.ts`, `containment/windows-links.test.ts`, `index.test.ts`, `pinning/properties.test.ts`, `transport/costly-schema.test.ts` | `unlisted.json`, with reasons |

Existing rows changed only by gaining `tests` entries, `checks` (eight rows), and one `mustFail`
name (finding 6); no existing stub or red-proof diffs.

## The rows (§3.1)

All 69 new rows in one invocation at `ebae752` (`node scripts/control-deletion.mjs --row …`), in a
capped scope on Furnace; the §8 title is cut from each line. The two timeout rows were re-run after
the reduction pass (`3b109a5`): RED, 47 s each.

```
control-deletion: baseline green: 24 test file(s), 479 test(s) passed on the unpatched tree
RED  request-timeout | stub applied; 1/1 named test(s) red by assertion | 47109 ms
RED  approval-listener-request-timeout | stub applied; 1/1 named test(s) red by assertion | 47105 ms
RED  content-type-415 | stub applied; 3/3 named test(s) red by assertion | 4035 ms
RED  content-coding-415 | stub applied; 3/3 named test(s) red by assertion | 3991 ms
RED  method-post-only | stub applied; 5/5 named test(s) red by assertion | 3490 ms
RED  health-get-only | stub applied; 1/1 named test(s) red by assertion | 2218 ms
RED  x-mcp-header-annotation-refused | stub applied; 13/13 named test(s) red by assertion | 2198 ms
RED  arguments-schema-refused | stub applied; 3/3 named test(s) red by assertion | 3527 ms
RED  json-duplicate-key | stub applied; 7/7 named test(s) red by assertion | 8304 ms
RED  json-depth | stub applied; 4/4 named test(s) red by assertion | 3537 ms
RED  json-lone-surrogate | stub applied; 3/3 named test(s) red by assertion | 2223 ms
RED  request-state-integrity | stub applied; 3/3 named test(s) red by assertion | 2514 ms
RED  request-state-binding | stub applied; 3/3 named test(s) red by assertion | 3986 ms
RED  request-state-expiry | stub applied; 1/1 named test(s) red by assertion | 2239 ms
RED  auth-h2-missing | stub applied; 2/2 named test(s) red by assertion | 8255 ms
RED  auth-h3-bearer | stub applied; 6/6 named test(s) red by assertion | 8378 ms
RED  auth-h4-compact | stub applied; 2/2 named test(s) red by assertion | 8286 ms
RED  auth-h4-canonical | stub applied; 1/1 named test(s) red by assertion | 8295 ms
RED  auth-jose-utf8 | stub applied; 2/2 named test(s) red by assertion | 8397 ms
RED  auth-h7-crit | stub applied; 1/1 named test(s) red by assertion | 8322 ms
RED  auth-h9-kid | stub applied; 4/4 named test(s) red by assertion | 8265 ms
RED  auth-h10-typ | stub applied; 2/2 named test(s) red by assertion | 8296 ms
RED  auth-k1-by-kid | stub applied; 1/1 named test(s) red by assertion | 8285 ms
RED  auth-k2-key-fits | stub applied; 3/3 named test(s) red by assertion | 8246 ms
RED  auth-c4a-horizon | stub applied; 2/2 named test(s) red by assertion | 5260 ms
RED  auth-c5-nbf | stub applied; 2/2 named test(s) red by assertion | 8302 ms
RED  auth-c6-iat | stub applied; 2/2 named test(s) red by assertion | 8268 ms
RED  auth-c7-sub | stub applied; 4/4 named test(s) red by assertion | 8286 ms
RED  auth-g1-blank-config | stub applied; 1/1 named test(s) red by assertion | 8251 ms
RED  auth-j1-https | stub applied; 1/1 named test(s) red by assertion | 8307 ms
RED  auth-j2-ttl | stub applied; 4/4 named test(s) red by assertion | 8226 ms
RED  auth-j3-refetch-window | stub applied; 1/1 named test(s) red by assertion | 8326 ms
RED  auth-j5-caps | stub applied; 3/3 named test(s) red by assertion | 8340 ms
RED  auth-j6-deadline | stub applied; 2/2 named test(s) red by assertion | 17086 ms
RED  auth-h1-duplicate | stub applied; 4/4 named test(s) red by assertion | 4010 ms
RED  auth-h3a-token-elsewhere | stub applied; 4/4 named test(s) red by assertion | 2256 ms
RED  auth-g2-prm | stub applied; 3/3 named test(s) red by assertion | 2184 ms
RED  auth-g4-http-refused | stub applied; 21/21 named test(s) red by assertion | 2232 ms
RED  manifest-schema | stub applied; 1/1 named test(s) red by assertion | 2059 ms
RED  manifest-generated-at | stub applied; 1/1 named test(s) red by assertion | 2041 ms
RED  manifest-tools-sorted | stub applied; 1/1 named test(s) red by assertion | 2065 ms
RED  manifest-hash-recomputes | stub applied; 1/1 named test(s) red by assertion | 2058 ms
RED  edition-config-schema | stub applied; 3/3 named test(s) red by assertion | 2130 ms
RED  pin-approve-needs-yes | stub applied; 1/1 named test(s) red by assertion | 1997 ms
RED  auth-g1-algs | stub applied; 1/1 named test(s) red by assertion | 8292 ms
RED  auth-g1-skew | stub applied; 1/1 named test(s) red by assertion | 8282 ms
RED  auth-g1-lifetime | stub applied; 1/1 named test(s) red by assertion | 5286 ms
RED  auth-j2-ttl-bounds | stub applied; 1/1 named test(s) red by assertion | 8273 ms
RED  auth-j3-shared-fetch | stub applied; 1/1 named test(s) red by assertion | 8350 ms
RED  auth-g5-ca-file | stub applied; 3/3 named test(s) red by assertion | 5252 ms
RED  auth-g5-audience-differs | stub applied; 1/1 named test(s) red by assertion | 5275 ms
RED  auth-g5-log-escaping | stub applied; 3/3 named test(s) red by assertion | 5243 ms
RED  auth-g5-decimal | stub applied; 1/1 named test(s) red by assertion | 5254 ms
RED  cage-o-nofollow | stub applied; 3/3 named test(s) red by assertion | 2459 ms
RED  cage-descriptor-recheck | stub applied; 1/1 named test(s) red by assertion | 2445 ms
RED  cage-backslash-drive | stub applied; 1/1 named test(s) red by assertion | 2442 ms
RED  cage-port-bounds | stub applied; 1/1 named test(s) red by assertion | 2437 ms
RED  cage-frozen | stub applied; 1/1 named test(s) red by assertion | 2449 ms
RED  domain-fs-nul-backslash | stub applied; 1/1 named test(s) red by assertion | 2453 ms
RED  domain-host-not-address | stub applied; 2/2 named test(s) red by assertion | 2453 ms
RED  domain-port-range | stub applied; 2/2 named test(s) red by assertion | 2460 ms
RED  harness-one-run | stub applied; 1/1 named test(s) red by assertion | 2415 ms
RED  harness-shim-counted | stub applied; 5/5 named test(s) red by assertion | 2447 ms
RED  harness-corpus-required | stub applied; 1/1 named test(s) red by assertion | 2454 ms
RED  canonical-nesting-cap | stub applied; 2/2 named test(s) red by assertion | 2056 ms
RED  canonical-data-members | stub applied; 1/1 named test(s) red by assertion | 2035 ms
RED  canonical-array-extra | stub applied; 1/1 named test(s) red by assertion | 2030 ms
RED  era-legacy-status-200 | stub applied; 6/6 named test(s) red by assertion | 3532 ms
RED  legacy-input-required | stub applied; 2/2 named test(s) red by assertion | 3505 ms
control-deletion: every stub made its named tests fail by assertion — 69 row(s), 463.3 s
```

## Adversarial pass (WO §5)

A fresh Opus subagent, in its own worktree at `9cb1930`, had the diff, the WO and the deletion README,
and none of my conclusions. It ran all 44 rows then new in one invocation: all RED by assertion after
a green baseline (17 files, 404 tests), 364.5 s. Its findings, and what was done:

1. **must-fix: batch refusal and the legacy `initialize` had no record.** Both were in my uncommitted
   FEEDBACK; it read the committed tree. It reproduced the batch layer by hand (120 pass, 1 fail,
   SH-9's regex). **Done:** both, and the other layered controls, are `{control, reason}` entries in
   `exempt.json`, which the detector reads. I did not take its proposal of a batch row red on the
   message only: a row must go red for its control, and a message is not the batch's control.
2. **must-fix: three files were listed with none of their tests named.** **Done:** rows for what they
   test (finding 1), `drift-refused` names the teaching test (finding 6), and the detector now refuses
   a listed file that proves nothing.
3. **must-fix: G5 was credited to a row that deletes one clause.** **Done:** a row per clause (CA file,
   audience line, sink escaping, decimal settings); G5's id stays on `refusal-audit-lines`.
4. **should-fix: G1's clauses, J2's TTL bound, J3's shared fetch.** **Done:** rows; G1's resource URL is
   a layer (*Read this first*). Its note that C4a's named bound test goes red on the edge, not the
   bound, is answered by `auth-g1-lifetime`, which names it for the bound.
5. **should-fix: two `edition-config-schema` names red on the message only.** **Done:** dropped; the
   row's control line says why.
6. **should-fix: the timeout tests cannot tell a configured value under 30 s apart.** Recorded
   (finding 2); a fix needs the seam the operator ruled out.
7. **should-fix: ST-2 and LG-8 had no row, and `sdk-client.test.ts`'s allowlist reason was wrong.**
   **Done:** `era-legacy-status-200`, `legacy-input-required`; the file moved into the first. LG-8's
   *state-only* test fails under its stub by a crash, not an assertion, so it is not named.
8. **should-fix: ways a control or file could drop out with the detector green.** **Done** for the
   parser cases (leading space, `partly built`, `**G6**`), the empty glob and the unproven file; each
   has a planted test. Not done: a sub-control inside a bundled §8 title, and whether a stub deletes
   what its row claims (stated under *The detector*).
9. **note: `json-lone-surrogate`'s raw clause had no test.** **Done:** `json.test.ts` gains *refuses a
   raw lone surrogate code unit, as a caller may hand in any string*, green on the tree and red under
   the stub; the row names it.
10. **note: rows it read as layered but unlabelled (H3, H4, H3a).** Checked by hand, and they are
    not: under `auth-h4-compact` the four-segment and 8 KiB tokens are *accepted* (`actual: true`); under
    `auth-h3-bearer` and `auth-h3a-token-elsewhere` the request is still refused, but with the status or
    error the check exists to give changed, which the client sees. The smaller untested clauses it
    named are in finding 4.
11. **note: process gaps.** The `CHECKS.md` map lives in `checks` (operator ruling); the Windows file is
    finding 7.

Confirmed fine by it: the seven old rows that gained `checks` each delete their check (apart from the
layers `CHECKS.md` already lists); `request-state-integrity`, `-expiry`, the `manifest-*` rows and
`pin-approve-needs-yes` let the refused input through.

## Gates

- `npm run check` on Node v24.21.0, on Furnace: lint, typecheck and build green; the detector 20 of
  20; core and teaching 941 of 942, the one failure being the canary (`warm=815ms` against its 900 ms:
  `-2008b` finding 3, `-2008d`'s); `check` stops there, so the later stages were run by hand: spike 0102
  69, spike 0101 8, `test:subset` 4. Core and teaching grew by three tests: the two receive-timeout
  tests and the raw-surrogate test.
- CI on `3b109a5` (run 46092903964): **every job green**, both `test` jobs included (942 tests, the
  detector 20 of 20, on Linux and Windows).
- `control-deletion --self-test`: passed, locally and on CI.
- Every new row: RED by assertion, in one invocation (*The rows*).
- Every shard on CI, at 307 rows and 16 shards (job wall time includes checkout, install and build):

  | shard | rows | CI runner | CI job |
  |---|---|---|---|
  | 1/16 | 20 | 157.8 s | 187 s (3 min 07 s) |
  | 2/16 | 20 | 105.3 s | 130 s (2 min 10 s) |
  | 3/16 | 20 | 153.9 s | 182 s (3 min 02 s) |
  | 4/16 | 19 | 142.7 s | 168 s (2 min 48 s) |
  | 5/16 | 19 | 140.5 s | 166 s (2 min 46 s) |
  | 6/16 | 19 | 104.8 s | 125 s (2 min 05 s) |
  | 7/16 | 19 | 118.8 s | 144 s (2 min 24 s) |
  | 8/16 | 19 | 116.0 s | 143 s (2 min 23 s) |
  | 9/16 | 19 | 109.0 s | 134 s (2 min 14 s) |
  | 10/16 | 19 | 130.7 s | 156 s (2 min 36 s) |
  | 11/16 | 19 | 126.5 s | 151 s (2 min 31 s) |
  | 12/16 | 19 | 109.8 s | 130 s (2 min 10 s) |
  | 13/16 | 19 | 88.8 s | 106 s (1 min 46 s) |
  | 14/16 (`validation-deadline`) | 19 | 165.9 s | 194 s (3 min 14 s) |
  | 15/16 (`request-timeout`) | 19 | 166.6 s | 186 s (3 min 06 s) |
  | 16/16 (`approval-listener-request-timeout`, `auth-j6-deadline`) | 19 | 218.9 s | 246 s (4 min 06 s) |

  At 14 shards and 282 rows (run 46088597495, `9cb1930`) every job was green and the slowest shard took
  249 s; the 25 rows added after the adversarial pass are why the count went to 16.
- Leak gate: `--self-test`, `--tree` and `--history` exited 0 on each pushed head, exit code checked;
  `dbb96d5` is not an ancestor.
- Reduction pass (diff): −10 net · 1 duplicate removed (the stalled-request reader both timeout tests
  carried, now `test/fixtures/stall.ts`) · 1 dead path removed (the `status` alias in both) · 0
  protected kept · 0 findings below.
- Protected surfaces, against `3332570`: `packages/*/src/**` diffs to empty (no seam was needed); the
  steering documents, the governance files, `.npmrc` and `.node-version` diff to empty;
  `scripts/control-deletion.mjs` diffs to empty; no existing stub or red-proof changed; `.github/**` is
  the shard number and its comment; `package.json` gains the detector at the head of `test`.

## Deliberately not built

- Rows for the seven controls in *Read this first* (no honest stub exists).
- A `connectionsCheckingInterval` seam (operator ruling; finding 2).
- Fetch-count assertions in the H9 tests (finding 3), per-clause ids in `CHECKS.md` and tests for the
  untested clauses (finding 4), and a test that tells a configured receive timeout from another under
  30 s (finding 2).
- Anything in `-1005c` or `-2008d`.

## Push

Two S25-minted tokens for `clearforgekey:clearseal-reference`, each spent only through
`~/bin/gh-write`: the first pushed `9cb1930` and was revoked straight after (`revoked (HTTP 204)`); the
second pushed `3b109a5` and this commit and opened the pull request, and was revoked after that. Every
commit's author and committer is `clearforgekey[bot]`'s noreply address.
