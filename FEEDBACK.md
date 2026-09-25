# FEEDBACK: CSR-WO-0002 (governance and supply chain)

Branch `wo/CSR-WO-0002`, cut from `main` at `4e51bc2` (CSR-WO-0000a merged; `.github/workflows/ci.yml`
present). Parked as one unmerged pull request, #9. It was opened as a draft early, because the
provenance workflow's guarded dry run can only run on a pull request until that workflow exists on
`main`, and marked ready with this file.

Built on **Node v24.21.0**. Every commit carries the role identity as both author and committer, and
`node scripts/leak-gate.mjs --tree` and `--history` were clean before every push. Pushes went over
the repository's write deploy key. A short-lived token was minted **only** for the pull-request API
calls (open, then mark ready and update the description), kept in a mode-0600 scratch file, never
written to git config or a remote, and **deleted** after the last call.

## Crossed or parked: two items need the architect, and neither can be completed from this branch

1. **`CODEOWNERS` protects nothing as written.** A CODEOWNERS owner must be a user or an
   organization team (`@org/team`) with write access; **an organization handle is not a valid
   owner.** The platform's validator (`codeowners/errors`) reports `Unknown owner` on all three
   lines. The organization lists **no teams**, and none has access to this repository. The WO's
   fallback, a personal handle, is exactly what N6 and §7 forbid, so it was not used. In addition,
   the default-branch ruleset has `require_code_owner_review: false`, so even a valid file would
   not gate merges today. · `CODEOWNERS:4-6` · bug (§7-adjacent: the organization handle is not
   usable) · Create an organization team (for example `maintainers`) with write access to this
   repository; the change here is then `@ClearForge-LLC` → `@ClearForge-LLC/<team>` on three lines.
   Turn on code-owner review in the ruleset if the file is meant to gate merges. ·
   **decision-needed: yes**
2. **The dependency-update gate clause (§3.6) cannot be met before this merges.** The platform's
   dependency bot reads `.github/dependabot.yml` **only from the default branch.** Measured:
   - no bot pull request exists;
   - the repository has never had a dependency-update run;
   - the pull request shows no bot check.

   The configuration's keys are all valid per the documented schema (checked in the adversarial
   pass), but "accepted by the platform" can only be shown after merge. · `.github/dependabot.yml` ·
   scope-question · Merge; the first weekly run then opens pull requests (the tree has candidates,
   for example `@types/node` and a TypeScript major). Or land `dependabot.yml` ahead in its own
   small PR. Findings 3 and 4 predict what that first run will hit. · **decision-needed: yes**

Nothing else is crossed. No step needed a stored secret; the attestation uses the job's identity
token. The attestation action pins to a commit SHA, and so does the action it wraps. No protected
surface changed.

## Gates line

