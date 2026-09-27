# FEEDBACK: CSR-WO-1007b (the core owns the process entry)

Branch `wo/CSR-WO-1007b`, cut from `main` at `b88f71f`, where the WO lives (`-2002` merged at
`845e641`). Parked as one unmerged pull request. Built on Node v24.21.0. None of the §7
flag-and-stop conditions arose.

## Read this first

- **The fix is ordering, and the ordering is now a file.** `packages/core/src/node/cli.ts` is
  `clearseal-node`, and it does four things in this order: capture every setting into a frozen
  snapshot; read, hash and parse the manifest and open the audit store; **then** `import()` the
  edition `CLEARSEAL_EDITION` names; then check its two exports and start. Nothing an edition runs at
  load time can change a setting or a manifest that has already been read.
- **`startNode` no longer reads the environment at all.** It takes the prepared node (which holds the
  snapshot) and the edition's two values. The edition's own variables are read from the snapshot's
  frozen copy of the environment, not from `process.env`.
- **Editions lose `bin/`.** `packages/teaching/bin/teaching-node.ts` is deleted. An edition imports
  types from the core and holds no core value: the checker's one exception (`startNode` in `bin/`) is
  gone with it, and `startNode`, `startNodeFromEnv`, `captureSettings`, `PreparedNode` and `runNode`
  are all names an edition may not construct.
- **All four H-1 variants are reproduced and refused end to end**, each as a real package installed
  where the operator's install resolves it, started by `clearseal-node` as a process. The pastes are
  in §3.2. Each is also a checker finding now, which is defense in depth and not the guarantee.
- **The control-deletion job found two weaknesses in my own tests**, and both are fixed:
  - the exports-check test leaked a started node when its refusal did not happen, so the row timed
    out instead of failing by assertion. It now closes it and fails by assertion.
  - the environment-mutation test never observed a value that a `process.env` read inside `startNode`
    would change. It now asserts the running node's own `config.resourceUrl` is the captured one.
  Both were caught by deleting the control, which is what the job is for.

## Choices the WO left to me, with reasons

**§1.5, extensionless files: read them as modules.** A file with no extension is a module Node loads
when it is imported by that exact name — measured on 24.21.0, with the package's `"type": "module"`,
for both a package entry and a relative import. A checker that skips such a file reads less than the
loader does, which is precisely the gap two of the four H-1 variants used. So the walk reads any file
whose name has no dot, and a file with some other extension (`.json`, `.md`) is data these rules do
not cover — and an import that resolves to one is now a finding in its own right (`import-unread`).

**How reachability is closed, rather than enumerated.** The rules are applied to the edition's
shipped tree (everything but its own `test/` and `node_modules/`), and three findings make the set of
reachable files equal to the set of read files:
- `import-unshipped`: shipped code may not import into `test/` or `node_modules/` at all;
- `import-unread`: an import must resolve to a file the walk read;
- `entry-unread`: every `exports` target must be a file the walk read (a `.d.ts` target is types, not
  code, and is skipped).

An edition's own tests are not held to the shipped rules — a test imports `node:test` and may use
`process` — and nothing shipped can reach them, so no code there ever runs when the node imports the
edition. That is a stronger statement than reading `test/` and rule-checking it would have been, and
it does not force an edition to write its tests under the shipped rules.

**`CLEARSEAL_EDITION` is a package name, matched against `^(?:@scope/)?name$`.** A path, a URL, a
deep subpath (`@clearseal/teaching/dist/index.js`) and an empty value are all refused. The operator's
install decides what the name resolves to; if the edition could name a path, it would choose what
loads, which is the same defect one layer down.

**`SettingsError extends NodeStartError`.** A refusal in the capture step is named for its step and is
still the same class a caller catches, so the existing refusal tests and control rows hold.

## §3.3 The snapshot: the environment rewritten after capture

