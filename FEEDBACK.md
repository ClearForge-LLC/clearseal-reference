# FEEDBACK: CSR-WO-1007 (the core owns node assembly; the checker holds under aliasing; P1 evidence covers containment)

Branch `wo/CSR-WO-1007`, cut from `main` at `ea93fd8` (the docs commit after `-2008`'s merge at
`290077a`). Parked as one unmerged pull request. Built on Node v24.21.0.

## Read this first

- **All five items are built, each with a red-proof and a control-deletion row.**
  - `startNode` owns assembly.
  - The teaching edition exports three values, and its `bin/` calls `startNode` with them.
  - The checker's rules hold under aliasing: the H1 plant and fourteen variants each turn it red.
  - The P1 evidence audits every refusal and gains a containment clause.
  - L2 is closed.
- **One route remains, named in the WO as deferred, and stated here plainly:** the `Function`
  constructor reached through `.constructor`. `(() => 0).constructor("return process")()` passes
  the checker and returns `process` at run time (measured), and from `process` the H1 route
  follows. The WO fences it to the P2 hardening WO with C7 and H7. It is not an aliasing gap: it
  compiles code from a string, which no reading of the source can see. The checker's header now
  says so.
- **One flag for the steering documents, which are protected here.** Architecture §5 *Where OS
  primitives live* still lists "a deploy scaffold" among what an edition may export. After this
  WO, the deploy scaffold is `bin/` and its configuration, not an export. The executable form
  (`KINDS` in the checker) no longer has a `deploy-scaffold` kind, and its test says why. The
  sentence in §5 (and §3's "Editions are thin" line) is the architect's to reword.
- **Three consequences of "an edition reads nothing from the process", each a choice.**
  - `TEACHING_NOTES_ROOT` and `TEACHING_MANIFEST` are gone. The root is pinned in the committed
    definitions and manifest, and moving it is a code change and a re-approval; an unknown
    `TEACHING_` variable refuses start, so setting either now refuses too. Tests build the
    edition's definitions for a temporary root, write a manifest for them, and call the same
    `startNode`.
  - The transport settings keep their `TEACHING_*` names, but the core reads them. The edition's
    `configSchema` names its variables' prefix (`x-clearseal-env-prefix`) and which variable
    carries each setting (`x-clearseal-setting`: `host`, `port`, `resource-url`), so the core
    never guesses a name.
  - `bin/` installs no signal handlers (no `process`). A teaching node stops on SIGINT as any
    Node process does, without a graceful close of its transport.
- **The edition needed no core value but `startNode`, so §7's stop did not apply.** `notes.ts`
  imported `DEFAULT_LIMITS` only for the 256 KiB note cap. It now states the number, and the
  transport's own result cap refuses a larger result whatever it says. `startNode` needed no
  change to the gate, the registry's construction or the transport: it builds `PinGate` and
  `PinnedRegistry` directly and calls `startTransport`.
- **A node now reports the core's identity** (`serverInfo` `clearseal-node` and the core's
  version), not `@clearseal/teaching`. An edition passes nothing but its three values, so it cannot
  claim one.

## §3.2 The H1 plant and each variant, red, with the checker's message

`supply-boundary.test.ts` (the export-undeclared lines each plant also produces are left out):

