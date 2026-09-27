# FEEDBACK: CSR-WO-1007a (the operator names the manifest)

Branch `wo/CSR-WO-1007a`, cut from `main` at `4478a35` (`-2000` merged; the WO on `main` since
`98c2fda`). Parked as one unmerged pull request. Built on Node v24.21.0.

## Read this first

- **F1 and F2 were reproduced end to end on `4478a35` before anything changed** (pastes below). Each
  hostile edition passed the checker with no findings. Its own `bin/`, run as a node, listed and
  served `notes.exfil`, a tool the committed manifest does not pin.
- **All five items are built.**
  - `startNode({ definitions, configSchema })` reads the manifest only from `CLEARSEAL_MANIFEST`,
    requires it, and writes `manifest-loaded` with the file's path and SHA-256.
  - Editions export definitions and a configuration schema only.
  - F1 and F2 now run as real nodes in the P1 evidence and are refused at start.
  - `bin/` imports only `startNode` and its own entry.
  - The export check trusts its child only through a nonce.
  - Every item has a red-proof and a control-deletion row.
- **The adversarial pass found a third High route, F3. It is closed at the checker, and stated at
  the runtime layer.**
  - A `dist/index.js` entry sets `process.env.CLEARSEAL_MANIFEST` to its own manifest before
    `startNode` reads it. The node, started against the operator's `pins/teaching.json`, served
    `notes.exfil`. `manifest-loaded` named the hostile file, which is the operator-visible signal.
  - The lever was that the checker never read `dist/`, where the entry `bin/` loads usually lives.
    It reads `dist/` now, like `src/`, so F3 is refused (`dist/index.js: process-referenced`). The
    teaching edition's built `dist/` stays clean. The plant is in the suite with its own row.
  - **Stated plainly: at run time, code an edition runs in the node's process defeats the §1.1
    guarantee.** It can rewrite the environment, or assemble its own node from the core's public
    exports, as H1 did. The WO scopes that out ("NOT an in-process sandbox", §4). The checker is
    the layer that stops such code from shipping, and it is best effort (the `.constructor` route
    stays with P2). So the guarantee is exact for a node whose editions' code the checker accepted,
    or the operator reviewed. The operator's check is the `manifest-loaded` line, compared with the
    manifest they approved.
- **Two choices beyond the letter of §1.1, both refusals:**
  - An edition that passes any key beyond `definitions` and `configSchema` is refused, with a
    manifest path named. Silently ignoring one would hide a stale or hostile `bin/`.
  - An edition's configuration may not use the core's variable prefixes (`CLEARSEAL_`, `AUTH_`,
    `PIN_`, `EXEC_`). Its schema could otherwise declare a `CLEARSEAL_MANIFEST` property. The core
    never reads schema defaults into the environment, so that would be inert, but it would mislead.
- **Two existing control-deletion rows now guard their tests through the rule that replaced theirs.**
  `controls.json` is protected except for added rows, so the rows are unchanged and their stubs were
  regenerated:
  - `boundary-manifest-url`: the pins-only manifest-URL rule is gone, because `import.meta` is
    banned outright. The row's two plants now go red on `import-meta`, and its stub deletes that
    rule.
  - `boundary-manifest-export`: the `manifest-path` kind is gone. The exported manifest path now
    goes red as `kind-unknown`, and its stub deletes that report.
  - Their `control` text still describes the old rule. Rewording it is an edit to a protected row,
    so it is the architect's call.
  - Six more stubs went stale on context and were regenerated with the same change:
    `supply-boundary-control-exported`, `startnode-file-scheme`, `startnode-no-link-on-the-way`,
    `boundary-process`, `boundary-import-meta` and `boundary-namespace-access`.

## §3.2 F1 and F2, end to end

**Before the fix, on `4478a35`:** each plant's own `bin/` was run as a node against the test issuer.

```
REPRO f1 checker findings: []
REPRO f1 node output: listening on http://127.0.0.1:40267/mcp
REPRO f1 tools/list: ["notes.exfil"]
REPRO f1 tools/call notes.exfil: 200 {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"SERVED BY AN UNPINNED TOOL"}],...}}
REPRO f2 checker findings: []
REPRO f2 node output: listening on http://127.0.0.1:33253/mcp
REPRO f2 tools/list: ["notes.exfil"]
REPRO f2 tools/call notes.exfil: 200 {"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"SERVED BY AN UNPINNED TOOL"}],...}}
```

