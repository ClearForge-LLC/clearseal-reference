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

### Dependencies

Every dependency is pinned exactly and named here with its reason.

- `z-schema` (**runtime**, `@clearseal/core`, CSR-WO-1005): JSON Schema 2020-12 validation of
  `tools/call` arguments before any handler runs. It was chosen by measurement over six candidates:
  the only one to pass all 1252 required draft 2020-12 tests in scope, it generates no code, has
  no install script, and fetches nothing unless a loader is installed (the transport refuses to
  run if one is). Writing a complete 2020-12 validator would be the larger risk. Its tree is 5
  packages (`punycode`, `safe-regex2`, `ret`, `validator`), plus `commander`, an optional
  dependency used only by its command line.

- `typescript`: the compiler and type checker for the core and the root scripts. Kept on 6.0.x,
  within `typescript-eslint`'s supported range.
- `@types/node`: Node's type definitions, for the type checker.
- `eslint` and `@eslint/js`: the linter and its recommended rules.
- `typescript-eslint`: type-aware lint rules, including `no-floating-promises`.
