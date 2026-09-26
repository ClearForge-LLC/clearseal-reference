# FEEDBACK: CSR-WO-1000, stage A (the canonical form, specified; parked for ratification)

Branch `wo/CSR-WO-1000`, cut from `main` at `b93e1b3`. This is a **draft** pull request, and there
is no implementation code. The deliverables are `docs/canonical-form.md` (ten rules, 63 vectors)
and `packages/core/test/vectors/canonical-v1.json`: the same 63 vectors, 41 canonical and 22
refusals. Built on Node v24.21.0.

**How the vectors were made:**
- A throwaway Python script, **not committed**, computed them. It carries its own JCS: ECMAScript
  number formatting, UTF-16 member order, and JCS string escaping.
- A second throwaway in Node recomputed every canonical vector, using `JSON.stringify` for
  ECMAScript number and string forms and the default UTF-16 sort. Result: **41 of 41
  byte-identical.**
- The RFC 8785 wording was checked against the official text from the RFC Editor.

## The rule list

| Rule | Rule, in one line | Prior |
|---|---|---|
| A1 | Canonical bytes are the RFC 8785 (JCS) serialization; a duplicate key is refused | adopted |
| A2 | ECMAScript `Number::toString`; NaN, the infinities, negative zero, and magnitude over 2^53−1 refused | adopted (C-1: `1e21` is refused under it) |
| A3 | Strings as given, no Unicode normalization; a lone surrogate or a leading U+FEFF refused | adopted (C-2: "leading" read per string) |
| A4 | Top-level `description` only: CRLF/CR → LF, per-line trailing `[ \t\f\v]+` stripped, leading/trailing LF stripped | adopted, the fleet's post-M5 rule exactly |
| A5 | A name must fully match `[a-z0-9][a-z0-9._-]{0,63}`; `capability_class` is one of four | adopted (+ A5-8: whole-string match) |
| A6 | The ten fields of ClearSeal v0.8, nothing else; booleans never coerced | adopted |
| A7 | `containment_domain`: distinct strings, sorted by UTF-16 code units, case kept, or null; schema arrays keep their order | adopted (C-3) |
| A8 | Inside `input_schema`, absent, `null`, `{}` and `[]` are distinct; **at the top level all ten fields are always present** | **argued, top level only: D-1** |
| A9 | `tool_hash` = SHA-256(JCS(ten fields)); `manifest_hash` = SHA-256(JCS of `{canonical_form_version, tools:[{name, tool_hash}] sorted by name}`) | **argued: D-2** (the version member) |
| A10 | `canonical_form_version: 1`, recorded inside the manifest hash; an unimplemented version refused | adopted; the placement is argued in D-2 |

## Argued deviations (each with its vector)

### D-1: A8 at the top level. All ten fields present, `null` where they do not apply; absent refused

**The prior:** "an absent optional field is serialized as absent (not `null`)". Applied to the
pinned object, that gives **one tool two hashes**. The vector is the `echo` tool of A6-1, with
`containment_domain` either `null` or left out:

| Form | `tool_hash` under the prior |
|---|---|
| `"containment_domain": null` (345 bytes) | `40e12e60 9f20f36f f25812f5 249676a9 b41ba509 c08b4a9c 97888065 1c2ff18c` |
| field absent (319 bytes) | `f988231e e4f2bb93 d9d0d70d 2ec2cde1 a308c359 81c2c2e8 7aa16bff b73b8da4` |

Both say "no containment claimed". Under the prior, a producer that omits the field and a verifier
that fills in `null` report drift that is not there, which is the M5 failure in another place.

**The ruling proposed:** the ten top-level fields are always present, and a missing one is refused
(vector A8-5). A8's distinctions still hold inside `input_schema`, where absent and `null` mean
different things to a validator (A8-1…A8-4).

**Support:** the standard itself says "`recoverability_basis` (null unless `owned_state`)", and
both fleet canonicalizers already emit `null`, never absent.

### D-2: A9 and A10. The version goes inside the manifest hash

**The prior:** `manifest_hash = SHA-256(JCS([{name, tool_hash}, …]))`, with the version recorded
in the manifest beside the hash. Under that form the version can change without the hash moving.
For the two tools of A9-2:

