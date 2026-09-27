# FEEDBACK: CSR-WO-2008 (the control-deletion job)

Branch `wo/CSR-WO-2008`, cut from `main` at `03903ba` (the docs commit after `-1006a`'s merge at
`b5e1f92`). Parked as one unmerged pull request. Built on Node v24.21.0. **No control and no test
assertion changed.** The diff is `test/deletion/**`, `scripts/control-deletion.mjs`, one job in
`.github/workflows/ci.yml`, one root script, the changelog and this file.

## Read this first

- **45 rows, every one red by assertion under its stub, in about 3½ minutes of runner time.** The
  rows cover every *built* §8 row and every P1 exit-gate clause. Where a §8 row holds several
  controls, each control has its own row: the verifier has seven (audience, issuer, expiry,
  algorithm, signature, the RSA key rules, the outage `503`); the transport has the verdict gate and
  the challenge as two; and the three captured options are three. The first push had 28 rows. The
  adversarial passes named seventeen more built controls without one; seventeen rows were added,
  and the controls that could not be stubbed honestly are listed below with their reasons.
- **The adversarial passes found four real holes in the runner, all fixed with a crafted run each.**
  (1) An assertion in a `beforeEach`, or a failing todo, counted as red. (2) What a stub changed was
  read from its patch headers, so a binary, renamed or tab-suffixed hunk could hide a test edit.
  (3) Even read from `git status`, an ignored path (a shim under `node_modules/`, or behind a
  `.gitignore` the stub adds) was invisible. (4) An `AssertionError` thrown from source counted as
  the test's own assertion. See the adversarial section.
- **The runner's own three red-proofs pass** (`--self-test`, run first in CI): a stub that changes
  nothing, a stub that no longer applies, and a stub that breaks the build each fail the job, each
  for its own reason.
- **The runner proved itself on real rows while they were being written.** A first-cut stub that
  broke the build (TypeScript narrowed the rest of a function to `never`) was refused as "no
  longer builds", not counted red. Three first-cut named tests were dropped because they did not
  discriminate, and the runner's baseline and assertion checks are what showed it. See *Rows I
  could not stub honestly as first written*.
- **It is not a required check.** For the gate to require it (the job's check name is
  `control-deletion`), a repository administrator would run:

  ```sh
  gh api -X POST repos/ClearForge-LLC/clearseal-reference/branches/main/protection/required_status_checks/contexts \
    -f 'contexts[]=control-deletion'
  ```

## §3.2 The runner's full output (local, Node v24.21.0, 45 rows)

