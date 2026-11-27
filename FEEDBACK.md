# FEEDBACK: CSR-WO-0002b (the dependency bot's npm backlog)

Branch `wo/CSR-WO-0002b`, cut from `main` at `b7a1f62` (contains `6f442fd`). Built on Node v24.21.0,
npm 11.19.0. Parked as one unmerged pull request; the bot's #81 was not touched.

## Read this first

- **Shard 2 failed because the fixture lost its cost, not because the control broke.** z-schema
  12.7.0 changed `uniqueItems` on arrays of objects from pair-by-pair to by-key comparison. The old
  `costly_schema` input fell from about 15 s to about 22 ms uncapped, validated inside 300 ms, and
  answered 200. The deadline in `schema-pool.ts` still fires: the new fixture is abandoned at about
  330 ms with 400 -32602 and a `validation-timeout` audit. §7's first condition is not met.
- **Three tests were broken, not one.** Under 12.8.0 the old fixture also failed
  `era-status.test.ts` (*validation over validationTimeoutMs*, `[200, null]`) and `corrections.test.ts`
  (*closing while a validation is in flight*, `200`). CI never showed them: lint failed first in
  `npm run check`, and no control-deletion baseline that ran lists those files.
- **z-schema has two costs per schema, and the fixture is sized for the cheaper one (for your
  ruling).** z-schema 12.8 validates a schema's first call by building a full report. Later calls go
  through a fast path that builds none, about 19× cheaper.
  - My first fixture (200 branches) was costly only on that first call. Warm, it validated in about
    250 ms, under the deadline, and a worker that had validated `costly_schema` once turned F2 into a
    200 again. The independent reviewer found this, and I reproduced it end to end.
  - The fixture now has 1,500 branches: about 1.9–2.1 s warm and about 37 s cold on 12.8.0.
  - The ceiling is near. 1,503 of `maxSchemaNodes`' 2,000 subschemas are used, and 1,990 branches
    would give only about 2.8 s warm. If CI's warm margin proves thin, §7's second condition applies.
  - z-schema 12.4.6 has no fast path at all: every call there takes about 77 s at this size.
- **There is no control-deletion row for the validation deadline.** No row in
  `test/deletion/controls.json` touches `schema-pool.ts`. The F2 test runs in shard 2 only because
  the `verifier-timeout` row lists `adversarial.test.ts`, and the baseline runs that whole file. §2's
  "show it with `--row`" cannot be done, and `test/deletion/**` is protected, so I added no row. The
  substitute evidence is under *§2*.
  - **Proposal for a follow-up WO:** a `validation-deadline` row listing `adversarial.test.ts`,
    `era-status.test.ts` and `corrections.test.ts`.
  - Its stub must take the timer **past the cold cost** (×1,000 here). The 30-fold stretch the
    `handler-timeout` and `verifier-timeout` rows use leaves F2 green: it answered 400 at 9,034 ms,
    because F2 asserts the 400 but not that it comes near the deadline.
  - That is a second follow-up: F2 could assert `call` is near `validationTimeoutMs`. I left it alone,
    because assertions are fenced here.
- **SDK 1.32.2 serves exactly what 1.30.1 served.** The re-probe matches the architecture's §2.3 row
  value for value, so §7's third condition is not met.

## Gates

- `npm run check` exits 0 on Node v24.21.0. Core and teaching: **939** tests in 61 files (`main`:
  938 in 60; the +1 is `costly-schema.test.ts`). Spike 0102: 69 (`main` 69). Spike 0101: 8 (8).
  `test:subset`: 4 (4).
