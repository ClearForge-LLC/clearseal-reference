# Changelog

All notable changes to this repository are recorded here, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. **Every work order updates this
file**, with one entry per work order, written from its pull-request title.

**Versions and tags.** Tags are `v0.<n>` until the first edition is proven on a host, and `v1.<n>`
after. Tags are annotated and created by the architect at phase boundaries, never by a work order.
Every tag's entry records the tagged commit beside it as
`ClearForge-LLC/clearseal-reference@<full commit SHA>`, so a consumer can pin either the tag or
the commit. A release carries the packed tarballs and their signed build-provenance attestation.

## [Unreleased]

### Added

- **CSR-WO-0000:** repository skeleton: workspaces, TypeScript, lint, tests, and CI that can go red.
- **CSR-WO-0001:** the leak gate: tree, history and self-test, with a leak-gate CI job.
- **CSR-WO-0000a:** skeleton corrections: ESLint 10, suppression policy, built exports.
- **CSR-WO-0002:** governance and supply chain: `SECURITY.md`, `CODEOWNERS`, this changelog,
  `CONTRIBUTING.md`, a bill-of-materials job, a reporting vulnerability-audit job, tag-triggered
  build provenance, and dependency-update automation.

### Dependencies

Every dependency is pinned exactly and named here with its reason. All of them are currently
development-only; `@clearseal/core` has no runtime dependencies.

- `typescript`: the compiler and type checker for the core and the root scripts. Kept on 6.0.x,
  within `typescript-eslint`'s supported range.
- `@types/node`: Node's type definitions, for the type checker.
- `eslint` and `@eslint/js`: the linter and its recommended rules.
- `typescript-eslint`: type-aware lint rules, including `no-floating-promises`.
