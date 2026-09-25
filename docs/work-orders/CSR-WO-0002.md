# CSR-WO-0002 — Governance and supply chain: disclosure front door, ownership, versioning, and evidence of what ships

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` after `CSR-WO-0000` has merged
(verify live HEAD; if `.github/workflows/ci.yml` is absent, the base is wrong — stop).
**Branch:** `wo/CSR-WO-0002`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P0 — skeleton, gates, and spikes · **Phase exit gate:** the clauses this work order owns:
every CI run publishes a bill-of-materials artifact; a tag publishes a provenance attestation; the
dependency-update configuration exists and has opened at least one pull request.
**Grounds:** `docs/northstar.md` N5, N6, N8; `docs/architecture.md` §5 rows *Supply chain in CI*,
*Governance*, *Key identity and rotation* (for the tagging convention); §7.1 rows *A compromised
dependency* and *An attacker with write access to the deployed tree*; §8 row *Supply chain*;
§9 (external contributions); `docs/roadmap.md` P0. Code seams: `.github/workflows/ci.yml` and
`package.json` from `CSR-WO-0000`.

> **What this is:** the files and CI jobs that turn "pinned by SHA" from a claim into evidence, and
> give a public repository its front door — a disclosure path, named owners, a version scheme, a
> changelog, and a contribution default. It is NOT the leak gate (`CSR-WO-0001`), NOT release
> integrity (a deferred control in `architecture.md` §8), and NOT a publishing decision. Why now:
> these are forty lines of workflow and five small files, and every later phase inherits them; the
> same files added in P3 are a retrofit with a history that says the repository shipped without them.

**Cadence:** build. One PR, left unmerged for review.

> **As-built amendment (2026-09-25).** (1) The `/goal` text in §8 carried the clause *"dependency-update
> automation that has opened a pull request"*, which can only be true after `main` carries the bot's
> configuration — a clause past the builder's authority boundary. The goal hook looped on it until
> its cap. The architect's error; the phase gate keeps the clause because a human checks it after
> merge, but no builder goal carries it again. (2) `CODEOWNERS` cannot name an organization — the
> platform requires a user or a team. Merged as written (protects nothing, harms nothing); the gate
> creates a team with write access and the architect changes the three lines. (3) A tag ruleset
> restricting `v*` creation, update and deletion to repository admins and the architect's app was
> set by the architect at merge, closing the finding that any write access could cut a release.
> (4) Engine strictness: first ruled to move out of `.npmrc`; then measured — the bot regenerated
> the lockfile under the exact pin within minutes of merge — so `.npmrc` stays and `CSR-WO-0002a`
> only adds an explicit check to `npm run check`. The bot's first two pull requests were majors
> (a TypeScript major outside the pinned peer range; a `@types/node` major ahead of the runtime),
> closed by the architect with the reason on each; both failed the leak gate as predicted.

## 1. Scope — numbered, specific

1. **`SECURITY.md`.** Supported versions (currently: `main` only, until the first tag); how to
   report — the platform's private vulnerability reporting for this repository, and nothing else
   (no e-mail address, no chat handle: the leak gate forbids them and a public address rots);
   what a reporter can expect (acknowledgement window, no bounty); a one-line statement of scope
   — the reference and its editions, not deployments built on them.
2. **`CODEOWNERS`.** Repository-wide ownership by the organization's owning team or account; the
   `docs/` tree and `.github/` additionally listed so a change to a steering document or a workflow
   cannot merge without the owner. Use the organization-level handle, not a personal one.
3. **`CHANGELOG.md`.** Keep-a-Changelog format, `## [Unreleased]` only, with one entry per merged
   work order so far (`-0000`, this one) written from their pull-request titles. The changelog is
   updated by every work order from here on; say so in its header.
4. **`CONTRIBUTING.md`.** A conservative default, labelled as a default awaiting the gate's ruling
   (`architecture.md` §9): issues welcome; documentation and typo pull requests welcome; substantive
   changes start as an issue because the repository is built by work orders and a change that
   arrives without one has no phase, no gate, and no invariant restated. Explain the work-order
   model in three sentences and point at `docs/roadmap.md`.
5. **Tagging convention**, written into `CONTRIBUTING.md` and `CHANGELOG.md`: tags are `v0.<n>`
   until the first edition is proven on a host, `v1.<n>` after; every tag's changelog entry records
   the commit SHA beside it so a consumer may pin either; tags are annotated and are created by the
   architect at phase boundaries, never by a work order.
