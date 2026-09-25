# FEEDBACK: CSR-WO-0001 (the leak gate)

Branch `wo/CSR-WO-0001`. It was cut from `main` at `06b7c30`, then rebased onto `d6bf9ec`
(CSR-WO-0000a docs, merged while this was in flight) before any PR or red-proof existed. It is
parked as one unmerged pull request. This file replaces `-0000`'s FEEDBACK at the root; that one
stays in history at `28254e1`.

## Crossed or parked

**A §7 stop fired and was ruled on. It was not routed around.** Before any gate code existed, a
probe of the ratified rules over `main`'s history found two things:

1. **An organization-domain e-mail address in the `Co-authored-by` trailers that GitHub's squash
   merge added to `06b7c30` and `28254e1`.** The ratified e-mail rule (which admits only
   `example.*`, the platform no-reply domain and `noreply@`) refuses it. The `28254e1` trailer
   exists because the `-0000` builder (this session) authored its branch commits under that role
   address. The squash merge turned the branch authors into trailers.
2. **The two action-pin SHAs pasted into `-0000`'s `FEEDBACK.md` (in `28254e1`)**, as `-0000` §5.4
   required. They lie outside the single workflow allow the WO planned, so a third allow would
   have been needed. That is also a §7 stop.

I stopped and asked. **The architect ruled: no history rewrite, because nothing leaked.** Rows D-a
to D-c record that ruling. Rows D-d to D-g are my own departures, made to keep the WO's intent,
and they are flagged for ratification.

### Deviations from the WO

| # | Deviation | WO text it departs from | Reason | Decision-needed |
|---|---|---|---|---|
| D-a | The `email` rule exempts **exactly** `claude@` and `architect@` at the organization's `.dev` domain, in the rule itself with its reason. Any other address at that domain is still a finding, and the self-test proves it. | §1.2's e-mail exceptions | Architect's ruling: "role identity, not a person or a deployment; already public" | no (ruled; the architect amends the WO) |
| D-b | The `long-hex` rule exempts the `owner/repo@<40-hex>` action-pin shape **in any path**, in the rule itself. That is exactly 40 hex characters after an `owner/repo@` token. | §1.3's path-scoped allow for workflow `uses:` lines | Architect's ruling: "an action pin is a public reference by construction" | no (ruled) |
| D-c | `.leak-gate-allow` ships **empty (zero bytes)**. The stale-allow mechanism is proven with temporary entries (§3.4) and inside `--self-test`. **"Stale" means an entry that suppressed no finding in the run that read it.** | §1.3: "Exactly two entries ship" | Architect's ruling. With D-b, both planned entries would be stale, and the gate must fail on stale | no (ruled) |
| D-d | **Masking is stricter than "the first four characters":** at most four, **never more than half the match**, and **none at all** for the person-identifying rules (`email`, `user-at-host`). A path that matches a rule is masked wherever it is printed. Allow entries print as line, rule and masked glob, never their justification. | §1.4 | The adversarial passes showed that four characters of a short match, or of an address, is most of the identifier | **yes** (ratify) |
| D-e | **Seven rules beyond §1.2's literal list**, each in a category the WO names: `ipv4` (routable, ported from the public source), `private-ipv6`, `users-path` (macOS/WSL profiles), `user-at-host` (ssh targets), `platform-host` (hosting subdomains), `vendor-api-key`, and `url-userinfo`. There are 29 rules in all, with 76 planted examples, one per alternative. | §1.2 | Every one was a shape the first adversarial pass got through the gate unseen | **yes** (ratify or trim) |
| D-g | **On a `pull_request` event, the `leak-gate` job checks out the PR's head commit** (`ref: ${{ github.event.pull_request.head.sha \|\| github.sha }}`), not GitHub's synthetic merge commit. | §1.6 (the job's checkout was unspecified; the default is the merge ref) | The synthetic merge's message is `Merge <40-hex> into <40-hex>`, which `long-hex` rightly refuses, so **every PR went red** (run 36085459379 on this PR). That commit never lands; squash merges write their own message, which is scanned on `main`'s push. No rule gained an exemption. The `test` job is untouched | **yes** (ratify) |
| D-f | **History reads more than `git show` plus `%B`:** `--text --no-textconv` diffs, merges diffed against their first parent, the message read from the raw commit object, every path a commit touches, and git run without global or system config, replace refs or grafts. **Headers are still not scanned** (see finding 8). | §1.1's two commands | Each literal command had a fail-open, found by the adversarial passes and reproduced before fixing (see "Adversarial pass") | no (it keeps §1.1's intent) |

