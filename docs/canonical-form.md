# The canonical form, version 1

**Status: ratified 2026-09-26** (`CSR-WO-1000` stage A). The gate adopted both argued deviations
(D-1: every top-level field present; D-2: the version inside the manifest hash) and the
clarifications C-1 to C-4. **`canonical_form_version: 1`.**

**Implementations:**
- **The core's canonicalizer,** `packages/core/src/pinning/canonical.ts`, is implemented from this
  text.
- **An independent Python oracle,** `packages/core/test/oracle/`, is written from this text too. It
  is the only generator of the vectors file; the TypeScript is checked against the file and never
  writes it.

**What this is:** the exact bytes a pinned tool is hashed from, and the exact bytes a manifest is
hashed from. With this document, two implementations written independently in different
languages produce the same hash for the same tool (northstar N3).

The pinning control's whole meaning is that equal hashes mean equal tools. If two runtimes
serialize one tool differently, every boot reports drift that is not there, and the control dies
of fatigue. The fleet paid for that once already: two shipped canonicalizers disagreed on a
trailing U+00A0 (M5, `architecture.md` §2.2).

So every decision an implementer must make is a numbered rule here. Each rule has a reason and at
least one vector. The same vectors are data in `packages/core/test/vectors/canonical-v1.json`.

## How to read the vectors

- **Input** is shown the way the vectors file carries it:
  - JSON text for the JSON layer, so that duplicate keys and `-0` can be expressed;
  - an escaped string for descriptions and names;
  - a JSON value for sets, tools and manifests.
- **Canonical bytes** are lower-case hex. **SHA-256** is lower-case hex.
- **The vectors file is authoritative,** and carries both as plain hex. This repository's leak gate
  refuses any run of forty or more hex digits, and exempts `packages/core/test/vectors/*.json` by
  one allow entry (digests of committed public test inputs, not secrets).
- **This document is not exempt.** So here the bytes are shown with one space between them, and
  digests in eight groups of eight digits. Remove the spaces to get the vectors file's form.
- **refused** means a conforming implementation refuses the input and produces no bytes and no
  hash. A refusal is part of the specification: an implementation that accepts a refused input is
  as wrong as one that produces different bytes.

## The pipeline

**A tool is hashed in this order:**
1. The ten fields are checked for presence, type and value (A5, A6, A8).
2. Every string is checked (A3).
3. The top-level `description` is normalized (A4).
4. `containment_domain` is made canonical (A7).
5. The resulting object is serialized (A1, A2, A3).
6. It is hashed (A9).

**A manifest** is hashed from its tools' names and hashes, with the version inside (A9, A10).

The rules are numbered as the work order numbers the decisions, not in pipeline order.

---

## A1 — The JSON layer: RFC 8785

**Rule.** The canonical bytes of a JSON value are its serialization under RFC 8785, the JSON
Canonicalization Scheme (JCS), and an input with a duplicate object key is refused.

**Reason.** JCS is a published scheme with independent implementations. A private scheme has
exactly the one implementation that defines it, and "defined by its own output" is the M5 failure.
The fleet's two canonicalizers disagree with JCS, and with each other, in ways vectors A1-2 and
A2-1 show (see `FEEDBACK.md`).