```
control-deletion: baseline green: 21 test file(s), 482 test(s) passed on the unpatched tree
RED  verify-before-register | Verify-before-register; drift and unpinned refused | stub applied; 1/1 named test(s) red by assertion | 3394 ms
RED  drift-refused | Verify-before-register; drift and unpinned refused | stub applied; 3/3 named test(s) red by assertion | 3307 ms
RED  unpinned-refused | Verify-before-register; drift and unpinned refused | stub applied; 1/1 named test(s) red by assertion | 3241 ms
RED  missing-manifest-refused | Verify-before-register; drift and unpinned refused | stub applied; 1/1 named test(s) red by assertion | 3342 ms
RED  admitted-freeze | Verify-before-register; drift and unpinned refused | stub applied; 1/1 named test(s) red by assertion | 3292 ms
RED  options-captured | Verify-before-register; drift and unpinned refused | stub applied; 1/1 named test(s) red by assertion | 3272 ms
RED  supply-boundary-control-exported | Verify-before-register; drift and unpinned refused | stub applied; 1/1 named test(s) red by assertion | 3971 ms
RED  supply-boundary-ungated-registry | Verify-before-register; drift and unpinned refused | stub applied; 1/1 named test(s) red by assertion | 3993 ms
RED  canonical-hash | Canonicalizer from a written spec, cross-language vectors | stub applied; 3/3 named test(s) red by assertion | 3295 ms
RED  subset-invariant | Ten-field pinned object; subset invariant | stub applied; 3/3 named test(s) red by assertion | 3181 ms
RED  enumeration-detector | Cross-repo enumeration detector | stub applied; 1/1 named test(s) red by assertion | 3238 ms
RED  exec-domain-refused | containment_domain as a sink set; exec refused a domain | stub applied; 1/1 named test(s) red by assertion | 3206 ms
RED  exec-tools-forbidden | containment_domain as a sink set; exec refused a domain | stub applied; 1/1 named test(s) red by assertion | 3225 ms
RED  cage-undeclared-reach | Reach harness | stub applied; 3/3 named test(s) red by assertion | 3674 ms
RED  read-only-mode | containment_domain as a sink set; exec refused a domain | stub applied; 1/1 named test(s) red by assertion | 3689 ms
RED  regular-file | Reach harness | stub applied; 3/3 named test(s) red by assertion | 3378 ms
RED  reach-harness-verdict | Reach harness | stub applied; 1/1 named test(s) red by assertion | 3639 ms
RED  handler-no-this | Reach harness | stub applied; 1/1 named test(s) red by assertion | 3321 ms
RED  cage-facade | Reach harness | stub applied; 1/1 named test(s) red by assertion | 3451 ms
RED  discover-versions | Stateless transport, owned, both eras, revision measured | stub applied; 1/1 named test(s) red by assertion | 3305 ms
RED  origin-check | Transport hardening (Origin/Host, body cap, timeouts, concurrency, batches, mirrored headers, x-mcp-header) | stub applied; 1/1 named test(s) red by assertion | 3688 ms
RED  host-check | Transport hardening (Origin/Host, body cap, timeouts, concurrency, batches, mirrored headers, x-mcp-header) | stub applied; 1/1 named test(s) red by assertion | 3648 ms
RED  body-cap | Transport hardening (Origin/Host, body cap, timeouts, concurrency, batches, mirrored headers, x-mcp-header) | stub applied; 2/2 named test(s) red by assertion | 4421 ms
RED  concurrency-cap | Transport hardening (Origin/Host, body cap, timeouts, concurrency, batches, mirrored headers, x-mcp-header) | stub applied; 1/1 named test(s) red by assertion | 3733 ms
RED  handler-timeout | Transport hardening (Origin/Host, body cap, timeouts, concurrency, batches, mirrored headers, x-mcp-header) | stub applied; 1/1 named test(s) red by assertion | 7246 ms
RED  mirrored-param-headers | Transport hardening (Origin/Host, body cap, timeouts, concurrency, batches, mirrored headers, x-mcp-header) | stub applied; 2/2 named test(s) red by assertion | 3408 ms
RED  running-config-frozen | Transport hardening (Origin/Host, body cap, timeouts, concurrency, batches, mirrored headers, x-mcp-header) | stub applied; 1/1 named test(s) red by assertion | 3349 ms
RED  schema-closed | Runtime input validation against the pinned schema; output size cap | stub applied; 2/2 named test(s) red by assertion | 3287 ms
RED  external-ref-refused | Runtime input validation against the pinned schema; output size cap | stub applied; 2/2 named test(s) red by assertion | 3351 ms
RED  output-cap | Runtime input validation against the pinned schema; output size cap | stub applied; 2/2 named test(s) red by assertion | 4373 ms
RED  verdict-gate | 401 + protected-resource metadata; audience-bound verify | stub applied; 2/2 named test(s) red by assertion | 3661 ms
RED  missing-token-challenge | 401 + protected-resource metadata; audience-bound verify | stub applied; 1/1 named test(s) red by assertion | 3482 ms
RED  audience-check | 401 + protected-resource metadata; audience-bound verify | stub applied; 2/2 named test(s) red by assertion | 9547 ms
RED  issuer-check | 401 + protected-resource metadata; audience-bound verify | stub applied; 2/2 named test(s) red by assertion | 9564 ms
RED  expiry-check | 401 + protected-resource metadata; audience-bound verify | stub applied; 1/1 named test(s) red by assertion | 9517 ms
RED  algorithm-check | 401 + protected-resource metadata; audience-bound verify | stub applied; 3/3 named test(s) red by assertion | 9681 ms
RED  signature-check | 401 + protected-resource metadata; audience-bound verify | stub applied; 2/2 named test(s) red by assertion | 9497 ms
RED  rsa-key-rules | 401 + protected-resource metadata; audience-bound verify | stub applied; 2/2 named test(s) red by assertion | 9555 ms
RED  outage-503 | 401 + protected-resource metadata; audience-bound verify | stub applied; 2/2 named test(s) red by assertion | 6531 ms
RED  state-key-captured | Verify-before-register; drift and unpinned refused | stub applied; 1/1 named test(s) red by assertion | 3289 ms
RED  server-info-captured | Verify-before-register; drift and unpinned refused | stub applied; 1/1 named test(s) red by assertion | 3304 ms
RED  registry-genuine-at-start | Verify-before-register; drift and unpinned refused | stub applied; 1/1 named test(s) red by assertion | 3314 ms
RED  mirrored-method-name | Transport hardening (Origin/Host, body cap, timeouts, concurrency, batches, mirrored headers, x-mcp-header) | stub applied; 2/2 named test(s) red by assertion | 3660 ms
RED  verifier-timeout | Transport hardening (Origin/Host, body cap, timeouts, concurrency, batches, mirrored headers, x-mcp-header) | stub applied; 1/1 named test(s) red by assertion | 9394 ms
RED  cage-net-svc | Reach harness | stub applied; 2/2 named test(s) red by assertion | 3660 ms
control-deletion: every stub made its named tests fail by assertion — 45 row(s), 216.8 s
```