```
PLANTED h1
src/index.ts: process-referenced: process: an edition reads nothing from the process; the core reads the configuration and starts the node
src/index.ts: import-meta: import.meta: an edition uses it only as new URL(<literal>, import.meta.url)
PLANTED h1-parenthesized
src/index.ts: process-referenced: process: an edition reads nothing from the process; the core reads the configuration and starts the node
PLANTED h1-alias
src/index.ts: process-referenced: process: an edition reads nothing from the process; the core reads the configuration and starts the node
PLANTED h1-destructured
src/index.ts: process-referenced: process: an edition reads nothing from the process; the core reads the configuration and starts the node
PLANTED h1-computed
src/index.ts: process-referenced: process: an edition reads nothing from the process; the core reads the configuration and starts the node
PLANTED h1-meta
src/index.ts: import-meta: import.meta: an edition uses it only as new URL(<literal>, import.meta.url)
PLANTED h1-meta-url
src/index.ts: import-meta: import.meta: an edition uses it only as new URL(<literal>, import.meta.url)
PLANTED h1-type-namespace
src/index.ts: core-namespace-access: core.PinGate: an edition reads nothing from the core's namespace
PLANTED h1-type-value
src/index.ts: type-import-as-value: G: imported from the core as a type, used as a value
PLANTED h1-startnode-src
src/index.ts: core-import: startNode: an edition imports only types from the core, and startNode in bin/
PLANTED h1-manifest-climb
src/index.ts: manifest-url: new URL("../../../../../../../../etc/self-approved.json", import.meta.url) names ../../../../../../../etc/self-approved.json: the one URL an edition builds is its committed manifest, a .json file in the repository's pins/
PLANTED h1-manifest-other
src/index.ts: manifest-url: new URL("../../../../fixtures/manifest.json", import.meta.url) names ../../../fixtures/manifest.json: the one URL an edition builds is its committed manifest, a .json file in the repository's pins/
PLANTED h1-manifest-export
./src/index.ts: kind-mismatch: export manifestPath: declared manifest-path, but it is not the committed manifest, a .json file in the repository's pins/
PLANTED h1-startnode-bin
bin/node.ts: start-node-call: startNode: startNode is called once, as startNode({ definitions, manifestPath, configSchema }), and never passed around
bin/node.ts: start-node-call: startNode: startNode is called once, as startNode({ definitions, manifestPath, configSchema }), and never passed around
```

The plant (`H1` in the test) is the red-team's route, kept inside a function so the export check,
which loads the entry, never starts a server:
- it reaches `node:module` through `process.getBuiltinModule`;
- it `createRequire`s the core;
- it builds a manifest for its own unpinned tool with `buildManifest`;
- it admits the tool through a real `PinGate`;
- it builds a `PinnedRegistry` and calls `startTransport`.

The checker names the first two steps. Everything after them needs `process` or `import.meta`,
which rule (b) refuses outright.

## §3.3 `p1-exit.test.ts`, one line per clause

```
EXIT | unauthenticated returns 401 with resource_metadata | 401 WWW-Authenticate: Bearer resource_metadata="https://mcp.example.invalid/.well-known/oauth-protected-resource/mcp"
EXIT | a token with a different audience also returns 401 | 401 error="invalid_token"
EXIT | N4: a failed signature refuses | 401 invalid_token
EXIT | a valid token lists notes.read and reads a note | tools/list ["notes.read"]; notes.read today.md → 200
EXIT | a hand-edited description leaves that tool absent from tools/list on restart | PIN_STRICT=false: tools/list [], audit pin-refused drifted; default: start refused (PinRefusedError)
EXIT | N4: a missing manifest or an unpinned tool refuses to start | missing: ManifestError; unpinned: PinRefusedError
EXIT | a forged Origin and an extra request property are each refused before any handler runs, each with its audit line | teaching node: forged Origin → 403, extra property → 400; counting node: forged Origin → 403, extra property → 400; handler runs during both refusals: 0 (a valid call: 1); teaching node audit: http-refused 403 origin-not-allowed, rpc-refused -32602
EXIT | containment: an escape by name, by link and by FIFO is refused, each with its audit line | "../outside.md" → 400 (the pinned schema, before the cage; rpc-refused); a planted link → 500 containment-refused; a FIFO → 500 containment-refused fileType fifo, in 2 ms
EXIT | N3: every gate-read field is in the hash, and the subset test can go red | packages/core/test/pinning/subset.test.ts: test: 1 file(s), 4 test(s) passed
EXIT | every committed cross-language vector hashes identically in the core | packages/core/test/pinning/vectors.test.ts: test: 1 file(s), 71 test(s) passed
EXIT | the enumeration detector goes red when a local copy of the standard's field list is edited | packages/core/test/pinning/spec-check.test.ts: test: 1 file(s), 2 test(s) passed
EXIT | the supply-boundary test exists and goes red on a planted edition-side control, the red-team's H1 plant and each of its aliasing variants | packages/core/test/boundary/supply-boundary.test.ts: test: 1 file(s), 38 test(s) passed; H1 plant and variants red: 14
```