## Gates line

| Gate | Result |
|---|---|
| `--self-test` | exit 0: **29 rules, 76 planted examples**, every one fired by name; clean near-miss tree and clean history fixture: 0 findings; **23 further checks** (masking, the role-exemption boundary, 14 scan mechanisms, allowlist behaviour, output escaping, the long-line bound) each passed by making the gate fire. Full output under §3.1 |
| `--tree` on the branch | exit **0**, 28 files |
| `--history` on the branch | exit **0**, **10 commits** (`main`'s six plus this WO's four) |
| **Throwaway red-proof (§3.3)** on the final scanning code (`e3e2035`) | `scratch/leak-gate-red` @ `c3fdfb5`: <https://github.com/ClearForge-LLC/clearseal-reference/actions/runs/36085060203>. `leak-gate` **failure** on `--tree` with a masked `private-ip` line; both `test` jobs green. **Deleted** locally and on the remote; `git log --all --oneline \| grep -c c3fdfb5` prints `0` |
| **Trailer-only red-proof (§5.8)** on the same code | `scratch/leak-gate-trailer` @ `e775e69`: <https://github.com/ClearForge-LLC/clearseal-reference/actions/runs/36085060007>. The diff is empty and `--tree` is clean; `--history` **fails** on `e775e69:(message):3`. **Deleted**; `grep -c e775e69` prints `0` |
| Earlier red-proof rounds | The same two proofs ran red on the gate as it stood after each adversarial round: <https://github.com/ClearForge-LLC/clearseal-reference/actions/runs/36082513816> and <https://github.com/ClearForge-LLC/clearseal-reference/actions/runs/36082513617> (at `50c0ef8`), then <https://github.com/ClearForge-LLC/clearseal-reference/actions/runs/36083534254> and <https://github.com/ClearForge-LLC/clearseal-reference/actions/runs/36083534545> (at `68d47fd`). All four branches were deleted, and each commit's `grep -c` prints `0` |
| WO branch CI, final code commit `64ed159` | <https://github.com/ClearForge-LLC/clearseal-reference/actions/runs/36085217172>: `leak-gate`, `test (ubuntu-latest)` and `test (windows-latest)` all **success**. `64ed159` changes only a self-test fixture string relative to `e3e2035` (run <https://github.com/ClearForge-LLC/clearseal-reference/actions/runs/36085041348>, also all green), so the red-proofs above ran on the final scanning logic |
| PR check before D-g | <https://github.com/ClearForge-LLC/clearseal-reference/actions/runs/36085459379>: the `pull_request` run went **red** on the synthetic merge commit's message (two masked `long-hex` findings), while the `push` run at the same head was green. That is how D-g was found |
| WO branch CI, final commit | shows on the PR checks, for both `push` and `pull_request`. It is the commit that adds D-g and this file's final form; it changes no scanning code |
| Stale-allow proof (§3.4) | a temporary entry makes the gate exit 1, naming the entry by line and rule; reverted to zero bytes |
| Masking proof (§3.5) | a synthetic token prints as `"ghp_…" (len 40)`. The self-test also asserts that no finding line contains its planted value, that a four-character match shows two, and that the person rules show none |
| Protected surfaces | `git diff origin/main...HEAD --stat -- docs README.md LICENSE NOTICE packages` is **empty**. The `test` job's lines in `ci.yml` are unchanged; the diff is purely additive after line 27 |
| `npm run check` | green: typecheck (the root `tsconfig.json` type-checks `scripts/*.mjs`, so the gate runs under `checkJs` strict), lint (type-checked, including `no-control-regex`), and 1 test |

## Findings

Schema: `finding · where · type · recommendation · decision-needed`.

