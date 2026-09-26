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

5. **The fleet's canonicalizers versus the ratified canonical form.** The description rule was
   already reconciled (post-M5: both strip `[ \t\f\v]`). What remains, measured in `-1000` stage
   A with vectors in its FEEDBACK: the fleet's Python sorts keys by code point where RFC 8785 sorts
   by UTF-16 code units (differs only for astral-character keys — and the fleet's own two
   canonicalizers disagree with *each other* there); and Python's float repr differs from
   ECMAScript on `1.0`, `1E2` and `1e-7`. The reference's form is the ratified one; the fleet's
   nodes adopt it at their next canonical-form version bump. *Status:* open, waits on the fleet's
   v2 ports (P5).
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
10. **Never pipe the gate.** The architect ran `leak-gate --tree | tail -1`, lost the non-zero
    exit, and pushed a finding (a dotted four-part RFC section number matched the IPv4 rule) — the same
    slip the builder had caught in itself a day earlier. The build SoP gets the line the builder
    already follows: *check the gate's exit code directly, before every push, no pipe*. And a
    second: *admins are not exempt from required checks* — `enforce_admins` on, from the first
    protection rule. *Evidence:* `architecture.md` §10, 2026-09-26. *Status:* both applied here;
    SoP line pending in the skills repository.
11. **§3's field list names a capability class inside a parenthetical.** The standard's pinned-field
    sentence at `66b640d` puts `owned_state` in backticks inside an aside, so a naive parser counts
    eleven fields where the standard's own heading says ten. The reference's detector strips
    parentheticals before reading; the next version should keep identifiers out of asides in any
    sentence that enumerates. *Evidence:* `-1001` FEEDBACK; `packages/core/test/pinning/spec-check.test.ts`.
    *Status:* open, wording only.
12. **§3 calls `containment_domain` a sink set but gives no sink grammar.** Two conforming
    implementations can pin the same intent as different strings, so a manifest hash would differ
    across them. The reference proposes three schemes — `fs:<absolute root>`, `host:<name>[:port]`,
    `svc:<name>` — canonical, lower-case hosts matched by name never address, refused rather than
    repaired when malformed; the next version should name a grammar, this one or another.
    *Evidence:* `packages/core/src/containment/domain.ts`; `architecture.md` §5, *Containment matching*.
    *Status:* open, proposal.
13. **The `fs:` sink grammar the reference proposes (entry 12) is POSIX-only.** A Windows drive path
    cannot be declared, so the Windows host edition (P4) cannot pin a file root as the grammar
    stands. Any sink grammar the standard adopts needs a portable spelling for file roots, or a
    rule that the operating system is part of what is pinned. *Evidence:* `packages/core/src/containment/domain.ts`;
    `CSR-WO-1004` §1.3. *Status:* open, to be measured at `-1004` and resolved before P4.