**What an implementer must do**, each one as JCS states it:
- **Whitespace:** emit no insignificant whitespace.
- **Object members:** order them by their names **as arrays of UTF-16 code units**, compared
  unsigned (JCS's rule on the *sorting of object properties*), at every level of nesting.
- **Arrays:** keep them in the order given.
- **Strings:** serialize them by JCS's rule on the *serialization of strings*:
  - `"` and `\` are escaped;
  - U+0008, U+0009, U+000A, U+000C and U+000D become `\b`, `\t`, `\n`, `\f` and `\r`;
  - every other code point below U+0020 becomes `\u00` plus two **lower-case** hex digits;
  - everything else, including `/`, U+007F, U+2028 and all non-ASCII text, is emitted as its
    UTF-8 bytes.
- **Numbers:** serialize them by JCS's rule on the *serialization of numbers*, restricted by A2.
- **Literals:** emit `true`, `false` and `null` as themselves.
- **Output:** the result is UTF-8.

**Duplicate keys.** JCS requires its input to be adapted to I-JSON (RFC 7493): "JSON objects MUST
NOT exhibit duplicate property names". It does not say what to do with input that breaks this.
**This specification refuses it**, and does not repair it by keeping the first or the last value.
A parser that silently keeps the last value (as `JSON.parse` does) is not conforming for vector
inputs; the parser must be able to see the duplicate.

**JCS's own refusals are kept.** A lone surrogate, NaN and Infinity already stop a compliant JCS
implementation with an error. A3 and A2 restate them as refusals and add others.

**Sorting pitfall.** UTF-16 order and code-point order differ only when a name contains a code
point above U+FFFF, but they do differ (A1-2). An implementation must not rely on its language's
default string comparison without checking which order that is.

| ID | Input | Canonical bytes (hex) | SHA-256 | Note |
|---|---|---|---|---|
| A1-1 | ` { "b" : [3, 1, 2], "a" : { "d" : 1, "c" : 2 } } ` | `7b 22 61 22 3a 7b 22 63 22 3a 32 2c 22 64 22 3a 31 7d 2c 22 62 22 3a 5b 33 2c 31 2c 32 5d 7d` | `628b7efc bc80e138 bcf67ff6 e41fb548 a721cb8b 8e89bbbd 7af5f482 8d8fe169` | Insignificant whitespace removed; keys sorted at every level; array order kept. |
| A1-2 | `{"\ufb01":1,"\ud83d\ude00":2}` | `7b 22 f0 9f 98 80 22 3a 32 2c 22 ef ac 81 22 3a 31 7d` | `14dc6c14 e11d686b bd133245 2e5c8dc9 99ac1479 def9c87e 945308b1 b27d469b` | Keys sort by UTF-16 code units: U+1F600 (D83D DE00) sorts before U+FB01. Code-point order, the fleet Python's, puts U+FB01 first. |
| A1-3 | `{"9":1,"10":2,"a":3,"B":4}` | `7b 22 31 30 22 3a 32 2c 22 39 22 3a 31 2c 22 42 22 3a 34 2c 22 61 22 3a 33 7d` | `1bc7528f 6306b914 44da567d 6cca3d34 b797f560 a7acb3b9 c9cd369b 80058c7a` | Keys are strings, sorted as strings: "10" before "9", upper case before lower. |
| A1-4 | `["\u0000\b\t\n\f\r\u001f\"\\\/\u007f\u2028\u00e9"]` | `5b 22 5c 75 30 30 30 30 5c 62 5c 74 5c 6e 5c 66 5c 72 5c 75 30 30 31 66 5c 22 5c 5c 2f 7f e2 80 a8 c3 a9 22 5d` | `5dc6fe11 a2022513 137f0ef9 bbdfcca6 acb76c83 537f1707 93ac9ded 04082f62` | String escapes: the five short forms, \u00XX in lower-case hex for other controls, quote and backslash escaped; solidus, U+007F, U+2028 and non-ASCII emitted raw as UTF-8. |
| A1-5 | `{"a":1,"a":2}` | **refused** | — | A duplicate key is refused: JCS assumes I-JSON, which has none. |
| A1-6 | `[true,false,null,{},[]]` | `5b 74 72 75 65 2c 66 61 6c 73 65 2c 6e 75 6c 6c 2c 7b 7d 2c 5b 5d 5d` | `9ea8f385 6a89c119 0f602b6f 66c9e6f9 50f0f23d 7d20e63d 0d6ce7e5 6aafc722` | Literals and empty containers are emitted as given. |

## A2 — Numbers

**Rule.** A number is serialized as JCS requires (ECMAScript `Number::toString`), and it is
refused when it is NaN, positive or negative infinity, negative zero, or of magnitude greater
than 2^53−1 (9007199254740991).

**Reason.**
- **NaN and the infinities** have no JSON form.
- **Negative zero** has two forms (`-0`, `0`) and JCS prints both as `0`: two inputs would give one
  hash, and the difference would be invisible.
- **Past 2^53−1**, integers are exact in one runtime (Python's `int`) and rounded in the other (an
  IEEE double). The two would hash different values while both believe they hashed the input.
- The bound is the prior's "integers beyond ±2^53−1".

**Consequences an implementer must know:**
- **The bound applies to every number.** Every double of magnitude 2^53 or more is an integer, so
  "a number of magnitude over 2^53−1" and "an integer beyond ±2^53−1" are the same set.
- **So `1e21` is refused (A2-2),** and so is every number that JCS would print with a positive
  exponent: that branch of `Number::toString` is unreachable here. Numbers below 1e-6 in
  magnitude do take the exponent form (`1e-7`, A2-3). At 1e-6 the form is still positional
  (`0.000001`, A2-5).
- **Negative zero must be caught at parse time.** Python's `json.loads("-0")` returns the integer
  `0`, which has no sign. An implementation that parses vector text must see the literal (`-0`,
  `-0.0`, `-0e3`, …) before it becomes a value.
- **A number is its value, not its spelling.**
  - `1.0`, `1E0` and `1` are the same number and serialize as `1`.
  - `12.50` serializes as `12.5`.
  - `0.1+0.2` serializes as its shortest round-trip form, `0.30000000000000004`.

| ID | Input | Canonical bytes (hex) | SHA-256 | Note |
|---|---|---|---|---|
| A2-1 | `1.0` | `31` | `6b86b273 ff34fce1 9d6b804e ff5a3f57 47ada4ea a22f1d49 c01e52dd b7875b4b` | 1.0 is the number one: "1". |
| A2-2 | `1e21` | **refused** | — | Refused: magnitude over 2^53-1 (every such double is integral, so this is the prior's integer bound). JCS's positive-exponent form is therefore unreachable. |
| A2-3 | `1e-7` | `31 65 2d 37` | `5b33e02f 2c5103a0 5d32f6ba 9cb05829 4452bfbf 393967f6 8bb30c1b dcbbab22` | Below 1e-6 the ECMAScript form uses an exponent: "1e-7". |
| A2-4 | `0.30000000000000004` | `30 2e 33 30 30 30 30 30 30 30 30 30 30 30 30 30 30 30 34` | `06bad310 60c1212a e832de4c 031f7b31 e3b48aed 57858294 478cb194 50cf34ca` | 0.1+0.2: the shortest round-trip digits, never rounded for display. |
| A2-5 | `0.000001` | `30 2e 30 30 30 30 30 31` | `159fb29a 827ad04b 260aa6c8 ab6d8637 f8f2b38a f5c4f3cb 49d6a212 05e040f8` | At 1e-6 the ECMAScript form is still positional. |
| A2-6 | `{"multipleOf":0.01}` | `7b 22 6d 75 6c 74 69 70 6c 65 4f 66 22 3a 30 2e 30 31 7d` | `3fb1e18a 1bf5d4c5 1dddd001 4fb118a1 9784fc2f 84125ca4 a7935c3a 2bd4a773` | A schema number of the kind the rule exists for. |
| A2-7 | `9007199254740991` | `39 30 30 37 31 39 39 32 35 34 37 34 30 39 39 31` | `f40b423c 2dd95ff2 b2f027e2 2208f438 cf724286 2e5e7468 60e69730 8c9add26` | 2^53-1, the largest accepted magnitude. |
| A2-8 | `9007199254740992` | **refused** | — | 2^53: refused. |
| A2-9 | `-0` | **refused** | — | Negative zero is refused (JCS would print it as "0"; two inputs, one hash). |
| A2-10 | `-0.0` | **refused** | — | Negative zero written as a fraction: refused too. |
| A2-11 | `1E2` | `31 30 30` | `ad573668 65126e55 649ecb23 ae1d4888 7544976e fea46a48 eb5d85a6 eeb4d306` | Exponent input, integral value: "100". |
| A2-12 | `12.50` | `31 32 2e 35` | `b902cc45 50838229 a710bfec 4c38cbc7 eb110823 67a409df 9135e7f0 07a96bda` | Trailing zeros are not significant: "12.5". |
| A2-13 | the native value `NaN` | **refused** | — | Not a JSON value; a native value that reaches the canonicalizer is refused. |
| A2-14 | the native value `Infinity` | **refused** | — | Not a JSON value; a native value that reaches the canonicalizer is refused. |
| A2-15 | the native value `-Infinity` | **refused** | — | Not a JSON value; a native value that reaches the canonicalizer is refused. |

## A3 — Strings: bytes as given, no Unicode normalization

**Rule.** A string, whether a value or a member name anywhere in the object, is its sequence of
code points exactly as given, with **no Unicode normalization**. It is refused when it contains
an unpaired surrogate or **begins** with U+FEFF.

**Reason.**
- **No normalization.** JCS itself requires Unicode string data to be preserved "as is". NFC and
  NFD spellings of the same text are different bytes that a reviewer cannot tell apart on screen,
  so they are different tools (A3-1 and A3-2 hash differently). Normalizing would also make the hash depend on each runtime's Unicode database
  version, which neither runtime pins to the other's.
- **Lone surrogates.** An unpaired surrogate has no UTF-8 encoding, so there are no bytes to hash.
- **A leading U+FEFF** is a byte-order mark: a decoding artifact that has no business inside a tool
  definition. Stripping it would make two inputs one hash. Refusing it makes the artifact visible
  where it was introduced.

**Where U+FEFF is not at the start** of a string, it is an ordinary (zero-width) character and is
preserved (A3-4).

**Scope.** These checks apply to every string that reaches the canonical object: names, the
description (before A4 normalizes it), `scope`, `recoverability_basis`, set elements, and every
string and member name inside `input_schema`.

| ID | Input | Canonical bytes (hex) | SHA-256 | Note |
|---|---|---|---|---|
| A3-1 | `"\u00e9"` | `22 c3 a9 22` | `f2886017 e9c7abac f804b54d 64787dce 2b611c95 44ba21f3 affdd126 a6e50086` | Composed e-acute (NFC). |
| A3-2 | `"e\u0301"` | `22 65 cc 81 22` | `3d68ce21 f2899a47 5713cdbe 7562ba9b db6b1dfd e8af1f22 1bdff4a0 935b53b2` | Decomposed e-acute (NFD): different bytes and a different hash from A3-1. No normalization. |
| A3-3 | `"\ufeffabc"` | **refused** | — | A string that begins with U+FEFF is refused, not stripped. |
| A3-4 | `"a\ufeffb"` | `22 61 ef bb bf 62 22` | `8fe96f53 46abe284 8adbcaa2 86551691 4cdeb3c2 1df1bf6b f2c84837 53b10236` | U+FEFF inside a string is preserved (bytes as given). |
| A3-5 | `"\ud800"` | **refused** | — | A lone surrogate is refused. |
| A3-6 | `{"\udc00":1}` | **refused** | — | A lone surrogate in a key is refused. |
| A3-7 | `"\ud83d\ude00"` | `22 f0 9f 98 80 22` | `7a0c50b9 2434b015 545fe93a b723db2d 4b2cdd14 a4414056 24a9ce8b e29f1d5a` | A well-formed surrogate pair is one code point, emitted as 4 bytes of UTF-8. |

## A4 — Description normalization, the only string transform

**Rule.** The top-level `description`, and no other string, is normalized in three steps, in
order:
1. every CR LF, then every remaining CR, becomes LF;
2. on each line, a trailing run of U+0020, U+0009, U+000C or U+000B is removed;
3. leading and trailing LF are removed.

**Reason.** A description is a prompt, placed verbatim in the model's context, so the pinned text
must be the text. The rule removes only what changes when the same file is edited on a different
platform.
- **Exactly four characters are stripped.** This is the fleet's post-M5 rule. Python's `rstrip()`
  also removed U+00A0, the TypeScript twin did not, and a description ending in U+00A0 hashed
  differently per runtime.
- **What is preserved:** U+00A0, U+2028, U+3000 and every other non-ASCII space, leading
  indentation, and internal blank lines. They are visible structure, or at least not provably
  invisible.

**Order matters.** Step 2 runs before step 3, so a line holding only spaces becomes empty and is
then removed if it leads or trails (A4-4). A description of only newlines normalizes to the
empty string (A4-7). Whether an empty description may be registered is a registration rule, not a
canonical-form rule.

**Only the top-level field.** Descriptions *inside* `input_schema` are schema content, and are
hashed byte for byte (A4-8).

| ID | Input | Canonical bytes (hex) | SHA-256 | Note |
|---|---|---|---|---|
| A4-1 | `Reads a file.\xa0` | `52 65 61 64 73 20 61 20 66 69 6c 65 2e c2 a0` | `a7e1cf1b c9c841a8 8dcd05a0 c6c91573 c4859028 6f07a7fe 0354e8e2 5aaf72f5` | M5: a trailing U+00A0 is preserved. |
| A4-2 | `line one\r\nline two\rline three` | `6c 69 6e 65 20 6f 6e 65 0a 6c 69 6e 65 20 74 77 6f 0a 6c 69 6e 65 20 74 68 72 65 65` | `26a5cd65 4e540e91 433a2f23 7e270974 3fc4753e 764deb74 ed37299c 2f338ece` | CRLF and a lone CR become LF. |
| A4-3 | `a \t\x0c\x0b\nb` | `61 0a 62` | `7e18f737 311b2dc3 b2f269dd 78396b03 51f14fb6 6efa879f 768cb231 81883c78` | Trailing space, tab, form feed and vertical tab are stripped per line. |
| A4-4 | `\n\n  \nText\n\n\nMore\n\n` | `54 65 78 74 0a 0a 0a 4d 6f 72 65` | `da2f7574 dbdc209e 24736804 fdde6ce7 9e4f1319 83fec80c 3950b75d ad5a0097` | Leading and trailing newlines stripped (after the per-line strip); internal blank lines kept. |
| A4-5 | `one\u2028two\u2028` | `6f 6e 65 e2 80 a8 74 77 6f e2 80 a8` | `dd0774bc c9bc82e8 4317f06b 2e7de6be e6d70963 3d594194 f091aed0 386da164` | U+2028 is neither a line break nor strippable here: preserved. |
| A4-6 | `  indented\u3000` | `20 20 69 6e 64 65 6e 74 65 64 e3 80 80` | `4e417b74 afafac20 b34c98a6 80ef60fa eea540c1 a614f923 0f177510 85828935` | Leading spaces and a trailing U+3000 are preserved. |
| A4-7 | `\n\n\n` | (empty) | `e3b0c442 98fc1c14 9afbf4c8 996fb924 27ae41e4 649b934c a495991b 7852b855` | Only newlines: the empty string. |

**A4-8** (tool). Only the top-level description is normalized: its trailing spaces go; the schema's inner description keeps them.

Input:

```json
{
  "name": "echo",
  "description": "Echo.  ",
  "input_schema": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string",
        "description": "Text.  "
      }
    }
  },
  "capability_class": "read_only",
  "untrusted_input_facing": false,
  "scope": "echo",
  "privacy_sensitive": false,
  "recoverability_basis": null,
  "elevated": false,
  "containment_domain": null
}
```

Canonical bytes (308 bytes):

```
7b 22 63 61 70 61 62 69 6c 69 74 79 5f 63 6c 61
73 73 22 3a 22 72 65 61 64 5f 6f 6e 6c 79 22 2c
22 63 6f 6e 74 61 69 6e 6d 65 6e 74 5f 64 6f 6d
61 69 6e 22 3a 6e 75 6c 6c 2c 22 64 65 73 63 72
69 70 74 69 6f 6e 22 3a 22 45 63 68 6f 2e 22 2c
22 65 6c 65 76 61 74 65 64 22 3a 66 61 6c 73 65
2c 22 69 6e 70 75 74 5f 73 63 68 65 6d 61 22 3a
7b 22 70 72 6f 70 65 72 74 69 65 73 22 3a 7b 22
74 65 78 74 22 3a 7b 22 64 65 73 63 72 69 70 74
69 6f 6e 22 3a 22 54 65 78 74 2e 20 20 22 2c 22
74 79 70 65 22 3a 22 73 74 72 69 6e 67 22 7d 7d
2c 22 74 79 70 65 22 3a 22 6f 62 6a 65 63 74 22
7d 2c 22 6e 61 6d 65 22 3a 22 65 63 68 6f 22 2c
22 70 72 69 76 61 63 79 5f 73 65 6e 73 69 74 69
76 65 22 3a 66 61 6c 73 65 2c 22 72 65 63 6f 76
65 72 61 62 69 6c 69 74 79 5f 62 61 73 69 73 22
3a 6e 75 6c 6c 2c 22 73 63 6f 70 65 22 3a 22 65
63 68 6f 22 2c 22 75 6e 74 72 75 73 74 65 64 5f
69 6e 70 75 74 5f 66 61 63 69 6e 67 22 3a 66 61
6c 73 65 7d
```

SHA-256: `96138956 d85f1c43 2a5f40cf f8aca81a 248f1374 f409e7dd 85bff0d7 b0411ad5`

## A5 — Tool names

**Rule.** A tool name is accepted only when the whole string matches
`[a-z0-9][a-z0-9._-]{0,63}`, and it is refused otherwise, never rewritten.

**Reason.** A name restricted to lower-case ASCII has one spelling, so no normalization question
can arise. Refusing, rather than lower-casing, keeps the name the author wrote and the name the
manifest pins the same string.

**Whole-string match.** The pattern must match the entire string, from the first character to the
last. An end anchor that also matches before a final newline accepts `echo\n` (A5-8); Python's `$`
does this, so use `fullmatch` there.

**The name's bytes.** They are its UTF-8, which for an accepted name is its ASCII.

**`capability_class`.** It is the other identifier in the object. It must be exactly one of
`read_only`, `owned_state`, `state_change` or `arbitrary_exec` (A6-4). The remaining strings
(`scope`, `recoverability_basis`, set elements) follow A3.

| ID | Input | Canonical bytes (hex) | SHA-256 | Note |
|---|---|---|---|---|
| A5-1 | `echo` | `65 63 68 6f` | `092c79e8 f80e559e 404bcf66 0c48f352 2b67aba9 ff1484b0 367e1a4d def7431d` | Accepted. |
| A5-2 | `Echo` | **refused** | — | Upper case refused. |
| A5-3 | `note.append_v2-x` | `6e 6f 74 65 2e 61 70 70 65 6e 64 5f 76 32 2d 78` | `82afb053 98868e08 3da3cf26 e9b92aec e7013033 8a67fa30 3a4e88c7 20871760` | Dot, underscore and hyphen allowed after the first character. |
| A5-4 | `_hidden` | **refused** | — | Must begin with a lower-case letter or digit. |
| A5-5 | `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz` | `7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a 7a` | `72996563 049cc84d aa2c3f31 fd5c3d10 770e69d6 ebbb8da5 b6d76db3 03dbae43` | 64 characters: accepted. |
| A5-6 | `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz` | **refused** | — | 65 characters: refused. |
| A5-7 | `\xe9cho` | **refused** | — | Non-ASCII refused. |
| A5-8 | `echo\n` | **refused** | — | A trailing newline is refused: the pattern must match the whole string (an end anchor that also matches before a final newline is the trap). |

## A6 — The hashed field set

**Rule.** `tool_hash` covers exactly these ten fields, the pinned tool object of ClearSeal v0.8:
- `name`
- `description`
- `input_schema`
- `capability_class`
- `untrusted_input_facing`
- `scope`
- `privacy_sensitive`
- `recoverability_basis`
- `elevated`
- `containment_domain`

A field outside them is refused, and **a gate must never decide on a field the manifest does not
hash.**

**Reason.** A gate's real decision is a function of pinned and unpinned inputs. Anything in the
unpinned position changes the outcome with **zero pin drift**. The generating rule, not the list,
is the specification: if a gate starts reading a new field, the field joins this set, and
`canonical_form_version` goes up (A10).

**Enforcement.** In the implementation (stage B), the list is exported by **one** module (the
capability module) and imported by the canonicalizer, never restated. The subset test
(`test:subset`) asserts that every field a gate reads is in this set.

| Field | Type in the canonical object | Rule |
|---|---|---|
| `name` | string | A5 |
| `description` | string, normalized | A3, A4 |
| `input_schema` | JSON object, hashed as given | A1–A3, A7 (arrays keep their order), A8 |
| `capability_class` | one of four strings | A5 |
| `untrusted_input_facing` | `true` or `false` | this rule |
| `scope` | string | A3 |
| `privacy_sensitive` | `true` or `false` | this rule |
| `recoverability_basis` | string or `null` | A3, A8 |
| `elevated` | `true` or `false` | this rule |
| `containment_domain` | array of strings, or `null` | A7, A8 |

**Booleans are booleans.** A boolean field given anything other than `true` or `false` is refused
(A6-3). There is no truthiness coercion, because `bool("false")` is true.

**Semantics are enforced elsewhere.** "`recoverability_basis` is null unless `owned_state`" and
"`arbitrary_exec` is refused a containment domain" are enforced at registration by the capability
and containment modules (`-1002`). The canonical form hashes what it is given, once those checks
pass.

**Member order.** The object's members are ordered by A1 like any other object.


**A6-1** (tool). The ten-field object, keys in JCS order; sha256 is tool_hash.

Input:

```json
{
  "name": "echo",
  "description": "Returns its text.",
  "input_schema": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "capability_class": "read_only",
  "untrusted_input_facing": false,
  "scope": "echo",
  "privacy_sensitive": false,
  "recoverability_basis": null,
  "elevated": false,
  "containment_domain": null
}
```

Canonical bytes (345 bytes):

```
7b 22 63 61 70 61 62 69 6c 69 74 79 5f 63 6c 61
73 73 22 3a 22 72 65 61 64 5f 6f 6e 6c 79 22 2c
22 63 6f 6e 74 61 69 6e 6d 65 6e 74 5f 64 6f 6d
61 69 6e 22 3a 6e 75 6c 6c 2c 22 64 65 73 63 72
69 70 74 69 6f 6e 22 3a 22 52 65 74 75 72 6e 73
20 69 74 73 20 74 65 78 74 2e 22 2c 22 65 6c 65
76 61 74 65 64 22 3a 66 61 6c 73 65 2c 22 69 6e
70 75 74 5f 73 63 68 65 6d 61 22 3a 7b 22 61 64
64 69 74 69 6f 6e 61 6c 50 72 6f 70 65 72 74 69
65 73 22 3a 66 61 6c 73 65 2c 22 70 72 6f 70 65
72 74 69 65 73 22 3a 7b 22 74 65 78 74 22 3a 7b
22 74 79 70 65 22 3a 22 73 74 72 69 6e 67 22 7d
7d 2c 22 72 65 71 75 69 72 65 64 22 3a 5b 22 74
65 78 74 22 5d 2c 22 74 79 70 65 22 3a 22 6f 62
6a 65 63 74 22 7d 2c 22 6e 61 6d 65 22 3a 22 65
63 68 6f 22 2c 22 70 72 69 76 61 63 79 5f 73 65
6e 73 69 74 69 76 65 22 3a 66 61 6c 73 65 2c 22
72 65 63 6f 76 65 72 61 62 69 6c 69 74 79 5f 62
61 73 69 73 22 3a 6e 75 6c 6c 2c 22 73 63 6f 70
65 22 3a 22 65 63 68 6f 22 2c 22 75 6e 74 72 75
73 74 65 64 5f 69 6e 70 75 74 5f 66 61 63 69 6e
67 22 3a 66 61 6c 73 65 7d
```

SHA-256: `40e12e60 9f20f36f f25812f5 249676a9 b41ba509 c08b4a9c 97888065 1c2ff18c`

**A6-2** (tool). A field outside the ten is refused, not dropped.

Input:

```json
{
  "name": "echo",
  "description": "Returns its text.",
  "input_schema": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "capability_class": "read_only",
  "untrusted_input_facing": false,
  "scope": "echo",
  "privacy_sensitive": false,
  "recoverability_basis": null,
  "elevated": false,
  "containment_domain": null,
  "title": "Echo"
}
```

Result: **refused**.

**A6-3** (tool). A boolean field given a string is refused: no truthiness coercion.

Input:

```json
{
  "name": "echo",
  "description": "Returns its text.",
  "input_schema": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "capability_class": "read_only",
  "untrusted_input_facing": false,
  "scope": "echo",
  "privacy_sensitive": false,
  "recoverability_basis": null,
  "elevated": "false",
  "containment_domain": null
}
```

Result: **refused**.

**A6-4** (tool). capability_class outside the four rungs is refused.

Input:

```json
{
  "name": "echo",
  "description": "Returns its text.",
  "input_schema": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "capability_class": "admin",
  "untrusted_input_facing": false,
  "scope": "echo",
  "privacy_sensitive": false,
  "recoverability_basis": null,
  "elevated": false,
  "containment_domain": null
}
```

Result: **refused**.

## A7 — Set-valued fields

**Rule.** `containment_domain`, the one set-valued field among the ten, is canonicalized to the
array of its **distinct** strings sorted by UTF-16 code units (as A1 sorts names), with case
preserved, or to `null`.

**Reason.**
- **Order and repetition carry no meaning in a set.** A domain that arrives in another order must
  not look like drift, and only widening or narrowing it should move the hash.
- **The same order as A1.** Sorting by UTF-16 code units means one comparison serves the whole
  specification.
- **Empty and null are different.** `[]` claims containment to nothing; `null` claims no
  containment. They hash differently (A7-2, A7-3).

**Arrays elsewhere are not sets.** Arrays inside `input_schema` (`required`, `enum`, `type`, …)
keep their order (A7-5), because order can be meaningful there and sorting them would make
different schemas equal.

**Other set-valued fields.** The prior also names "allowed hosts". That is not one of the ten
pinned fields today. A future set-valued field is added to this rule by name, with a version bump.

| ID | Input | Canonical bytes (hex) | SHA-256 | Note |
|---|---|---|---|---|
| A7-1 | `["b", "a", "b", "B"]` | `5b 22 42 22 2c 22 61 22 2c 22 62 22 5d` | `756ec021 cad39e23 f770a620 70784c36 f95d72f3 a6a73be7 e37f6ea4 4e7b058f` | Deduplicated, sorted by UTF-16 code units, case preserved. |
| A7-2 | `[]` | `5b 5d` | `4f53cda1 8c2baa0c 0354bb5f 9a3ecbe5 ed12ab4d 8e11ba87 3c2f1116 1202b945` | The empty set: contained to nothing. Distinct from null. |
| A7-3 | `null` | `6e 75 6c 6c` | `74234e98 afe7498f b5daf1f3 6ac2d78a cc339464 f950703b 8c019892 f982b90b` | null: no containment claimed. |
| A7-4 | `["\ufb01", "\ud83d\ude00"]` | `5b 22 f0 9f 98 80 22 2c 22 ef ac 81 22 5d` | `ee4f2693 e8617d45 62c6b611 6dbd1ce9 7f032a01 d43e2e68 d164cf75 132f7897` | UTF-16 order, as A1-2. |
| A7-5 | `{"required":["b","a"],"enum":[2,1]}` | `7b 22 65 6e 75 6d 22 3a 5b 32 2c 31 5d 2c 22 72 65 71 75 69 72 65 64 22 3a 5b 22 62 22 2c 22 61 22 5d 7d` | `8fc1ca19 46d9bbc3 8ea1a91e 2ac91ae4 4ee8034d 88a726b0 3a0947c4 9154fdb0` | Arrays inside input_schema are not sets: order kept. |

## A8 — Absent, null and empty

**Rule.**
- **Inside `input_schema`,** an absent member, a member whose value is `null`, and one whose value
  is `{}` or `[]` are four different values, serialized as given.
- **At the top level,** all ten fields are always present. A field that does not apply is `null`,
  and a missing top-level field is refused.

**Reason.**
- **Inside the schema,** the four forms mean different things to a validator: no default, a
  default of null, a default of an empty object, a default of an empty array. They must hash
  differently (A8-1 to A8-4).
- **At the top level,** "absent stays absent" would give one tool two hashes: one with
  `containment_domain: null` and one with the field left out. Both forms say "no containment
  claimed". Requiring every field makes the object's shape fixed, so a hash always describes the
  same ten fields. The standard already words it this way ("`recoverability_basis` (null unless
  `owned_state`)"), and both fleet canonicalizers already emit `null`.
- **Ratified as D-1:** it replaced the prior's "absent stays absent" at the top level.

**`undefined`.** A member whose value is not a JSON value (JavaScript's `undefined`) is refused,
not dropped. `JSON.stringify` drops it silently, which would make `{"a": undefined}` hash as `{}`.

| ID | Input | Canonical bytes (hex) | SHA-256 | Note |
|---|---|---|---|---|
| A8-1 | `{"type":"object"}` | `7b 22 74 79 70 65 22 3a 22 6f 62 6a 65 63 74 22 7d` | `a2c79926 2a3ce3c1 9ef5cdd9 83bf3d12 b43ab3c4 26227091 b909dcb7 054738c0` | Absent. |
| A8-2 | `{"type":"object","default":null}` | `7b 22 64 65 66 61 75 6c 74 22 3a 6e 75 6c 6c 2c 22 74 79 70 65 22 3a 22 6f 62 6a 65 63 74 22 7d` | `7a9b699b d75d585d 882389aa ae4200a4 b3c9f023 eac0a0cb dd1bb282 d1615b18` | null. |
| A8-3 | `{"type":"object","default":{}}` | `7b 22 64 65 66 61 75 6c 74 22 3a 7b 7d 2c 22 74 79 70 65 22 3a 22 6f 62 6a 65 63 74 22 7d` | `e0313a37 1c2076f7 a0d4d7d0 85a24103 2c84e08e 0ae2075d 7c60eb69 d2ead629` | Empty object. |
| A8-4 | `{"type":"object","default":[]}` | `7b 22 64 65 66 61 75 6c 74 22 3a 5b 5d 2c 22 74 79 70 65 22 3a 22 6f 62 6a 65 63 74 22 7d` | `0fe20ff7 03a1976b 26e96034 dd383a65 0ea08e46 8f975d4e d05e2b40 657ada5b` | Empty array. Four inputs, four hashes. |

**A8-5** (tool). A top-level field that is absent is refused: all ten are always present, null where they do not apply.

Input:

```json
{
  "name": "echo",
  "description": "Returns its text.",
  "input_schema": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "capability_class": "read_only",
  "untrusted_input_facing": false,
  "scope": "echo",
  "privacy_sensitive": false,
  "recoverability_basis": null,
  "elevated": false
}
```

Result: **refused**.

## A9 — The tool hash and the manifest hash

**Rule.**
- **`tool_hash`** is the SHA-256 of the A1 bytes of the canonical ten-field object.
- **`manifest_hash`** is the SHA-256 of the A1 bytes of the object
  `{"canonical_form_version": 1, "tools": [...]}`. `tools` holds one `{"name", "tool_hash"}` object
  per tool, sorted by `name` in UTF-16 code units.
- Both digests are written as lower-case hex, and `tool_hash` sits inside the manifest object as
  that 64-character string.
- Two tools with one name are refused.

**Reason.**
- **Names beside hashes.** The manifest hash binds each name to its hash, so a manifest that swaps
  two tools' hashes changes the manifest hash. A hash of the bare sorted list of hashes (the fleet
  node's form) would not notice the swap.
- **Sorting** removes declaration order, which carries no meaning.
- **Duplicate names** would make the pin ambiguous.
- **The version member** was ratified as D-2 (A10).

**Why the manifest vector shows only hex.** The manifest vector's canonical bytes contain the tool
hashes as 64-character strings, so they are shown only as hex. In A9-2, the `tool_hash` of `echo`
is A6-1's SHA-256 and that of `note.append` is A9-1's, each with the spaces removed.


**A9-1** (tool). The second tool; sha256 is its tool_hash.

Input:

```json
{
  "name": "note.append",
  "description": "Appends one line to the operator's notes.\nNever rewrites earlier lines.",
  "input_schema": {
    "type": "object",
    "properties": {
      "line": {
        "type": "string",
        "maxLength": 500
      }
    },
    "required": [
      "line"
    ],
    "additionalProperties": false
  },
  "capability_class": "owned_state",
  "untrusted_input_facing": true,
  "scope": "notes",
  "privacy_sensitive": true,
  "recoverability_basis": "append-only",
  "elevated": false,
  "containment_domain": [
    "notes-file"
  ]
}
```

Canonical bytes (443 bytes):

```
7b 22 63 61 70 61 62 69 6c 69 74 79 5f 63 6c 61
73 73 22 3a 22 6f 77 6e 65 64 5f 73 74 61 74 65
22 2c 22 63 6f 6e 74 61 69 6e 6d 65 6e 74 5f 64
6f 6d 61 69 6e 22 3a 5b 22 6e 6f 74 65 73 2d 66
69 6c 65 22 5d 2c 22 64 65 73 63 72 69 70 74 69
6f 6e 22 3a 22 41 70 70 65 6e 64 73 20 6f 6e 65
20 6c 69 6e 65 20 74 6f 20 74 68 65 20 6f 70 65
72 61 74 6f 72 27 73 20 6e 6f 74 65 73 2e 5c 6e
4e 65 76 65 72 20 72 65 77 72 69 74 65 73 20 65
61 72 6c 69 65 72 20 6c 69 6e 65 73 2e 22 2c 22
65 6c 65 76 61 74 65 64 22 3a 66 61 6c 73 65 2c
22 69 6e 70 75 74 5f 73 63 68 65 6d 61 22 3a 7b
22 61 64 64 69 74 69 6f 6e 61 6c 50 72 6f 70 65
72 74 69 65 73 22 3a 66 61 6c 73 65 2c 22 70 72
6f 70 65 72 74 69 65 73 22 3a 7b 22 6c 69 6e 65
22 3a 7b 22 6d 61 78 4c 65 6e 67 74 68 22 3a 35
30 30 2c 22 74 79 70 65 22 3a 22 73 74 72 69 6e
67 22 7d 7d 2c 22 72 65 71 75 69 72 65 64 22 3a
5b 22 6c 69 6e 65 22 5d 2c 22 74 79 70 65 22 3a
22 6f 62 6a 65 63 74 22 7d 2c 22 6e 61 6d 65 22
3a 22 6e 6f 74 65 2e 61 70 70 65 6e 64 22 2c 22
70 72 69 76 61 63 79 5f 73 65 6e 73 69 74 69 76
65 22 3a 74 72 75 65 2c 22 72 65 63 6f 76 65 72
61 62 69 6c 69 74 79 5f 62 61 73 69 73 22 3a 22
61 70 70 65 6e 64 2d 6f 6e 6c 79 22 2c 22 73 63
6f 70 65 22 3a 22 6e 6f 74 65 73 22 2c 22 75 6e
74 72 75 73 74 65 64 5f 69 6e 70 75 74 5f 66 61
63 69 6e 67 22 3a 74 72 75 65 7d
```

SHA-256: `8131e955 204dbe89 10ad9ea0 e2fed4e4 35f3f1c6 da0f8e19 7b621649 ca7b8723`

**A9-2** (manifest). Two tools given out of order: entries sorted by name; sha256 is manifest_hash.

Input:

```json
{
  "canonical_form_version": 1,
  "tools": [
    {
      "name": "note.append",
      "description": "Appends one line to the operator's notes.\nNever rewrites earlier lines.",
      "input_schema": {
        "type": "object",
        "properties": {
          "line": {
            "type": "string",
            "maxLength": 500
          }
        },
        "required": [
          "line"
        ],
        "additionalProperties": false
      },
      "capability_class": "owned_state",
      "untrusted_input_facing": true,
      "scope": "notes",
      "privacy_sensitive": true,
      "recoverability_basis": "append-only",
      "elevated": false,
      "containment_domain": [
        "notes-file"
      ]
    },
    {
      "name": "echo",
      "description": "Returns its text.",
      "input_schema": {
        "type": "object",
        "properties": {
          "text": {
            "type": "string"
          }
        },
        "required": [
          "text"
        ],
        "additionalProperties": false
      },
      "capability_class": "read_only",
      "untrusted_input_facing": false,
      "scope": "echo",
      "privacy_sensitive": false,
      "recoverability_basis": null,
      "elevated": false,
      "containment_domain": null
    }
  ]
}
```

Canonical bytes (235 bytes):

```
7b 22 63 61 6e 6f 6e 69 63 61 6c 5f 66 6f 72 6d
5f 76 65 72 73 69 6f 6e 22 3a 31 2c 22 74 6f 6f
6c 73 22 3a 5b 7b 22 6e 61 6d 65 22 3a 22 65 63
68 6f 22 2c 22 74 6f 6f 6c 5f 68 61 73 68 22 3a
22 34 30 65 31 32 65 36 30 39 66 32 30 66 33 36
66 66 32 35 38 31 32 66 35 32 34 39 36 37 36 61
39 62 34 31 62 61 35 30 39 63 30 38 62 34 61 39
63 39 37 38 38 38 30 36 35 31 63 32 66 66 31 38
63 22 7d 2c 7b 22 6e 61 6d 65 22 3a 22 6e 6f 74
65 2e 61 70 70 65 6e 64 22 2c 22 74 6f 6f 6c 5f
68 61 73 68 22 3a 22 38 31 33 31 65 39 35 35 32
30 34 64 62 65 38 39 31 30 61 64 39 65 61 30 65
32 66 65 64 34 65 34 33 35 66 33 66 31 63 36 64
61 30 66 38 65 31 39 37 62 36 32 31 36 34 39 63
61 37 62 38 37 32 33 22 7d 5d 7d
```

SHA-256: `e3e7c134 8daa166f 5e9c1bb0 1c4f314e 102ee64e 4a83b154 d56a2a8c e53b1ff6`

**A9-3** (manifest). Two tools with one name: refused.

Input:

```json
{
  "canonical_form_version": 1,
  "tools": [
    {
      "name": "echo",
      "description": "Returns its text.",
      "input_schema": {
        "type": "object",
        "properties": {
          "text": {
            "type": "string"
          }
        },
        "required": [
          "text"
        ],
        "additionalProperties": false
      },
      "capability_class": "read_only",
      "untrusted_input_facing": false,
      "scope": "echo",
      "privacy_sensitive": false,
      "recoverability_basis": null,
      "elevated": false,
      "containment_domain": null
    },
    {
      "name": "echo",
      "description": "Appends one line to the operator's notes.\nNever rewrites earlier lines.",
      "input_schema": {
        "type": "object",
        "properties": {
          "line": {
            "type": "string",
            "maxLength": 500
          }
        },
        "required": [
          "line"
        ],
        "additionalProperties": false
      },
      "capability_class": "owned_state",
      "untrusted_input_facing": true,
      "scope": "notes",
      "privacy_sensitive": true,
      "recoverability_basis": "append-only",
      "elevated": false,
      "containment_domain": [
        "notes-file"
      ]
    }
  ]
}
```

Result: **refused**.

## A10 — Versioning

**Rule.**
- This specification is `canonical_form_version: 1`.
- The manifest records the version inside the object its hash covers (A9).
- An implementation refuses a manifest whose version it does not implement.
- Any change to a rule, to the hashed field set, or to a vector's expected result makes a new
  version.

**Reason.**
- **A version changes the gate's decision.** A canonical form that changes silently re-hashes
  every tool, and the result looks like drift everywhere at once. A version makes the change a
  decision the gate can see and refuse.
- **So the version goes inside the hash.** The pin gate decides how to canonicalize, and whether
  to refuse, from the version. By A6's generating rule, a field a gate decides on must be inside
  the hash, so the version is inside `manifest_hash` (A10-2) rather than beside it. Ratified as
  D-2.
- **Old versions.** An implementation may implement more than one version; this one implements
  exactly version 1 (A10-1).


**A10-1** (manifest). A version this implementation does not implement is refused.

Input:

```json
{
  "canonical_form_version": 2,
  "tools": [
    {
      "name": "echo",
      "description": "Returns its text.",
      "input_schema": {
        "type": "object",
        "properties": {
          "text": {
            "type": "string"
          }
        },
        "required": [
          "text"
        ],
        "additionalProperties": false
      },
      "capability_class": "read_only",
      "untrusted_input_facing": false,
      "scope": "echo",
      "privacy_sensitive": false,
      "recoverability_basis": null,
      "elevated": false,
      "containment_domain": null
    }
  ]
}
```

Result: **refused**.

**A10-2** (manifest). The version is inside the manifest hash.

Input:

```json
{
  "canonical_form_version": 1,
  "tools": [
    {
      "name": "echo",
      "description": "Returns its text.",
      "input_schema": {
        "type": "object",
        "properties": {
          "text": {
            "type": "string"
          }
        },
        "required": [
          "text"
        ],
        "additionalProperties": false
      },
      "capability_class": "read_only",
      "untrusted_input_facing": false,
      "scope": "echo",
      "privacy_sensitive": false,
      "recoverability_basis": null,
      "elevated": false,
      "containment_domain": null
    }
  ]
}
```

Canonical bytes (133 bytes):

```
7b 22 63 61 6e 6f 6e 69 63 61 6c 5f 66 6f 72 6d
5f 76 65 72 73 69 6f 6e 22 3a 31 2c 22 74 6f 6f
6c 73 22 3a 5b 7b 22 6e 61 6d 65 22 3a 22 65 63
68 6f 22 2c 22 74 6f 6f 6c 5f 68 61 73 68 22 3a
22 34 30 65 31 32 65 36 30 39 66 32 30 66 33 36
66 66 32 35 38 31 32 66 35 32 34 39 36 37 36 61
39 62 34 31 62 61 35 30 39 63 30 38 62 34 61 39
63 39 37 38 38 38 30 36 35 31 63 32 66 66 31 38
63 22 7d 5d 7d
```

SHA-256: `8aae96f1 2c5851c1 78d5a809 b33d807e 3990b72a a33b6963 9bfee97d b588614a`

---

## Not decided here

- **The manifest file's format, signing, verify-before-register and drift refusal:** `-1001`.
  Only the hash inputs are fixed here.
- **Which values registration accepts:** `recoverability_basis` present exactly for `owned_state`,
  no containment domain for `arbitrary_exec`, and whether an empty description may be registered.
  These belong to the capability and containment modules (`-1002`).
- **Argument digests for the audit trail:** these are keyed HMACs (architecture §5). They reuse A1
  for the argument object, but they are specified with the audit work.

## References

- **RFC 8785**, *JSON Canonicalization Scheme (JCS)*: its rules on the sorting of object
  properties, the serialization of strings, and the serialization of numbers, the last of which
  defers to ECMAScript's `Number::toString`.
- **RFC 7493**, *The I-JSON Message Format*: unique member names.
- **ClearSeal v0.8**: the ten-field pinned tool object and its generating rule.
- **`docs/architecture.md`**: §2.2 (the M5 divergence) and §5 (*Canonical form*, *Test discipline
  for parsers*).
- **`docs/upstream.md`**: entries 1 and 5.