1. **Upstream: the public rule source has a same-line masking bypass.**
   `ClearProof/scripts/check_notes.py`'s `scan_text` skips the **entire line** when the line
   contains any allowed placeholder (`example.com`, `127.0.0.1`, `localhost`, `<REDACTED>`, and
   others). So a line holding `example.com` *and* a real hostname, token or address is never
   checked. That source was not ported. Here, exemptions live inside the rule they exempt and
   apply to the match, not the line, and the self-test's clean tree puts near-misses beside each
   other to keep it that way. · `ClearProof/scripts/check_notes.py:69-70` · bug (upstream) ·
   Apply the exemption per match, not per line, in the public source. · **decision-needed: yes**
2. **The organization's apex domains are now in this repository, in the gate's own source.**
   `main` named neither before this branch. The `.dev` domain appears in the `ORG_DOMAINS` regex
   source and in the two role addresses that D-a puts in the rule. The `.net` domain appears only
   in `ORG_DOMAINS`, carried over from the public rule source. An apex domain plus
   certificate-transparency logs lists its subdomains, which is the endpoint map N6 protects.
   · `scripts/leak-gate.mjs:56` · scope-question · Confirm that both apexes are meant to be
   public here. The alternative is to match a hostname's last two labels against committed
   SHA-256 digests, so the source never names the domains. · **decision-needed: yes**
3. **The gate caught its own source five times during the build.**
   - A rule reason quoted a tilde-plus-username shape.
   - A comment described a URL's credential form literally.
   - A reason string contained an ssh-target shape.
   - A planted IPv6 prefix and a planted URL were written as literals.
   - The self-test's clean fixture spelled out the §3.6 grep pattern.

   Each was reworded or built from fragments. None was exempted. · `scripts/leak-gate.mjs` · note ·
   Keep rule text example-free; the gate enforces it on itself. · decision-needed: no
4. **The WO's §3.6 grep matches the WO itself.** It returns exactly one line,
   `docs/work-orders/CSR-WO-0001.md:106`, which is the acceptance criterion quoting its own
   pattern. The gate's `url-token` rule requires a URL (a scheme, or a path from `/`) and returns
   nothing. · WO §3.6 · note · When the WO is amended, word item 6 as "returns only this line".
   · decision-needed: no
5. **Cause of the §7 stop: tooling-added identity in history.** Squash merges turn branch authors
   into `Co-authored-by` trailers, and trailers are scanned. Any author address outside D-a's two
   and the no-reply shapes will now **fail `--history` at the next push after merge**, which is the
   gate working. · process · risk · Builders commit as a role identity or a `noreply@` address.
   State it in the WO template. · decision-needed: no
6. **Rebased once before the PR opened.** `main` gained `d6bf9ec` after the branch was cut. The one
   gate commit was rebased and force-pushed with a lease **before any PR or red-proof existed**.
   Its first CI run (at `4cb4711`) is superseded, and that commit is on no branch. · note · None.
   · decision-needed: no
7. **`--history` covers `HEAD`'s ancestry only** (`git rev-list HEAD`, as the WO says). A pull
   request's CI checks out the merge ref, which covers `main` plus the branch. Another branch is
   covered when its own push runs the job. Annotated tag messages and notes are not scanned.
   · `scripts/leak-gate.mjs` (`scanHistory`) · note · Documented in `scripts/README.md`.
   · decision-needed: no
8. **Commit headers are not scanned: author, committer, signature, and extra headers.** The WO
   scans `%B`. Author identity is squarely "account identifiers" under N6. All author and committer
   addresses in today's history are the role or no-reply shapes, so scanning headers (except
   `tree`/`parent` SHAs and signatures) would pass today. · `scanHistory` · risk · Extend to
   author and committer lines in the next WO. · **decision-needed: yes**
9. **An allow can only be proven necessary per mode.** Content that exists only in history (for
   example, a binary-extension file with a NUL byte: `--tree` skips it, `--history` scans it) can
   never be allowed, because the entry is stale in `--tree`. · `applyAllows` · scope-question ·
   Judge staleness across both modes, or add a mode column. · **decision-needed: yes**