6. **Bill of materials.** A CI job on every push and pull request that runs the package manager's
   built-in SBOM generation in CycloneDX format over the installed tree and uploads it as a workflow
   artifact named for the commit. The job fails if the artifact is empty or malformed (parse it).
7. **Provenance on tags.** A workflow triggered by `v*` tags that packs each workspace package,
   produces a signed build-provenance attestation for the tarballs using the platform's
   attestation action, and attaches tarballs and attestations to a release. The workflow needs
   `id-token: write` and `attestations: write` for that job only — grant them at the job, not the
   workflow, and keep the default `contents: read` everywhere else (`contents: write` on the release
   step alone).
8. **Vulnerability audit, reporting.** A CI job that runs the package manager's audit at `high`
   and above and publishes the result as a job summary. **It does not fail the build** — a new
   advisory in a transitive dependency should not block an unrelated pull request — but its
   summary is visible on every run, and the maintenance cadence in the roadmap reviews it.
9. **Dependency automation.** A configuration for the platform's dependency-update bot covering
   `npm` (root and workspaces) and `github-actions`, weekly, grouped, with action updates keeping
   the commit-digest pin and the version comment (`-0000` established the pin style; this keeps
   it maintainable). Open the configuration so at least one update pull request has been raised
   by the time this work order parks — that is part of the phase gate.
10. **Every new action pinned by full commit SHA with the version in a trailing comment**, the
    style `-0000` set. List them in FEEDBACK.
11. **`FEEDBACK.md`** at the repository root on this branch, per §6.

## 2. Invariants — restated by number from the northstar

The authoritative source is `docs/northstar.md` §4.

- **N5** — the bill-of-materials job must be shown to fail: push a commit that breaks the artifact
  (an intentionally malformed output path is enough), observe red, revert with a follow-up commit.
- **N6** — no deployment identifier in any file this work order adds. `SECURITY.md` and
  `CONTRIBUTING.md` are the two files most likely to attract an address or a name; they get neither.
  `CODEOWNERS` uses the organization handle.
- **N8** — no secret. The attestation flow uses the platform's OIDC identity token, obtained at run
  time by the job's granted permission; nothing is stored. If any step wants a stored token, stop.

**Protected surfaces — must diff to empty:** `docs/northstar.md`, `docs/architecture.md`,
`docs/roadmap.md`, `README.md`, `LICENSE`, `NOTICE`, `packages/**`, `scripts/**`, and the `test`
job in `ci.yml` (add jobs; do not alter the existing one).

## 3. Tests / acceptance — what must be proven, not asserted

1. `SECURITY.md`, `CODEOWNERS`, `CHANGELOG.md`, `CONTRIBUTING.md` exist and pass the sanitisation
   rules the leak gate will apply (the builder runs the rules by hand until `-0001` lands: no owned
   domains, no addresses, no handles, no home paths).
2. A CI run on this branch shows the bill-of-materials artifact; its download parses as CycloneDX
   and lists at least every direct dependency in `package-lock.json`. Paste the artifact name and
   the component count.
3. The bill-of-materials job has been observed red once (§2) and the revert is in history.
4. The audit job's summary is visible on a run; paste it, including a zero-finding result if that
   is what it is.
5. The provenance workflow is validated without a tag: run it on the branch with a manual trigger
   guarded so it does **not** create a release when not on a tag, and confirm the attestation step
   succeeds against a packed tarball. The actual tag run is the architect's, at the P0 boundary.
6. The dependency-update bot has opened at least one pull request against the repository; paste
   its link. If none was opened because nothing was out of date, say so and show the bot's
   configuration was accepted by the platform (its check run or log).
7. The existing `test` job is unchanged (diff of that block is empty) and green on both runners.

## 4. Scope fence — what is NOT in this work order

- **The leak gate.** `CSR-WO-0001`. Not started here; the sanitisation check in §3 item 1 is
  manual precisely because the gate does not exist yet.
- **Release integrity** — a node attesting its own distribution digest at start. Deferred in
  `architecture.md` §8 with a named trigger. Provenance here proves what CI built; nothing here
  checks what a node runs.
- **Publishing to any registry.** `architecture.md` §5. The provenance workflow produces tarballs
  attached to a release, not a registry publish.