| Gate | Result |
|---|---|
| Bill-of-materials artifact | **`sbom-cyclonedx-35ae6933edaa`** (the final code commit's push run <https://github.com/ClearForge-LLC/clearseal-reference/actions/runs/36094825676>): **CycloneDX 1.5, 99 components**. Downloaded and parsed independently; it lists all 5 direct dependencies at their lockfile versions, matched by package URL (transcript below) |
| Bill of materials shown red (N5) | <https://github.com/ClearForge-LLC/clearseal-reference/actions/runs/36093837841> on `f28c7dc` (output written to a wrong path): `sbom` **failure**, every other job green, **0 artifacts uploaded**. Reverted by the follow-up commit `e305716` (not force-pushed): green again (run 36093921374) |
| Audit summary | "Dependencies audited: 100. Findings at high or critical: **0** (critical 0, high 0, moderate 0, low 0, info 0)." The job is green by design (reporting only) |
| Provenance dry run | <https://github.com/ClearForge-LLC/clearseal-reference/actions/runs/36094830153> (pull request, final workflow): `build` ✓, `attest` ✓, `release` **skipped** (guarded). Attestation created for `clearseal-core-0.0.0.tgz`, **verified independently**, and a tampered tarball fails. The documented release check **refuses** this pull-request attestation (below) |
| Dependency-update PR | **None yet, and none possible before merge** (crossed item 2) |
| `test` and `leak-gate` jobs | unchanged: lines 1-46 of `ci.yml` are byte-identical to `main`, and the diff only appends the `sbom` and `audit` jobs. Green on both runners on every run |
| CI on the final code commit `35ae693` | push <https://github.com/ClearForge-LLC/clearseal-reference/actions/runs/36094825676> and pull request <https://github.com/ClearForge-LLC/clearseal-reference/actions/runs/36094830216>: `test` ×2, `leak-gate`, `sbom`, `audit` all **success**. The run for this file's commit shows on the PR |
| Protected surfaces | `git diff origin/main...HEAD --stat -- docs README.md LICENSE NOTICE packages scripts` is **empty** |
| N6 | the four governance files, both scripts, both workflows and every commit on the branch pass `--tree` and `--history`. The adversarial pass read `SECURITY.md` and `CONTRIBUTING.md` "as a stranger" and found exactly one vulnerability path, the platform's private reporting, with no person, address, handle or path |

### Every `permissions:` block (WO §6)

Printed with `yaml.safe_load` over each workflow: the workflow-level block, then each job's block
or "(inherits workflow)".

```
.github/workflows/ci.yml          workflow        {'contents': 'read'}
.github/workflows/ci.yml          job:test        (inherits workflow)      <- unchanged from -0000
.github/workflows/ci.yml          job:leak-gate   {'contents': 'read'}
.github/workflows/ci.yml          job:sbom        {'contents': 'read'}
.github/workflows/ci.yml          job:audit       {'contents': 'read'}
.github/workflows/provenance.yml  workflow        {'contents': 'read'}
.github/workflows/provenance.yml  job:build       {'contents': 'read'}
.github/workflows/provenance.yml  job:attest      {'contents': 'read', 'id-token': 'write', 'attestations': 'write'}
.github/workflows/provenance.yml  job:release     {'contents': 'write'}
```

`id-token: write` appears in **one** job: `attest`, which runs no npm and no repository code.
`contents: write` appears only in `release`, which runs only on a pushed `v*` tag.

### Every `uses:` pin (WO §1.10, §6)

```
.github/workflows/ci.yml:18,34,53,78     actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
.github/workflows/ci.yml:21,41,56,81     actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
.github/workflows/ci.yml:67              actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1   (new)
.github/workflows/provenance.yml         actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
.github/workflows/provenance.yml         actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
.github/workflows/provenance.yml         actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1   (new)
.github/workflows/provenance.yml         actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1 (new)
.github/workflows/provenance.yml         actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2 (new)
  nested inside attest-build-provenance: actions/attest@508db95dd578ae2727ebd6217d5ba78e4fbda05d # v4.2.1
```

Each new SHA was resolved from the release tag (all lightweight tags) and re-checked with
`git ls-remote` in the adversarial pass. The attestation action is a composite whose only step
calls `actions/attest` **by SHA**, so pinning the outer action pins what runs.

## Findings

Schema: `finding · where · type · recommendation · decision-needed`.

3. **The bot's npm updates will probably fail to resolve** (a prediction; the first run will
   confirm). `.npmrc` sets `engine-strict=true` and `engines.node` is exactly `24.21.0`. Locally, a
   lockfile update under Node 22 or 24.16 fails with `notsup`. If the bot's updater runs a
   different Node version and honours `.npmrc`, every npm update errors. Actions updates are
   unaffected. · `.npmrc`, `package.json` · risk · Check the bot's log after merge. If it fails,
   choose between an engines range (such as `>=24.21.0 <25`) and keeping the exact pin with npm
   updates handled by a work order. · **decision-needed: yes**