10. **Realistic false positives remain, and none was exempted, because each exemption is a ruling**
    like D-a and D-b:
    - `user-at-host` on package dist-tags (`<pkg>@latest`, `@next`) and on container digests;
    - `email` on the git-over-ssh service user at a code host, and on `@2x` image names;
    - `url-token` on placeholder values (an ALL-CAPS name, a `${…}` template) in docs;
    - `auth-header-value` on long hyphen- or slash-joined prose after "Basic";
    - `ipv4` on four-part version strings;
    - `uuid` on the nil UUID;
    - `long-hex` on full commit SHAs in prose, container digests, and LFS pointer ids.

    They fail closed today and create pressure to add allows. · rules · risk · Rule on which, if
    any, to exempt in the rule itself. · **decision-needed: yes**
11. **The pin exemption (D-b) and the `noreply@` exemption apply anywhere.** A 40-hex value after
    any `owner/repo@` token passes `long-hex`, and a `noreply@` local part passes at any domain. Both
    work as ruled. · rules · note · None unless the ruling changes. · decision-needed: no
12. **The self-test skips the symlink cases on Windows**, where they can't be created without
    privileges. It says so in its output. CI runs the gate on `ubuntu-latest` only. · note · None.
    · decision-needed: no
13. **Scan cost is linear.** A crafted 100k-character line scans in about 1 s (it was quadratic
    before: 38.5 s for six crafted lines), and the self-test holds that to under 10 s.
    · `hostRule`, URL rules · note · None. · decision-needed: no

## Adversarial pass (WO §5)

Two fresh subagents ran it, each on its own clone, with no push rights. **I reproduced every
fail-open claim before fixing it.** Each fix is now a self-test case, so the claim is proven red,
not just patched.

### Round 1 (at `4cb4711`), 33 findings

| Sev. | Finding | Disposition |
|---|---|---|
| critical | A committed `.gitattributes` `* -diff` blinded `--history` | **Fixed:** `--text --no-textconv`; self-test case |
| high | A NUL-byte text file was invisible to `--history` | **Fixed:** same; self-test case |
| high | An added line starting `++ ` was taken for a file header | **Fixed:** a hunk header ends the header state; self-test case |
| high | File names were never scanned | **Fixed** in both modes, masked when printed; self-test cases |
| high | Missing IPv6, vendor prefixes, operator paths | **Fixed** within §1.2's categories (D-e) |
| high | Org apex domains introduced by this branch | **Decision:** finding 2 |
| medium | Short matches masked to nothing useful | **Fixed** (D-d) |
| medium | A shallow clone passed silently | **Fixed:** refused; self-test case |
| medium | A dir symlink crashed `--tree`; link targets unscanned | **Fixed:** `lstat` plus `readlink`; self-test case |
| medium | UTF-16 unscanned | **Fixed** (round 2 made it complete) |
| medium | `bearer` case, `Basic`, URL-credential variants, PGP header, underscore boundary, platform hosts | **Fixed**; each alternative has a planted example |
| medium | A `**` allow silences a rule silently | **Fixed:** applied allows print with counts; review still decides |
| low–note | Other refs, tags, author identity; history-only allows; false positives | **Documented** / findings 7–10 |
| note | §5.1 (split across a line), §5.2 (encoded), §5.3 (code block, HTML comment, YAML comment all fire), §5.4 (a renamed text file without NUL is scanned) | Confirmed as the WO expects; README says so |

### Round 2 (at `68d47fd`), 17 findings; 4 of 7 claimed fixes verified, 3 broken

| Sev. | Finding | Disposition |
|---|---|---|
| critical | UTF-16 committed then deleted passed both modes | **Fixed:** any line holding NUL bytes is also scanned with them removed; self-test case |
| high | UTF-32, and UTF-16 after a 4 KB ASCII prefix, passed | **Fixed:** same; self-test case |
| high | An allow entry could excuse its own identifier | **Fixed:** the allowlist never excuses itself; self-test case |
| high | Allow text was echoed verbatim in log lines | **Fixed:** printed as line, rule and masked glob; self-test case |
| medium | A NUL byte in a commit message truncated `%B` | **Fixed:** raw commit object; self-test case built with `hash-object --literally` |
| medium | Evil merges caught only by accident, with no path | **Fixed:** first-parent diffs; self-test case |
| low | Local config (`log.showRoot=false`), replace refs and grafts hid history | **Fixed:** hermetic git; self-test case |
| low | Crafted long lines were quadratic (seconds to hours) | **Fixed:** bounded labels and scheme; self-test time bound |
| low | An odd-length big-endian BOM crashed `--tree` | **Fixed**; self-test case |
| low | Error text printed raw paths; a file name could inject a CI workflow command | **Fixed:** redaction plus control-character escaping; self-test case |
| low | The mask shows a short username | **Fixed** (D-d) |
| medium | Realistic false positives | **Decision:** finding 10 |
| low–note | History-only allows; tree reads the working tree; LFS content | **Documented** / finding 9 |