The containment clause, in one sentence each:
- **A name that climbs out** (`../outside.md`) is refused at the pinned schema, before the cage:
  `400` with an `rpc-refused` line. `notes.read`'s name pattern forbids a separator, so no name can
  reach the cage with a climb in it.
- **The cage refusals** are proven by a symlink planted in the root and a FIFO: each `500` with a
  `containment-refused` line, the FIFO in 2 ms, never waited on. On Windows a FIFO cannot be made,
  and the link case stands.

## §3.4 L2, now refused

```
L2 NODE_TLS_REJECT_UNAUTHORIZED=0, an untrusted issuer's token → ok false, reason jwks-unavailable (the TLS handshake refused its certificate)
L2 AUTH_JWKS_URL with user:password@ → JwksConfigError: AUTH_JWKS_URL must not carry a user name or password
```

Before the fix, the same test goes red: with `rejectUnauthorized` left to Node's default, which
reads `NODE_TLS_REJECT_UNAUTHORIZED`, the impostor issuer's key set was fetched and its token
verified. That is the `jwks-reject-unauthorized` control-deletion row. The userinfo URLs in the
test are assembled at run time, because the leak gate refuses a literal one (it did, on the first
push attempt, which is how that was found).

## `startNode`'s refusals (`packages/core/test/node/start.test.ts`)

```
STARTNODE a relative path: ManifestError: the manifest path must be absolute, or a file: URL
STARTNODE a data: URL: ManifestError: the manifest path is a data: URL: a node reads its committed manifest from a file
STARTNODE an https: URL: ManifestError: the manifest path is a https: URL: a node reads its committed manifest from a file
STARTNODE a directory: ManifestError: the manifest is not a regular file: a node reads its committed manifest from a regular file
STARTNODE a missing file: ManifestError: the manifest cannot be read (ENOENT): a node without a manifest does not start
STARTNODE a symbolic link to the real manifest (a link is followed by nothing): ManifestError: the manifest cannot be read (ELOOP): a node without a manifest does not start
STARTNODE a link on the way, not at the leaf (a symlinked directory): ManifestError: the manifest's path passes through a symbolic link: a node reads its committed manifest from a path with no link on the way
STARTNODE a FIFO (never waited on): ManifestError: the manifest is not a regular file: a node reads its committed manifest from a regular file
STARTNODE an unpinned tool: PinRefusedError: the pin gate refused 1 tool(s): extra (unpinned); PIN_STRICT is on, so the node does not start
STARTNODE a drifted tool: PinRefusedError: the pin gate refused 1 tool(s): echo (drifted); PIN_STRICT is on, so the node does not start
STARTNODE an unknown variable: the configuration does not match its schema: SNT_COLOUR, SNT_RESOURCE_URL
STARTNODE a schema without its prefix: the configuration schema names its variables' prefix in "x-clearseal-env-prefix" (upper case, ending in _)
STARTNODE a schema without a resource URL: the configuration schema names no resource-url variable: a node does not start without its protected-resource URL
STARTNODE the committed file's tools: tools/list ["echo"], serverInfo {"name":"clearseal-node","version":"0.0.0"}
```

## Variants the checker cannot catch honestly

- **`Function` through `.constructor`** (`(() => 0).constructor`, `[].constructor.constructor`, an
  async function's prototype's `constructor`): accepted, and it reaches `process` at run time.
  Known, deferred to P2 by the WO, stated in the checker's header.