4. **The bot's commits will probably fail `leak-gate --history`**, and the leak-gate job scans a
   pull request's head.
   - **What was tested:** in the adversarial pass, locally crafted commits imitating the bot.
   - **What passes:** its author and committer (platform no-reply addresses) are exempt.
   - **What fails:** a `compare/<40-hex>...<40-hex>` link, typical for SHA-pinned action bumps, is
     refused by `long-hex`. A `Signed-off-by:` trailer carrying the vendor's non-no-reply support
     address is refused by `email`.

   `scripts/**` is protected here, so the gate was not touched. · rules · risk · Decide before
   the first bot PR. Precise rule changes (per the `-0001` ruling: never an allow), such as an
   exact exemption for that sign-off address and for compare-URL SHAs, or rewording bot commits
   at squash. · **decision-needed: yes**
5. **Any account with write access can push a `v*` tag and get a release with valid provenance.**
   "Tags are created by the architect" is a convention: there is no tag ruleset, and this
   session's pushes use a write deploy key. · repository settings · risk · Add a tag ruleset
   restricting creation of `refs/tags/v*`. The documented verification already pins the tag ref
   and the signer workflow (below). · **decision-needed: yes**
6. **Pull-request dry runs create real, repository-valid attestations.** Attestations 50073427 and
   50075232 have source ref `refs/pull/9/merge`. So the verification command in the release notes
   and `CHANGELOG.md` pins **both** `--source-ref refs/tags/<tag>` **and** `--signer-workflow
   …/provenance.yml`. Proven on this PR's tarball (transcript below):
   - under its own ref: accepted;
   - under the release check: **refused**, "expected SourceRepositoryRef to be refs/tags/v0.1, got
     refs/pull/9/merge";
   - under the wrong signer workflow: **refused**.

   · `provenance.yml`, `CHANGELOG.md` · note · Keep both flags in every published instruction. ·
   decision-needed: no
7. **No identity token while dependency code runs.** From the adversarial pass. Originally one
   job held `id-token: write` through `npm ci`, the compile and `npm pack`, so a compromised
   compiler could tamper with the tarball before attestation, or mint a token. It is now split:
   `build` has no token, and `attest` downloads the tarballs and runs only the attestation action.
   Lifecycle scripts are off (`ignore-scripts=true`, verified to cover `npm pack`), and the attest
   path uses no npm cache. · `provenance.yml` · bug (fixed) · Keep the split. · decision-needed: no
8. **The root `package.json` gained `"version": "0.0.0"`.** `npm sbom` refuses a root without a
   version (`EINVALIDPURLTYPE`: a package URL needs one). The root is private and never packed, so
   the value only names the root component. It is also why the lockfile changed (2 lines). ·
   `package.json:3` · note · None. · decision-needed: no
9. **Nothing automated would catch a widened `permissions:` block or a tag-for-SHA pin swap.** In
   the adversarial pass, `id-token: write` added at `ci.yml`'s workflow level (so the unchanged
   `test` job silently inherits it), and a pin replaced by its tag, both passed `npm run check` and
   the leak gate. Only a reviewer reading the two listings above catches either. · workflows ·
   risk · A later WO could add a small CI assertion (the workflow level is exactly `contents:
   read`, every job declares permissions, only `provenance/attest` has `id-token`, and every
   `uses:` matches `@<40-hex> # v…`), or turn on the platform's "require full-length SHA pins"
   policy. Not built here: scope. · decision-needed: no
10. **On a pull request, the bill of materials describes the merge result, not the branch head.**
    Its artifact is named for GitHub's synthetic merge commit (for example
    `sbom-cyclonedx-11a33895e58d` on a PR run, beside `…a5c4aa64adb4` for the same head's push
    run). Describing what would land seemed the more useful inventory, and the artifact is named
    for the commit it inventories. · `ci.yml` `sbom` job · note · Say if the head is wanted
    instead. · decision-needed: no