## Acceptance evidence (WO §3)

**§3.1: `node scripts/leak-gate.mjs --self-test`** at `64ed159`, exit 0. The planted values differ
every run; only masks print.

```
$ node scripts/leak-gate.mjs --self-test
self-test: fired  owned-host             2 example(s), e.g. owned-host-0.md:1 "kpud…" (len 23)
self-test: fired  tunnel-host            4 example(s), e.g. tunnel-host-0.md:1 "odgh…" (len 29)
self-test: fired  auth-tenant            6 example(s), e.g. auth-tenant-0.md:1 "kfmn…" (len 22)
self-test: fired  tailnet-host           1 example(s), e.g. tailnet-host-0.md:1 "ieoz…" (len 24)
self-test: fired  platform-host          9 example(s), e.g. platform-host-0.md:1 "vryu…" (len 32)
self-test: fired  user-at-host           2 example(s), e.g. user-at-host-0.md:1 "…" (len 13)
self-test: fired  home-path              2 example(s), e.g. home-path-0.md:1 "/hom…" (len 13)
self-test: fired  users-path             2 example(s), e.g. users-path-0.md:1 "/Use…" (len 14)
self-test: fired  android-terminal-path  2 example(s), e.g. android-terminal-path-0.md:1 "/dat…" (len 21)
self-test: fired  windows-user-path      2 example(s), e.g. windows-user-path-0.md:1 "C:\U…" (len 16)
self-test: fired  tilde-user             1 example(s), e.g. tilde-user-0.md:1 "~iki…" (len 8)
self-test: fired  private-ip             4 example(s), e.g. private-ip-0.md:1 "10.1…" (len 13)
self-test: fired  private-ipv6           2 example(s), e.g. private-ipv6-0.md:1 "fd21…" (len 18)
self-test: fired  ipv4                   1 example(s), e.g. ipv4-0.md:1 "203.…" (len 13)
self-test: fired  mac-address            2 example(s), e.g. mac-address-0.md:1 "af:7…" (len 17)
self-test: fired  uuid                   1 example(s), e.g. uuid-0.md:1 "e4ea…" (len 36)
self-test: fired  long-hex               2 example(s), e.g. long-hex-0.md:1 "06d5…" (len 48)
self-test: fired  github-token           4 example(s), e.g. github-token-0.md:1 "ghp_…" (len 40)
self-test: fired  vendor-api-key         8 example(s), e.g. vendor-api-key-0.md:1 "sk-a…" (len 47)
self-test: fired  jwt                    1 example(s), e.g. jwt-0.md:1 "eyJh…" (len 66)
self-test: fired  private-key            2 example(s), e.g. private-key-0.md:1 "----…" (len 30)
self-test: fired  cloud-access-key       2 example(s), e.g. cloud-access-key-0.md:1 "AKIA…" (len 20)
self-test: fired  secret-key             1 example(s), e.g. secret-key-0.md:1 "sk_t…" (len 32)
self-test: fired  slack-token            2 example(s), e.g. slack-token-0.md:1 "xoxb…" (len 40)
self-test: fired  npm-token              1 example(s), e.g. npm-token-0.md:1 "npm_…" (len 40)
self-test: fired  auth-header-value      3 example(s), e.g. auth-header-value-0.md:1 "Bear…" (len 39)
self-test: fired  url-token              5 example(s), e.g. url-token-0.md:1 "http…" (len 70)
self-test: fired  url-userinfo           1 example(s), e.g. url-userinfo-0.md:1 "http…" (len 36)
self-test: fired  email                  1 example(s), e.g. email-0.md:1 "…" (len 20)
self-test: masked github-token github-token-0.md:1 "ghp_…" (len 40)  (no finding line carries its planted value)
self-test: masked a 4-character match shows 2: "~a…" (len 4)
self-test: fired  email on a non-role address at the org domain (the role exemption is exact)
self-test: clean  synthetic tree of near-misses and exemptions: 0 findings
self-test: fired  owned-host on a tracked file's NAME, and the name is masked in the output
self-test: fired  home-path on a symlink's target; a link to a directory does not crash the scan
self-test: fired  private-ip in UTF-16 (with and without a byte-order mark), UTF-32, and UTF-16 after 5 KB of ASCII; an odd-length big-endian file does not crash
self-test: clean  history fixture's final tree is clean
self-test: fired  private-ip behind a revert (e9d4775)
self-test: fired  email in a commit-message trailer only (6e4967a)
self-test: fired  private-ip on an added line starting with "++" (d1c271e)
self-test: fired  private-ip in a text file with a NUL byte (c41a5e0)
self-test: fired  private-ip despite a later "* -diff" attribute (82b5a78)
self-test: fired  owned-host on a file NAME in history, masked (bc94de8)
self-test: fired  private-ip in UTF-16 text committed then deleted (a82a8ad)
self-test: fired  private-ip added by an evil merge, with its path (776c28f)
self-test: fired  private-ip after a NUL byte in a commit message
self-test: fired  private-ip in a root commit hidden by local log.showRoot=false, diff.noprefix and a replace graft
self-test: fired  a shallow history is refused, not called clean
self-test: fired  a used allow suppresses its findings and is printed as applied
self-test: fired  a stale allow entry fails the gate
self-test: fired  malformed and unknown-rule allow entries fail
self-test: fired  an allow entry cannot excuse its own identifier, and no output line echoes it
self-test: fired  control characters in printed text are escaped (no injected log lines)
self-test: fired  crafted 100k-character lines scanned in 1.0s
self-test: 29 rules, 76 planted examples
self-test: PASS — every rule fired on every planted example; every scan mechanism went red; clean input passed
exit=0
```

