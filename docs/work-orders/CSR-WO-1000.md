# CSR-WO-1000 — The canonical form: specified, ratified, then implemented from the specification

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD).
**Branch:** `wo/CSR-WO-1000` (stage A), continued on the same branch for stage B after ratification.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P1 · **Phase exit gate (the clause this WO owns):** the cross-language vectors verify
and `test:subset` passes — every field a gate reads is inside the hash.
**Grounds:** `docs/northstar.md` N3 (the canonical form specified precisely enough for an
independent implementation to produce identical bytes; every gate-read field inside the hash);
`docs/architecture.md` §2.2 (the M5 divergence — two shipped canonicalizers disagreed on a
trailing U+00A0), §5 rows *Canonical form*, *Gate-read fields*, *Test discipline for parsers*;
§8 rows *Pinning*, *Canonical form*; `docs/roadmap.md` P1; `docs/upstream.md` entries 1 and 5.

> **What this is:** the first control that is a *document* before it is code. The manifest hash
> is the whole pinning control's meaning; if two implementations hash the same tool differently,
> every boot reports drift that is not there and the control dies of fatigue (ClearSeal §8.8). The
> fleet learned this the expensive way (M5). So this WO writes the specification first — every
> decision an implementer must make, with a byte-level vector for each — **stops for the gate's
> ratification**, and only then implements the core's canonicalizer from the ratified text, proven
> against vectors a second language generated. It is NOT the pin gate (`-1001`), NOT the manifest
> format beyond the hash inputs, and NOT a place for the canonicalizer to define itself by its
> own output.

**Cadence:** two stages on one branch. **Stage A — spike:** write the specification and its
vectors, open a *draft* PR, **STOP** for ratification. **Stage B — build**, after the architect's
kickoff for it: implement from the ratified specification, oracle in Python, property tests, mark
the PR ready. One PR, left unmerged for review.

## 1. Scope — numbered, specific

### Stage A — the specification (`docs/canonical-form.md`)

1. **Every decision, named and vectored.** The document lists each of the decisions below as a
   numbered rule, states the rule in one sentence, gives the reason in one or two, and attaches
   at least one vector (input → exact canonical bytes as hex → SHA-256). The architect's prior for
   each is given here; the builder may argue for a different rule *with a vector showing why*, but
   silently picking a different one is a finding.
   - **A1 — The JSON layer.** *Prior:* **adopt RFC 8785 (JSON Canonicalization Scheme) wholesale**
     for serializing objects: no insignificant whitespace, keys sorted by **UTF-16 code units**
     (RFC 8785 §3.2.3), strings escaped per its §3.2.2.2, numbers per ECMAScript
     `Number::toString` (§3.2.2.3), UTF-8 output. Reason: a published scheme with independent
     implementations and vectors beats a private one; the fleet's Python canonicalizer sorts by
     code point (differs from JCS only for keys with astral characters) — record that as a
     deviation in `docs/upstream.md` entry 5 with the vector that shows it.
   - **A2 — Numbers.** *Prior:* per A1 for the schema layer (a schema may carry `multipleOf:
     0.01`); `NaN`, `±Infinity`, `-0` refused at registration; integers beyond ±2^53−1 refused.
     A vector each for `1.0`→`1`, `1e21`, `1e-7`, `0.1+0.2`.
   - **A3 — Strings.** *Prior:* strings are bytes-as-given — **no Unicode normalization anywhere**
     (NFC and NFD forms of the same text are different tools); a lone surrogate refused; a
     leading BOM refused rather than stripped (a BOM inside a tool definition is an error, not a
     platform artifact). Vectors for U+0301 composed/decomposed, U+FEFF, U+D800.
   - **A4 — Description normalization** (the only string transform). *Prior:* the fleet's
     post-M5 rule exactly — `\r\n` and `\r` → `\n`; per line, strip trailing `[ \t\f\v]+` and
     **nothing else** (U+00A0, U+2028, U+3000 are preserved); strip leading and trailing `\n`
     only; internal blank lines preserved. Vectors: the M5 case (trailing U+00A0 preserved),
     CRLF, trailing tab, leading blank lines, U+2028.
   - **A5 — Tool names and other identifiers.** *Prior:* ASCII pattern `[a-z0-9][a-z0-9._-]{0,63}`
     enforced at registration, so no normalization question arises; a vector of a refused name.
   - **A6 — The hashed field set.** *Prior:* exactly the gate-read fields the architecture
     lists, **imported from one module** (the capability module), never restated; the
     specification names them and states the generating rule: *a gate must never decide on a
     field the manifest does not hash.* The subset test (§1.B4) enforces it.
   - **A7 — Set-valued fields** (containment paths, allowed hosts). *Prior:* deduplicated, sorted
     by UTF-16 code units (consistent with A1), serialized as arrays; case preserved.
   - **A8 — Absent versus null versus empty.** *Prior:* an absent optional field is serialized as
     absent (not `null`); `null` where the schema allows it is serialized as `null`; an empty
     object or array is serialized as such. Three vectors.
   - **A9 — The tool hash and the manifest hash.** *Prior:* `tool_hash = SHA-256(canonical bytes
     of the hashed field set)`; `manifest_hash = SHA-256(canonical JSON of the array of
     {name, tool_hash} objects sorted by name)`; both hex lowercase. Vectors with two tools.
   - **A10 — Versioning.** *Prior:* the specification carries `canonical_form_version: 1` and the
     manifest records it; a change to any rule bumps it and the pin gate refuses a manifest whose
     version it does not implement.