- `control-deletion --self-test` passes: the no-op, stale and build-breaking stubs each fail the job.
- `control-deletion --shard i/4`, locally on the final fixture, each with a green baseline before any
  stub and every row red by assertion:

  | shard | rows | baseline | time | head |
  |---|---|---|---|---|
  | 1/4 | 60 | 28 files, 626 tests | 316.3 s | `b15bea5` |
  | 2/4 | 59 | 31 files, 629 tests | 332.6 s | `b15bea5` |
  | 3/4 | 59 | 31 files, 641 tests | 330.3 s | `39ffcb7` (rerun, see below) |
  | 4/4 | 59 | 29 files, 689 tests | 344.7 s | `b15bea5` |

  That covers all 237 rows. `39ffcb7` differs from `b15bea5` only in a comment in `tools.ts`, and
  `npm run check` was rerun on it. **Shard 3's first run at `b15bea5` failed its baseline** on
  `limits.test.ts` *in-flight returns to 0 and heap growth stays small*, with
  `heap grew 17460744 bytes` against its 16 MiB bound. I measured it; it is not a leak and not the
  fixture:
  - **The test runs without `--expose-gc`**, so its `gc()` calls do nothing and it measures unswept
    heap.
  - **Bimodal and fixture-independent.** Run alone, the reading falls in one of two modes, about
    8.7–9 MB or about 11.7 MB, under all three fixture versions (the 1,500-branch, the 200-branch and
    main's `uniqueItems`).
  - **The bump shifts the mode.** On main's lockfile the 9 MB mode is usual, with one 12,037 KiB
    outlier; with z-schema 12.8.0 swapped in, the 11.7 MB mode is usual. The 17 MB came under the
    shard's parallel baseline load.
  - **Nothing is retained.** With `--expose-gc`, growth is 1,099–1,107 KiB on the branch and
    1,041–1,126 KiB on `main`.
  - **For the architect:** this is a pre-existing measurement that the bump makes likelier to trip,
    on CI too. The fix is `--expose-gc` for that file or a retained-heap measure, and either one
    touches protected `scripts/**` or a fenced test.
  - The earlier full shard run on the 200-branch fixture (`967111e`) passed all four shards: 315.9,
    334.6, 329.2 and 342.7 s.

- `node scripts/leak-gate.mjs --self-test`, `--tree` and `--history` exit 0 before the push.
- Reduction pass (diff): −3 net lines · 1 duplicate removed (the cold/fast-path explanation lived in
  both `tools.ts` and the canary; `tools.ts` now cites the canary) · 0 dead paths removed · 0
  protected kept · 2 findings under *Known* (the input built four times, the repeated 300 ms literal).
- CI on the pull request: see *CI*.

## §1.1 Versions

`fa8dc08` (#81's head commit) was cherry-picked unchanged; its author is `dependabot[bot]` and the
committer is the builder role identity. `npm install` on Node v24.21.0 regenerated a byte-identical
lockfile. After §1.6, the five `package.json` files still diff to empty against `fa8dc08`.

## §1.2 Lint

`verifier.test.ts:104`: `.jwk as never` → `.jwk`. No suppression and no config change.

## §1.3 Shard 2, measured

(a) The F2 test alone, three runs per version, with the old fixture. Only the `z-schema` package
directory was swapped: every version from 12.4.6 to 12.9.0 declares the same three dependency ranges.

| z-schema | `VALIDATION-DEADLINE` line (3 runs) |
|---|---|
| 12.4.6 | `status=400 code=-32602 call=335ms` · `337ms` · `337ms` |
| 12.5.0 | `status=400 code=-32602 call=337ms` · `337ms` · `339ms` |
| 12.6.0 | `status=400 code=-32602 call=338ms` · `336ms` · `335ms` |
| 12.6.1 | `status=400 code=-32602 call=344ms` · `336ms` · `338ms` |
| **12.7.0** | **`status=200 code=undefined call=123ms`** · `121ms` · `120ms` |
| 12.8.0 | `status=200 code=undefined call=125ms` · `123ms` · `123ms` |

Health stayed at 3–4 ms throughout. **The release that changed it is 12.7.0**, whose changelog lists
under *Performance Improvements*:

> **validation:** speed up uniqueItems on large arrays of objects ([#569](https://github.com/zaggino/z-schema/issues/569)) ([fedf376](https://github.com/zaggino/z-schema/commit/fedf37623c8750ecbe00efbd03c4ae55f4caa78e))

The source agrees: `src/utils/array.ts` in 12.7.0 adds `isUniqueByKey`, which keys each item, above
`PAIRWISE_MAX_ITEMS = 32`, in place of the O(n²) pairwise loop. The old fixture validated the
20,000-item input uncapped (cold) in:

| z-schema | uncapped, cold |
|---|---|
| 12.4.6 | 15,067 ms |
| 12.6.1 | 15,331 ms |
| 12.7.0 | 22 ms |
| 12.8.0 | 22 ms |

(b) The new fixture. `costly_schema`'s `tags` is now `items: { oneOf: [1,500 branches] }`. Branch 0
is `{ required: ["k"] }`; branches 1–1,499 are `{ required: ["k", "m<j>"] }`.
- **Why it cannot be shortcut.** The tests' unchanged input, `{ k: i }` × 20,000, matches exactly one
  branch, so a validator must try every branch to know that only one matched. The cost is items ×
  branches, with no pairwise structure to key away.
- **Size and limits.** 1,503 subschemas against `maxSchemaNodes` 2,000, at depth 3 against
  `maxSchemaDepth` 32; about 39 KB served in `tools/list`. Compiling it takes about 30 ms.
- **The input is valid** (200 when uncapped), so a 400 from the deadline tests can only be the
  deadline: under `breakOnFirstError: true`, invalid arguments also answer 400 -32602.
- **Validation time, both paths**, on the main thread through `prepareTool` + `compileSchema`, with
  the registry's `unevaluatedProperties: false` added. "Warm" means after a one-item call:

  | z-schema | cold (first call) | warm (fast path) | warm × 300 ms |
  |---|---|---|---|
  | 12.4.6 (main's lockfile, `npm ci`) | — (no fast path) | 77,019 / 78,514 ms | ≈ 260× |
  | 12.8.0 (this branch) | 37,258 ms | 1,881–2,064 ms | ≈ 6–7× |
  | 12.9.0 (the bot's next) | — | 2,357 ms | ≈ 8× |

  For reference, the 200-branch shape I first built was 4.7 s cold but 234–265 ms warm. The F2
  deadline test is the first call in a fresh worker, so on 12.8.0 its worker is cut off at 300 ms
  partway through the 37 s cold path either way.
- **Measured on the CI runners:** see *CI*. The new `costly-schema.test.ts` warms the validator with
  one item and then logs `COSTLY-SCHEMA warm=… z-schema=… platform=…` on every `test` job. It fails if
  the input stops being valid or the warm time falls under 3 × 300 ms. A future validator speed-up
  then fails as itself, not as a 200 that reads like a broken control. No control-deletion row lists
  that file, so stub reruns do not pay its ~2 s.
- **The manifest** was regenerated through
  `npm run pin -- approve --yes --definitions packages/core/test/fixtures/tools.ts --manifest packages/core/test/fixtures/manifest.json`.
  `costly_schema` is now `a821e168d9a2`; the other 12 tools are unchanged, and `pin verify` admits 13.
- **Unchanged tests.** The tests' inputs, titles and assertions are untouched. F2's title still says
  "a quadratic validation"; the cost is now items × branches, so the title is stale, but a title
  change is a test change.

(c) Does not apply: the deadline fires.

## §2: the deadline turns the tests red (substitute for `--row`)

There is no row (see *Read this first*), so I applied by hand, on a committed tree, the stub such a
row would need, then reverted it:

```diff
--- a/packages/core/src/transport/schema-pool.ts
+++ b/packages/core/src/transport/schema-pool.ts
@@ -104,7 +104,7 @@ export class ValidationPool {
-      }, this.#options.timeoutMs);
+      }, this.#options.timeoutMs * 1000);
```

```
adversarial.test.ts F2:  VALIDATION-DEADLINE status=200 code=undefined call=39920ms health=4ms
                         AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: actual: 200, expected: 400
era-status.test.ts:      validation over validationTimeoutMs: actual [ 200, null ] (fail 1, 39.6 s)
```

Both are red by assertion. The same file stretched only 30-fold leaves F2 green
(`status=400 code=-32602 call=9034ms`), which is why the proposed row needs the larger factor.
`git checkout -- packages/core/src` restored the file each time, and `packages/*/src/**` diffs to
empty.

**The reviewer's scenario, end to end** (a scratch test, not committed). On the 300 ms server, one
one-item `costly_schema` call per worker, then F2's input:

| fixture | `validationWorkers` 1 | `validationWorkers` 2 |
|---|---|---|
| 1,500 branches (this branch) | `status=400 code=-32602 call=325ms audit=true` | `status=400 code=-32602 call=318ms audit=true` |
| 200 branches (my first fixture) | `status=200 call=308ms audit=false` | `status=200 call=277ms audit=false` |

On main's 12.4.6 lockfile, the 1,500-branch fixture gives `400 … 340ms` and `400 … 319ms`.

## §1.5 SDK 1.30.1 → 1.32.2, for this repository's surface

Releases in range: 1.31.0 (2026-09-28), 1.32.0 (10-02), 1.32.1 (10-05, docs only), 1.32.2 (10-23).

Checked on disk by comparing the two installed `dist/esm` trees:
- byte-identical: `types.js`, `server/index.js`, `server/streamableHttp.js`, `client/index.js`;
- changed: `client/streamableHttp.js`, `shared/protocol.js`, `server/auth/middleware/bearerAuth.js`;
- the SDK's own `package.json` differs only in `version`, so no dependency range moved.

**Re-probe** (`node spikes/0100-protocol/probe.ts`, SDK 1.32.2) printed all 53 findings. They match
the architecture's §2.3 row for 1.30.1 value for value:
- `LATEST_PROTOCOL_VERSION` is 2025-11-25.
- `SUPPORTED_PROTOCOL_VERSIONS` is 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07.
- `DEFAULT_NEGOTIATED_PROTOCOL_VERSION` is 2025-03-26.
- `initialize` echoes any supported revision. Offered `2026-07-28` or an unknown one, it answers 200
  and counter-offers 2025-11-25.
- A header outside the list gets 400 -32000, and that check runs before dispatch.
- **`server/discover` answers HTTP 200 with -32601 "Method not found"**, with or without a header.
- The server is stateless: no `mcp-session-id` is set, and a client-supplied one is ignored.

Neither `server/discover` nor `2026-07-28` appears in 1.32.2's dist. Its README says v1.x will not
implement 2026-07-28, which is planned for v2 (#2942). Our own server's pair is asserted by
`eras.test.ts` (*server/discover answers supportedVersions = the architecture's set*), which is green,
and the `discover-versions` row turns red under its stub.

A 1.30.1 re-run from a scratch tree failed on a path lookup unrelated to the SDK. The comparison is
therefore against the recorded row, not a fresh 1.30.1 run.

| Surface | 1.31 / 1.32 change | Covered here? |
|---|---|---|
| Stateless Streamable HTTP server | None: `server/streamableHttp.js` is byte-identical. The session-scoping in `shared/protocol.js` runs only when `sessionId !== undefined`. | The spike probe (`session.*`); our core does not use the SDK server |
| Protocol revisions, `server/discover` | None (above) | The probe; `eras.test.ts`; the `discover-versions` row |
| MRTR, elicitation, sampling | None in shipped code: a diff of `dist/esm` without examples has no changed line matching `_meta\|elicit\|sampling\|createMessage\|protocolVersion`. The SDK has no MRTR. | Our MRTR is our own code (`sdk-client` and transport tests); the SDK client sees it as an ordinary result |
| `_meta` | None (same diff) | `era-status.test.ts` `_meta` rows; `sdk-client.test.ts` |
| OAuth / bearer | 1.31.0 #2888: stored tokens carry an `issuer` and are dropped on mismatch; `expectedIssuer` is expected on `ClientCredentialsProvider` / `PrivateKeyJwtProvider`. 1.32.0 #2930: opt-in `requireBearerAuth({ expectedResource })`. 1.32.0 #2902: OAuth follows same-origin redirects only. | Not used: `sdk-client.test.ts` sends a static `Authorization` header with no `authProvider`, and our verifier is our own (`packages/core/src/auth/**`) |
| Client redirects | 1.32.0 #2902: `StreamableHTTPClientTransport` follows same-origin redirects only (`redirect: 'manual'` on the GET) | `sdk-client.test.ts` is green; our server never redirects |
| `McpServer` | #2927 `maxToolInputElements` (off by default); #2045 missing `arguments` becomes `{}`; #2958 register after `connect()` | Not imported (the spike uses the low-level `Server`) |

The five advisories in the window:

| Advisory | Severity | Fixed in | Component | Here |
|---|---|---|---|---|
| GHSA-6qxp-vccf-f47h: OAuth client could send credentials to an authorization server chosen by the MCP server | high | 1.31.0 | client OAuth | not used |
| GHSA-rvq5-wwqv-78pq: bearer auth accepted tokens issued for another service | medium | 1.32.0 (opt-in `expectedResource`) | `requireBearerAuth` | not imported |
| GHSA-22jm-h49p-29qw: experimental tasks not tied to their session | high | 1.32.0 | `taskStore` in `shared/protocol` | imported transitively; no `taskStore` is used |
| GHSA-6prh-2h8m-c8cw: client transports and OAuth followed cross-origin redirects, re-sending headers | medium | 1.32.0 | `StreamableHTTPClientTransport`, OAuth | the client transport is imported by `sdk-client.test.ts`; nothing redirects |
| GHSA-46jr-4wx8-v453: one request within 4 MiB could exhaust memory in validation | high | 1.32.0 (opt-in `maxToolInputElements`) | `McpServer` argument validation | not imported; the bump gives the spike's `Server` no protection |

For the architect's §2.3 update: the served revisions did not move. The *Served protocol revisions*
row's "`z-schema` 12.4.6" is now 12.8.0.

## §1.6 Transitive advisories

`npm update body-parser zod hono @hono/node-server fast-uri qs ip-address`. The lockfile changed
for exactly those seven and nothing else, and no `package.json` moved:

| Package | From | To |
|---|---|---|
| @hono/node-server | 2.1.1 | 2.1.11 |
| body-parser | 2.3.0 | 2.4.0 |
| fast-uri | 3.1.8 | 3.1.9 |
| hono | 4.13.9 | 4.13.23 |
| ip-address | 10.7.2 | 10.7.6 |
| qs | 6.16.0 | 6.17.1 |
| zod | 4.6.5 | 4.6.7 |

The sdk-client typecheck passes with zod 4.6.7 (in `npm run check`).

`npm audit` before (after §1.1):

```
@hono/node-server  1.19.10 - 2.1.5      moderate  GHSA-rmxm-3fg6-px4f, GHSA-qv5m-9pm6-hqp3, GHSA-jpvv-r467-5p4w
body-parser  2.0.0 - 2.3.0              high      GHSA-27r3-jxmh-p828
fast-uri  3.0.0 - 3.1.8                 moderate  GHSA-w74x-v6f9-j3xg, GHSA-xhq7-xmqj-769h, GHSA-wjr9-j795-jxcr, GHSA-333x-w4r6-6crp
hono  <=4.13.15                         moderate  GHSA-5r4p-p66f-jhc7, GHSA-4m76-xfj5-7975, GHSA-h7mg-cq63-vhpq, GHSA-3gg2-335m-rxc6, GHSA-46wx-v44x-9hh2, GHSA-4h7h-rv7c-7m2v
ip-address  <=10.7.3                    moderate  GHSA-rxp7-6hxx-x8q5
qs  6.7.0 - 6.16.0                      moderate  GHSA-6pq8-jhm2-2vcw
zod  <4.6.6                             high      GHSA-mrhx-c7xc-m3w5
7 vulnerabilities (5 moderate, 2 high) — each "fix available via `npm audit fix`"
```

`npm audit` after:

```
found 0 vulnerabilities
```

## Adversarial pass (WO §5)

1. **Slow only on the builder's machine.** CI's `COSTLY-SCHEMA` and `VALIDATION-DEADLINE` lines for
   both runners are under *CI*.
2. **Slow for a reason other than validation.** The body is the same 20,000-item input as before,
   and the schema compiles at registration (about 30 ms), not per call. A one-branch schema over the
   same input validates in 18 ms. F2 still asserts `s.audits.includes("validation-timeout")`, and it
   passes.
3. **With the 12.4.6 lockfile.** I used a scratch tree of `main` with its own `npm ci` (z-schema
   12.4.6, SDK 1.30.1) and the new `tools.ts`, `manifest.json` and `costly-schema.test.ts`:
   - F2: `status=400 code=-32602 call=332ms` · `334ms` · `334ms`;
   - era-status and close-in-flight pass;
   - the canary passes at `warm=77019ms`;
   - the warm-worker scenario answers 400.

   The fixture does not depend on the validator version.

## Review

A fresh reviewer subagent attacked the diff independently, with no access to my conclusions.

- **Blocking, now fixed: the fixture was slow only cold.** See *Read this first* and *§2*. The fix is
  1,500 branches and a canary that times the warm path. I reproduced the finding before changing
  anything (warm 234–265 ms; the warm-worker scenario answered 200).
- **Should-fix, fixed: the canary claimed more margin than it measured.** It now warms first, and
  this file reports both paths.
- **Nits it raised, left as known:** the stale F2 title, and `schema.ts:2` (both below).
- **Attacks that found nothing.** Each was checked with measurements:
  - input validity, cold and warm;
  - `unevaluatedProperties: false`, which makes no difference;
  - `breakOnFirstError`: no early exit in `oneOf`;
  - `anyOf` or dedup shortcuts: none, and the branches are distinct;
  - the cost sitting elsewhere (parse, transport, compile);
  - the schema limits;
  - Windows path resolution of the z-schema `package.json`;
  - deletion rows listing the new file: none do;
  - the lockfile scope, the protected surfaces and the identities and trailers;
  - the leak gate.

## Known, and not in scope (with the reason)

- `packages/core/src/transport/schema.ts:2` still reads "the one pinned validator: z-schema 12.4.6".
  `packages/*/src/**` is protected, so it is for the architect to conform.
- No validation-deadline deletion row, and F2 does not bound the call's duration (see *Read this
  first*). Both are follow-up WOs, since `test/deletion/**` and test assertions are fenced here.
- The fixture's margin has a ceiling under `maxSchemaNodes` (see *Read this first*).
- The heap-growth test in `limits.test.ts` measures without a forced GC, so it can trip under load
  (see *Gates*).
- Every shard takes over five minutes, the point at which `ci.yml`'s comment says to raise
  `CONTROL_DELETION_SHARDS`. It is outside this WO, since `.github/**` is protected.
- z-schema 12.9.0 is out (2026-11-26). Per §1.1 I did not chase it; the fixture holds under it at
  2,357 ms warm.
- The 20,000-item input is now built in four places: the three deadline tests and the canary. The
  canary's `DEADLINE_MS = 300` repeats the tests' literal. Folding them into one would change fenced
  tests, so it is reported, not done (reduction-pass finding).

## Push

Pushed over the repository's SSH deploy key, no token. `node scripts/leak-gate.mjs --self-test`,
`--tree` and `--history` exited 0 on the pushed head, run unpiped with the exit code checked, before
each push.

## CI

CI-LINE