| Manifest | `manifest_hash` |
|---|---|
| prior form (either version) | `1fb5c092 6243642b 191fb04d c76a530f 7ec6e483 0f982071 7c4f9c89 2c996c52` |
| proposed, `canonical_form_version: 1` (vector A9-2) | `e3e7c134 8daa166f 5e9c1bb0 1c4f314e 102ee64e 4a83b154 d56a2a8c e53b1ff6` |
| proposed, `canonical_form_version: 2` (for contrast only; refused by A10-1) | `0cb16f91 7af7c928 3255f819 314004cb aa282432 936e13e0 a7a8d700 168b373e` |

**Why:** the pin gate decides from the version how to canonicalize and whether to refuse. By A6's
own generating rule ("a gate must never decide on a field the manifest does not hash"), the
version belongs inside the hash. A signature over the manifest file (`-1001`) would cover it too,
but `manifest_hash` is the value that gets compared and displayed. Binding the version into it
costs one member.

**Proposed:** `manifest_hash = SHA-256(JCS({"canonical_form_version": 1, "tools": [...]}))`. **If
the prior stands,** A9-2 and A10-2 change to the prior form and nothing else moves.

## Clarifications (not deviations; each is how I read the prior, for the architect to confirm)

**C-1: `1e21` is refused.**
- The prior asks for "a vector for `1e21`" and also refuses "integers beyond ±2^53−1".
- Every double of magnitude 2^53 or more is an integer, so `1e21` falls under the bound (A2-2),
  and JCS's positive-exponent form (`1e+21`) can never be emitted.
- The rule is written as "magnitude over 2^53−1", which is the same set and simpler to check in
  both languages.
- If the architect intended `1e21` to serialize, the bound must be narrowed to integers **as
  spelled**. That makes the result depend on the source text, which the value-level canonicalizer
  in the core never sees, so I recommend against it.

**C-2: "a leading BOM" is read per string.** A string whose first code point is U+FEFF is refused
(A3-3). U+FEFF elsewhere is preserved (A3-4).

**C-3: "allowed hosts" is not one of the ten pinned fields.** A7 names `containment_domain` only,
and says how a future set-valued field joins.

**C-4: the WO's §5.1 says "JCS does not define duplicates".** The official text requires its input
to be I-JSON: "JSON objects MUST NOT exhibit duplicate property names". What JCS leaves open is
what to do with input that breaks that. The specification refuses it (A1-5), so the adversarial
item stands as written in substance.

**C-5: how the digests are written.** Every digest and byte string is written in spaced hex
(bytes separated by spaces; SHA-256 as eight groups of eight). The leak gate's long-hex rule
refuses any run of forty or more hex digits in a tracked file, and `scripts/**` is protected here.
The vectors file's `format` block says so. The name vectors of A5-5 and A5-6 use `z`, not `a`,
for the same reason. An exemption for the vectors file would be a gate change, and yours to make.

## The fleet divergences the A1 prior asks to record (proposed text for `docs/upstream.md` entry 5)

`docs/upstream.md` is the architect's ledger, so I have not edited it. These are the vectors for
entry 5, measured with the fleet Python's own serialization,
`json.dumps(v, sort_keys=True, ensure_ascii=False, separators=(",", ":"))`:

| Input | Fleet Python bytes | JCS bytes (this specification) |
|---|---|---|
| A1-2 `{"ﬁ":1,"😀":2}` | `7b 22 ef ac 81 22 3a 31 2c 22 f0 9f 98 80 22 3a 32 7d` (code-point order) | `7b 22 f0 9f 98 80 22 3a 32 2c 22 ef ac 81 22 3a 31 7d` (UTF-16 order) |
| A2-1 `1.0` | `31 2e 30` | `31` |
| A2-11 `1E2` | `31 30 30 2e 30` | `31 30 30` |
| A2-3 `1e-7` | `31 65 2d 30 37` | `31 65 2d 37` |

- **Both fleet canonicalizers diverge from this specification.** The fleet's TypeScript twin sorts
  by UTF-16 like JCS, so on A1-2 the two fleet canonicalizers also disagree with **each other**.
  The Python side also keeps `1.0` and `100.0` as floats.
- **None of these is reachable** by the 26 tools that node pins today; that is its own measured
  claim. So an amendment that adopts this specification should move no existing hash. That is to
  be measured when the amendment is made, not assumed.
