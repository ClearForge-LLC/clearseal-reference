# CSR-WO-0002a — Corrections from review: a gate that admits the bot, and engine strictness that does not block it

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD; the
base must contain `.github/dependabot.yml`).
**Branch:** `wo/CSR-WO-0002a`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P0 · **Phase exit gate:** the dependency-update configuration has opened at least one
pull request **that passes CI** — the clause `-0002` could not meet, made meetable.
**Grounds:** `docs/northstar.md` N5, N6; `docs/architecture.md` §5 rows *Dependencies* and
*Supply chain in CI*; `-0002`'s as-built note (4); the `-0002` FEEDBACK decisions on the bot's
commit shapes and the engine pin. Code seams: `scripts/leak-gate.mjs` (this work order is allowed
to change it; nothing else may), `.npmrc`, `package.json`, `scripts/`.

> **What this is:** two small changes so that the dependency bot's pull requests are not red by
> construction. The bot signs its commits with a vendor `Signed-off-by` and links platform compare
> URLs whose path holds two full SHAs; both are public references, and the gate must say so
> precisely rather than broadly. And the bot regenerates the lockfile with its own Node, which the
> exact `engine-strict` pin refuses; the guarantee behind that pin belongs in an explicit check the
> suite runs and in the host install scripts, not in a file that also gates the bot. It is NOT a
> relaxation of N6 and NOT a change to which Node the reference runs on.

**Cadence:** build. One PR, left unmerged for review.

## 1. Scope — numbered, specific

1. **Gate, e-mail rule:** exempt a `Signed-off-by:` trailer **only when the signer's name is the
   platform's dependency bot** (`dependabot[bot]`), whatever address follows. A trailer with the
   same address and a different name still fires. Planted self-test examples for both.
2. **Gate, long-hex rule:** exempt a 40-hex string **only when it sits inside a platform commit or
   compare URL** — `https://github.com/<owner>/<repo>/commit/<sha>` or
   `…/compare/<ref>...<ref>` where a ref may be a full SHA. The same SHA outside such a URL, or in a
   URL on any other host, still fires. Planted examples for the exempt shape and for both
   lookalikes.
3. **Engine strictness — measured, so the ruling changed before this work order ran:** the bot
   opened its first two pull requests within minutes of the configuration merging, lockfile
   regenerated, with `engine-strict=true` in place. The pin does *not* block the bot. So
   **`.npmrc` is left exactly as it is.** What is added: `scripts/check-node.mjs` — reads
   `.node-version`, compares to `process.version`, exits non-zero with both values on mismatch —
   wired as the **first** step of `npm run check`, so the suite itself refuses a wrong runtime even
   where an install did not run. `scripts/README.md` gains a paragraph saying which guarantee lives
   where (install: `.npmrc`; suite: `check-node`; host install scripts: `npm ci --engine-strict`).
4. **Provenance workflow packs `packages/*` only.** `npm pack --workspaces` also packs the private
   spike (`private` blocks publishing, not packing), so a tag release would carry a spike tarball
   (`-0100` FEEDBACK finding 3). Narrow the pack step to the `packages/*` workspaces and prove it
   with the dry run's file list. This is the one workflow edit this work order may make.
5. **`FEEDBACK.md`** per §6.

## 2. Invariants

- **N6** — the two exemptions are shapes of *public references*, not identifiers; the lookalike
  self-tests prove they do not widen. Leak gate before every push.
- **N5** — `check-node.mjs` is shown to fail on a wrong version (run it under the machine's other
  Node); each new self-test example is shown to fire.

**Protected surfaces — must diff to empty:** the four steering documents, `LICENSE`, `NOTICE`,
`packages/**`, `scripts/test.mjs`, `scripts/check-directives.mjs`, `.github/workflows/ci.yml`,
`.github/dependabot.yml`, the governance files. (`provenance.yml`: the pack step only.)

## 3. Tests / acceptance

1. `--self-test` lists the four new planted examples by rule and passes; paste.
2. A synthetic commit on a throwaway branch with a bot-shaped `Signed-off-by` and a compare URL in
   its message passes `--history`; the throwaway branch is deleted after (as in `-0001`).
3. `check-node.mjs` exits non-zero under a different Node and zero under 24.21.0; paste both.
4. `npm ci` still refuses under a different Node (`.npmrc` unchanged), and so does `npm run check`
   even when the install was skipped; paste both.
5. All CI jobs green; the `test` and `leak-gate` job definitions unchanged.

## 4. Scope fence

- **Any other gate rule.** One exemption per finding; nothing speculative.
- **Widening either exemption** beyond the exact shapes above.
- **`CODEOWNERS`.** Human track (team creation), then the architect.
- **Touching `ci.yml` or the bot configuration.** (`provenance.yml`'s pack step is in scope; nothing else in it.)

## 5. Adversarial pass

1. A bot-shaped `Signed-off-by` trailer (the bot's name and the vendor support address it signs
   with) on one line and a real hostname on the
   next line of the same message: the hostname must still fire.
2. A compare URL on the platform host but with a path of a different shape
   (`/<owner>/<repo>/tree/<sha>`): must still fire until ruled otherwise.
3. A 40-hex inside a URL on a lookalike host (`github.com.example.net`): must fire.
4. `check-node.mjs` with `.node-version` missing: must fail, not pass.

## 6. Upward-feedback directive

`FEEDBACK.md`: gates line (self-test output, throwaway-branch run and deletion, the two
`check-node` runs, CI links), the exact regexes added with their lookalike cases, and the standard
entries.

## 7. Flag-and-stop conditions

- Either exemption cannot be written narrowly enough to pass its lookalike tests.
- A protected surface must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-0002a` off current `main` where the leak gate admits exactly the platform
> bot's `Signed-off-by` trailer and full SHAs inside platform commit/compare URLs — with lookalike
> self-tests proving neither exemption widened — `.npmrc` unchanged, an explicit
> Node check runs first in `npm run check` and is shown to fail on the wrong Node, CI is green, and
> the work is parked as one unmerged pull request. Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-0002a origin/main`; confirm
> `.github/dependabot.yml` exists on the base. Cadence: **build**. Read
> `docs/work-orders/CSR-WO-0002a.md` in full and `-0002`'s as-built note. Two narrow gate
> exemptions with lookalike proofs; `check-node.mjs` joins `npm run check`; `.npmrc` stays; nothing else.
> This WO may edit `scripts/leak-gate.mjs`; no other WO could. Leak gate before every push.
> Flag-and-stop: WO §7. Report the PR link and the self-test lines for the four new examples.