```
SNAPSHOT after rewriting CLEARSEAL_MANIFEST, CLEARSEAL_EDITION, PIN_STRICT, EXEC_TOOLS_FORBIDDEN, AUTH_ISSUER, AUTH_AUDIENCE, CLI_RESOURCE_URL and AUDIT_STORE: manifest the operator's, tools/list ["echo"], resourceUrl unchanged
```

## The `process.env` inventory (§1.2)

Every read in `packages/core/src`, counted in code with comments stripped. Two are the capture step
and its one call site; the rest are default parameters on the exported readers, which the capture step
always calls with the snapshot. The two indirect entries are fallbacks for a **direct** caller that
omits an option — a node's own path never reaches either, because `startNode` passes every value from
the snapshot. The test fails until any new read is named here, and it caught one I had missed
(`transport/server.ts`'s verifier fallback) while I was writing it.

PROCESS.ENV INVENTORY (packages/core/src)
direct reads (`process.env` in code):
| file | reads | what it is |
|---|---|---|
| auth/verifier.ts | 1 | jwtVerifierFromEnv's default parameter; the capture step passes the snapshot |
| node/cli.ts | 1 | the entry's one read: runNode(process.env), whose first act is the capture, before any edition loads |
| node/start.ts | 1 | startNodeFromEnv's default parameter, for the core's own tests; the entry passes a snapshot |
| pinning/registry.ts | 2 | pinStrictFromEnv's and execToolsForbiddenFromEnv's default parameters; the capture step passes the snapshot |
| transport/request-state.ts | 1 | requestStateKeyFromEnv's default parameter; the capture step passes the snapshot |
indirect reads (a reader called with no argument):
| file | calls | what it is |
|---|---|---|
| pinning/registry.ts | 2 | options.strict ?? pinStrictFromEnv() and options.execToolsForbidden ?? execToolsForbiddenFromEnv(): the fallback for a direct loadPinnedRegistry caller that omits the option (-1001 adversarial F5). startNode passes both from the snapshot, so a node's path never reaches them |
| transport/server.ts | 1 | options.verifier ?? jwtVerifierFromEnv(): the fallback for a direct startTransport caller that configures no verifier (the core's transport tests). startNode passes the snapshot's verifier, so a node's path never reaches it |
| status | case | audit line(s) |
|---|---|---|
| 400 | a target that is not origin-form | http-refused {"status":400,"reason":"request-target"} |
| 404 | an unknown route | http-refused {"status":404,"reason":"not-found"} |
| 400 | Host sent twice | http-refused {"status":400,"reason":"host-count"} |
| 405 | GET /mcp | http-refused {"status":405,"reason":"method"} |
| 405 | POST /health | http-refused {"status":405,"reason":"method"} |
| 403 | /health with a Host not allowed | http-refused {"status":403,"reason":"host-not-allowed"} |
| 403 | /mcp with a Host not allowed | http-refused {"status":403,"reason":"host-not-allowed"} |
| 403 | /mcp with an Origin not allowed | http-refused {"status":403,"reason":"origin-not-allowed"} |
| 400 | H1 Authorization sent twice | http-refused {"status":400,"reason":"duplicate-authorization"} |
| 401 | no Authorization (auth-refused only) | auth-refused {"reason":"refused"} |
| 400 | a token in the query too (auth-refused only) | auth-refused {"reason":"token-elsewhere"} |
| 406 | Accept without JSON | http-refused {"status":406,"reason":"not-acceptable","principal":"test-principal"} |
| 415 | Content-Type not JSON | http-refused {"status":415,"reason":"content-type","principal":"test-principal"} |
| 415 | a content coding | http-refused {"status":415,"reason":"content-coding","principal":"test-principal"} |
| 400 | a transfer coding other than chunked | http-refused {"status":400,"reason":"transfer-coding","principal":"test-principal"} |
| 413 | a body over the cap | http-refused {"status":413,"reason":"body-too-large","principal":"test-principal"} |
| 400 | a body that is not UTF-8 | http-refused {"status":400,"reason":"body-not-utf8","principal":"test-principal"} |
| 400 | a body that is not JSON | http-refused {"status":400,"reason":"parse-error","principal":"test-principal"} |
| 400 | a duplicate key | http-refused {"status":400,"reason":"duplicate-key","principal":"test-principal"} |
| 400 | a lone surrogate | http-refused {"status":400,"reason":"lone-surrogate","principal":"test-principal"} |
| 400 | nesting over the depth cap | http-refused {"status":400,"reason":"body-depth","principal":"test-principal"} |
| 400 | a batch (framing) | http-refused {"status":400,"reason":"framing","principal":"test-principal"} |
| 503 | at capacity | http-refused {"status":503,"reason":"capacity","principal":"test-principal"} |

## §3.2 H-1, all four variants, end to end

Each variant is installed where the operator's install resolves it, then started by
`clearseal-node` as a process. Under the strict default the node refuses to start; with
`PIN_STRICT=false` it starts and the unpinned tool is absent and uncallable. In every case
`manifest-loaded` names the operator's file and the edition's own manifest is never read.

```
H-1 under-test strict output:
H-1 under-test PIN_STRICT=false: tools/list []; tools/call notes.exfil → 400 {"jsonrpc":"2.0","id":8,"error":{"code":-32602,"message":"The tool \"notes.exfil\" is refused by the pin gate"}}
H-1 under-node-modules strict output:
H-1 under-node-modules PIN_STRICT=false: tools/list []; tools/call notes.exfil → 400 {"jsonrpc":"2.0","id":10,"error":{"code":-32602,"message":"The tool \"notes.exfil\" is refused by the pin gate"}}
H-1 extensionless-entry strict output:
H-1 extensionless-entry PIN_STRICT=false: tools/list []; tools/call notes.exfil → 400 {"jsonrpc":"2.0","id":12,"error":{"code":-32602,"message":"The tool \"notes.exfil\" is refused by the pin gate"}}
H-1 extensionless-import strict output:
H-1 extensionless-import PIN_STRICT=false: tools/list []; tools/call notes.exfil → 400 {"jsonrpc":"2.0","id":14,"error":{"code":-32602,"message":"The tool \"notes.exfil\" is refused by the pin gate"}}
```

The P1 exit line:

```
EXIT | the node serves only tools whose definitions hash to the manifest the operator configured, and every setting is read before any edition code runs (the H1 re-test's H-1, all four variants, end to end) | under-test: checker ["dist/index.js: import-unshipped"]; strict: refused (notes.exfil unpinned) after manifest-loaded pins/teaching.json; PIN_STRICT=false: tools/list [], notes.exfil not served | under-node-modules: checker ["dist/index.js: import-outside-exports"]; strict: refused (notes.exfil unpinned) after manifest-loaded pins/teaching.json; PIN_STRICT=false: tools/list [], notes.exfil not served | extensionless-entry: checker ["dist/entry: process-referenced"]; strict: refused (notes.exfil unpinned) after manifest-loaded pins/teaching.json; PIN_STRICT=false: tools/list [], notes.exfil not served | extensionless-import: checker ["dist/helper: process-referenced"]; strict: refused (notes.exfil unpinned) after manifest-loaded pins/teaching.json; PIN_STRICT=false: tools/list [], notes.exfil not served
```

## §1.6 The two Lows

`manifest-loaded` is written only after the parse succeeds; a manifest read and refused is
recorded with the same path and hash. A rename or replacement under the path is told apart from a
link, so the message never sends an operator looking for a link that is not there.

```
MANIFEST refused: manifest-refused {"path":"<tmp>/not-a-manifest.json","sha256":"<sha256>","reason":"ManifestError"}
MANIFEST a link on the way: the manifest's path passes through a symbolic link: a node reads its committed manifest from a path with no link on the way
MANIFEST renamed or replaced under the path: the manifest file changed while it was being opened (it was renamed, replaced or removed): a node reads one file, once
MANIFEST admitted notes.read 8d8cfa77e141; refused []
```

And the entry's own refusals:

```
ENTRY CLEARSEAL_EDITION missing: SettingsError: CLEARSEAL_EDITION is required: the package name of the edition this node serves
ENTRY CLEARSEAL_EDITION empty: SettingsError: CLEARSEAL_EDITION is required: the package name of the edition this node serves
ENTRY CLEARSEAL_EDITION a relative path: SettingsError: CLEARSEAL_EDITION must be a package name, not a path or a URL (got "./dist/index.js"): the operator's install decides what it resolves to
ENTRY CLEARSEAL_EDITION an absolute path: SettingsError: CLEARSEAL_EDITION must be a package name, not a path or a URL (got "<tmp>/index.js"): the operator's install decides what it resolves to
ENTRY CLEARSEAL_EDITION a parent path: SettingsError: CLEARSEAL_EDITION must be a package name, not a path or a URL (got "../edition"): the operator's install decides what it resolves to
ENTRY CLEARSEAL_EDITION a file URL: SettingsError: CLEARSEAL_EDITION must be a package name, not a path or a URL (got "file://<tmp>/index.js"): the operator's install decides what it resolves to
ENTRY CLEARSEAL_EDITION a deep subpath: SettingsError: CLEARSEAL_EDITION must be a package name, not a path or a URL (got "@clearseal/teaching/dist/index.js"): the operator's install decides what it resolves to
ENTRY an extra export: SettingsError: @clearseal-cli-test/extra exports manifestPath: an edition exports its definitions and its configSchema, and nothing else
ENTRY a missing export: SettingsError: @clearseal-cli-test/short does not export configSchema: an edition exports its definitions and its configSchema
ENTRY a well-formed edition, by name: http://127.0.0.1:42083/mcp serves ["echo"]
```

## §3.4 Red-proofs and control-deletion rows

Twelve new rows, each red by its named test's own assertion:

| Row | Control | What its stub deletes |
|---|---|---|
| `entry-captures-before-edition` | §1.1 the capture comes first | imports the edition before the capture |
| `entry-edition-is-a-name` | §1.1 a package name, never a path | the name check |
| `entry-exports-checked` | §1.1 two exports, nothing else | the extra-export refusal |
| `settings-env-is-a-copy` | §1.2 the snapshot's environment is a frozen copy | the copy (keeps the caller's object) |
| `startnode-reads-the-snapshot` | §1.2 `startNode` reads the snapshot | reads `process.env` instead |
| `manifest-loaded-after-parse` | §1.6 written only after the parse | writes it before |
| `manifest-refused-row` | §1.6 a refused manifest is recorded | the `manifest-refused` row |
| `manifest-rename-told-apart` | §1.6 a rename is not called a link | the distinction |
| `boundary-import-unshipped` | §1.5 no import into `test/` or `node_modules/` | the check |
| `boundary-import-unread` | §1.5 every import lands on a read file | the check |
| `boundary-entry-unread` | §1.5 every entry is read | the check |
| `boundary-reads-extensionless` | §1.5 extensionless files are read | skips them |

## Adversarial pass (WO §5)

A fresh subagent ran §5 in its own worktree, at `48e7763`, through `clearseal-node` as a process. **It
could not serve, or pin, a tool the operator's manifest does not pin, and it found no core setting read
after edition code runs. No High findings.** I checked each Low against the code before acting.

| # | Attempt | Result | Disposition |
|---|---|---|---|
| X1 | §5.1, §5.2 load-time code reassigning CLEARSEAL_MANIFEST, PIN_STRICT, CLEARSEAL_EDITION, AUDIT_STORE and the edition's own variables | no effect: every read had already happened. Refused under the strict default; `manifest-loaded` named the operator's file | — |
| X2 | §5.2 `Object.defineProperty(process.env, "CLEARSEAL_MANIFEST", { get })` at load, and replacing `process.env` itself | no effect | — |
| X3 | §5.3 a `package.json` `imports` map (`import "#steal"`) | a checker finding (`import-outside-exports`); not served | — |
| X4 | §5.3 an uppercase extension (`./helper.JS`) | Node's loader refuses `.JS`, so it never ran; the checker also flagged it. **But the walk did not read it** | **fixed** (L1): the walk matches module extensions case-insensitively, with its own red-proof [boundary-reads-extensionless] |
| X5 | §5.3 a conditional export (`exports["."].node`) naming a target the walk skipped | Node refuses it at load; `entry-unread` and `conditional-exports` both fired | — |
| L2 | the inventory matched only the literal `process.env`, so an aliased read (`const p = process; p.env[…]`) or a destructured one would evade it | not reachable by an edition (it cannot edit the core), but a real guard against future drift in the core itself | **fixed**: the inventory also matches a computed read off `process` and destructuring `env` from it |
| L3 | a `postinstall` script in an edition's `package.json` runs arbitrary code at **install** time, and the checker has no visibility into `scripts` | out of scope by §4 (install-time hostile code is code already inside), and it does not defeat the ordering control | **not built; flagged for the architect.** Worth a rule of its own: an edition that ships an install hook is a finding. I did not add it because §1.5 is about files an import can reach, and a hook is a different surface |

**One correction to my own wording, from the subagent's reading.** `settings.ts`'s header said "the core
reads `process.env` nowhere else". That is true of what a node *does*, but not of the source text: five
exported readers keep a `= process.env` default parameter for a caller outside the capture step. The
header now says so, and points at the inventory and the mutation test, which are what enforce it.

## Gates

- `npm run check` exits 0: 702 core and teaching tests (701 before the adversarial fixes; 693 on
  `main`), spike 0102 69, spike 0101 8, `test:subset` 4.
- `control-deletion`: 137 rows, **all red by assertion**, on the final code (675 s); `--self-test`
  passes. Twelve stubs were re-targeted at the code that now holds their control, and two rows were
  updated to name `node/settings.ts`, the file their check moved into.
- **Three rows were retired, because §1.3 removed the control they guarded:** `boundary-bin-imports`,
  `boundary-bin-no-reexport` and `boundary-startnode-call` all tested rules about an edition's `bin/`,
  and an edition no longer has one. `boundary-startnode-bin-only` stays, retargeted: an edition may
  now import no core value at all. `test/deletion/**` is this WO's working surface, so this is an
  edit the WO allows; it is called out here because retiring a row is otherwise a thing to refuse.
- `node scripts/leak-gate.mjs --tree` exit 0; `--history` exit 0, run unpiped with the exit code
  checked directly before every push.
- CI: the pull request's checks, on both runners, with `control-deletion`. The first run failed on the
  Windows runner, in two of my own new assertions: an audit row is JSON, so a Windows path's separators
  are escaped inside it, and I had compared the raw path text. (The `-1007a` clause I replaced had
  escaped it; I dropped that when I rewrote it.) Both now compare the parsed field, or the escaped
  form, so they hold on either platform. Nothing in the core changed.
- Protected surfaces diff to empty against `b88f71f`, except the two the WO allows: `auth/**` and
  `transport/**` change only where an environment read moved (`transport/server.ts` gains a comment
  naming its verifier fallback, and `startTransport` gains no new behaviour), and `pinning/**` is
  untouched.
- The minted token lived in a mode-0600 scratch file, was never written to git config or a remote
  URL, and was deleted after the pull request was opened.

## What was not built

- In-process sandboxing, and freezing built-ins against an edition's load-time code (§4, and the P2
  hardening WO). Step 3 of the entry runs the edition's code in the node's process: an edition that
  patches hashing, JSON or a prototype at load is hostile code already inside the node. The snapshot
  closes the ordering hole, not that one, and both `settings.ts` and `cli.ts` say so in their headers.
- Manifest signing (`-2004`).
- No change to what the gate, the registry, the transport, auth or the audit *decide*. The reads moved;
  `pinning/registry.ts`'s two fallbacks are untouched, so `-1001`'s adversarial F5 control (an omitted
  `strict` falls back to `PIN_STRICT`) still holds and is named in the inventory.
- Log rotation, and the OS-log audit stores (P3, P4), unchanged from `-2002`.