2. **Vectors as data.** Every vector also lands in `packages/core/test/vectors/canonical-v1.json`
   (input, expected hex, expected sha256, rule id) — the file both implementations are checked
   against. In stage A they are computed by hand or by a throwaway script that is **not**
   committed; the committed generator comes in stage B.
3. **Draft PR opened; STOP.** FEEDBACK per §6 with any argued deviation from a prior, then wait.

### Stage B — the implementation (after ratification)

4. **`packages/core/src/pinning/canonical.ts`** implemented from the ratified text: one
   canonicalizer, imported by both the pin side and the verify side (`-1001`), never inlined.
   Includes the JCS layer (own implementation, no dependency — it is ~150 lines and the
   reference must own the bytes it hashes), the description normalizer, the field-set
   selection, and both hashes.
5. **The Python oracle** `packages/core/test/oracle/canonical_oracle.py` — an independent
   implementation written from the specification (not translated from the TypeScript), plus a
   generator that regenerates `canonical-v1.json`; the TypeScript is checked against the file and
   never generates it (N3). A CI step runs the generator and fails if the committed file differs.
6. **Property-based tests** (a pinned dev dependency, tree measured) over: key order
   permutations, Unicode normalization forms, lone surrogates, BOMs, U+00A0 and the other
   non-ASCII whitespace, number forms, absent/null/empty. Each property also runs the same
   inputs through the oracle via a subprocess and asserts byte equality.
7. **`test:subset`** — for every gate-read field the capability module exports, assert it is in
   the hashed field set; the test imports the list from the module (one list). Wired into
   `npm run check`.
8. **FEEDBACK** per §6; PR marked ready.

## 2. Invariants

- **N3** — the specification is the source; both implementations are written from it; vectors
  come from the second language.
- **N5** — every rule has a vector that fails when the rule is broken; the oracle diff step is a
  red-proof for the generator.
- **N1** — one canonicalizer in core; editions never touch it.

**Protected surfaces — must diff to empty:** the four steering documents, `LICENSE`, `NOTICE`,
`scripts/**`, `.github/**` (stage B may add the oracle-diff step to `ci.yml` — the one exception,
named here), `spikes/**`, `packages/core/src/transport/**`.

## 3. Tests / acceptance

Stage A: `docs/canonical-form.md` with ten numbered rules, each with reason and vector; the
vectors file; the draft PR; FEEDBACK listing any argued deviation.
Stage B: `npm run check` green on both runners; the oracle regenerates the vectors file with no
diff; every property test passes against both implementations; `test:subset` passes and is shown
to fail when a gate-read field is removed from the hashed set; the dev dependency's tree pasted.

## 4. Scope fence

- **The manifest file format, signing, verify-before-register, drift refusal.** `-1001`.
- **Any tool.** `-1004`.
- **A JSON canonicalization dependency.** The bytes we hash are ours to own.

## 5. Adversarial pass (stage B)

1. Feed both implementations an object with duplicate keys; confirm both refuse (JCS does not
   define duplicates; the reference refuses).
2. Keys that differ only by a trailing U+FE0F; keys with astral characters (the A1 sort case).
3. A description of 1 MiB; a description that is only `\n\n\n`.
4. Change one byte in the vectors file; confirm CI's oracle-diff step fails.

## 6. Upward-feedback directive

Stage A FEEDBACK: the rule list with any argued deviation and its vector; nothing else. Stage B
FEEDBACK: gates line, oracle-diff output, property-test counts, dev-dependency tree, and the
standard entries.

## 7. Flag-and-stop conditions

- A prior turns out to be unimplementable identically in both languages (record the vector,
  stop that rule).
- A gate-read field cannot be canonicalized under the rules (e.g. a value the schema allows that
  A2 refuses).
- A protected surface must change beyond the named exception.

## 8. Kickoff prompt

`/goal` text (stage A):
> A branch `wo/CSR-WO-1000` off current `main` with `docs/canonical-form.md` stating ten numbered
> canonicalization rules each with a reason and a byte-level vector, the vectors also in
> `packages/core/test/vectors/canonical-v1.json`, any argued deviation from the architect's priors
> shown with a vector in `FEEDBACK.md`, no implementation code, and the work parked as one draft
> pull request for ratification. Specify and STOP. Stop at parked.

Kickoff (stage A):
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-1000 origin/main`. Node 24.21.0. Cadence:
> **SPIKE — specification only, then STOP** for the gate's ratification; stage B has its own
> kickoff. Read `docs/work-orders/CSR-WO-1000.md` in full, `docs/architecture.md` §2.2 and §5
> (*Canonical form*, *Gate-read fields*), `docs/upstream.md` entries 1 and 5, and RFC 8785. Ten
> rules, each with a reason and a vector; vectors also as data; a prior may be argued against only
> with a vector. No code. Draft PR. Leak gate before every push. Report the PR link and the rule
> list.