- **Signed commits or signed tags policy.** A gate decision, not this work order's.
- **Any change to `packages/**` or the test job.**
- **A ruling on external contributions.** `CONTRIBUTING.md` ships the default and says it is one.

## 5. Adversarial pass — try to break it before calling it done

Fresh subagent if available; otherwise yourself, framed as an attack on the finished branch.

1. Grant `id-token: write` at the workflow level "by accident" in a scratch commit; confirm the
   review would catch it (the FEEDBACK lists every `permissions:` block with its scope) and revert.
2. Feed the bill-of-materials job an empty file; confirm it fails rather than uploading nothing.
3. Change one new action's SHA pin to a tag; confirm the `grep -n "uses:"` listing shows it.
4. Read `SECURITY.md` and `CONTRIBUTING.md` as a stranger looking for a person to contact; confirm
   there is exactly one path and it is the platform's.
5. Check `CODEOWNERS` syntax with the platform's validator (a malformed file silently protects
   nothing).
6. Check every file added for anything N6 forbids.

## 6. Upward-feedback directive

`FEEDBACK.md` at the repository root on this branch. Schema per entry:
`finding · where (file:line) · type (note | risk | scope-question | bug) · recommendation · decision-needed (yes/no)`.
Lead with anything crossed or parked. Include: a **gates line** (artifact name and component count,
the red bill-of-materials run URL and its revert, the audit summary, the provenance dry-run URL, the
dependency-update pull request link or the reason there is none, protected-surface diff status);
every `permissions:` block and every `uses:` pin; **what did not work and why**; and a **"what was
deliberately not built"** section restating §4.

## 7. Flag-and-stop conditions

Park the branch and say so:

- Any step that needs a stored secret or a personal access token.
- The attestation action cannot be pinned to a commit SHA, or requires a permission broader than
  the job it runs in.
- The dependency bot cannot keep commit-digest pins on actions (it would downgrade `-0000`'s pin
  style to tags).
- A file that would carry something N6 forbids — including a maintainer's name in `CODEOWNERS`
  when the organization handle is available.
- A protected surface that must change.

## 8. Kickoff prompt

Sent to the builder session as one message, after `/goal` in its own turn.

`/goal` text:
> A branch `wo/CSR-WO-0002` off current `main` adding `SECURITY.md`, `CODEOWNERS`, `CHANGELOG.md`
> and `CONTRIBUTING.md` (no address, handle, or path in any of them), a CI bill-of-materials job
> shown to fail once and green after, a reporting audit job, a tag-triggered provenance workflow
> validated by a guarded dry run, and dependency-update automation that has opened a pull request —
> with every new action pinned by commit SHA, the existing `test` job untouched, and the work
> parked as one unmerged pull request with `FEEDBACK.md` at the root. Stop at parked.

Kickoff:
> Sync first: `git fetch origin && git checkout -b wo/CSR-WO-0002 origin/main` — confirm
> `.github/workflows/ci.yml` exists on that base; if it does not, `-0000` has not merged and you
> stop. Cadence: **build** — no spike. Read `docs/work-orders/CSR-WO-0002.md` in full; it is the
> directive; `docs/architecture.md` §5 (*Supply chain in CI*, *Governance*), §7.1 and §9 are the
> source of truth it cites.
> Ratified with reasons in the WO: the disclosure path is the platform's private reporting and
> nothing else (the leak gate forbids addresses); the audit job reports and does not block (a
> transitive advisory must not stall an unrelated PR); provenance is attested on tags only and the
> tag run is the architect's; permissions are granted per job, never per workflow; the dependency
> bot must keep commit-digest pins. `CONTRIBUTING.md`'s policy is a labelled default, not a ruling.
> Invariants: N5 — show the bill-of-materials job red once; N6 — the two prose files are where an
> address or a name wants to land, and they get neither; N8 — no stored secret; the attestation
> flow uses the job's identity token. Protected surfaces diff to empty: the four steering
> documents, LICENSE, NOTICE, `packages/**`, `scripts/**`, and the existing `test` job.
> Flag-and-stop: §7. Park rather than route around.
> Close with the gate: adversarial pass per §5, then `FEEDBACK.md` per §6, then one PR to `main`
> left unmerged. Report the PR link, the artifact name and component count, and the
> dependency-update PR link.
