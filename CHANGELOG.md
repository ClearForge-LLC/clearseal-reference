# Changelog

All notable changes to this repository are recorded here, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. **Every work order updates this
file**, with one entry per work order, written from its pull-request title.

**Versions and tags.** Tags are `v0.<n>` until the first edition is proven on a host, and `v1.<n>`
after. Tags are annotated and created by the architect at phase boundaries, never by a work order.
Every tag's entry records the tagged commit beside it as
`ClearForge-LLC/clearseal-reference@<full commit SHA>`, in exactly that plain form and not as a
commit link, so a consumer can pin either the tag or the commit. A commit cannot contain its own
SHA, so the entry is completed in the first commit after the tag. A release carries the packed
tarballs and their signed build-provenance attestation. Verify a tarball against its tag and the
provenance workflow, not just this repository, because pull-request dry runs of that workflow
produce attestations too: `gh attestation verify <tarball> --repo
ClearForge-LLC/clearseal-reference --source-ref refs/tags/<tag> --signer-workflow
ClearForge-LLC/clearseal-reference/.github/workflows/provenance.yml`.

## [Unreleased]

### Added

- **CSR-WO-0000:** repository skeleton: workspaces, TypeScript, lint, tests, and CI that can go red.
- **CSR-WO-0001:** the leak gate: tree, history and self-test, with a leak-gate CI job.
- **CSR-WO-0000a:** skeleton corrections: ESLint 10, suppression policy, built exports.
- **CSR-WO-0002:** governance and supply chain: `SECURITY.md`, `CODEOWNERS`, this changelog,
  `CONTRIBUTING.md`, a bill-of-materials job, a reporting vulnerability-audit job, tag-triggered
  build provenance, and dependency-update automation.
- **CSR-WO-1005:** the transport, owned: one stateless Streamable HTTP POST endpoint serving MCP
  `2026-07-28` natively and the legacy `2025-11-25` handshake as a pure function, with no session,
  every limit enforced and tested in this layer, JSON Schema 2020-12 argument validation,
  `x-mcp-header` handling, HMAC-sealed MRTR `requestState`, and a refuse-all verifier seam.
  `packages/core/src/transport/SPEC-MAP.md` maps it to the specification.

- **CSR-WO-1002:** containment.
  - `containment_domain` entries are parsed under three schemes (`fs:`, `host:`, `svc:`); a
    malformed or non-canonical entry is refused at construction, never fixed.
  - A `Cage` interface; the core's `RecordingCage` enforces the domain in-process and records every
    reach.
  - N7 at construction: `arbitrary_exec` is refused a domain, and refused outright while
    `EXEC_TOOLS_FORBIDDEN` is on, which is the default.
  - `tools/call` runs every handler inside a per-call cage and refuses an undeclared reach.
  - A reusable reach harness for editions.