- **Accepted but harmless, each run to show it reaches nothing:**
  - `this` at module scope is `undefined` in an ES module.
  - `setTimeout("…")` throws, because Node does not evaluate a string callback.
  - `Error.prepareStackTrace` with `getThis()` gives `undefined` for every frame (strict code).
  - `String.raw` and other tags only build strings.
  - `WebAssembly` has no host access without imports JavaScript supplies.
  - A JSON import is data.

## Red-proofs and control-deletion rows (N5)

Seventeen new rows. One `-2008` row, `supply-boundary-ungated-registry`, was retired: the rule it
stubbed is gone, because an edition can no longer import `startTransport` at all, and
`boundary-core-imports` proves what replaced it. The job now has 61 rows. Its output for the new
rows:

```
RED  startnode-committed-file | Verify-before-register; drift and unpinned refused | stub applied; 1/1 named test(s) red by assertion | 3343 ms
RED  startnode-regular-file | Verify-before-register; drift and unpinned refused | stub applied; 1/1 named test(s) red by assertion | 3432 ms
RED  startnode-no-follow | Verify-before-register; drift and unpinned refused | stub applied; 1/1 named test(s) red by assertion | 3464 ms
RED  startnode-file-scheme | Verify-before-register; drift and unpinned refused | stub applied; 1/1 named test(s) red by assertion | 3361 ms
RED  startnode-no-link-on-the-way | Verify-before-register; drift and unpinned refused | stub applied; 1/1 named test(s) red by assertion | 3443 ms
RED  boundary-core-imports | Verify-before-register; drift and unpinned refused | stub applied; 2/2 named test(s) red by assertion | 6191 ms
RED  boundary-startnode-bin-only | Verify-before-register; drift and unpinned refused | stub applied; 1/1 named test(s) red by assertion | 6106 ms
RED  boundary-startnode-call | Verify-before-register; drift and unpinned refused | stub applied; 1/1 named test(s) red by assertion | 6148 ms
RED  boundary-process | Verify-before-register; drift and unpinned refused | stub applied; 5/5 named test(s) red by assertion | 6153 ms
RED  boundary-import-meta | Verify-before-register; drift and unpinned refused | stub applied; 2/2 named test(s) red by assertion | 6143 ms
RED  boundary-namespace-access | Verify-before-register; drift and unpinned refused | stub applied; 1/1 named test(s) red by assertion | 6166 ms
RED  boundary-type-as-value | Verify-before-register; drift and unpinned refused | stub applied; 1/1 named test(s) red by assertion | 6101 ms
RED  boundary-manifest-url | Verify-before-register; drift and unpinned refused | stub applied; 2/2 named test(s) red by assertion | 6125 ms
RED  boundary-manifest-export | Verify-before-register; drift and unpinned refused | stub applied; 1/1 named test(s) red by assertion | 6098 ms
RED  jwks-reject-unauthorized | 401 + protected-resource metadata; audience-bound verify | stub applied; 1/1 named test(s) red by assertion | 3256 ms
RED  jwks-no-credentials | 401 + protected-resource metadata; audience-bound verify | stub applied; 1/1 named test(s) red by assertion | 3241 ms
RED  refusal-audit-lines | Transport hardening (Origin/Host, body cap, timeouts, concurrency, batches, mirrored headers, x-mcp-header) | stub applied; 1/1 named test(s) red by assertion | 10014 ms
```

The whole job, with the self-test first:

```
control-deletion: baseline green: 24 test file(s), 518 test(s) passed on the unpatched tree
control-deletion: every stub made its named tests fail by assertion — 61 row(s), 305.2 s
```

The job earned its keep during this WO:
- **Three stale stubs.** After the adversarial-pass fixes changed `start.ts` and the checker,
  three stubs stopped applying, and the job named each. They were regenerated, not deleted.
- **A crashing stub refused.** The first regenerated import-meta stub crashed the checker instead
  of deleting its rule, and the job refused it as "not by assertion".
- **A test race found.** Its baseline caught one: the supply-boundary suite runs both directly and
  as a child of the P1 evidence test, and the two runs deleted each other's scratch plants. Each
  run now plants into its own directory.

