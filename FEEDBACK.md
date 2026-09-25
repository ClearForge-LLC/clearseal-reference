# FEEDBACK: CSR-WO-0002a (a gate that admits the bot, and a suite that checks its Node)

Branch `wo/CSR-WO-0002a`, cut from `main` at `8a9c46f` (`.github/dependabot.yml` present). Parked as
one unmerged pull request. Built on Node v24.21.0. Every commit carries the role identity as both
author and committer, and `leak-gate --tree` and `--history` were clean before every push.

## Crossed or parked

**Nothing crossed. No §7 condition fired.** Both exemptions could be written narrowly enough to
pass every lookalike, and no protected surface changed. **One deviation needs a ruling
(D-1).** The adversarial pass showed that the WO's "whatever address follows" would let an
org-domain or personal address through under the bot's name, which overrides the `-0001` role
ruling. So the exemption also pins the bot's vendor address. That is narrower than the WO text.

**Measured before any change:** the bot's two real commits (PRs #11 and #12) each gave **exactly
one** `--history` finding: the `Signed-off-by` address (`email … :(message):15`). After this change,
both pass `--history` clean. Neither real commit used the SHA-compare shape, because both were npm
bumps. That shape comes from bumps of SHA-pinned actions, and the self-test and the throwaway branch
prove it.

### Deviations

