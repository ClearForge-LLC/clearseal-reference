# FEEDBACK: CSR-WO-1000, stage B (the canonical form, implemented from the ratified specification)

Branch `wo/CSR-WO-1000`. Stage A (`b098d08`, `76f709b`) was ratified on 2026-09-26: D-1 and D-2
adopted, C-1 to C-4 accepted, C-5 ruled the other way (plain hex, one allow entry). Built on Node
v24.21.0 with Python 3.12.3. This is PR #32, marked ready for review.

## Review round (architect, 2026-09-26): five change requests, all applied on this branch

The architect's second read of `canonical_oracle.py` against the specification (F9) found no
divergence. These are the rulings and requests, and what was done:

| Request | Done |
|---|---|
| **F1: the depth limit goes into version 1** | A1 now says: an input nested deeper than 512 objects and arrays, counted together, is refused. Oracle vectors A1-7 (512, accepted) and A1-8 (513, refused) were added. The code comments cite the rule rather than an implementation limit. An off-by-one mutant (limit 513) now fails vector A1-8 as well as the boundary test |
| **F6: the leading-U+FEFF rule applies to the description as given and after normalization** | The sentence is in A3 and A4. Vector A4-9 (a tool whose description is LF, U+FEFF, `abc`) is refused by both |
| **F7: a literal is first rounded to the nearest double, then serialized** | The sentence is in A2. Vectors A2-16 (`9007199254740991.4` → 2^53−1, accepted) and A2-17 (`-1e-400` → negative zero, refused) |
| **A6-4 relabelled** | It is now **A5-9**, refused under A5, the rule that refuses it. The id A6-4 is retired and A6-5 keeps its id, so no existing id changes meaning |
| **Plain hex in `docs/canonical-form.md`** | A second `.leak-gate-allow` line: `docs/canonical-form.md long-hex digests of committed public test inputs, not secrets`. The document's tables are rendered from the oracle-written vectors file by a throwaway, uncommitted script. A check confirmed every one of the 69 vectors appears in the document with identical hex and digest. The allow lines suppress 59 findings in the vectors file and 97 in the document |

**After the round:**
- **Vectors:** 69. The oracle diff on the commit exits 0: `wrote packages/core/test/vectors/canonical-v1.json: 69 vectors`.
- **`npm run check`:** exits 0. Core has **296** tests; the spikes have 69 and 8; `test:subset` has 4.
- **Property suite:** re-run, with 0 mismatches in every property; 8,700 inputs this run.
- **Red-proof matrix:** re-run against the commit. The script now refuses to start on a dirty tree. Every mutant goes red except the equivalent accessor mutant, as before.
- **Leak gate:** `--tree` and `--history` exited 0 before the push.

**F1's and F6's "decision-needed" in the table below are resolved** by the rulings above.

## Gates

| Gate | Result |
|---|---|
| `npm run check` | exit 0: core **291** tests (16 files), spike 0102 69, spike 0101 8, `test:subset` 4 |
| CI | both runners; the oracle-diff step runs on Linux |
| Protected surfaces | The steering documents (`README.md`, `northstar.md`, `architecture.md`, `roadmap.md`), `docs/upstream.md`, `LICENSE`, `NOTICE`, `scripts/**`, `spikes/**` and `packages/core/src/transport/**` diff **empty**. `.github/workflows/ci.yml` gains the one named step. `.leak-gate-allow` gains the one ruled line |
| Leak gate | `--tree` and `--history` exited 0 before every push, each checked by exit code. The allow entry suppresses 55 long-hex findings, all in `packages/core/test/vectors/canonical-v1.json` |
| Credentials | Pushes went over the repository's write deploy key. A short-lived token was minted only for the pull-request calls, kept in a mode-0600 scratch file, and deleted straight after |

## Commits, in order

1. **The ratified text first, in its own commit.** The document is marked ratified. The vectors
   file goes to plain hex, and `.leak-gate-allow` gets
   `packages/core/test/vectors/*.json long-hex digests of committed public test inputs, not secrets`.
2. **The build (WO §1.4–§1.8).**
3. **The adversarial pass's fixes.**

## What was built