## Adversarial pass (WO §5)

The fresh subagent was stopped by a safety classifier before it wrote a single planted edition,
which is also what happened to two of the three `-2008` passes. It returned leads from reading the
code. I ran every §5 attempt myself, as planted editions through `checkSource` and `checkEdition`,
and as real `startNode` calls, and ran the accepted forms to see what they reach.

| ID | Attempt | Outcome | Severity | Disposition |
|---|---|---|---|---|
| X1 | `globalThis.process`, `global.process`, indirect `eval`, `require`, `createRequire` from `node:module`, dynamic `import()`, `import.meta.resolve` | Caught (`forbidden-global`, `builtin-forbidden`, `dynamic-import`, `import-meta`) | — | — |
| X2 | A default import of the core, `export * from` the core, `import type` + `typeof X`, a relative climb into `node_modules/@clearseal/core/dist` | Caught (`core-import`, `core-reexport`, `type-import-as-value`, `import-outside-exports`) | — | — |
| X3 | **`new URL(<literal>, import.meta.url)` with a literal that climbs out of the edition, or names another JSON file** (the allowed form accepted any literal) | Accepted: an edition could name a self-written manifest anywhere in the tree | **HOLE** | medium | **Fixed:** the literal must resolve to a `.json` in the repository's `pins/` (`manifest-url`). The export check holds the exported `manifestPath` to the same rule. Rows `boundary-manifest-url`, `boundary-manifest-export` |
| X4 | **A symlinked directory on the way to the manifest** (`O_NOFOLLOW` covers the leaf only) | `startNode` read the file through it | **HOLE** | low | **Fixed:** the descriptor's real path must equal the path named (on Linux from `/proc/self/fd`, so a swap between check and read is caught too). Row `startnode-no-link-on-the-way`. Windows keeps the leaf `lstat` only, as stated |
| X5 | A manifest path that is relative, a `data:` or `https:` URL, a directory, a FIFO, missing, a leaf symlink | All refused before the gate, none waited on | HELD | — | — |
| X6 | `Function` through `.constructor` | Accepted; reaches `process` | KNOWN-DEFERRED | — | P2, per the WO's scope fence |
| X7 | `this`, `setTimeout` with a string, `String.raw`, `WebAssembly`, `Error.prepareStackTrace`, a JSON import | Accepted; each reaches nothing | harmless | — | Listed above |
| X8 | A hard link to another manifest, placed in `pins/` | Not detectable by path | limit | low | A hard link is a file in `pins/` like any other; `pins/` is reviewed and committed, and `pin approve` is how a file gets there. Stated |

## Gates

- `npm run check` exits 0 from a clean state (every `dist/` removed first): 626 core and teaching
  tests, spike 0102 69, spike 0101 8, `test:subset` 4.
- `control-deletion`: 61 rows, all red by assertion; `--self-test` passes; no copy left behind.
- `node scripts/leak-gate.mjs --tree` exit 0; `--history` exit 0, run unpiped before every push
  with the exit code checked directly.
- CI: the pull request's checks, on both runners, with `control-deletion`.
- Protected surfaces diff to empty against `ea93fd8`: the steering documents, `spikes/`, the
  canonical form, `pinning/gate.ts`, `manifest.ts`, `canonical.ts`, `registry.ts`, `capability/`,
  `containment/`, `auth/verifier.ts`, `auth/jws.ts` and `transport/`. The source changes are the new
  `node/start.ts`, one export line in `index.ts`, and `auth/jwks.ts`.
- The minted token lived in a mode-0600 scratch file, was never written to git config or a remote
  URL, and was deleted after the pull request was opened.

## What was not built

- An in-process sandbox for editions, and the deferred supply-side routes (C7, H7, `Function` via
  `.constructor`): the P2 hardening WO.
- The rewording of architecture §5 (protected; flagged above).
- `typ` defaults (L3) and hard links (L1): unchanged, as the WO fences.