| # | Deviation | WO text | Reason | Decision-needed |
|---|---|---|---|---|
| D-1 | The bot-trailer exemption requires the signer name `dependabot[bot]` **and** the vendor address the bot signs with | §1.1: "whatever address follows" | "Whatever address" admitted a personal address, or a non-role address at the organization's domain, under the bot's name. That overrode the `-0001` ruling that any non-role org address is a finding. The bot always signs with one address, so pinning it costs nothing and fails closed: if the vendor changes it, bot PRs go red visibly | **yes** (ratify or revert to "whatever address") |
| D-2 | The bot-trailer exemption applies **only to commit-message lines**, not to tree files or author/committer headers | §1.1 says "trailer", without saying where | An author **name** shaped like the trailer let a personal address through the identity scan, reproduced before fixing. A trailer is by definition in a message | no (it keeps §1.1's intent) |

## Gates line

| Gate | Result |
|---|---|
| Self-test | `node scripts/leak-gate.mjs --self-test`: exit 0, **29 rules, 81 planted examples**. It includes **15 new exemption lines**: 3 exact shapes that pass, and 12 lookalikes that fire. Pasted below |
| Real bot commits | PRs #11 and #12 (`dependabot[bot]`): `--history` clean, where before this change each gave one `email` finding on the trailer |
| Throwaway-branch history proof (§3.2) | `scratch/leak-gate-bot` @ `08727f2`, on the final gate: a commit whose message carries the bot's exact trailer and a compare URL of two full SHAs. <https://github.com/ClearForge-LLC/clearseal-reference/actions/runs/36099542008>: `leak-gate` **success**, `--history` clean over 18 commits. **Deleted** locally and on the remote; `git log --all --oneline \| grep -c 08727f2` prints `0`. An earlier run on the pre-narrowing code (run 36099081586, branch likewise deleted) also passed |
| `check-node` (§3.3) | exit **0** under v24.21.0, and exit **1** under v24.16.0 ("`.node-version` pins 24.21.0; running 24.16.0"). Transcript below |
| Wrong Node (§3.4) | `npm ci` under v24.16.0: `EBADENGINE`, exit 1 (`.npmrc` unchanged). `npm run check` under v24.16.0 with no install run: fails at `check-node`, exit 1 |
| Provenance pack (§1.4) | `npm pack --workspace packages --dry-run` yields `@clearseal/core` only, where `--workspaces` also packed `@clearseal/spike-0100-protocol`. The PR's provenance dry run shows the same (run on the PR) |
| CI | <https://github.com/ClearForge-LLC/clearseal-reference/actions/runs/36099540883> on `ba4eb09` (the final gate code): `test` ×2, `leak-gate`, `sbom`, `audit` all **success**. The run for this file's commit, and the provenance dry run, show on the PR |
| Protected surfaces | the steering documents, `LICENSE`, `NOTICE`, `packages/**`, `scripts/test.mjs`, `scripts/check-directives.mjs`, `ci.yml`, `dependabot.yml`, the governance files and `.npmrc` diff **empty** against `main`. `provenance.yml` changes only the pack step |

## The exact regexes added, with their lookalike cases

```js
// e-mail rule: exempt only when context is a commit-message line, the text before the address is
// exactly this (the line is untruncated, i.e. under 512 characters), and the address is the bot's.
const BOT_SIGNOFF = /^Signed-off-by: dependabot\[bot\] <$/;
const BOT_ADDRESS = ["support", "github.com"].join("@");

// long-hex rule: exempt a lowercase 40-hex SHA only when the text before it on its line ends with
const PLATFORM_COMMIT_URL =
  /(?:^|[\s([<"'])https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:commit\/|compare\/(?:[\w-]{1,64}(?:\.[\w-]{1,64}){0,8}\.\.\.?)?)$/;
```

| Exemption | Passes (exact shape) | Still fires (lookalike) |
|---|---|---|
| Bot trailer | `Signed-off-by: dependabot[bot] <vendor address>` as a commit-message line | the same line in a **tree file** · the same address under **another signer name** · **another address** under the bot's name · a **second address** after the trailer · the trailer **indented**, or padded past the 512-character window · an **author or committer name** shaped like the trailer |
| Platform-URL SHA | `https://github.com/o/r/commit/<sha>` · `…/compare/<sha>...<sha>` (either SHA) · `…/compare/v1.2.3...<sha>` | the same SHA **bare** or after a word · in a **`/tree/`** path · on a **lookalike host** (`github.com.example.net`) or **another host** (`gitlab.com`) · a platform URL **nested in another host's URL** (in the path or a query) · after a **three-way compare** or a **run of dots** · an **upper-case** SHA |

## Findings

Schema: `finding · where · type · recommendation · decision-needed`.

1. **The bot's real commits gave exactly the finding the WO predicted, and no other.** Measured on
   PRs #11 and #12 before the change: one `email` finding each, on the trailer. Their compare links
   use tags, not SHAs, so only the trailer exemption was needed for those two. · measured · note ·
   None. · decision-needed: no
2. **The adversarial pass found the first cut wider than spec in seven ways.** An identity header, a
   nested URL, a three-way compare, an indented trailer, an upper-case SHA, a trailer in a tree file,
   and any address after the bot's name all passed. Each was reproduced where it mattered, fixed, and
   given its own lookalike line in the self-test (above). The first cut's self-test also joined two
   cases with `||`, which would have hidden a regression; it now uses `&&`. · `scripts/leak-gate.mjs`
   · bug (fixed) · None. · decision-needed: no
3. **Some shapes are deliberately left unexempted, so they still fire.** They are narrower than the
   platform accepts:
   - `http://` without TLS, a `www.` host, an upper-case host, and a `:443` port;
   - a compare ref containing `/` (a branch with a slash);
   - a cross-fork compare `main...owner:<sha>`.

   Each fails closed. If a real bot commit ever uses one, it goes red visibly and needs a ruling.
   · `PLATFORM_COMMIT_URL` · note · Revisit at the first real case. · decision-needed: no
4. **A two-dot compare `<sha>..<sha>` passes.** It is a valid platform compare form, and the regex
   takes two or three dots. The WO names only three. · `PLATFORM_COMMIT_URL` · note · Ratify, or
   say "three dots only". · decision-needed: no
5. **`check-node` treats a `.node-version` of `v24.21.0` (with a `v`) as a mismatch, and fails.**
   Version managers accept that form. The repository writes `24.21.0`, so this fails closed rather
   than open. · `scripts/check-node.mjs` · note · Accept, or strip a leading `v`. ·
   decision-needed: no
6. **`check-node` reads `.node-version` relative to the working directory.** `npm run` sets that
   to the package root. Run from another directory, it fails closed ("missing"). ·
   `scripts/check-node.mjs` · note · None. · decision-needed: no

## Acceptance evidence

**§3.1: self-test** (the per-rule "N example(s)" lines are omitted; fixture commit ids read
`<commit>`):

```
self-test: masked github-token github-token-0.md:1 "ghp_…" (len 40)  (no finding line carries its planted value)
self-test: masked a 4-character match shows 2: "~a…" (len 4)
self-test: fired  email on a non-role address at the org domain (the role exemption is exact)
self-test: clean  the dependency bot's own Signed-off-by trailer in a commit message (signer dependabot[bot], its vendor address)
self-test: fired  email on the bot's exact trailer outside a commit message (lookalike)
self-test: fired  email on the bot's address under a different signer name (lookalike)
self-test: fired  email on a different address under the bot's signer name (lookalike)
self-test: fired  email on a second address after the bot's trailer on the same line (lookalike)
self-test: fired  email when the trailer does not start its line: indented, or padded past the 512-character window (lookalike)
self-test: clean  a full SHA in a platform commit URL and in either ref of a platform compare URL
self-test: fired  long-hex on the same SHA in a /tree/ path of the platform host (lookalike)
self-test: fired  long-hex on the same SHA in a commit URL on a lookalike host (lookalike)
self-test: fired  long-hex on the same SHA outside any URL (lookalike)
self-test: fired  long-hex on a platform commit URL nested inside another host's URL (lookalike)
self-test: fired  long-hex on a SHA after a three-way compare or a run of dots (lookalike)
self-test: fired  long-hex on an upper-case SHA in a platform commit URL (lookalike)
self-test: clean  synthetic tree of near-misses and exemptions: 0 findings
self-test: fired  owned-host on a tracked file's NAME, and the name is masked in the output
self-test: fired  home-path on a symlink's target; a link to a directory does not crash the scan
self-test: fired  private-ip in UTF-16 (with and without a byte-order mark), UTF-32, and UTF-16 after 5 KB of ASCII; an odd-length big-endian file does not crash
self-test: clean  history fixture's final tree is clean
self-test: clean  a bot-shaped commit (compare URL of two SHAs + the bot's trailer) passes --history (<commit>); the same address signed by another name fires (<commit>)
self-test: fired  email on an author header whose name is shaped like the bot's trailer (<commit>)
self-test: fired  private-ip behind a revert (<commit>)
self-test: fired  email in a commit-message trailer only (<commit>)
self-test: fired  private-ip on an added line starting with "++" (<commit>)
self-test: fired  private-ip in a text file with a NUL byte (<commit>)
self-test: fired  private-ip despite a later "* -diff" attribute (<commit>)
self-test: fired  owned-host on a file NAME in history, masked (<commit>)
self-test: fired  private-ip in UTF-16 text committed then deleted (<commit>)
self-test: fired  private-ip added by an evil merge, with its path (<commit>)
self-test: fired  on each identity field: author name (<commit>), author e-mail (<commit>), committer name (<commit>), committer e-mail (<commit>)
self-test: clean  role identities as author and committer pass (<commit>); only the four planted fields fired
self-test: fired  private-ip after a NUL byte in a commit message
self-test: fired  private-ip in a root commit hidden by local log.showRoot=false, diff.noprefix and a replace graft
self-test: fired  a shallow history is refused, not called clean
self-test: fired  a used allow suppresses its findings and is printed as applied
self-test: fired  a stale allow entry fails the gate
self-test: fired  malformed and unknown-rule allow entries fail
self-test: fired  an allow entry cannot excuse its own identifier, and no output line echoes it
self-test: fired  control characters in printed text are escaped (no injected log lines)
self-test: fired  crafted 100k-character lines scanned in 1.1s
self-test: 29 rules, 81 planted examples
self-test: PASS — every rule fired on every planted example; every scan mechanism went red; clean input passed
```

**§3.3 and §3.4: Node**

```
$ node --version && node scripts/check-node.mjs      # the pinned Node
v24.21.0
check-node: 24.21.0 matches .node-version
exit=0
$ node --version && node scripts/check-node.mjs      # another installed Node
v24.16.0
check-node: FAIL — .node-version pins 24.21.0; running 24.16.0
exit=1
$ node scripts/check-node.mjs      # .node-version missing (§5.4)
check-node: FAIL — .node-version is missing or empty; running 24.21.0
exit=1
$ npm ci      # another Node (.npmrc unchanged)
npm error code EBADENGINE
npm error notsup Not compatible with your version of node/npm: clearseal-reference@0.0.0
npm error notsup Required: {"node":"24.21.0"}
exit=1
$ npm run check      # another Node, no install run
> node scripts/check-node.mjs && npm run typecheck && npm run lint && npm run build && npm run test
check-node: FAIL — .node-version pins 24.21.0; running 24.16.0
exit=1
```

**§1.4: the narrowed pack** (`--dry-run`, in the repository after `npm run build`):

```
$ npm pack --workspace packages --dry-run          # this change
npm notice name: @clearseal/core
npm notice filename: clearseal-core-0.0.0.tgz
$ npm pack --workspaces --dry-run                  # before
npm notice name: @clearseal/core
npm notice filename: clearseal-core-0.0.0.tgz
npm notice name: @clearseal/spike-0100-protocol
npm notice filename: clearseal-spike-0100-protocol-0.0.0.tgz
```

## What did not work, and why

- **The first cut of both exemptions was wider than the WO** (finding 2). It matched the WO's
  words, but an adversary could reach it through an identity header, another host's URL, or
  sloppy compare refs. Narrowed, and each case is now a self-test line.
- **Lint caught a redundant initial assignment** in `check-node.mjs`.
- **`npm ci` under the wrong Node cleared the install** as it refused. `node_modules` was reinstalled
  on the pinned Node before the next check.

## What was deliberately not built

- **No other gate rule, and no widening** beyond the shapes above (see D-1 and D-2, both narrower).
- **No change to `.npmrc`** (§1.3 as corrected), `ci.yml`, `dependabot.yml`, `CODEOWNERS` or the
  governance files.
- **No change to `provenance.yml` beyond the pack step.**
- **No handling of the platform URL variants that still fire** (finding 3). They wait for a real
  case.