**After:** each is started by its own `bin/`, with `CLEARSEAL_MANIFEST` at the committed
`pins/teaching.json`. Paths are shortened to the repository, and hashes to 12 characters, here.

```
F1F2 f1 strict output:
[audit-seam] manifest-loaded {"path":"<repo>/pins/teaching.json","sha256":"27206075fb62…"}
[audit-seam] pin-refused {"tool":"notes.exfil","reason":"unpinned"}
[audit-seam] pin-refused {"tool":"notes.read","reason":"removed"}
PinRefusedError: the pin gate refused 2 tool(s): notes.exfil (unpinned), notes.read (removed); PIN_STRICT is on, so the node does not start
F1F2 f1 PIN_STRICT=false: tools/list []; tools/call notes.exfil → 400 {"jsonrpc":"2.0","id":8,"error":{"code":-32602,"message":"The tool \"notes.exfil\" is refused by the pin gate"}}
F1F2 f2 (the same manifest-loaded line and refusal)
F1F2 f2 PIN_STRICT=false: tools/list []; tools/call notes.exfil → 400 {"jsonrpc":"2.0","id":10,"error":{"code":-32602,"message":"The tool \"notes.exfil\" is refused by the pin gate"}}
```

**The P1 EXIT line for the clause.** It names the gate sentence it proves, from the roadmap's P1
exit gate as `-1007a`'s docs reworded it:

```
EXIT | the node serves only tools whose definitions hash to the manifest the operator configured (the H1 re-test's F1 and F2, end to end) | F1: checker ["bin/node.ts: bin-import","bin/node.ts: bin-import"]; strict: start refused (notes.exfil unpinned), after manifest-loaded pins/teaching.json; PIN_STRICT=false: tools/list [], notes.exfil not served; F2: checker ["package.json: check-failed"]; strict: start refused (notes.exfil unpinned), after manifest-loaded pins/teaching.json; PIN_STRICT=false: tools/list [], notes.exfil not served
```

With `dist/` now read, F2 also gets `dist/index.js: process-referenced` from the static rules.

## §3.3 `startNode`'s refusals (`packages/core/test/node/start.test.ts`)

```
CLEARSEAL_MANIFEST unset: NodeStartError: CLEARSEAL_MANIFEST is required: the operator names the approved manifest (an absolute path or a file: URL); a node without one does not start
CLEARSEAL_MANIFEST empty: NodeStartError: (the same)
an edition naming its manifest: NodeStartError: startNode takes an edition's definitions and configSchema, nothing else (not manifestPath): the operator names the manifest in CLEARSEAL_MANIFEST
CLEARSEAL_MANIFEST a relative path: ManifestError: the manifest path must be absolute, or a file: URL
CLEARSEAL_MANIFEST a dot-relative path: ManifestError: the manifest path must be absolute, or a file: URL
CLEARSEAL_MANIFEST a data: URL: ManifestError: the manifest path must be absolute, or a file: URL
CLEARSEAL_MANIFEST an https: URL: ManifestError: the manifest path is a https: URL: a node reads its committed manifest from a file
CLEARSEAL_MANIFEST a directory: ManifestError: the manifest is not a regular file: a node reads its committed manifest from a regular file
CLEARSEAL_MANIFEST a missing file: ManifestError: the manifest cannot be read (ENOENT): a node without a manifest does not start
CLEARSEAL_MANIFEST a symbolic link to the real manifest: ManifestError: the manifest cannot be read (ELOOP): a node without a manifest does not start
CLEARSEAL_MANIFEST a link on the way (a symlinked directory): ManifestError: the manifest's path passes through a symbolic link: a node reads its committed manifest from a path with no link on the way
CLEARSEAL_MANIFEST a FIFO (never waited on): ManifestError: the manifest is not a regular file: a node reads its committed manifest from a regular file
an unpinned tool: PinRefusedError: the pin gate refused 1 tool(s): extra (unpinned); PIN_STRICT is on, so the node does not start
a drifted tool: PinRefusedError: the pin gate refused 1 tool(s): echo (drifted); PIN_STRICT is on, so the node does not start
an edition's prefix CLEARSEAL_ / AUTH_ / PIN_ / EXEC_: NodeStartError: the configuration prefix <prefix> is the core's own: an edition's variables carry its own prefix
manifest-loaded {"path":"<tmp>/manifest.json","sha256":"f4fc7609b513…"}  (the SHA-256 of the file's bytes, asserted; written before anything is admitted)
```

