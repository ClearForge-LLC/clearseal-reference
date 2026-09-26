# FEEDBACK: CSR-WO-1004 (the teaching edition's skeleton, its first tool, its manifest, and the supply-boundary test)

Branch `wo/CSR-WO-1004`, cut from `main` at `fcb415f`, one commit. Parked as one unmerged pull
request. Built on Node v24.21.0. **This WO carries the P1 exit gate.**

## Read this first: the Windows measurement (WO §1.3)

`windows-latest`, measured by CI on this branch (`notes.test.ts`, the `WINDOWS-MEASURE` lines):

```
WINDOWS-MEASURE platform=win32 root=/tmp/clearseal-teaching-01c6d3d8c265/notes read today.md: 200 text returned
WINDOWS-MEASURE platform=win32 refused names: "../outside.md" → 400; "/tmp/…/no → 400; "/etc/passwd" → 400; "a\u0000.md" → 400; "..\\outside.md" → 400; "aaaa…(65).md" → 400; "today" → 400; ".hidden.md" → 400; "TODAY.md" → 400; 5 → 400
WINDOWS-MEASURE platform=win32 planted symlink read: 200 {"result":{"content":[{"type":"text","text":"SECRET OUTSIDE THE ROOT\n"}] …
```

- **What runs honestly on Windows:** the notes root is a POSIX-style path (`/tmp/…`), which Windows
  maps to a directory on the current drive, so the `fs:` grammar (POSIX-only, upstream entry 13)
  can declare it without widening. `notes.read` reads a note there, and every hostile name is
  refused by the pinned schema before the handler runs, exactly as on Linux. The P1 evidence test
  passes there in full.
