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

- **CSR-WO-1005b:** the HTTP status of an error is now era-dependent. On `2025-11-25`, a JSON-RPC
  error answering a well-formed request goes back at `200` with the error object unchanged, as that
  era's page and its client (the official SDK, which loses the code and `data` at any non-`2xx`)
  expect. HTTP-level refusals and the whole `2026-07-28` era are unchanged. SPEC-MAP gains the ST
  rows, an era column and LG-9.

### Fixed

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