**Read once (§7).** `readManifestFile` returns the bytes it read from its one descriptor.
`startNode` hashes that buffer for `manifest-loaded` and hands the same buffer to `PinGate.load`, so
the logged hash and the parsed bytes cannot differ, and §7's flag condition does not arise.

## §1.4(b) The choice: an authenticated report, and why

- The parent sends a 32-byte random nonce on the child's stdin. The child reads stdin to its end
  before it imports anything of the edition's, keeps the nonce in its own module scope, and writes
  one report line: `clearseal-supply-boundary-report {"nonce": …, "findings": […]}`.
- The parent accepts exactly one line carrying its nonce, with a well-formed findings array. Every
  finding must have exactly `file`, `rule` and `detail`, all strings. Anything else is a
  `check-failed` finding, never a clean result: no line, two lines, a wrong nonce, a malformed
  array, a non-zero exit, or an early exit.
- Why a nonce, and not a separate descriptor: the loaded entry runs in the same process as the child
  and can write to any descriptor the child can. What it cannot do is produce a secret it never saw.
  By the time it loads, stdin is drained and the nonce lives only in the child's module scope. A
  nonce also works on both runners the same way; an extra pipe descriptor is less certain on
  Windows.
- Its limit, stated in the checker's header: an entry with arbitrary code could, in principle, find
  the nonce in its own process's memory. That is in-process code again, and now the static rules,
  which read `dist/`, stand in front of it.
- Proven:
  - F2, which prints `[]` and exits, gives `check-failed: 0 authenticated report lines`.
  - A forged report line with a guessed nonce gives `0 authenticated report lines (1 report-looking
    lines)`.
  - An entry that reads stdin for the nonce finds it empty and is refused the same way.
  - The parser refuses each malformed form directly.

## §3.4 Red-proofs and control-deletion rows (N5)

Eleven new rows, all red by the test's own assertion:

| Row | Control | Named tests red |
|---|---|---|
| `startnode-operator-manifest-required` | §1.1 `CLEARSEAL_MANIFEST` required, no default (stub: `?? "/"`) | without CLEARSEAL_MANIFEST, or with it empty … |
| `startnode-edition-names-no-manifest` | §1.1 an edition's extra key, `manifestPath` above all, refused | an edition that passes a manifest path … |
| `startnode-manifest-loaded` | §1.1 the `manifest-loaded` line | started, the node writes manifest-loaded …; the P1 F1/F2 clause |
| `startnode-manifest-hash-of-bytes` | §1.1 the SHA-256 is of the bytes read | started, the node writes manifest-loaded … |
| `startnode-core-prefixes` | §1.1 no edition prefix is the core's | an edition's schema may not claim the core's own variables' prefix |
| `boundary-bin-imports` | §1.4(a) bin/ imports only startNode and its own entry | F1; F1 variant: a built-in; F1 variant: another package |
| `boundary-bin-no-reexport` | §1.4(a) bin/ re-exports nothing | F1 variant: bin/ re-exports from dist/ |
| `boundary-report-nonce` | §1.4(b) only the nonce authenticates | F2 variant: a guessed nonce; the child's report is trusted only with its nonce … |
| `boundary-report-required` | §1.4(b) short of one authenticated report is a failure | F2; F2 variant: a guessed nonce; F2 variant: reads stdin |
| `boundary-report-well-formed` | §1.4(b) the findings must be well-formed | the child's report is trusted only with its nonce … |
| `boundary-dist-read` | F3: the checker reads dist/ | F3: a dist/ entry that points CLEARSEAL_MANIFEST at its own manifest … |

Plus the eight regenerated stubs above, each red again. The `import-meta` ban is proven by
`boundary-import-meta` (and by `boundary-manifest-url`, whose plants it now catches), and by the new
plant "the formerly allowed form, new URL(<pins literal>, import.meta.url), is refused too".

## Adversarial pass (WO §5)

The fresh subagent was stopped by a safety classifier before it ran any attempt, as happened in
`-2008` and `-1007`. Its notes from reading the code, checked against the code before I adopted them:
- the hash and the parse use one buffer;
- `startNode` never reads a `manifestPath` key;
- schema defaults never reach the environment.