11. **The bill-of-materials check verifies shape and the direct dependencies, not completeness.**
    A crafted document holding only the 5 direct package URLs would pass. The job generates the
    document itself, so the threat the check answers is a broken generator, not a forger (anyone
    who can edit the workflow can bypass any check). · `.github/scripts/check-sbom.mjs` · note ·
    Optionally assert the component count against the lockfile's entries. · decision-needed: no
12. **The audit summary now fails soft but visibly.** Missing or non-numeric counts report "did
    not complete" (from the adversarial pass: an empty `vulnerabilities` object used to read as
    "0"). Both "did not complete" and any high or critical finding raise a warning annotation, so
    the result shows in the checks view without blocking the PR. ·
    `.github/scripts/audit-summary.mjs` · bug (fixed) · None. · decision-needed: no
13. **Tag convention detail.** A commit cannot contain its own SHA, so a tag's
    `owner/repo@<full SHA>` line is added in the first commit after the tag. It uses exactly that
    plain form, which the leak gate's action-pin exemption accepts; a commit *link* would carry a
    bare 40-hex that the gate refuses. Both `CHANGELOG.md` and `CONTRIBUTING.md` say so. · note ·
    None. · decision-needed: no
14. **The default-branch ruleset has no required status checks.** Outside this WO, but the P0
    phase-exit gate names them. · repository settings · note · The architect's post-merge action.
    · decision-needed: no

## Adversarial pass (WO §5)

A fresh subagent ran it on its own clone, read-only, with no pushes and no GitHub writes.

| # | WO §5 attack | Result |
|---|---|---|
| 1 | `id-token: write` moved to the workflow level | Nothing automated catches it (finding 9). The permissions listing above exposes it. Moved in `provenance.yml`, the attest job would lose the token at run time, since job-level permissions replace the workflow set, so the dry run would go red |
| 2 | An empty file given to the bill-of-materials check | Fails (exit 1). So do non-CycloneDX JSON, a document missing a direct dependency, a direct dependency at the wrong version, a missing file, and a missing argument. A minimal crafted document passes (finding 11) |
| 3 | A new action's SHA replaced by its tag | `grep -n "uses:" … \| grep -vE '@[0-9a-f]{40} # v'` exposes exactly the swapped line; nothing else does (finding 9) |
| 4 | `SECURITY.md` and `CONTRIBUTING.md` read by a stranger | Exactly one path, the platform's private reporting. No person, address, handle or path |
| 5 | `CODEOWNERS` validator | 3 × `Unknown owner` (crossed item 1) |
| 6 | N6 sweep | Clean across every added file, all branch commits, and every author and committer |

**Other results and dispositions:**
- **Fixed:** findings 7 and 12 above, the verification flags (6), and the tag-line timing and
  form (13).
- **Held, with no finding:** no `${{ }}` expression inside any `run:` step, and no
  `pull_request_target`.
  - A fork pull request gets no identity token, so attestation fails closed and nothing is
    released.
  - A branch named like a tag cannot trigger a release, and neither can a manual run on a tag.
  - The dry run now also fires on changes to what gets packed (`packages/**`, `package*.json`,
    `tsconfig*.json`).

## Acceptance evidence

