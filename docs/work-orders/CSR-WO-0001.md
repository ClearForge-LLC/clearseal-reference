# CSR-WO-0001 — The leak gate: nothing that identifies a deployment reaches the tree or its history

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` after `CSR-WO-0000` has merged
(verify live HEAD; if `.github/workflows/ci.yml` is absent, the base is wrong — stop).
**Branch:** `wo/CSR-WO-0001`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P0 — skeleton, gates, and spikes · **Phase exit gate:** the clauses this work order owns:
the leak gate's self-test exits non-zero on every planted shape and zero on the tree; `grep` across
the tree for a query-string token path returns nothing; `main` shows the required status checks.
**Grounds:** `docs/northstar.md` N5, N6 (this work order *is* N6's mechanism), N8;
`docs/architecture.md` §7.1 (the adversaries a leak serves), §8 row *Leak gate over tree and
history*, §8 row *No URL credential path*; `docs/roadmap.md` P0 and the standing-cadence rule that
the gate is not advisory. Code seams: `.github/workflows/ci.yml` and `scripts/` from `-0000`. The
rule set to port is public: `ClearForge-LLC/ClearProof/scripts/check_notes.py`, the sanitisation
rules that repository's own gate runs.

> **What this is:** a dependency-free script that scans every tracked file and every line ever
> *added* in reachable history for the shapes that identify a deployment or carry a credential —
> and refuses; a self-test that proves each rule can fire; and a CI job that runs both on every push
> and pull request. It is NOT a secret manager, NOT a content policy, and NOT a substitute for
> review. Why now: N6 says "a leak gate scans the tree and reachable history on every push", and
> until this merges that sentence is a promise the builder is keeping by hand. History is forever;
> the first push after this lands is the first one the invariant actually covers.

**Cadence:** build. One PR, left unmerged for review.

## 1. Scope — numbered, specific

1. **`scripts/leak-gate.mjs`** — plain Node, no dependencies, importing only `node:` modules.
   Modes: `--tree` (every file `git ls-files` reports, skipping binaries by extension list and by a
   NUL-byte probe), `--history` (for every commit in `git rev-list HEAD`, the `+` lines of
   `git show --format= --unified=0 <sha>` **and the full commit message** from
   `git log -1 --format=%B <sha>` — trailers included, because a tooling-added session or
   machine trailer is an identifier and the diff never contains it), and `--self-test`. Exit code non-zero on any finding.
2. **The rule set**, ported from the public source named in Grounds and extended:
   - owned and infrastructure hostnames — any subdomain of the organization's domains, any tunnel
     provider hostname, any tenant hostname of a hosted authorization server, any tailnet name;
   - operator and device paths — `/home/<name>`, the Android terminal-app data path,
     `C:\Users\<name>`, `~<name>`;
   - private address space (`10.`, `172.16–31.`, `192.168.`, link-local), MAC addresses;
   - UUIDs; hex strings of forty or more characters;
   - credential shapes — platform token prefixes, JWT bodies, private-key blocks, `AKIA`-style
     cloud keys, `Bearer <opaque>` in prose, and **a query-string token parameter on any URL**
     (the §8 *No URL credential path* row becomes this rule);
   - e-mail addresses other than the `example.` reserved domains and the platform's no-reply
     domain.
   Each rule has a name, a regex, and a one-line reason in the script, because the next person to
   add a rule copies the shape of the last one.
3. **Allowlist, narrow and justified.** A committed `.leak-gate-allow` file, one entry per line as
   `<path-glob> <rule-name> <justification>`. The gate **fails** on an allow entry that matches
   nothing (stale allows rot into blanket exceptions). Exactly two entries ship: the `uses:` lines of
   `.github/workflows/*.yml` for the forty-hex rule (action pins, set by `-0000`), and
   `package-lock.json` for the forty-hex rule (resolved git dependencies, should any ever be
   added). No other allow without a flag-and-stop.
4. **Output that does not itself leak.** A finding prints `<rule> <path>:<line>` and a masked
   excerpt — the first four characters of the match and its length — never the full match. A gate
   that echoes the secret into a public CI log is the leak.
5. **`--self-test`.** Builds a temporary tree containing one planted example per rule, runs `--tree`
   against it, and asserts a finding for each rule *by name*; then runs against a clean synthetic
   tree and asserts zero. Also plants one shape into a temporary git repository's history behind a
   revert and asserts `--history` finds it — that proves the revert does not hide it — and
   plants one shape in a commit *message* only, asserting `--history` finds that too.
6. **CI job `leak-gate`** in `ci.yml`: `permissions: contents: read`; checkout with full history
   (`fetch-depth: 0` — the history mode needs every commit); runs `--self-test`, then `--tree`,
   then `--history`, in that order, on `ubuntu-latest` only (the scan is platform-neutral). The
   existing `test` job is untouched.
7. **`npm run leak-gate`** as a root script for local use, documented in one paragraph in
   `scripts/README.md` (create it; three sections: what the gate is, how to run it, how to add a
   rule or an allow — and that an allow is a review item).
8. **`FEEDBACK.md`** at the repository root on this branch, per §6.

## 2. Invariants — restated by number from the northstar

The authoritative source is `docs/northstar.md` §4.

- **N6** — the mechanism. Note the consequence that shapes the whole work order: **because history
  is scanned, a planted identifier can never be committed on a branch that will merge.** The
  red-proof for CI therefore lives on a throwaway branch (§3 item 3) and in `--self-test`; the WO
  branch's own history must be clean end to end.
- **N5** — the self-test is the red-proof; a rule with no planted example in the self-test is not
  a rule.
- **N8** — the planted credential shapes in the self-test are synthetic and structurally valid
  only; none may be a real token, and none may be committed anywhere but inside the self-test's
  temporary tree at run time (generated in code, not stored as fixture files).

**Protected surfaces — must diff to empty:** `docs/northstar.md`, `docs/architecture.md`,
`docs/roadmap.md`, `README.md`, `LICENSE`, `NOTICE`, `packages/**`, and the `test` job in `ci.yml`.

## 3. Tests / acceptance — what must be proven, not asserted

1. `node scripts/leak-gate.mjs --self-test` exits zero and prints one line per rule confirming it
   fired on its planted example, plus the history-behind-a-revert confirmation. Paste the output.
2. `--tree` and `--history` both exit zero on the WO branch. Paste both exit codes and the
   commit count `--history` scanned.
3. **CI red-proof on a throwaway branch:** create `scratch/leak-gate-red` from the WO branch,
   commit one synthetic private address in a Markdown file, push, observe the `leak-gate` job fail,
   record the run URL, then **delete the branch** locally and on the remote. Confirm the WO branch
   never contained that commit (`git log --all --oneline | grep -c <sha>` prints `0` after the
   delete). Paste the run URL and the confirmation.
4. Stale-allow proof: temporarily add an allow entry matching nothing; confirm the gate fails
   naming it; revert.
5. Masking proof: plant a synthetic token in the self-test tree; confirm the finding line shows
   four characters and a length, not the token; paste the line.
6. `grep -rn "?token=\|&token=\|?access_token=" --include=* .` on the tree (excluding
   `node_modules`) returns nothing — and the gate's own rule returns nothing.
7. Both CI jobs green on the final commit; the `test` job's block unchanged.

## 4. Scope fence — what is NOT in this work order

- **A client-side git hook.** Hooks are not versioned; `npm run leak-gate` is the local path.
- **Secret *detection* tooling with a dependency tree** (no third-party scanners). The rule set is
  small, ours, and readable; a dependency here is exactly the surface `-0000` closed.
- **Scanning pull-request titles, descriptions, or comments.** Out of the repository's control.
- **Rewriting history if a leak is found in it.** That is an incident, handled by the gate (the
  human), not by this script; the script's job is to refuse.
- **Governance and supply-chain files.** `CSR-WO-0002`.
- **Required status checks on `main`.** An administrative action the architect performs after
  merge; the builder's deploy key cannot and must not.

## 5. Adversarial pass — try to break it before calling it done

Fresh subagent if available; otherwise yourself, framed as an attack on the finished branch.

1. Split a hostname across a line break or a Markdown soft wrap; does the gate still catch it? If
   not, record it as a known limitation in `scripts/README.md` rather than pretending.
2. Encode an identifier (base64, URL-encoding); confirm the gate does not claim to catch that and
   the README says so.
3. Put an identifier inside a fenced code block, an HTML comment, and a YAML comment; the gate
   must not care about context.
4. Rename a file to a binary extension and hide an identifier inside; confirm the NUL probe still
   scans it if it is actually text.
5. Try to satisfy the stale-allow rule with a glob that matches everything; confirm the review
   would see it (the allowlist is printed in FEEDBACK).
6. Time the history scan on the full repository; if it exceeds two minutes, say so — the fix is
   incremental scanning against the merge base in a later work order, not a weaker scan.
7. Check every file added for anything N6 forbids — including the rule reasons, which want to
   quote a real example.
8. Make a commit whose only identifier is in a trailer line of its message, on the throwaway
   branch; confirm `--history` catches it. (`-0000`'s builder found a tooling-added session
   trailer on its first commit; this rule exists because of that.)

## 6. Upward-feedback directive

`FEEDBACK.md` at the repository root on this branch. Schema per entry:
`finding · where (file:line) · type (note | risk | scope-question | bug) · recommendation · decision-needed (yes/no)`.
Lead with anything crossed or parked. Include: a **gates line** (self-test output, tree and
history exit codes with commit count, the throwaway-branch red run URL and the deletion
confirmation, the stale-allow and masking proofs, both CI run URLs, protected-surface diff status);
the full allowlist; the scan time; **what did not work and why** (which shapes the regexes missed
in the adversarial pass); and a **"what was deliberately not built"** section restating §4.

## 7. Flag-and-stop conditions

Park the branch and say so:

- Any finding on the *current* tree or history that is real — a genuine identifier already
  committed. Do not fix it, do not allow-list it: stop, because history rewrite is the gate's call.
- A third allow entry appearing necessary.
- Any rule whose planted example cannot be made synthetic.
- A protected surface that must change.
- The history scan requiring a token or credential to read the repository.

## 8. Kickoff prompt

Sent to the builder session as one message, after `/goal` in its own turn.

`/goal` text:
> A branch `wo/CSR-WO-0001` off current `main` with a dependency-free `scripts/leak-gate.mjs`
> whose `--self-test` proves every rule fires, whose `--tree` and `--history` pass on the branch,
> which masks what it finds, fails on a stale allow, and runs as a `leak-gate` CI job with full
> history — the red-proof done on a deleted throwaway branch so the WO branch's history stays clean
> — parked as one unmerged pull request with `FEEDBACK.md` at the root. Stop at parked.

Kickoff:
> Sync first: `git fetch origin && git checkout -b wo/CSR-WO-0001 origin/main` — confirm
> `.github/workflows/ci.yml` exists on that base; if not, `-0000` has not merged and you stop.
> Cadence: **build** — no spike. Read `docs/work-orders/CSR-WO-0001.md` in full; it is the
> directive; `docs/northstar.md` §4 (N6 especially) and `docs/architecture.md` §7.1 are the source
> of truth it cites.
> Ratified with reasons in the WO: no dependencies (a scanner's dependency tree is the surface
> `-0000` closed); history is scanned, so the CI red-proof happens on a throwaway branch that is
> deleted, never on the WO branch; findings are masked because a gate that echoes the secret is the
> leak; exactly two allow entries, and a stale allow is a failure. The rule set to port is the public
> one named in the WO's Grounds.
> Invariants: N6 — this is its mechanism, and the WO branch's own history must be clean end to end;
> N5 — a rule without a planted self-test example is not a rule; N8 — planted shapes are synthetic
> and generated at run time, never stored. Protected surfaces diff to empty: the four steering
> documents, LICENSE, NOTICE, `packages/**`, the existing `test` job.
> Flag-and-stop: WO §7 — above all, a *real* finding in current history is a stop, not a fix.
> Close with the gate: adversarial pass per §5 (fresh subagent), then `FEEDBACK.md` per §6, then
> one PR to `main` left unmerged. Report the PR link, the self-test output, and the throwaway
> branch's red run URL with its deletion confirmation.