- **`packages/core/src/pinning/canonical.ts`** is the one canonicalizer, written rule by rule from
  the ratified text.
  - **It owns the JCS layer and has no dependency.** The only platform facilities it uses are the
    two definitions JCS itself defers to: `String(number)`, which is ECMAScript's
    `Number::toString`, and UTF-16 string comparison.
  - **JSON text** is parsed by the transport's existing strict parser, imported and not copied (N1).
- **`packages/core/src/capability/fields.ts`** is the one place `PINNED_FIELDS` and
  `GATE_READ_FIELDS` are written.
  - The canonicalizer imports the first; `test:subset` imports the second.
  - `GATE_READ_FIELDS` is typed as a subset of the pinned fields, so an unpinned gate field also
    fails the type check.
- **`packages/core/test/oracle/`** has two parts:
  - `canonical_oracle.py`, the independent Python implementation, standard library only;
  - `generate.py`, the **only** writer of `canonical-v1.json`.
- **CI** gets one step:
  `python3 packages/core/test/oracle/generate.py && git diff --exit-code -- packages/core/test/vectors/canonical-v1.json`.
- **`test:subset`** is wired into `npm run check`. It asserts three things:
  - every gate-read field is in the hashed set, which is read from the canonicalizer's output, not
    restated;
  - that set is exactly the ten pinned fields;
  - changing each gate-read field changes `tool_hash`.
  It is shown able to go red on a synthetic unpinned field.

## Oracle-diff output

**On the committed tree:**

```
$ python3 packages/core/test/oracle/generate.py && git diff --exit-code -- packages/core/test/vectors/canonical-v1.json
wrote packages/core/test/vectors/canonical-v1.json: 64 vectors
$ echo $?
0
```

**Reproducing stage A.** The first run of the generator reproduced all 63 stage-A vectors, which a
separate throwaway script had computed in stage A. Every expected result, hex string and digest was
identical. The only line that changed was the A1-5 note's wording (the C-4 correction).

**A flipped digit** in A1-1's `canonical_hex`:

```
  ✖ A1-1 (A1, json): canonical
  ✖ the oracle, run now, agrees with the file on every vector
 packages/core/test/vectors/canonical-v1.json | 2 +-
ci_step_rc=1
```

The adversarial pass separately committed a one-digit mutant in a scratch clone and saw the step
exit 1.

## Property-test counts

fast-check drives 300 runs per property, and every generated input goes through **both**
implementations: the oracle by subprocess, one batch per property. The equality is on bytes, or on
both refusing. These are the counts from one local run; CI's runs are of the same size, with 0
mismatches:

```
A1 key order: 600 inputs (600 canonical, 0 refused), 0 mismatches
A2 numbers: 1794 inputs (856 canonical, 938 refused), 0 mismatches
A3 normalization forms: 1200 inputs (1184 canonical, 16 refused), 0 mismatches
A3 surrogates and BOMs: 1200 inputs (300 canonical, 900 refused), 0 mismatches
A4 descriptions: 300 inputs (300 canonical, 0 refused), 0 mismatches
A5 names: 300 inputs (102 canonical, 198 refused), 0 mismatches
A6-A9 tools: 600 inputs (600 canonical, 0 refused), 0 mismatches
A8 absent/null/empty: 1500 inputs (1200 canonical, 300 refused), 0 mismatches
A9-A10 manifests: 900 inputs (600 canonical, 300 refused), 0 mismatches
```

That is **8,694 inputs per run**. The adversarial pass also ran its own sweep of about 240,000
requests (doubles by bit pattern, decimal forms, near-bound integers) and about 250 hand-made edge
cases. There were 0 disagreements outside F1.

## The dev dependency

- **`fast-check` 4.10.2**, pinned exactly in `@clearseal/core`'s `devDependencies`, plus its one
  dependency, **`pure-rand` 8.4.2**. Both are MIT.
- **The lockfile adds 2 packages**, 1.8 MB on disk. There is no runtime change.
- **No JCS dependency.**

## Red-proofs (N5)

Each mutant was applied to the committed `canonical.ts` and restored from it:

| Mutant | Goes red in |
|---|---|
| A1 member names unsorted | vectors 13, properties 4, boundaries 2 |
| A1 duplicate keys accepted (`JSON.parse`) | vectors 1 (A1-5) |
| A1 names in code-point order (the fleet Python's) | vectors 1 (A1-2), properties 1 |
| A2 negative zero accepted | vectors 2, properties 1 |
| A2 magnitude bound removed | vectors 2, properties 2 |
| A3 leading U+FEFF accepted | vectors 1, properties 2 |
| A3 NFC applied | vectors 1, properties 3 |
| A4 **M5**: per-line strip by `trimEnd()` (Unicode whitespace) | vectors 3, properties 4 |
| A4 description not normalized | vectors 1, properties 3 |
| A5 name pattern case-insensitive | vectors 1 |
| A6 extra field dropped, not refused | vectors 1 |
| A6 booleans coerced | vectors 1 |
| A7 set not deduplicated | vectors 1, properties 3 |
| A8 absent top-level field read as `null` (the prior D-1 replaced) | vectors 1, properties 1 |
| A9 manifest hash without the version (the prior D-2 replaced) | vectors 2, properties 1 |
| A9 duplicate names accepted | vectors 1 |
| A10 version not checked | vectors 1, properties 1 |
| `elevated` always hashed `false` (adversarial F4) | vectors 1 (A6-5), properties 3, `test:subset` 1 |
| Nesting limit lowered to 64 (adversarial F1) | boundaries 1 |
| **`test:subset`: `elevated` leaves the hashed object** | **`test:subset` 4**, vectors 7, properties 3 |

One mutant is **equivalent** rather than a gap: "accessors not refused", which drops
`"value" in d`. The canonicalizer reads each member from its property descriptor and never calls a
getter. An accessor's descriptor has no `value`, so the field arrives as undefined and is still
refused, under A8. The explicit check makes the refusal's reason honest; it adds no protection.

## Adversarial pass (fresh subagent, WO §5)

**WO §5 held:**
- **§5.1:** duplicate keys are refused by both at every level, in every escape spelling, and after
  100,000 keys.
- **§5.2:** keys differing by a trailing U+FE0F, and the UTF-16 sort cases (U+D7FF, U+E000, U+FB01,
  U+FFFF, U+10000, U+1F600, U+10FFFF), agree as keys and as set members.
- **§5.3:** a 1 MiB description takes at most 159 ms in TypeScript and 482 ms in the oracle,
  including process spawn. It scales linearly to 16 MiB with no quadratic path, and `"\n\n\n"` is
  empty in both.
- **§5.4:** a flipped byte fails CI's step.

| # | Finding | Severity | Status |
|---|---|---|---|
| F1 | **Nesting depth.** The oracle crashed with `RecursionError` from depth 498, below the 512 text bound, and a crash took down its whole batch. The TypeScript value path (`input_schema` passed as an object) had no bound and threw a bare `RangeError` somewhere between 2,000 and 20,000 deep. No test went past depth 4 | medium | **Fixed.** One nesting limit, 512 objects and arrays, in both implementations and on both paths; beyond it, both refuse. The oracle's recursion limit is raised so that the limit, not the interpreter, decides. Tests pin 512 accepted and 513 refused, for text and for a tool's schema, in both implementations. **Decision-needed:** version 1 sets no depth, so this is an implementation limit. It is kept out of the vectors file on purpose, since vectors are the spec's. Proposed for version 2: *"an input nested deeper than 512 objects and arrays is refused."* |
| F2 | `canonicalManifestBytes(null)` threw a `TypeError` rather than refusing | low | **Fixed:** a manifest that is not a plain object is refused (A9) |
| F3 | The TypeScript value API accepted some non-JSON shapes silently: a non-enumerable or symbol-keyed extra field, array extra properties, getters (read twice), and a cycle (`RangeError`) | low | **Fixed:** only enumerable, string-keyed data members, read once from their descriptors. Anything else is refused, never skipped, and a cycle meets the nesting limit. A `Proxy` can still describe itself consistently falsely. `-1001` should canonicalize manifests from text through `parseCanonicalJson`, which builds only plain values |
| F4 | No canonical vector had `elevated: true`, so a mutant hashing `elevated` as always `false` passed every vector | low–medium | **Fixed:** vector **A6-5**, every boolean true plus a containment domain, added to both the file and the document. Adding a vector changes no expected result |
| F5 | `test:subset` checked keys only, not that each value reaches the hash | info | **Fixed:** it now checks that changing each gate-read field changes `tool_hash` |
| F6 | **Spec ambiguity, shared by both implementations.** A tool whose description is `"\n"` followed by U+FEFF and `abc` is refused: after A4 removes the LF, the string begins with U+FEFF, and serialization checks A3 again. The `description` kind accepts the same input. A3's Scope line says only "before A4 normalizes it" | low | **Recorded, decision-needed.** Proposed one sentence for A3: *the normalized description is checked again, as every string in the canonical object is.* That is what both implementations do |
| F7 | **Spec silence on literal to double.** `1e-400` underflows to `0` and is accepted, `-1e-400` is refused as negative zero, and `9007199254740991.4` rounds to 2^53−1 and is accepted. Both implementations agree on all of them | info | **Recorded.** Proposed for version 2: *a number's value is the IEEE 754 double nearest its literal; A2 applies to that double* |
| F8 | The oracle split its input with `splitlines()`, which also splits at U+2028 and U+0085 inside a raw-UTF-8 line. The harness hid this by escaping requests to ASCII | low | **Fixed:** it splits on LF only |
| F9 | **Is the oracle independent (N3)?** The cores differ. Python implements `Number::toString` itself, sorts on UTF-16-BE bytes, and parses with `json` hooks; the TypeScript uses `String()`, string comparison, and the transport's parser. But the surfaces match: 17 of 26 refusal messages are identical, the check order is the same, and both carry the coordinated depth constant. **The same session wrote both, one after the other.** The oracle was written from the specification, not translated, but it is not the work of a second author. The shared readings the pass found (F1, F6) are exactly what a second author would catch | medium | **Disclosed.** Recommended: the architect or a separate session reviews `canonical_oracle.py` against `docs/canonical-form.md` alone before merge. Refusal messages are never compared (only bytes, or both refusing), so their sameness has no effect on the result |
| F10 | FEEDBACK was still stage A's | process | **This file** |
| F11 | About 39% of the key-order property's inputs were refusals, for which "same bytes" is trivial | info | **Fixed:** that property draws accepted values only (600 of 600 canonical) |
| F12 | `__pycache__` is not in `.gitignore`. Importing the oracle as a module leaves an untracked directory | info | **Not changed.** `generate.py` sets `dont_write_bytecode` and `serve` runs as a script, so only ad hoc imports create it. `.gitignore` is outside this WO's named edits |

## What did not work, and why

- **My mutant script restored `canonical.ts` with `git checkout` while my fixes were uncommitted.**
  It silently undid them. This is **the same slip as in `-1005b`**, repeated. I re-applied the
  fixes, committed, and re-ran the whole matrix against the commit; the table above is from that
  run. The lesson has to become a rule, not a memory: **commit before any mutant run.**
- **The first surrogate-injection property guessed escape offsets and was wrong.** It now escapes
  the two halves separately and asserts refusal exactly when the decoded string is not
  well-formed.
- **The first A8 property failed on its own generator.** An out-of-range number inside the schema
  makes all four variants refused. The schema generator now stays in A2's range; out-of-range
  numbers are A2's own property.
- **This document shows spaced hex, not plain hex.** The ruled allow entry covers
  `packages/core/test/vectors/*.json` only, and the WO permits that one line, so
  `docs/canonical-form.md` still cannot carry a 64-digit run. It says so, and names the vectors file
  as authoritative. Plain hex there would need a second allow line: your call.

## What was deliberately not built

- **The manifest file format, signing, verify-before-register, drift refusal** (`-1001`).
- **Any tool** (`-1004`).
- **A gate-decision-derived field list** (the fleet's `gate_decision_fields`). There is no gate code
  yet to derive it from. `test:subset` guards the declared list, and the first gate WO should add
  the derived check.
- **The `docs/upstream.md` entries 1 and 5**, which are the architect's ledger. The proposed entry-5
  vectors are in stage A's FEEDBACK at `76f709b` (the fleet's code-point sort, `1.0`, `1E2`, `1e-7`).