**§3.2: the bill-of-materials artifact, downloaded and parsed independently** (run 36093732968,
the first green push; the final commit's artifact has the same shape):

```
$ gh run download <run> -n sbom-cyclonedx-0080b5259883
$ jq '{bomFormat, specVersion, components: (.components|length), metaName: .metadata.component.name}' sbom.cdx.json
{ "bomFormat": "CycloneDX", "specVersion": "1.5", "components": 99, "metaName": "clearseal-reference" }
$ node .github/scripts/check-sbom.mjs sbom.cdx.json
check-sbom: 99 component(s); 5 direct dependenc(ies) checked
pkg:npm/eslint@10.11.0
pkg:npm/%40eslint/js@10.0.1
pkg:npm/typescript@6.0.3
pkg:npm/typescript-eslint@8.70.1
pkg:npm/%40types/node@24.13.6
```

**§3.3: red once, then the revert** (run 36093837841, `sbom` job):

```
check-sbom: 0 component(s); 5 direct dependenc(ies) checked
check-sbom: FAIL — sbom.cdx.json is empty, unreadable, or not JSON
check-sbom: FAIL — bomFormat is undefined, not "CycloneDX"
check-sbom: FAIL — specVersion is missing
check-sbom: FAIL — no components
check-sbom: FAIL — direct dependency @eslint/js@10.0.1 is not in the bill of materials
   … (the other four direct dependencies likewise)
##[error]Process completed with exit code 1.
artifacts in red run: 0
```

**§3.4: the audit summary, as published on the run:**

```
## Dependency audit (npm audit, level high and above; reporting only)

Dependencies audited: 100. Findings at high or critical: **0** (critical 0, high 0, moderate 0, low 0, info 0).
```

**§3.5: the provenance dry run and independent verification** (run 36094830153; tarball and bundle
downloaded from the run's `release` artifact):

```
build success · attest success · release skipped
Attestation created for clearseal-core-0.0.0.tgz@sha256:<64-hex>

$ gh attestation verify clearseal-core-0.0.0.tgz --repo <repo> --bundle provenance.sigstore.json --format json
predicateType https://slsa.dev/provenance/v1 · subject clearseal-core-0.0.0.tgz
signer workflow <repo>/.github/workflows/provenance.yml · source ref refs/pull/9/merge · trigger pull_request
exit=0
$ (a copy with one byte appended) gh attestation verify tampered.tgz ...          exit=1
$ ... --signer-workflow <repo>/.github/workflows/provenance.yml --source-ref refs/pull/9/merge   exit=0
$ ... --signer-workflow <repo>/.github/workflows/provenance.yml --source-ref refs/tags/v0.1
Error: expected SourceRepositoryRef to be refs/tags/v0.1, got refs/pull/9/merge                  exit=1
$ ... --signer-workflow <repo>/.github/workflows/ci.yml                                           exit=1
```

**§3.6:** none possible before merge (crossed item 2).

**§3.7:** `ci.yml` lines 1-46 (header, `test`, `leak-gate`) are byte-identical to `main`. `test` is
green on both runners on every run on this branch.

## What did not work, and why

- **`CODEOWNERS` with the organization handle.** The platform rejects an organization as an owner,
  the organization has no team, and the personal fallback is forbidden (crossed item 1).
- **Showing a bot pull request.** The bot only reads its configuration from `main` (crossed item 2).
- **`npm sbom` on the tree as it was.** It needs a root version (finding 8).
- **A manual (`workflow_dispatch`) dry run.** It cannot run a workflow file that isn't on `main`, so
  the dry run triggers on pull requests that touch the workflow or what it packs.
- **"`contents: write` on the release step alone".** Permissions are per job, not per step, so the
  release is its own job holding that one permission.
- **The first provenance design held the identity token while npm ran.** The adversarial pass
  caught it, and it was split (finding 7).
- **Lint and typecheck** caught `any` flowing from `JSON.parse` and an unnarrowed optional in the
  two new scripts, and the empty-file case of the bill-of-materials check first died with a stack
  trace rather than a clear failure. All fixed.

## What was deliberately not built

- **No leak-gate change**: `scripts/**` is protected (finding 4 is for the architect).
- **No release-integrity control.** A node attesting its own digest is deferred in
  `architecture.md` §8. Provenance here proves what CI built, not what a node runs.
- **No registry publishing.** Tarballs attach to a release on a tag; nothing is published.
- **No signed-commit or signed-tag policy**, **no tag ruleset**, and **no required status checks or
  code-owner review in the ruleset.** Those are the architect's settings (findings 5 and 14,
  crossed item 1).
- **No change to `packages/**` or to the `test` or `leak-gate` jobs.**
- **No ruling on external contributions.** `CONTRIBUTING.md` ships the conservative default and
  says it is one.
- **No CI assertion on permissions or pins** (finding 9: scope).
- **No tag was pushed.** The tag run is the architect's.