- **What does not hold on Windows, measured:** the runner could create a symlink, and **a link
  planted in the notes root let `notes.read` return a file outside the root** (`200`, the outside
  text). On Linux the same case is refused by the cage (`500`, a `containment-refused` line). This
  is the core's in-process cage's stated Windows limit (architecture §5 *Containment matching*: it
  compares paths lexically there and resolves no links; the edition's OS cage is the boundary). The
  test asserts the refusal on POSIX, where the cage makes the claim, and on Windows asserts the known
  outcome as measured, so a change in it is seen (adversarial A12).
- **Decision (mine, for the architect to confirm or overrule):** the file tests run on Windows, with
  the link case measured and recorded rather than asserted. I did not flag-and-stop, because the
  reads and refusals run honestly there; but **a teaching node run on Windows with the core's cage
  is not contained against a link someone with write access puts in its notes root.** See
  *Decision-needed*.

## §3.4 `curl -i` against a started teaching node

A node started by the edition's `start()` from the environment alone (`TEACHING_*`, `AUTH_*`), with
the core's in-process test issuer on loopback HTTPS trusted through `AUTH_JWKS_CA_FILE`. Tokens elided.

```
$ curl -i -X POST http://127.0.0.1:<port>/mcp   # no Authorization
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Content-Length: 66
Cache-Control: no-store
X-Content-Type-Options: nosniff
WWW-Authenticate: Bearer resource_metadata="https://mcp.example.invalid/.well-known/oauth-protected-resource/mcp"

{"jsonrpc":"2.0","error":{"code":-32600,"message":"Unauthorized"}}

$ curl -i -X POST http://127.0.0.1:<port>/mcp -H "Authorization: Bearer <token, aud another.example.invalid>"
HTTP/1.1 401 Unauthorized
Content-Type: application/json
Content-Length: 66
Cache-Control: no-store
X-Content-Type-Options: nosniff
WWW-Authenticate: Bearer resource_metadata="https://mcp.example.invalid/.well-known/oauth-protected-resource/mcp", error="invalid_token"

{"jsonrpc":"2.0","error":{"code":-32600,"message":"Unauthorized"}}

$ curl -i -X POST http://127.0.0.1:<port>/mcp -H "Authorization: Bearer <valid token>"   # notes.read today.md
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 212
Cache-Control: no-store
X-Content-Type-Options: nosniff

{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"Water the plants.\n"}],"resultType":"complete","_meta":{"io.modelcontextprotocol/serverInfo":{"name":"@clearseal/teaching","version":"0.0.0"}}}}
```

The audit seam for the same run: `auth-refused {"reason":"missing"}`, `auth-refused {"reason":"aud"}`.

## §3.3 The P1 exit gate, as one test (`packages/teaching/test/p1-exit.test.ts`)

Every clause of the roadmap's P1 exit gate, each naming its sentence. The node clauses run against a
real teaching node started by the edition's scaffold; the core-property clauses run the core's own
suites, each of which carries its red case.

```
EXIT | unauthenticated returns 401 with resource_metadata | 401 WWW-Authenticate: Bearer resource_metadata="https://mcp.example.invalid/.well-known/oauth-protected-resource/mcp"
EXIT | a token with a different audience also returns 401 | 401 error="invalid_token"
EXIT | N4: a failed signature refuses | 401 invalid_token
EXIT | a valid token lists notes.read and reads a note | tools/list ["notes.read"]; notes.read today.md → 200
EXIT | a hand-edited description leaves that tool absent from tools/list on restart | PIN_STRICT=false: tools/list [], audit pin-refused drifted; default: start refused (PinRefusedError)
EXIT | N4: a missing manifest or an unpinned tool refuses to start | missing: ManifestError; unpinned: PinRefusedError
EXIT | a forged Origin and an extra request property are each refused before any handler runs | teaching node: forged Origin → 403, extra property → 400; counting node: forged Origin → 403, extra property → 400; handler runs during both refusals: 0 (a valid call: 1)
EXIT | N3: every gate-read field is in the hash, and the subset test can go red | packages/core/test/pinning/subset.test.ts: test: 1 file(s), 4 test(s) passed
EXIT | every committed cross-language vector hashes identically in the core | packages/core/test/pinning/vectors.test.ts: test: 1 file(s), 71 test(s) passed
EXIT | the enumeration detector goes red when a local copy of the standard's field list is edited | packages/core/test/pinning/spec-check.test.ts: test: 1 file(s), 2 test(s) passed
EXIT | the supply-boundary test exists and goes red on a planted edition-side control | packages/core/test/boundary/supply-boundary.test.ts: test: 1 file(s), 24 test(s) passed
```

- **"refused before any handler runs"** is proven by a second node serving the **same pinned
  definition** with its handler wrapped in a counter (the handler is outside the hash): the counter
  reads 0 through both refusals and 1 for a valid call.
- **"a hand-edited description … on restart":** the node is restarted against a manifest approved
  before the edit (the pinned text differs from the running definition; the gate compares hashes, so
  this is the same state as editing the source after pinning). `PIN_STRICT=false`: `tools/list` is
  empty and `pin-refused … drifted` is audited. The strict default: the node does not start.
- **"proven able to fail by deleting the control it guards"** (N2, N3, N4): the in-test red cases
  above, and the deletion matrices recorded in the FEEDBACK of `-1000` through `-1003a`; they are not
  re-run here.

## §3.2 The supply-boundary test's red-proofs

`packages/core/test/boundary/` (in the core's suite: the rule is the core's). The kinds are data in one
place (`KINDS`); an edition declares each export's kind in its `package.json`
(`"clearseal": { "exports": { … } }`), and the check applies that kind's structural test. The source
rules are read from the syntax tree (the TypeScript compiler API). The three WO red-proofs, and the kind
rules, each a planted edition:

```
BOUNDARY teaching: clean
PLANTED planted-verifier
  src/index.ts: control-constructed: a verify member: an edition does not verify tokens
  ./src/index.ts: kind-mismatch: export verifier: declared deploy-scaffold, but it is not a function
  ./src/index.ts: control-exported: export verifier: carries a verifier (a verify method)
PLANTED planted-deep-import
  src/index.ts: import-outside-exports: "../../../../../src/transport/server.ts" resolves outside the edition (../../../../src/transport/server.ts)
PLANTED planted-mislabelled
  ./src/index.ts: kind-mismatch: export definitions: declared configuration-schema, but it is not a JSON Schema object with type object
  ./src/index.ts: export-undeclared: export extra: not declared in package.json clearseal.exports
  ./src/index.ts: kind-reserved: export notifier: "approval-notifier": the core defines no such interface yet
PLANTED ungated
  src/index.ts: ungated-registry: startTransport is given a registry that is not loadPinnedRegistry's: the gate is the only registration path
PLANTED verifier-shorthand
  src/index.ts: option-forbidden: startTransport is given "verifier": an edition may pass only registry, serverInfo, config, validationPool, requestStateKey, audit
  src/index.ts: control-constructed: a verify member: an edition does not verify tokens
PLANTED self-pin
  src/index.ts: core-import: import * as core: a namespace reaches every control; import the allowed names
PLANTED self-pin-named
  src/index.ts: core-import: PinGate: an edition imports only loadPinnedRegistry, startTransport, ValidationPool, compileSchema, DEFAULT_LIMITS, requestStateKeyFromEnv from the core
PLANTED globals
  src/index.ts: forbidden-global: process.getBuiltinModule: reaches native code or another module
  src/index.ts: forbidden-global: fetch: code loading and network access go through the core and the cage
  src/index.ts: forbidden-global: eval: code loading and network access go through the core and the cage
  src/index.ts: forbidden-global: Function: code loading and network access go through the core and the cage
PLANTED nested-test
  src/test/evil.ts: builtin-forbidden: "node:fs": an edition reaches outside the process only through a tool's cage
PLANTED encoded
  src/index.ts: import-outside-exports: "./%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/core/src/index.ts": an encoded specifier cannot be checked
  ./src/index.ts: entry-unloadable: the entry does not load: The requested module './%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/core/src/index.ts' does not provide an export named 'start'
PLANTED exec
  src/index.ts: option-forbidden: loadPinnedRegistry is given "execToolsForbidden": an edition may pass only compile, limits
  ./src/index.ts: kind-mismatch: export definitions: declared tool-definitions, but it is not t: not an arbitrary_exec tool (N7: an edition ships none)
PLANTED mutate
  src/index.ts: registry-touched: registry: an admitted registry goes to startTransport untouched
PLANTED accessor-proxy
  src/index.ts: control-constructed: a verify member: an edition does not verify tokens
  src/index.ts: forbidden-global: Proxy: code loading and network access go through the core and the cage
  ./src/index.ts: control-exported: export config: carries an accessor (properties), which can answer differently each time it is read
PLANTED exported-proxy
  src/index.ts: forbidden-global: Proxy: code loading and network access go through the core and the cage
  ./src/index.ts: control-exported: export config: carries a Proxy, whose members cannot be read
PLANTED computed
  src/index.ts: computed-member: a member whose name is computed cannot be checked
PLANTED conditional
  src/evil.ts: control-constructed: a verify member: an edition does not verify tokens
  package.json: conditional-exports: exports["."] has conditions node: an edition has one entry, and what is checked is what loads
PLANTED reexport
  src/index.ts: core-reexport: re-exports from "@clearseal/core": an edition exports its own kinds, never the core's values
  ./src/index.ts: control-exported: export start: carries a value the core exports: an edition exports its own kinds, never the core's
PLANTED aliased
  src/index.ts: core-aliased: startTransport: the core's entry points are called by name, never passed around or renamed
  src/index.ts: registry-touched: registry: an admitted registry goes to startTransport untouched
PLANTED symlink
  src/reg.ts: symlink: a symbolic link in an edition's tree could lead anywhere; editions hold files
```

## §3.6 The committed manifest and its drift test

`pins/teaching.json`, produced by the core's pin path (`npm run pin -- approve --definitions
packages/teaching/src/index.ts --manifest pins/teaching.json --yes`) and committed. `pin verify`: 1
admitted, 0 refused.

```
MANIFEST admitted notes.read 8d8cfa77e141; refused []
```

The drift test loads the committed manifest into the core's gate and admits the edition's
definitions; anything unpinned, drifted or removed fails it. Red-proofs below (a description edited,
the root moved, the class widened: each red).

## The choices (WO §1.3, §1.5)

- **§1.3, the notes root:** `DEFAULT_NOTES_ROOT = /srv/clearseal/teaching/notes`, pinned in the
  committed manifest. `TEACHING_NOTES_ROOT` moves it, and the node then refuses to start until a
  manifest for the new root is approved: the root is part of the contract. Tests pin their own
  temporary root.
- **§1.5, where the boundary test lives:** `packages/core/test/boundary/`, because the rule is the
  core's and the next edition is checked without being edited. It discovers editions as every package
  under `packages/` other than `core`.
- **§1.5, how the check holds against a hostile edition** (after the adversarial pass): the export
  rules run in a fresh child process per edition, with the built-ins they use captured before the
  edition loads, reading descriptors so no getter runs; Proxies, accessors, conditional exports and
  the core's own values are refused. The source rules are a strict allowlist: the core only through
  six named imports (`loadPinnedRegistry`, `startTransport`, `ValidationPool`, `compileSchema`,
  `DEFAULT_LIMITS`, `requestStateKeyFromEnv`), no namespace or default import, no re-export, no
  dynamic import; `startTransport` and `loadPinnedRegistry` given only allowlisted option keys and
  called by name; the admitted registry handed to `startTransport` and touched nowhere else; no
  `eval`, `Function`, `fetch`, `globalThis`, `Proxy`, `process.getBuiltinModule` and the like; no
  computed member names; no symbolic links in the tree; relative paths resolved as URLs and real
  paths. **A static reading of JavaScript is best effort, not a sandbox** (stated in the checker):
  the boundaries that hold at run time are the core's brand on the registry and the cage.
- **§1.5, how a kind is told apart without judgement:** the edition declares each export's kind; the
  check refuses an undeclared export, an unknown kind, a reserved kind (`approval-notifier`,
  `audit-store`: the core defines no such interface yet), and a value that fails its kind's
  structural test. Independently, any exported value carrying a `verify` method, a core `PinGate` or a
  genuine `PinnedRegistry` (searched through arrays, objects and prototypes) is refused. The source
  rules: imports only from `@clearseal/core`, the edition's own files, and `node:path`/`node:url`;
  no computed or `createRequire` import; no reference to `PinGate` or `PinnedRegistry`; no `verify`
  member or `implements Verifier`; `startTransport` only with a registry from `loadPinnedRegistry`.

## Red-proofs (N5)

Mutants on a committed tree, each limited to 400 s: the WO's red-proofs, and one per rule the
adversarial pass added. **All 28 go red.** (The runtime Proxy rule first stayed green, because its only
fixture built the Proxy inside a function the static rule already refused; a fixture exporting a Proxy
was added and it went red.)

| § | Mutant | Red in |
|---|---|---|
| §1.4 | a description edited after pinning | manifest.test.ts RED 2: admits every definition the edition exports, with nothing unpinned, drifted or removed |
| §1.4 | the notes root moved without re-pinning | manifest.test.ts RED 2: admits every definition the edition exports, with nothing unpinned, drifted or removed |
| §1.4 | the class widened to state_change | manifest.test.ts RED 2: admits every definition the edition exports, with nothing unpinned, drifted or removed |
| §1.4 A13 | the scaffold registers something the exports do not | manifest.test.ts RED 1: start() with the committed manifest and the default root admits every tool under the strict default |
| §1.5 (a) | exported controls not looked for | supply-boundary.test.ts RED 4: red-proof (a) an exported verifier: the planted edition goes red, naming the file and the rule |
| §1.5 (b) | relative imports not resolved | supply-boundary.test.ts RED 1: red-proof (b) a deep import into core/src: the planted edition goes red, naming the file and the rule |
| §1.5 (c) | startTransport registry not checked | supply-boundary.test.ts RED 1: red-proof (c) a tool served without the gate |
| §1.5 | kind structure not checked | supply-boundary.test.ts RED 2: red-proof an export whose value is not its declared kind: the planted edition goes red, naming the file and  |
| A1 | any option passed to the transport | supply-boundary.test.ts RED 2: red-proof A1: a verifier passed to the transport by shorthand |
| A2 | any core name importable | supply-boundary.test.ts RED 1: red-proof A2: PinGate imported by name |
| A2 | namespace imports allowed | supply-boundary.test.ts RED 1: red-proof A2: a self-approved registry through a namespace import |
| A3 | globals not refused | supply-boundary.test.ts RED 2: red-proof A3: code loading and network reach without an import |
| A4 | nested test/ directories skipped | supply-boundary.test.ts RED 1: red-proof A4: a control in a nested test/ directory |
| A5 | encoded specifiers resolved leniently | supply-boundary.test.ts RED 1: red-proof A5: an encoded relative path into the core |
| A5 | symlinks in the tree followed | supply-boundary.test.ts RED 1: red-proof A5: a symbolic link in an edition's tree |
| A6 | the registry may be touched | supply-boundary.test.ts RED 1: red-proof A6: an admitted tool edited after admission |
| A7 | arbitrary_exec accepted as a tool definition | supply-boundary.test.ts RED 1: red-proof A7: an arbitrary_exec tool, and the exec switch turned off |
| A8 | accessors read through | supply-boundary.test.ts RED 1: red-proof A8: an accessor and a Proxy in the exports |
| A8 | Proxies read through | supply-boundary.test.ts RED 1: red-proof A8: an exported Proxy, whose members the check cannot read |
| A8 | computed member names allowed | supply-boundary.test.ts RED 1: red-proof A8: a verify member under a computed name |
| A8 | conditional exports allowed | supply-boundary.test.ts RED 1: red-proof A8: a conditional export that loads something else |
| A9 | core values re-exported | supply-boundary.test.ts RED 1: red-proof A9: a core function re-exported under an edition's name |
| A9 | core re-export statements allowed | supply-boundary.test.ts RED 1: red-proof A9: a core function re-exported under an edition's name |
| A16 | the core entry points aliased | supply-boundary.test.ts RED 1: red-proof A16-form: the transport renamed and called indirectly |
| §1.2 | the input schema has no name pattern | notes.test.ts RED 1: WO §5.1: names that climb, are absolute, carry a NUL or a backslash, or are very long are refused by the pin |
| §1.2 | the schema admits extra properties | p1-exit.test.ts RED 1: a forged Origin and an extra request property are each refused before any handler runs |
| A15 | an oversized note not told apart | notes.test.ts RED 1: a note larger than a result may be, and a note that is not UTF-8, are tool errors |
| §1.1 | configuration not validated | config.test.ts RED 4: refuses start: no resource URL |

**Green, stated:** `notes.read`'s own name check is a layer behind the pinned schema, which refuses
the same names before the handler runs (the `-1003` convention: a layer is named, not hidden).

## Deviations

| # | Deviation | Why |
|---|---|---|
| D-1 | **The edition declares the core as a `peerDependency`, not a `dependency`.** The protected SBOM check (`.github/scripts/check-sbom.mjs`) looks every direct dependency up under `node_modules/<name>` in the lockfile; a workspace dependency is a link entry with no version there, so it failed with `direct dependency @clearseal/core@? is not in the bill of materials`. A peer dependency says what is true of an edition (the core is supplied alongside it) and the check does not count it | `.github/**` is protected. **The checker's gap is the architect's to fix;** if it is taught to follow workspace links, the edition can declare a plain dependency |
| D-2 | **A `.leak-gate-allow` line for `pins/*.json`**, the committed manifests' tool and manifest digests (64 hex), matching the precedent for `packages/core/test/fixtures/*.json` | The gate's long-hex rule; the digests are public by design |
| D-3 | **The edition's `tsconfig.json` maps `@clearseal/core` to the core's source for typecheck and lint only.** `npm run check` typechecks before it builds, so the package entry (`dist/`) may not exist yet; the build and every run resolve the core through its package entry, and the boundary test holds the source to that | No core change, and no deep import in the source |
| D-4 | **The planted ungated edition loads the core by a computed import** so the core's own typecheck (before the build) need not resolve the package entry; the checker reports that as a second finding (`dynamic-import`) beside the one the red-proof asserts (`ungated-registry`) | CI failed on the first push until this changed |
| D-5 | **The edition has a `bin/teaching-node.ts`** that calls `start()`: not an export, and inside the boundary test's source scan | An operator needs a way to run the scaffold |

## Adversarial pass (fresh subagent, WO §5; its own scratch worktree, since removed)

The subagent attacked `d70abed` with its own probe files and planted editions (not committed), every
attempt using the operation that matters: real reads through a real teaching node, real planted
editions through `checkEdition()` **and then started**, real edits for the drift probes. **The notes
containment held for every name-based escape.** **The first boundary checker was the weak part:**
nine planted editions came back clean, and five of those did real damage when started. Every one is
now a planted regression case in `supply-boundary.test.ts`, each with its red-proof.

| # | Finding | Severity | Status |
|---|---|---|---|
| A1 | A verifier passed to `startTransport` by shorthand (`{ verifier: { verify } }`): the checker was clean, and the started node served an **unauthenticated** call (`200`) | high | **Fixed:** `startTransport` and `loadPinnedRegistry` take only allowlisted option keys; `verify` is refused in every member form. Red-proof |
| A2 | A self-approved registry through a namespace import (`core.PinGate` → `new core.PinnedRegistry`): clean, and the node served an unpinned tool | high | **Fixed:** the core only through six named imports; no namespace or default import. Red-proofs (namespace, and `PinGate` by name) |
| A3 | Code loading and network reach without an import (`process.getBuiltinModule("node:fs")`, a global `fetch`, `eval`, `new Function`): clean, and a pinned tool read `/etc/hostname` and a loopback URL outside its cage | high | **Fixed:** refused globals and `process` members. Red-proof. The limit stated: static checking is best effort; the OS cage is the boundary |
| A4 | Any directory named `test` or `dist` was skipped at any depth: a control in `src/test/evil.ts` was clean | high | **Fixed:** only the top-level ones are skipped. Red-proof |
| A5 | An encoded path (`./%2e%2e/…`) and a symlinked file reached the core's source: clean, and loaded a core-internal function | medium | **Fixed:** `%` refused; paths resolved as URLs and real paths; symbolic links in the tree refused. Red-proofs |
| A6 | **A core defect:** an admitted tool's definition, validator and handler stay mutable after admission (`transport/registry.ts`: `prepareTool` returns an unfrozen object, stored as is). The started node served an edited description and a swapped handler that bypassed the schema | high | **In the edition: closed by the checker** (the admitted registry goes to `startTransport` untouched; red-proof). **In the core: not fixed, `packages/core/src` is protected.** Verified by reading the code. *Decision-needed:* a follow-up to deep-freeze each registered tool in the `PinnedRegistry` constructor |
| A7 | An `arbitrary_exec` definition plus `execToolsForbidden: false`: clean, and the node ran a shell command | medium | **Fixed:** the tool-definitions kind refuses `arbitrary_exec` (N7); `execToolsForbidden`, `strict` and `cageFor` are not edition options. Red-proof |
| A8 | The runtime walk ran in the checker's own process, so an edition could patch its built-ins and blind later checks; a stateful getter, a Proxy, a Symbol-keyed member and a conditional export all passed | medium | **Fixed:** a child process per edition, built-ins captured first, descriptors read without running getters; Proxies, accessors, computed member names and conditional exports refused. Red-proofs, including "a poisoning edition cannot blind the next check" |
| A9 | A core function re-exported under an edition's name (`export { loadPinnedRegistry as start }`) was clean | low | **Fixed:** no re-export from the core, and any exported value identical to a core export is refused. Red-proof |
| A10 | **A core defect:** a FIFO in the notes root blocks the cage's `open()` on a worker thread that the handler timeout abandons but never frees, and the in-flight slot is never released: four such reads exhausted the thread pool, and enough of them left the node answering `503 at capacity` until restart | medium | **Not fixed: in the core's cage and dispatch** (protected). Stated in the edition's README as a known limit, with the operator rule that the notes root is writable only by the operator. *Decision-needed:* a follow-up to open with `O_NONBLOCK` and refuse a file that is not a regular one |
| A11 | A hard link in the notes root to a file outside is followed (the cage's stated limit), and the edition ships no OS cage | medium | **Stated and asserted:** the README's known limits, and a `notes.test.ts` row asserting today's behaviour so a change is seen |
| A12 | On Windows the planted-symlink row was measured but not asserted, so it passed whatever happened | medium | **Asserted:** on win32 the known outcome (followed, the in-process cage resolves no links there) is asserted, as measured in CI |
| A13 | `start()` built its own tool list, so an edit there (an extra tool, a different root) left the drift test green, and the node tests then hung | medium | **Fixed:** one `toolsFor(root)` for both the exports and the scaffold, and the drift test now starts the real scaffold against the committed manifest (`/health` pinned counts). Red-proof |
| A14 | A start that failed in `before()` left the tests hanging instead of failing | low | **Fixed:** guarded teardown |
| A15 | A note over the result cap with a multibyte character at the edge, or with invalid UTF-8, was an opaque handler error | low | **Fixed:** both are tool errors (`isError`). Tested; red-proof |
| A16 | The evidence test's header said every clause runs there; "proven able to fail by deleting the control" does not, and two clauses rest on equivalents | low | **Fixed:** the header and FEEDBACK say which clause is evidenced by the recorded deletion matrices, and state the two equivalents (the pre-edit manifest; the counting node) |
| A17 | Test cleanup left the temporary directories behind | info | **Fixed** |
| A18 | Every hand-built registry, in six syntactic forms, was refused at start by the transport's brand, though the static rule missed all six | info (held) | The brand is the boundary; the static rule now also refuses the aliasing forms (red-proof) |

**WO §5 items:** 1 reads outside the root: **pass** for every name, both symlink kinds on POSIX, the
cap and JSON inflation; the hard link and the FIFO are A11 and A10. 2 defeating the boundary test:
**failed at `d70abed`**, every bypass fixed with its red-proof. 3 a tool the gate did not admit: a
fake registry was refused by the core's brand in every form; a self-approved registry (A2) and a
mutated one (A6) got through and are closed in the checker. 4 the committed manifest and the
definitions disagreeing: **pass** for every hashed field; the scaffold path was A13, fixed.

## Decision-needed

- **Windows containment (§1.3):** accept the measured-and-recorded link case as the core cage's stated
  Windows limit, or require the teaching edition to refuse to start on Windows until an OS cage
  exists (P4).
- **D-1:** fix `check-sbom.mjs` to follow workspace links, so editions declare the core as a
  dependency.
- **A6 (core, high):** deep-freeze each registered tool and its definition in the `PinnedRegistry`
  constructor, so an admitted tool is served exactly as hashed whoever holds the registry.
- **A10 (core, medium):** the cage opens with `O_NONBLOCK` and refuses a file that is not a regular one
  before any read, and a timed-out handler's slot is released.

## Gates

| Gate | Result |
|---|---|
| `npm run check` | exit 0 on Node v24.21.0: core and teaching **586** tests (34 files, 24 in the boundary test), spike 0102 69, spike 0101 8, `test:subset` 4 |
| CI | both runners, on the pull request; the Windows measurement above is from this branch's CI |
| Protected surfaces | The four steering documents, `LICENSE`, `NOTICE`, `scripts/**`, `.github/**`, `spikes/**`, `docs/canonical-form.md` and `packages/core/src/**` diff **empty** against `fcb415f`. Root `package.json` unchanged (the `packages/*` workspace glob already covers the edition). `packages/core/test` grew only for the boundary test |
| Leak gate | `--tree` and `--history` exited 0 before every push, each checked by exit code |
| Clean-build check | `npm run check` also run with every `dist/` removed first, as CI starts: the typecheck and lint pass before the build |
| Credentials | Pushed over the repository's write deploy key. A short-lived token was minted only to open this pull request, kept in a mode-0600 scratch file, and deleted straight after |

## What did not work, and why

- **The first push failed CI twice over:** the planted ungated fixture imported the core statically, so
  the core's typecheck could not resolve the package entry before the build (it passed locally only
  because `dist/` existed; I now typecheck with `dist/` removed); and the SBOM check could not follow
  the workspace dependency (D-1).
- **The first boundary checker was too trusting** (adversarial A1–A9): it read only the obvious
  syntactic forms, walked exports in its own process, and skipped nested `test/` directories. Nine
  planted editions passed it, and five of those did real damage when started. It was rewritten as a
  strict allowlist with the export rules in a child process; every bypass is now a planted case.
- **The first mutant matrix had three greens:** the kind rule was never exercised alone (the planted
  verifier is also caught as a control), and configuration validation had no test; both are covered
  now. The third is the named layer above.

## What was not built

- **The other three teaching tools, the approval path, the audit store:** P2.
- **Any core change, including a new export:** none was needed.
- **Widening the `fs:` grammar to drive paths:** recorded for P4 and the upstream ledger (entry 13).
- **A host edition, a service unit, a deploy to any machine.**