**§3.2**, at `64ed159`:

```
$ node scripts/leak-gate.mjs --tree
leak-gate --tree: clean — 28 file(s) in 0.10s
exit=0
$ node scripts/leak-gate.mjs --history
leak-gate --history: clean — 10 commit(s) in 0.23s
exit=0
```

**§3.3: CI red-proof on the deleted throwaway branch** (run 36085060203, `leak-gate` job):

```
self-test: 29 rules, 76 planted examples
self-test: PASS — every rule fired on every planted example; every scan mechanism went red; clean input passed
leak-gate: private-ip RED-PROOF.md:3 "10.5…" (len 13)
leak-gate --tree: REFUSED — 1 finding(s), 0 problem(s); 29 file(s) in 0.07s
##[error]Process completed with exit code 1.
```

Deletion and confirmation:

```
 - [deleted]         scratch/leak-gate-red
 - [deleted]         scratch/leak-gate-trailer
Deleted branch scratch/leak-gate-red (was c3fdfb5).
Deleted branch scratch/leak-gate-trailer (was e775e69).
remote heads: refs/heads/main refs/heads/wo/CSR-WO-0001
$ git log --all --oneline | grep -c c3fdfb5
0
on WO branch? no
$ git log --all --oneline | grep -c e775e69
0
on WO branch? no
```

**§5.8: trailer-only red-proof in CI** (run 36085060007): `--tree` passes, `--history` refuses.
The address is masked to its length only (D-d).

```
leak-gate --tree: clean — 28 file(s) in 0.10s
leak-gate: email e775e69:(message):3 "…" (len 21)
leak-gate --history: REFUSED — 1 finding(s), 0 problem(s); 10 commit(s) in 0.25s
##[error]Process completed with exit code 1.
```

**§3.4: stale allow** (temporary entry, then reverted to zero bytes):

```
$ node scripts/leak-gate.mjs --tree
leak-gate: .leak-gate-allow:1 stale allow (matched no finding): uuid nothing/**
leak-gate --tree: REFUSED — 0 finding(s), 1 problem(s); 28 file(s) in 0.10s
exit=1
```