## §3.3 The runner's own red-proofs

```
self-test ok   noop.json: exit 1; MISS red-proof-noop | red-proof of the runner itself | stub applied; "an edited description drifts the tool: refused, the rest admitted" stayed green | 3261 ms
self-test ok   stale.json: exit 1; MISS red-proof-stale | red-proof of the runner itself | stub stale.patch no longer applies: error: patch failed: packages/core/src/pinning/gate.ts:132 | 44 ms
self-test ok   breaks-the-build.json: exit 1; MISS red-proof-breaks-the-build | red-proof of the runner itself | stub applied, but the copy no longer builds, so no test failed by assertion: the build of packages/core failed: src/pinning/gate.ts(134,13): TS2322: Type 'string' is not assignable to type 'number'.  | 1630 ms
control-deletion: --self-test passed — a no-op stub, a stale stub and a build-breaking stub each fail the job
```

Each lives in `test/deletion/red-proofs/` as a one-row manifest and its patch, all against the
gate's drift check:

- (a) `noop.patch` edits a comment. The named drift test stays green, so the job fails:
  "stayed green".
- (b) `stale.patch` is the real drift stub with one context line changed to a line the file does
  not have. `git apply` refuses it, so the job fails and names the row: "no longer applies".
- (c) `breaks-the-build.patch` adds a type error. The copy no longer builds, so the job fails:
  "no longer builds, so no test failed by assertion".

A fourth kind, a test that fails but not by assertion, was demonstrated by a real row. The RSA
row's first cut named "exponents 3 and 65538 (even) and a 16384-bit modulus are never used; 65537
up to 8192 bits is". Under the stub it fails with a `TypeError` inside its own setup, not an
assertion, and the runner reported exactly that.

## §3.4 Wall-clock time on CI

The `control-deletion` job on `ubuntu-latest`, at `ec85bfb` (CI run 36279572373, 39 rows): **4 min
22 s** wall clock, from checkout to the last row (23:28:51 to 23:33:13 UTC). The runner reports 221.1 s
for the rows themselves:

```
control-deletion: --self-test passed — a no-op stub, a stale stub and a build-breaking stub each fail the job
control-deletion: baseline green: 20 test file(s), 458 test(s) passed on the unpatched tree
control-deletion: every stub made its named tests fail by assertion — 39 row(s), 221.1 s
```

The first run, at `ce67635` with 28 rows (CI run 36278810870), took 2 min 35 s. Its lines:

```
self-test ok   noop.json … stayed green | 2962 ms
self-test ok   stale.json … no longer applies: error: patch failed: packages/core/src/pinning/gate.ts:132 | 29 ms
self-test ok   breaks-the-build.json … no longer builds, so no test failed by assertion
control-deletion: --self-test passed — a no-op stub, a stale stub and a build-breaking stub each fail the job
control-deletion: baseline green: 18 test file(s), 413 test(s) passed on the unpatched tree
control-deletion: every stub made its named tests fail by assertion — 28 row(s), 120.0 s
```

Both are well inside the 15-minute stop in §7, so no split is proposed. Each row costs about 3 s,
because the copy is small and the core builds in about 1.5 s. The auth rows run the verifier suite
and take about 9 s each. A later phase's rows add roughly linearly.

In that run GitHub's TypeScript problem matcher turned the third self-test line, which quotes
tsc's `file(l,c): error TSnnnn` output, into an error annotation on a green job. The runner now
rewords that form in its own message.

