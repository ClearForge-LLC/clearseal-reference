# Upstream ledger — what this build owes the standard and its neighbours

**What this is:** every finding this repository produces that belongs somewhere else — the
ClearSeal standard's next version, the fleet's own nodes, a public rule source, or a protocol
project — recorded the day it is found so it survives compaction and reaches P5 intact. **Read
before P5 (`CSR-WO-5000`, `-5001`)** and whenever a finding says "this is upstream's".
**Opened:** 2026-09-25 · **Author:** Claude (architect) · **Gate:** Scotty.

Each entry: *what · where it belongs · the evidence here · status*. Entries are never deleted; a
resolved entry gets its resolution appended.

## To ClearSeal (the version after v0.8)

1. **Canonical form must be specified, not measured.** The two shipped canonicalizers diverged on
   a trailing non-breaking space (M5). The standard's §8 #8 names the gap; the next version should
   carry the specification `-1000` writes (key order, number serialization, exactly which
   characters description normalization strips, Unicode normalization or its explicit absence).
   *Evidence:* `architecture.md` §2.1, §2.2; `-1000` when built. *Status:* open, waits on `-1000`.
2. **Decision #13's wording.** "Official SDK, no framework wrapper" assumed the official SDK serves
   the standard's target revision; measured otherwise (`-0100`). Proposed wording: *no framework
   between the code and the specification; an official SDK only when it serves the target revision,
   else a transport written against the specification text with its MUSTs mapped.* *Evidence:*
   `architecture.md` §10; `-0100` FEEDBACK. *Status:* open.
3. **The field envelope contract, verifier-side amendments.** `-0102` found three encodings the
   contract leaves open that a verifier should refuse without a wire change: duplicate JSON keys,
   non-shortest integer forms, and `-0` / `1.0` / `1e0`. *Evidence:* `-0102` FEEDBACK table.
   *Status:* open; applies to the fleet's deployed verifier too.
4. **A placeholder must not mask its line.** The public rule source skipped a whole line when it
   contained a placeholder such as `example.com`, so a real hostname beside one passed. *Evidence:*
   `-0001` FEEDBACK; fix opened upstream as `ClearForge-LLC/ClearProof#11`. *Status:* fix opened;
   merge pending the gate.

## To the fleet's own nodes

5. **Python `normalize_description` uses `rstrip()`** (all Unicode whitespace) where the TypeScript
   twin strips four ASCII characters. Whichever `-1000` specifies, the Python side is amended to
   match. *Status:* open, waits on `-1000`.
6. **Commit identity on rebase.** A machine's global git identity was applied silently during a
   rebase and reached a public branch. Fixed here with a repo-local role identity and a pre-push
   history scan; both guards belong in the build SoP for any public repository a builder session
   touches. *Evidence:* `-0001` FEEDBACK incident entry. *Status:* recorded for the SoP.

## To protocol and tooling projects

7. **The official TypeScript SDK on npm lags the current specification** (`latest` 1.30.1 serves
   `2025-11-25`; the release notes expected Tier 1 SDKs within the window). Not ours to fix; the
   maintenance cadence re-probes on every bump and this ledger records when it catches up.
   *Status:* watching.
8. **A patch release of that SDK added two protections silently** (a body cap and a batch cap
   between 1.30.0 and 1.30.1). Not a defect upstream, but the reason every limit here is the core's
   own with its own test. *Status:* recorded.
9. **The coding agent's goal hook loops on a clause only a human can satisfy** until its cap. The
   builder drafted a report; the gate sends it. The rule that prevents it (every goal clause
   reachable by the builder alone) is being added to the work-order skill. *Status:* report
   drafted; skill change in progress.