- **CSR-WO-1007b:** the core owns the process entry (the H1 re-test's H-1).
  - `clearseal-node`, a core executable, is the only way a node starts. It reads every operator
    setting — `CLEARSEAL_EDITION`, `CLEARSEAL_MANIFEST`, `PIN_STRICT`, `EXEC_TOOLS_FORBIDDEN`,
    `AUTH_*`, `AUDIT_*`, the request-state key and the transport's settings — into one frozen
    snapshot, reads and hashes and parses the manifest, and opens the audit store, **before** it
    imports the edition. The edition is named by package, never by path.
  - `startNode` takes the snapshot and the edition's two values, and no core code reads
    `process.env` after the capture. A test rewrites the environment after capture and shows every
    setting, and the running node's own configuration, unchanged; an inventory names every
    `process.env` read in the core's source.
  - Editions lose `bin/`: an edition imports types from the core and holds no core value at all.
  - The supply-boundary checker reads every file an import can reach, extensions or none, and
    refuses an import into the edition's `test/` or `node_modules/`, an import to any file it did
    not read, and a package entry it did not read.
  - `manifest-loaded` is written only after the manifest parses; a manifest read but refused writes
    `manifest-refused` with the same path and hash. A manifest renamed or replaced under its path is
    refused as a file that changed, not as a symbolic link.
- **CSR-WO-1007c:** the node entry, finished (the H1 re-test #2's M-1 and its two Info items).
  - The installed `clearseal-node` command starts a node. The entry carries a `#!/usr/bin/env node`
    line, and its main-module check compares real paths on both sides, so npm's bin link, the
    Windows `.cmd` shim and `node <link>` all start one. A test packs the core and the teaching
    edition, installs them with npm into a temporary prefix, and runs the command both ways on both
    runners.
  - Before the settings snapshot, the entry refuses a process started with a module-loading flag,
    from `NODE_OPTIONS` or the command line: `--import`, `--require`/`-r`, `--loader`/
    `--experimental-loader`, `--experimental-config-file`/`--experimental-default-config-file`,
    `--snapshot-blob`, `--experimental-package-map`, `-e`/`--eval`, `-p`/`--print`, and `--test`,
    `--test-reporter` and `--test-global-setup`. The refusal names the flag and where it came from.
    Other flags are allowed.
  - The supply-boundary checker makes any syntactic diagnostic TypeScript reports for an edition
    file a finding, naming the file, the line and the diagnostic, so `import source m from "X"` no
    longer hides `X` from the import rules. A `package.json` that declares a script npm runs on
    install (`preinstall`, `install`, `postinstall`, `prepublish`, `preprepare`, `prepare`,
    `postprepare`, `dependencies`), or a `binding.gyp`, is a finding.
  - The teaching README tells operators to install editions with scripts disabled and to start
    `clearseal-node` without a module-loading flag.
- **CSR-WO-2001:** approval: a grant bound to one call, redeemed once, decided on a channel the
  caller cannot reach.
  - A tool pinned `elevated` runs only after a different principal approves that exact call. The grant
    binds the principal, the tool, the canonical argument digest and an expiry, and it is redeemed
    once. A decline is terminal, and the approver can never be the requester.
  - Without a grant the call answers *approval pending* with a request id, and its handler is never
    entered. The caller re-invokes with the id in `_meta`. An optional bounded wait lets a fast
    decision complete in one call.
  - Decisions are made on a second listener with its own address and port. A person decides through
    a one-time link plus a short code, which only the notifier (stderr or an https webhook) receives. A
    delegated approver presents the core's verifier's token for a distinct audience. An approval that
    discharges Rule-of-Two is decided by a person only (the standard §3).
  - The construction refusal of `elevated` tools lifts only when `APPROVAL_BACKEND` is configured in
    the settings snapshot. Every step is audited without a link, a code or an argument value.
- **CSR-WO-2007:** tripwire and rate limit, as two controls.
  - A per-principal rate limit after authentication (`packages/core/src/rate-limit/`): a token bucket
    per verified principal. Every authenticated request takes a token before a capacity slot is taken
    or the body is read. Over budget, the principal gets `429` with `Retry-After` (whole seconds,
    rounded up) and a JSON-RPC error, and one `rate-limited` audit row is written. Every other
    principal is served.
  - A read-burst tripwire (`packages/core/src/tripwire/`): per principal, it counts `tools/call`s that
    name an admitted tool whose pinned class is `read_only`. It writes exactly one `tripwire-read-burst`
    row per burst and re-arms after a quiet period. It refuses, delays and alters nothing.
  - Both run on an injected monotonic clock and hold bounded state. At the cap, a newcomer goes
    untracked, and one `principal-state-full` row says so. Their `RATE_LIMIT_*` and `TRIPWIRE_*`
    settings are read in the settings snapshot and validated before start.
- **CSR-WO-2002:** the audit store behind the audit seam.
  - `packages/core/src/audit/`: the `AuditStore`, `AnchorSink` and `Signer` interfaces; a
    JSON-lines store whose rows (`{ seq, time, event, principal, fields, prev }`, canonical JSON)
    each hash their predecessor and carry a principal; a file anchor and an in-memory anchor.
    `RULES.md` lists each rule (AU-1 to AU-24) with its red-proof and the event/field table.
  - Arguments never enter a row. Every call that reaches a handler writes one `tool-call` row with
    `args: "hmac-sha256:<kid>:<base64url>"`, keyed by the operator's digest key over the core's
    canonical argument digest. Every field is written bare only if the event table lists it and its
    value is of the listed kind; anything else is a keyed digest, including a containment sink.
  - Signed Ed25519 checkpoints go to the anchor every N rows or T seconds (defaults 100 and 300)
    and on close. `npm run audit -- verify` names every edited, removed, reordered or inserted row,
    a non-canonical row, a truncation behind a checkpoint, a head mismatch, an unknown kid, a key
    used outside its window, a bad signature and a replayed checkpoint; a torn final line is its
    own kind (exit 3).
  - `startNode` refuses to start without the `AUDIT_*` configuration (the same file checks as the
    manifest); `AUDIT_STORE=seam-only` is the development exception and writes a loud
    `audit-unanchored` row. `manifest-loaded` is the run's first row. A development key script,
    `scripts/audit-dev-keys.mjs`, is labelled not for production.
- **CSR-WO-1007a:** the operator names the manifest (the H1 re-test's F1 and F2).
  - `startNode({ definitions, configSchema })` reads the approved manifest from `CLEARSEAL_MANIFEST`
    (required; an absolute path or `file:` URL to a regular file with no link on the way), reads it
    once, and writes one `manifest-loaded` audit line with its path and the SHA-256 of the bytes the
    gate parses. An edition that passes anything else, a manifest path above all, is refused, and an
    edition's configuration may not claim the core's variable prefixes.
  - Editions export definitions and a configuration schema only. The teaching edition's `bin/`
    imports its own package entry by name; `pins/teaching.json` is the manifest an operator points
    `CLEARSEAL_MANIFEST` at.
  - The supply-boundary checker, stated as defense in depth: `import.meta` is banned outright;
    `bin/` imports only `startNode` and the edition's own entry; the export check's child reports
    through a line authenticated by a nonce it reads on stdin before the entry loads, and anything
    short of one well-formed authenticated report is a failure.
  - The P1 evidence reproduces F1 and F2 end to end, as real nodes started by their own `bin/`, and
    shows each refused at start against the committed manifest.
- **CSR-WO-2000:** the capability obligation, enforced at registry construction (the first P2
  control).
  - `capability/ladder.ts` computes a frozen obligation from each tool's frozen tag: which
    compensating controls it requires and forbids, each with its rule. It is pure and total over the
    four rungs and three booleans, and a table test enumerates all 32 combinations.
    `capability/RULES.md` quotes the standard's sentence for every rule.
  - The pinned registry refuses construction when a tool does not meet its obligation, naming the
    tool and the rule. Rule-of-Two is refused for an untrusted-facing `state_change` tool with
    neither a non-empty containment domain nor approval, and for an untrusted-facing
    `arbitrary_exec` tool without approval. `owned_state` auto-discharges it.
  - `owned_state` must pin a one-line `recoverability_basis` of at most 120 code points: no line
    terminator, control, format, invisible or unassigned character, and at least one letter or
    digit. No other rung may carry a basis.
  - Any `elevated` tool is refused, because no approval backend exists until CSR-WO-2001.
  - Thirteen control-deletion rows, one or more per rule.
- **CSR-WO-1007:** the core owns node assembly (the P1 exit red-team's H1).
  - `startNode` is the one public path from an edition's definitions to a serving node. It reads
    the configuration through the edition's schema, reads the committed manifest file (an absolute
    path or `file:` URL to a regular file, opened once with no link anywhere on the way), builds the
    gate and the registry itself, and starts the transport.
  - The teaching edition exports `definitions`, `manifestPath` and `configSchema`; its `bin/` calls
    `startNode` with those three. The notes root and the manifest are no longer environment
    variables.
  - The supply-boundary checker's rules hold under aliasing. Editions import only types from the
    core, and `startNode` in `bin/`. No reference to `process` in any form. `import.meta` only as
    `new URL(<literal>, import.meta.url)` naming a `.json` in `pins/`. No property of a core namespace.
    No type import used as a value. The H1 plant and fourteen variants each turn it red.
  - The P1 evidence test audits each refusal and refuses a name, a link and a FIFO at the cage.
  - The key-set request states `rejectUnauthorized`, so `NODE_TLS_REJECT_UNAUTHORIZED=0` cannot turn
    off its certificate check, and an `AUTH_JWKS_URL` with a user name or password refuses start.
- **CSR-WO-2008:** the control-deletion job (N5).
  - `test/deletion/controls.json` names 45 built controls. Each row has a reviewed stub (a patch
    that deletes the control) and the specific tests that must fail. The rows cover every *built*
    §8 row and every P1 exit-gate clause.
  - `scripts/control-deletion.mjs` applies each stub to a throwaway copy of the tree, with its own
    workspace links, and requires every named test to fail by assertion. A test that stays green,
    fails some other way, or never runs, or a stub that no longer applies, fails the job and names
    its row. The unpatched copy must pass the same tests first.
  - `--self-test` proves the runner fails a no-op stub, a stale stub and a build-breaking stub.
  - The `control-deletion` CI job runs it on every push and pull request. It is not a required
    check.
- **CSR-WO-1004:** the teaching edition's skeleton, and the supply-boundary test.
  - `packages/teaching`, a thin edition that depends on `@clearseal/core` through its package entry
    only. It exports tool definitions, its manifest path, a configuration schema and a `start()`
    scaffold, each declared by kind in its `package.json`.
  - `notes.read`: `read_only`, `untrusted_input_facing`, contained to the notes root, and reading
    through its cage only. It is pinned in the committed `pins/teaching.json`, with a drift test.
  - The supply-boundary test in the core's suite holds every edition under `packages/` to the
    enumerated kinds, and reads their source for imports outside the core's entry and for controls
    built at home. Three planted editions show it red.
  - `packages/teaching/test/p1-exit.test.ts` runs every P1 exit-gate clause, each against a real
    teaching node or as the core suite that proves it.
- **CSR-WO-1003:** the resource server's token verifier, AS-agnostic.
  - `packages/core/src/auth/CHECKS.md` lists every check, from RFC 8725, RFC 6750, RFC 9728 and
    the MCP authorization page, each with its negative test.
  - `JwtVerifier` is configured by `AUTH_ISSUER`, `AUTH_JWKS_URL` and `AUTH_AUDIENCE`, and the
    node refuses to start without them. It verifies ES256, EdDSA and RS256 with `node:crypto`
    only; no JOSE library is a runtime dependency. `none` and HMAC are refused before any key is
    looked up. `aud` is one audience, string-equal. The skew is a stated constant. The principal's
    id is the token's `sub`.
  - The key-set client is HTTPS only, cached for a TTL, refetches once per window on an unknown
    `kid`, serves a valid cache when the issuer is down and refuses with a cold one. It is capped at
    64 KiB and 32 keys, with a 3 s timeout.
  - Every `401` names the RFC 9728 metadata document. A failed token adds `error=invalid_token`;
    the reason goes to the audit seam only. A token offered in the query or a form body as well is
    `400 invalid_request`. The resource URL must be configured.
  - The principal's id is on every call-scoped audit line, including a containment refusal that
    fires after the handler returned.
  - An in-process HTTPS test issuer keeps the suite off the network. A dev harness
    (`packages/core/dev/oidc`, not for deployment) runs one end-to-end call against
    node-oidc-provider, a dev dependency pinned exactly.
  - `RefuseAllVerifier` is removed.
  - From the external red team: every HTTP-level refusal the transport sends writes exactly one
    audit line with a one-word reason and the principal once known. An RSA key is used only with an
    odd exponent of at least 65537 and a 2048 to 8192 bit modulus, which closes an e = 1 forgery.
    Token and key-set bytes decode as strict UTF-8.
- **CSR-WO-1001:** the pin gate. A node serves a tool only when its hash matches the approved
  manifest.
  - The manifest format and schema carry `build` slots, present but not enforced.
  - `PinGate` admits only matching definitions; drifted, unpinned, removed, duplicated and invalid
    definitions are refused by name.
  - The registry can be built only from the gate's admission, and the transport serves only that
    registry.
  - `PIN_STRICT`, on by default, stops the node on any refusal. A missing manifest stops it
    whatever the setting.
  - The operator path is `npm run pin -- diff | approve --yes | verify`.
  - The cross-repo detector compares the standard's §3 list with `canonicalFieldSet()`.
  - `PlaceholderRegistry` is removed.
- **CSR-WO-1000:** the canonical form, specified, ratified, then implemented from the
  specification.
  - `docs/canonical-form.md` has ten rules, ratified 2026-09-26: RFC 8785 as the JSON layer,
    numbers, strings without Unicode normalization, description normalization, names, the
    ten-field hashed set, sets, absent/null/empty, both hashes, and versioning.
  - The ten rules were amended before release: A1 limits nesting to 512 levels, A2 states that a
    literal is rounded to the nearest double, and A3 and A4 check the description both as given
    and after normalization.
  - `packages/core/src/pinning/canonical.ts` owns its JCS layer, with no dependency.
  - An independent Python oracle is the only writer of the 69 vectors in
    `packages/core/test/vectors/canonical-v1.json`. CI regenerates them and fails on any
    difference.
  - Property tests cross-check both implementations.
  - `test:subset` holds every gate-read field inside the hash.

### Changed

- **CSR-WO-2008a:** the control-deletion job runs sharded.
  - `scripts/control-deletion.mjs --shard <i>/<n>` runs shard `i` of `n`: the manifest's rows at
    index `k` with `k mod n = i - 1`, each shard with its own unpatched baseline before any of its
    stubs. A test proves the shards partition the manifest for every `n` from 1 to 8. Malformed and
    out-of-range shards are refused.
  - CI runs `CONTROL_DELETION_SHARDS` shards (4) as a matrix, the runner's self-test once, and an
    aggregate job that keeps the name `control-deletion` and succeeds only if every shard and the
    self-test succeeded. A failed, cancelled or skipped shard fails it. No row, stub or rule for what
    counts as red changed, and the job stays an optional check.
- **CSR-WO-1005b:** the HTTP status of an error is now era-dependent. On `2025-11-25`, a JSON-RPC
  error answering a well-formed request goes back at `200` with the error object unchanged, as that
  era's page and its client (the official SDK, which loses the code and `data` at any non-`2xx`)
  expect. HTTP-level refusals and the whole `2026-07-28` era are unchanged. SPEC-MAP gains the ST
  rows, an era column and LG-9.

### Fixed

- **CSR-WO-1006a:** two transport corrections from the `-1006` adversarial pass, before the P1
  exit red-team.
  - Dispatch calls a handler as a plain function, so its `this` is `undefined`. Before, `this` was
    the tool's frozen `RegisteredTool`, and a handler could build a cage from it that dispatch
    never saw. A reach through that cage was refused, but no audit line was written and the call
    returned `200`.
  - The running transport's config is deeply frozen, its limits and lists included, and the lists
    are copies of the caller's. Before, the code that started a node could set
    `config.limits.maxInFlight = 0` after start, and every call answered `503`.
  - From the adversarial pass: a handler's `ctx.cage` is a frozen facade over dispatch's cage, so
    `ctx.cage.constructor` builds no unaudited cage. The config is a plain-data snapshot, deep-frozen,
    and a value that is not plain data refuses the start. `SUPPORTED_VERSIONS`, `DEFAULT_LIMITS`,
    `DEFAULT_CONFIG` and the returned `RunningTransport` are frozen.
- **CSR-WO-1006:** three core corrections from the `-1004` adversarial pass.
  - Admitted tools are immutable (N2). Each tool the pinned registry holds is frozen at
    construction: the object, its definition, the schema and its parameter headers. `list()` and
    `get()` hand out those same frozen objects, and `list()`'s array is frozen too. Nothing that
    holds the registry can change what `tools/list` serves, or which handler and validator a call
    runs.
  - The cage opens regular files only, and never waits (N4). A directory, FIFO, socket or device
    inside a declared root is a recorded containment refusal naming its type. POSIX opens carry
    `O_NONBLOCK`, and the descriptor is `fstat`-ed after the open, so one swapped in after the
    check is refused too. A write open with no reader (`ENXIO`) is also a refusal. Before this, a
    FIFO held a worker and a concurrency slot past the handler timeout.
  - On Windows the cage resolves links. `resolveReal` uses `realpathSync.native`, which follows
    symlinks and junctions, and the leaf link check applies there too. A symlink or junction
    planted in a root is refused. Spellings of a root (case, drive letter, `\\?\`, 8.3 names)
    resolve to one canonical form, measured on `windows-latest`. The check-then-open race on
    Windows remains the edition OS cage's job. The reach harness uses the cage's own root
    comparison.
  - From the adversarial pass: a path whose real path cannot be resolved for any reason but absence
    (a link into a real path longer than `PATH_MAX`, a loop) matches no root. Before, a write open
    through it truncated a file outside the root before the refusal. A directory or FIFO swapped in
    and refused by the open itself (`EISDIR`, or `EEXIST` under `O_EXCL`) is a recorded refusal. On
    Windows a reserved device name in the path is refused as a device.
  - Under the architect's scope amendment: `startTransport` captures once at start the registry it
    checked, a private copy of the request-state key and a frozen copy of `serverInfo`, and the
    request path reads only those. Before, code holding the options object could swap the served
    registry, or rewrite the key's bytes and forge request state, after start. The
    `containment-refused` audit line also names the file type when the reach has one.
- **CSR-WO-1003a:** auth corrections from the `-1003` review and red-team.
  - An issuer outage (the key set unreachable, no valid cache) answers `503` with `Retry-After` and
    no challenge, not `401 invalid_token`, so a correct client keeps its token. The verdict carries
    the distinction as a field.
  - `AUTH_MAX_TOKEN_LIFETIME_S` (default 86400) bounds how far out `exp` may lie.
  - `typ` accepts `JWT`, `application/jwt`, `at+jwt` and `application/at+jwt`, case-insensitive;
    `AUTH_REQUIRE_AT_JWT=true` accepts the `at+jwt` spellings only.
  - The default audit sink escapes line-separator and bidirectional-control characters.
  - `AUTH_JWKS_CA_FILE` trusts a private-CA issuer for the key-set client only.
  - An audience that differs from the resource URL is audited at start, and each JSON-RPC error
    writes one `rpc-refused` line.
  - From the adversarial pass: an unknown `kid` whose refetch fails during an outage is also a
    `503`, and the failed refetch no longer spends the window. The sink also escapes DEL, the C1
    controls and every format character. A logged method is bounded. A CA file allows no other PEM
    armour and is read without blocking. Numeric settings are plain digits.
- **CSR-WO-1002a:** two containment corrections from the `-1002` review.
  - A symlink swapped into a file's leaf after the cage's check, which the kernel refuses under
    `O_NOFOLLOW`, is now recorded and audited as a containment refusal instead of surfacing as a
    plain handler error. That covers `ELOOP` and `EMLINK`, plus `EEXIST` under `O_EXCL` when a link
    now sits at the leaf.
  - A `read_only` tool's cage now opens files for reading only, even under a declared root. Other
    classes are unchanged.
  - The cage seam editions implement (`cageFor`, `recordingCageFactory`, the harness's `makeCage`)
    now carries a frozen `CagePolicy` with the tool's pinned class.
  - The reach harness now fails a `read_only` tool that writes, whether its cage allowed the write
    or the shim saw it directly, and it records the written path of two-path fs calls.
- **CSR-WO-1005a:** two corrections to the transport, from the `-0101` spike's findings.
  - The server now owns the validation pool and closes it on `close()`. An open pool kept the
    process alive despite `unref()`.
  - A handler's `input_required` result on a `2025-11-25` request is now refused with
    `400`/`-32601`, instead of a `500`.

### Dependencies

Every dependency is pinned exactly and named here with its reason.

- `z-schema` (**runtime**, `@clearseal/core`, CSR-WO-1005): JSON Schema 2020-12 validation of
  `tools/call` arguments before any handler runs. It was chosen by measurement over six candidates:
  the only one to pass all 1252 required draft 2020-12 tests in scope, it generates no code, has
  no install script, and fetches nothing unless a loader is installed (the transport refuses to
  run if one is). Writing a complete 2020-12 validator would be the larger risk. Its tree is 5
  packages (`punycode`, `safe-regex2`, `ret`, `validator`), plus `commander`, an optional
  dependency used only by its command line.

- `@modelcontextprotocol/sdk` (**dev only**, `@clearseal/core`, CSR-WO-1005b): the official SDK's
  client, driven against the transport by `packages/core/test/sdk-client/` to prove what a
  `2025-11-25` client receives. Pinned at 1.30.1, the version `-0100` measured. It is imported by that
  test alone; no source file imports it and no runtime dependency names it (`eras.test.ts`). The
  tree already carried it for `spikes/0100-protocol`, so the lockfile gains no package.

- `fast-check` (**dev only**, `@clearseal/core`, CSR-WO-1000): property-based tests of the
  canonicalizer, cross-checked against the Python oracle. Pinned at 4.10.2. Its tree is 2 packages
  (`fast-check`, `pure-rand`), both MIT.

- `typescript`: the compiler and type checker for the core and the root scripts. Kept on 6.0.x,
  within `typescript-eslint`'s supported range.
- `@types/node`: Node's type definitions, for the type checker.
- `eslint` and `@eslint/js`: the linter and its recommended rules.
- `typescript-eslint`: type-aware lint rules, including `no-floating-promises`.