## The manifest (§1.1)

| Row | §8 row | What the stub deletes | Named tests |
|---|---|---|---|
| `verify-before-register` | Verify-before-register; drift and unpinned refused | the PinnedRegistry constructor refuses anything but the gate's Admission | 1 |
| `registry-genuine-at-start` | Verify-before-register; drift and unpinned refused | a PinnedRegistry is genuine only if this class constructed it (its private brand); startTransport refuses anything else at run time | 1 |
| `drift-refused` | Verify-before-register; drift and unpinned refused | the gate refuses a definition whose hash differs from its pinned hash | 3 |
| `unpinned-refused` | Verify-before-register; drift and unpinned refused | the gate refuses a definition with no manifest entry | 1 |
| `missing-manifest-refused` | Verify-before-register; drift and unpinned refused | a node whose manifest cannot be read does not start, strict or not (N4) | 1 |
| `admitted-freeze` | Verify-before-register; drift and unpinned refused | every admitted tool is frozen, so nothing changes what tools/list serves after admission (CSR-WO-1006 §1.1) | 1 |
| `options-captured` | Verify-before-register; drift and unpinned refused | the request path reads the registry startTransport checked, not options.registry re-read (CSR-WO-1006 A1) | 1 |
| `state-key-captured` | Verify-before-register; drift and unpinned refused | the request path signs and opens state with a private copy of requestStateKey, not the caller's buffer (CSR-WO-1006 A1) | 1 |
| `server-info-captured` | Verify-before-register; drift and unpinned refused | the request path serves a frozen copy of serverInfo, not options.serverInfo re-read (CSR-WO-1006 A1) | 1 |
| `supply-boundary-control-exported` | Verify-before-register; drift and unpinned refused | the supply-boundary checker refuses an edition that exports a control (its checker is test code, not a test file) | 1 |
| `supply-boundary-ungated-registry` | Verify-before-register; drift and unpinned refused | the supply-boundary checker refuses an edition that serves a registry the gate did not build | 1 |
| `canonical-hash` | Canonicalizer from a written spec, cross-language vectors | members serialized in UTF-16 code-unit order (A1) | 3 |
| `subset-invariant` | Ten-field pinned object; subset invariant | every gate-read field is inside the canonical object tool_hash covers | 3 |
| `enumeration-detector` | Cross-repo enumeration detector | the detector goes red when the core's hashed set diverges from the standard's list (its logic lives in its test file, so the stub makes the watched set diverge) | 1 |
| `exec-domain-refused` | containment_domain as a sink set; exec refused a domain | an arbitrary_exec definition with a containment domain is refused at construction (N7) | 1 |
| `exec-tools-forbidden` | containment_domain as a sink set; exec refused a domain | every arbitrary_exec definition is refused while EXEC_TOOLS_FORBIDDEN is on (N7) | 1 |
| `cage-undeclared-reach` | Reach harness | the RecordingCage refuses an fs reach outside every declared root | 3 |
| `cage-net-svc` | Reach harness | the RecordingCage refuses a net reach to an undeclared host or port, and an undeclared service | 2 |
| `read-only-mode` | containment_domain as a sink set; exec refused a domain | a read_only tool's cage opens for reading only (CSR-WO-1002a) | 1 |
| `regular-file` | Reach harness | the cage opens regular files only, and never waits (CSR-WO-1006 §1.2) | 3 |
| `reach-harness-verdict` | Reach harness | the reach harness fails a tool whose observed fs reach is outside its declared domain | 1 |
| `handler-no-this` | Reach harness | dispatch calls a handler with no this, so it cannot build a cage from its own tool (CSR-WO-1006a §1.1) | 1 |
| `cage-facade` | Reach harness | a handler's ctx.cage is a frozen facade over dispatch's cage (CSR-WO-1006a D-1) | 1 |
| `discover-versions` | Stateless transport, owned, both eras, revision measured | server/discover answers exactly the recorded protocol pair | 1 |
| `origin-check` | Transport hardening (Origin/Host, body cap, timeouts, concurrency, batches, mirrored headers, x-mcp-header) | a request whose Origin is not allowed is refused 403 | 1 |
| `host-check` | Transport hardening (Origin/Host, body cap, timeouts, concurrency, batches, mirrored headers, x-mcp-header) | a request whose Host is not allowed is refused 403 | 1 |
| `body-cap` | Transport hardening (Origin/Host, body cap, timeouts, concurrency, batches, mirrored headers, x-mcp-header) | a body over maxBodyBytes is refused 413 | 2 |
| `concurrency-cap` | Transport hardening (Origin/Host, body cap, timeouts, concurrency, batches, mirrored headers, x-mcp-header) | a request past maxInFlight is refused 503 with Retry-After | 1 |
| `handler-timeout` | Transport hardening (Origin/Host, body cap, timeouts, concurrency, batches, mirrored headers, x-mcp-header) | a handler past handlerTimeoutMs is ended at the configured deadline (the stub stretches it 30-fold: deleting it outright hangs the test, which is correctly not an assertion) | 1 |
| `verifier-timeout` | Transport hardening (Origin/Host, body cap, timeouts, concurrency, batches, mirrored headers, x-mcp-header) | a verifier that never answers is cut off at verifierTimeoutMs with 503 (the stub stretches it 30-fold: deleting it hangs, which is not an assertion) | 1 |
| `mirrored-method-name` | Transport hardening (Origin/Host, body cap, timeouts, concurrency, batches, mirrored headers, x-mcp-header) | an Mcp-Method or Mcp-Name header that disagrees with the body is refused 400 -32020 (SH-24) | 2 |
| `mirrored-param-headers` | Transport hardening (Origin/Host, body cap, timeouts, concurrency, batches, mirrored headers, x-mcp-header) | an Mcp-Param-* header that is missing or disagrees with the body is refused 400 -32020 | 2 |
| `running-config-frozen` | Transport hardening (Origin/Host, body cap, timeouts, concurrency, batches, mirrored headers, x-mcp-header) | the running transport config is a deep-frozen snapshot (CSR-WO-1006a §1.2) | 1 |
| `schema-closed` | Runtime input validation against the pinned schema; output size cap | a schema that does not decide is validated with unevaluatedProperties: false, so an extra property is refused before the handler | 2 |
| `external-ref-refused` | Runtime input validation against the pinned schema; output size cap | an inputSchema $ref or $dynamicRef outside its own document is refused at registration | 2 |
| `output-cap` | Runtime input validation against the pinned schema; output size cap | a result over maxResultBytes is not sent | 2 |
| `verdict-gate` | 401 + protected-resource metadata; audience-bound verify | the transport dispatches only on the verifier's ok verdict; a missing or failed token is refused 401 | 2 |
| `missing-token-challenge` | 401 + protected-resource metadata; audience-bound verify | an unauthenticated request gets 401 with WWW-Authenticate naming the protected-resource metadata | 1 |
| `audience-check` | 401 + protected-resource metadata; audience-bound verify | a token whose aud is not this resource is refused (C3) | 2 |
| `issuer-check` | 401 + protected-resource metadata; audience-bound verify | a token from another issuer is refused (C2) | 2 |
| `expiry-check` | 401 + protected-resource metadata; audience-bound verify | an expired token is refused (C4: exp is compared with the clock, less the skew) | 1 |
| `algorithm-check` | 401 + protected-resource metadata; audience-bound verify | alg none, HS*, and algorithms off the allow-list are refused (H6) | 3 |
| `signature-check` | 401 + protected-resource metadata; audience-bound verify | a token whose signature does not verify under a served key is refused (K3) | 2 |
| `rsa-key-rules` | 401 + protected-resource metadata; audience-bound verify | an RSA key is used only with an odd exponent of at least 65537 and a 2048 to 8192 bit modulus (red-team F3) | 2 |
| `outage-503` | 401 + protected-resource metadata; audience-bound verify | an unreachable key set answers 503 with Retry-After and no challenge, not 401 (CSR-WO-1003a §1.1) | 2 |