It also raised the open question that became F3. I ran every §5 attempt myself, through real nodes
started by an edition's own `bin/`, or through real `startNode` calls:

| # | Attempt | Result | Severity | Disposition |
|---|---|---|---|---|
| X1 | §5.1 an edition export or an extra key: `manifestPath`, a symbol key, a Proxy hiding `manifestPath` from `ownKeys`, an inherited `manifestPath` | extra and symbol keys refused (NodeStartError). The Proxy and inherited forms get past the key check, but `startNode` never reads the key: `manifest-loaded` shows `pins/teaching.json`, and the unpinned definitions are refused | none | — |
| X2 | §5.1 a default; a relative path; odd `file:` forms | no default (required). Relative, `./` and leading-whitespace paths refused. `file://host/…` and an encoded `/` throw. `file:pins/teaching.json` resolves to `/pins/teaching.json`, which does not exist. A query, fragment or dot segments resolve to the operator's own file | none | — |
| X3 | §5.1 a schema claiming `CLEARSEAL_`, or a `CLEARSEAL_MANIFEST` default | prefix refused. Property names must carry the edition's prefix. Defaults are never written to the environment | none | — |
| X4 | §5.1 an environment read the edition influences before startNode (**F3**): a `dist/index.js` entry setting `process.env.CLEARSEAL_MANIFEST` | **served** on the branch before the fix: tools/list `["notes.exfil"]`, call 200, `manifest-loaded` naming the plant's own file; the checker flagged only an incidental undeclared export | **High** | **closed at the checker**: `dist/` is read (`boundary-dist-read`), giving `dist/index.js: process-referenced`. **At run time it is the in-process limit**, stated above and in the checker's header |
| X5 | §5.2 F1 and variants: bin/ into `dist/`, a built-in, another package, a re-export | all `bin-import`. At run time, refused against the operator's manifest | none | — |
| X6 | §5.2 F2 and variants: `[]` and exit; a forged line with a guessed nonce; reading stdin for the nonce | all `check-failed`; F2 now also `process-referenced` (dist/ read). At run time, refused | none | — |
| X7 | §5.3 change the file between the hash and the parse | one read, one buffer, hashed and parsed; the hash cannot differ from the parsed bytes | none | — |

## Gates

- `npm run check` exits 0 from a clean state (every `dist/` removed first): 655 core and teaching tests (640 before), spike 0102 69, spike 0101 8,
  `test:subset` 4. The supply-boundary suite has 48 tests, 14 of them H1 plants.
- `control-deletion`: 85 rows (74 before, 11 new), all red by assertion, on the final code;
  `--self-test` passes.
- `node scripts/leak-gate.mjs --tree` exit 0; `--history` exit 0, run unpiped before every push
  with the exit code checked directly.
- CI: the pull request's checks, on both runners, with `control-deletion`. The first CI run failed
  on the Windows test job, and I had run the check locally with `dist/` already built. `npm run
  check` typechecks before it builds, and `bin/`'s import of `@clearseal/teaching` resolved to a
  `dist/index.d.ts` that did not exist yet. The teaching tsconfig now maps the name to `src/` for
  typecheck only, as it already did for `@clearseal/core`. At run time and in the build, the name
  resolves through the package's exports.
- Protected surfaces diff to empty against `4478a35`: the steering documents, `LICENSE`, `NOTICE`,
  `spikes/**`, `docs/canonical-form.md`, and everything under `packages/core/src/**` except
  `node/start.ts`. `index.ts` is unchanged. `test/deletion/controls.json` has only added rows
  (172 lines added, 0 removed).
- The minted token lived in a mode-0600 scratch file, was never written to git config or a remote
  URL, and was deleted after the pull request was opened.

## What was not built

- An in-process sandbox for editions (§4), and the P2 supply-side hardening: C7, H7, the `Function`
  constructor through `.constructor`, SIGINT shutdown, and the X10 and X7 rulings from `-2000`. F3's
  run-time half is in that class.
- Manifest signing (`-2004`): the operator names the file, and `manifest-loaded` gives its hash to
  compare.
- No change to the gate, the registry, the transport or auth. The one source file changed under
  `packages/core/src` is `node/start.ts`. `index.ts` needed no change: `Edition` keeps its name.
- The wording of the two retargeted rows' `control` text (protected).