**§3.5: masking.** A planted synthetic token, and a short match:

```
self-test: masked github-token github-token-0.md:1 "ghp_…" (len 40)  (no finding line carries its planted value)
self-test: masked a 4-character match shows 2: "~a…" (len 4)
```

**§3.6.** The WO's grep (pattern not repeated here, see finding 4), run over the tree excluding
`node_modules` and `.git`, returns exactly one line, the WO quoting itself:

```
docs/work-orders/CSR-WO-0001.md:106:6. `grep -rn ...` on the tree (excluding
```

The gate's `url-token` rule: 0 findings on the tree.

**§3.7:** all three jobs are green on `64ed159` (run 36085217172). The `test` job's block is
unchanged.

## The full allowlist

`.leak-gate-allow` on this branch, verbatim (zero bytes):

```
```

The only exemptions are D-a and D-b, inside their rules in `scripts/leak-gate.mjs`, each with an
`exemptReason`. D-f's URL-credential hand-off from `email` to `url-userinfo` is a third, internal
one: it only changes which rule reports that shape.

## Scan time

- **This repository:** `--history` over 10 commits takes **0.23 s** by its own report; wall time
  is 248 ms ± 3 ms (hyperfine, 5 runs, on 9 commits).
- **A synthetic 2000-commit repository** (one small change per commit): **6.8 s** on the final
  code. That is about 3.4 ms per commit, linear, from three git spawns per commit.
- **The WO's two-minute line** would fall at roughly 35,000 commits. Far below that, the fix is an
  incremental scan against the merge base, in a later WO, not a weaker scan.
- **`--self-test`:** about 1.5 s, including the crafted-long-line bound.

## What did not work, and why

- **The ratified rules could not pass `main`'s own history** (the stop above). The architect's
  ruling, not a workaround, resolved it.
- **The first gate failed open in five ways**, and so did the first hardening, in four more. Both
  adversarial rounds found real gaps that the self-test didn't cover yet. Each was reproduced,
  fixed, and turned into a self-test case.
- **The first PR check went red on GitHub's synthetic merge commit** (D-g). Only a real
  `pull_request` run could show it; every local and `push` run was green.
- **The gate flagged its own source five times** (finding 3), and my FEEDBACK draft twice. Each
  was fixed by rewording, never by exemption.
- **Tooling slips:**
  - A `Write` was refused because the file had changed on disk, so one self-test run exercised
    the old script. I caught it from the output and re-ran on the rewritten file.
  - A synthetic-repo builder was wrong the first time.
  - Lint caught a useless escape, an unsafe `any`, and a control-character regex. The last was
    rewritten as a character loop rather than suppressed.
- **Shapes the regexes still miss** (also in `scripts/README.md` under *Known limitations*):
  - anything split across lines;
  - encoded forms: base64, URL-encoding, and IPv4 as a single decimal or hex integer;
  - non-ASCII (IDN) domains, and encodings other than UTF-8, UTF-16 and UTF-32;
  - binary-extension files that also hold a NUL byte (in `--tree` only);
  - unprefixed secrets: 32-hex keys, cloud secret keys, and `password=` assignments;
  - routable IPv6, and MAC addresses in dotted or bare twelve-hex form;
  - vendor or platform names not in the lists;
  - commit headers, tags, notes, and other refs;
  - Git LFS content.

## What was deliberately not built

- **No client-side git hook.** Hooks aren't versioned; `npm run leak-gate` is the local path.
- **No third-party secret scanner, and no dependency of any kind.** The gate imports only `node:`
  modules.
- **No scanning of pull-request titles, descriptions or comments.** They are outside the
  repository's control.
- **No history rewrite.** The §7 finding went to the architect, who ruled that nothing leaked. The
  script refuses; it does not repair.
- **No governance or supply-chain files.** That is `CSR-WO-0002`.
- **No required status checks on `main`.** That is the architect's action after merge.
- **No allow entries** (D-c). **No false-positive exemptions** (finding 10). **No header scanning**
  (finding 8).
- **No change to `packages/**`, the steering documents, README, LICENSE, NOTICE, or the `test`
  job.**