**Why JSON, not TypeScript.** The manifest is data the runner reads, and a reviewer reads it as a
list. JSON cannot run code at load, the runner (a plain `.mjs` script with JSDoc types) parses it
with no build step, and it checks every field's shape itself (ids, non-empty lists, test files
ending `.test.ts`), so it gains nothing from `.ts` types.

**Each stub is the smallest edit that deletes the control's decision, in the control's own
file.** It keeps the tree building and changes one condition, return or line: for example the
drift branch removed, `#inside` always true, `rsaKeyUsable` accepting any key, the handler called
as a method again. The `missing-manifest-refused` stub is the worst version of that control's
absence: a node whose manifest cannot be read approves its own definitions and starts. Where the
`-1000` to `-1006a` FEEDBACK matrices had a mutant for the control, the stub reuses it. The
freezes, the options capture, the handler and facade, the regular-file rule, A9's neighbour and
the frozen config are the `-1006`/`-1006a` mutants.

## The runner (§1.2), and how "by assertion" is told apart

- **The copy.** The runner copies the tracked files (`git ls-files`, read from the working tree,
  so in CI exactly the commit under test) into `$TMPDIR/clearseal-deletion-base-*`. It makes the
  copy its own git repository and commits it there as a base, so `git apply` resolves every path
  inside it, and `git status` afterwards says exactly what a stub changed. It links third-party
  modules from the real `node_modules`, recreates the `@clearseal/*` workspace links inside the
  copy (they are relative, so they resolve to the copy's packages, never the real ones), and builds
  `core` and `teaching`. Each row gets a fresh copy of that base. The stub is applied, and the copy
  is rebuilt if the stub touched a package's `src`. Every child process leads its own process
  group. On SIGINT, SIGTERM or SIGHUP the runner kills those groups and removes every temporary
  directory (measured: 0 copies left after each signal mid-run). The run is asynchronous, so a
  signal is handled between steps and does not wait for the whole job.
- **The baseline.** The unpatched copy must pass every row's tests first: every file runs at least
  one test, nothing fails, is skipped or is todo, and every named test is present exactly once.
  Otherwise the job fails before any stub runs.
- **"By assertion".** The runner file is also the `node --test` reporter it passes (its default
  export). For every finished test it records the outcome, the `failureType`, and whether the
  failure's cause is an `AssertionError` (`code: 'ERR_ASSERTION'`). A named test counts as red only
  if it failed as a `testCodeFailure` whose cause is an assertion, and is not todo. The other
  outcomes are misses, each named:
  - a `TypeError` or any other thrown error (`testCodeFailure` with another cause);
  - a `testTimeoutFailure`;
  - an assertion in a `beforeEach` hook (reported as `hookFailed`), or a failing todo (both carry an
    assertion cause, and the first cut would have counted them);
  - a skip or todo, which Node reports as a pass;
  - a file that no longer loads, so its named test never appears ("did not run");
  - a stub that breaks the TypeScript build, refused before any test runs.
- **What a stub may touch.** Only the files its row lists under `touches`, and at load every such
  file must be a package's source (`packages/*/src/**`) or one of two named test-code controls
  (the supply-boundary checker's `supply-boundary.ts` and `supply-boundary-child.ts`). Never a
  `*.test.ts` file, a file of its own row's tests, or anything under `test/deletion/`. It is checked
  against what the stub **actually changed**, read from `git status` in the copy, so a binary patch,
  a rename or a tab-suffixed header cannot hide a file. A row's test files must be under
  `packages/` and exist.
- **What RED proves.** That the named assertions flipped under the stub, on a tree where they
  passed without it. That the stub deletes exactly the control on its row, and not something else
  that trips the same assertion (a changed message, a control made to crash), is the review of the
  stub. The README says so.

## Rows I could not stub honestly as first written

- **The enumeration detector.** Its logic (`unexpectedDifferences`) lives inside its test file, and
  a stub may not edit a test file. The row therefore proves the detector by making what it watches
  diverge: the stub drops `description` from the canonical object, so the core's hashed set no
  longer matches the standard's list. `description` is not gate-read, so the subset row's tests
  stay green under this stub, and the two rows discriminate from each other.
- **Verify-before-register:** the first named test, "a raw definition list is refused by the
  constructor's type and at run time", stays green with the run-time brand check deleted. Iterating
  a definition list as an admission throws a `TypeError` anyway. Its compile-time half is a
  `@ts-expect-error`, which the typecheck proves, not this job. The row names only the forged-
  Admission test, which does discriminate.
- **The cage's undeclared-reach refusal:** the first named test, "records every reach, allowed or
  refused, …", exercises only the net and service refusals, not the fs check the stub removes. It
  was replaced by the fs tests (`..`, the 10,000-entry domain, the null-domain tool).
- **The RSA key rules:** see §3.3. The row names the e=1 forgery and the 1024-bit key.
- **The handler timeout:** deleting the deadline outright makes the named test hang until its own
  timeout, which the runner correctly counts as not an assertion. The stub stretches the deadline
  30-fold instead, and the test's timing assertion catches it. Its `control` line says so.
- **Expiry:** the first cut of the stub removed the whole `exp` check, and TypeScript then refused to
  build (`exp` became `unknown`). The runner refused that stub as "no longer builds". The row now
  deletes only the clock comparison and names the expired-token test.
- **The RSA key rules, one at a time:** stubbing only the odd-exponent rule, or only the 8192-bit
  maximum, makes the named test throw inside its own setup rather than fail an assertion. The
  runner reported both correctly, so the combined row stands and the single-rule rows were dropped.
- **Not stubbed, with the reason:**
  - **"a legacy `initialize` never yields a session header"** (in the stateless-transport §8
    row). The control is the absence of a behaviour. A stub would have to add a session header in
    `server.ts`, not delete a check, and that tests the test, not a control. The row's other
    half, the recorded version pair, is a row.
  - **Batch refusal** (`SH-9`). Deleting the `Array.isArray` refusal leaves the next line
    (`isPlainObject`) refusing the same body with the same `400 -32600`, so no test can tell the
    difference. It is defence in depth, and a deletion that changes nothing observable proves
    nothing.
  - **`O_NONBLOCK` alone** (`-1006`'s M7). Without it the swapped-FIFO open waits, and the test
    ends by its own timeout, which is correctly not an assertion. The regular-file row stubs the
    type check instead.
  - **Twelve of the supply-boundary checker's fifteen-odd rules.** Two rows (an exported control,
    and a registry the gate did not build) prove the job can see the checker. The checker's other
    rules each have their own planted red-proof in `supply-boundary.test.ts`. A row per rule is a
    follow-up, not a gap in what the job can prove.
  - **The 2 s off-loop validation deadline.** Like the handler timeout, deleting it hangs rather
    than asserts. Unlike it, no test asserts its timing, so a stretched deadline would pass. Adding
    a timing assertion is a test change this WO does not make: a follow-up for the WO that next
    touches validation.
- **No test name changed** (§2 allowed one where a row needed it; none did).

## Adversarial pass (three fresh subagents, WO §5; each in its own worktree, since removed)

The first two subagents were each stopped by a safety classifier partway through. Neither ran its
crafted manifests, and each returned leads from reading the code. I ran every lead myself as a
crafted manifest, with a private `TMPDIR`, and fixed what held. The third subagent, briefed as a
robustness review, ran its checks and found two more holes, which I reproduced and fixed. Every
row below was run: the operation that matters is a crafted manifest through the runner, and then
`git status` in the real tree and a count of the copies left in `TMPDIR`.

| ID | Attempt | What happened | Outcome | Severity | Disposition |
|---|---|---|---|---|---|
| R1 | An assertion thrown in a `beforeEach` hook, and a failing `todo` test, named in a row | Both carry an assertion cause (`hookFailed`, and `testCodeFailure` with `todo: true`), and the first cut checked the cause alone: **counted red** | **HOLE** | medium | **Fixed:** red requires `failureType === "testCodeFailure"`, not todo. Measured with a scratch test through the runner's own reporter |
| R2 | Stubs that edit a test file through a **binary** hunk, a **tab-suffixed** `+++` header, and a **rename** | The first cut read paths from `---`/`+++` headers only | **HOLE** | high | **Fixed:** changed files are read from git (below). All three now `stub refused: … changed a test file` |
| R3 (review V2) | A comment edit to the control's file, plus a **shim under the ignored `packages/core/node_modules/z-schema/`** that makes validation pass; and a nested `.gitignore` (`*`) hiding a new source file | `git status` does not list ignored paths: the shim row read **RED 2/2** and the hidden file was not refused | **HOLE** | medium | **Fixed:** the runner also takes the paths from `git apply --numstat`, git's own parse of the patch (the same parser the apply uses), which names ignored paths. Both now `stub refused`, naming every shim file and the `.gitignore` |
| R4 (review V3) | A source file throws `Error` renamed `AssertionError` instead of doing its job | Counted as the test's assertion: **RED 2/2** without the test's own check running | **HOLE** | low–medium | **Fixed:** the reporter records the first stack frame outside Node, and the runner requires it under `packages/*/test/`. Now `failed by an assertion thrown outside test code (packages/core/src/transport/schema.ts)`. The 45 real rows still go red: their assertions, including those in shared helpers, are thrown from test code |
| R5 | Patches with `../` paths, an absolute path, a write through the `node_modules` symlink, and into `.git/` | `git apply` refuses `..`, a path beyond a symlink, and `.git/`; the absolute path lands inside the copy and is refused by `touches` | HELD | — | — |
| R6 | A row whose `touches` names a test helper; a row whose `tests` lie outside `packages/` | Refused at load | HELD (after a fix) | — | The first cut accepted any `touches`. Now only `packages/*/src/**` and the two named checker files are allowed |
| R7 | A named test that is skipped, never runs, sits in a file that runs zero tests, is duplicated across the row's files, or is registered by source under the same name | Baseline refuses skip, todo, zero-test files and duplicates. A same-named test registered from source is attributed to the source file, so it is "did not run" | HELD | — | — |
| R8 | Forged reporter lines written to the parent's stdout from source | `ENXIO`: the parent's stdout is a socket | HELD | — | — |
| R9 | SIGINT, SIGTERM and SIGHUP mid-run | The first cut was synchronous, so a signal waited for the whole job, and SIGHUP had no handler | **HOLE** | low | **Fixed:** asynchronous children, each leading its own process group. Measured: 0 copies and 0 test processes left after each signal |
| R10 | Does the copy's edition load the copy's core? | The drift stub, run against the teaching edition's P1 exit test (which starts a node through `@clearseal/core` `dist`), went red | HELD | — | — |
| R11 (review I2) | Code running in the copy (a stub, or a test) writing through `realpath` of the symlinked `node_modules`, or to `$HOME` | It lands in the real tree: the copy isolates the source, not the process | limit | low | **Stated** in the runner's header and the README. Stubs are reviewed code. A sandbox (copying `node_modules`, or an OS-level jail) would cost more than the job's other run time together |
| R12 (review V1) | A stub that only changes an error message the named test matches | RED | limit | info | **Stated:** RED means the named assertions flipped. That the stub deletes the control is the review of the stub against its `control` line |
| R13 | Coverage: built controls with no row | The first push lacked: the version pair, the concurrency cap, the handler and verifier timeouts, `Mcp-Method`/`Mcp-Name` and `Mcp-Param-*` mirroring, the external `$ref` refusal, the output cap, the verdict gate, issuer, expiry, algorithm, `EXEC_TOOLS_FORBIDDEN`, the run-time `isGenuine` check, the state-key and `serverInfo` captures, and the cage's net and service checks | GAP | medium | **Added: 17 rows.** The rest are in *Rows I could not stub honestly* |
| R14 | Weak rows: the stub goes red without the control being wholly gone | `external-ref-refused` is red on the refusal's message (the validator refuses an external `$ref` too, as defence in depth). `algorithm-check` is red on the check's own reason code (a later check still refuses). `handler-timeout` and `verifier-timeout` stretch rather than delete. `enumeration-detector` makes what it watches diverge | noted | low | **Stated** in each row's `control` line where it applies. The reason-code rows are what the verifier's matrix is built on: each check proves it is the one that refused |

**What held, plainly.** Nothing ever touched the real tree during the runs, and no copy was left
behind. The runner told red from green, skipped, not-run and crashed on every row built to test
it. Its remaining limits are stated rather than closed: what patched code does at run time, and
what the review of each stub is for.


## Gates

- `npm run check` exits 0 from a clean state (every `dist/` removed first): 604 core and teaching
  tests, spike 0102 69, spike 0101 8, `test:subset` 4. The runner is linted and type-checked with
  the repository's other scripts.
- `node scripts/leak-gate.mjs --tree` exit 0; `--history` exit 0, run unpiped before every push
  with the exit code checked directly.
- CI: green on both runners and the `control-deletion` job at `ec85bfb` (39 rows: 4 min 22 s); the
  head's run, with 45 rows, is in the pull request.
- Protected surfaces diff to empty against `03903ba`: nothing under `packages/`, `spikes/` or
  `docs/`, and no other workflow job. `.github/workflows/ci.yml` gains exactly the one job, with its
  actions pinned by SHA as the rest are.
- The minted token lived in a mode-0600 scratch file, was never written to git config or a remote
  URL, and was deleted after the pull request was opened.

## What was not built

- Rows for controls not yet built (approval, audit, ceiling, provenance, rate limit): their WOs add
  them, under the rule in `test/deletion/README.md`.
- Making the job required (the gate's decision; the command is above).
- A general mutation-testing tool.
