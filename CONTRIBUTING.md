# Contributing

> **This is a default, awaiting the project's ruling.** Whether external contributions are
> accepted beyond issues and documentation is an open question (`docs/architecture.md` §9). Until
> it is decided, the conservative policy below applies.

## What is welcome

- **Issues:** bug reports, questions, and proposals.
- **Documentation and typo fixes** as pull requests.
- **Substantive changes start as an issue**, not a pull request. The reason is the next section.

Security vulnerabilities are not issues. Report them privately, as `SECURITY.md` describes.

## How this repository is built

This repository is built by **work orders**. Each one is a numbered, scoped document under
`docs/work-orders/` that restates the invariants it touches and names the phase gate it serves.
It is proven (tests that are shown to fail, then pass) and reviewed before it merges. A change
that arrives without a work order has no phase, no gate and no restated invariant, so it can't be
reviewed on the same terms. An accepted issue becomes a work order, in the order
`docs/roadmap.md` sets.

## Versions and tags

Tags are `v0.<n>` until the first edition is proven on a host, and `v1.<n>` after. Tags are
annotated and are created by the architect at phase boundaries, never by a work order. Every tag's
`CHANGELOG.md` entry records the tagged commit beside it as
`ClearForge-LLC/clearseal-reference@<full commit SHA>`, so you can pin either the tag or the
commit.

## Checks every change must pass

`npm ci && npm run check` (typecheck, lint, build, tests) and `npm run leak-gate`. CI runs both,
and publishes a bill of materials and a vulnerability-audit summary on every run.
