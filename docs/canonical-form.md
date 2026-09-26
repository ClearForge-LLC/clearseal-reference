# The canonical form, version 1

**Status: ratified 2026-09-26** (`CSR-WO-1000` stage A). The gate adopted both argued deviations
(D-1: every top-level field present; D-2: the version inside the manifest hash) and the
clarifications C-1 to C-4. **`canonical_form_version: 1`.**

**Amended before release,** in the architect's review of stage B (2026-09-26). Version 1 has never
shipped, so it stays version 1:
- **A1 now bounds nesting:** 512 objects and arrays, counted together, are accepted, and 513 are
  refused (A1-7, A1-8).
- **A2 now states how a literal becomes a number** (A2-16, A2-17).
- **A3 and A4 now say that the leading-U+FEFF rule applies to the description both as given and
  after normalization** (A4-9).
- **Vector A6-4 is relabelled A5-9,** because the rule that refuses it is A5. The id A6-4 is
  retired.
- **Vector A6-5 was added** because no earlier canonical vector had `elevated: true`.

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
- **The vectors file is authoritative.** The Python oracle writes it, and this document's tables
  are rendered from it.
- **Both are exempt from the long-hex rule.** This repository's leak gate refuses any run of forty
  or more hex digits. The vectors file and this document are exempted by two allow entries, as
  digests of committed public test inputs, not secrets.
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

**Nesting.** An input nested deeper than 512 objects and arrays, counted together, is refused. The
limit is the same whether the input arrives as JSON text or as a value, and an implementation must
refuse at 513 rather than fail in any other way (A1-7, A1-8).
- **Why a limit at all:** a specification that leaves depth open guarantees divergence. One
  implementation hashes a 600-deep input while another refuses it or overflows its stack, and
  that is the class of failure this document exists to remove.
- **Why 512:** it is far deeper than any tool schema needs, and within reach of every mainstream
  runtime's recursion.

**Sorting pitfall.** UTF-16 order and code-point order differ only when a name contains a code
point above U+FFFF, but they do differ (A1-2). An implementation must not rely on its language's
default string comparison without checking which order that is.

| ID | Input | Canonical bytes (hex) | SHA-256 | Note |
|---|---|---|---|---|
| A1-1 | ` { "b" : [3, 1, 2], "a" : { "d" : 1, "c" : 2 } } ` | `7b2261223a7b2263223a322c2264223a317d2c2262223a5b332c312c325d7d` | `628b7efcbc80e138bcf67ff6e41fb548a721cb8b8e89bbbd7af5f4828d8fe169` | Insignificant whitespace removed; keys sorted at every level; array order kept. |
| A1-2 | `{"\ufb01":1,"\ud83d\ude00":2}` | `7b22f09f9880223a322c22efac81223a317d` | `14dc6c14e11d686bbd1332452e5c8dc999ac1479def9c87e945308b1b27d469b` | Keys sort by UTF-16 code units: U+1F600 (D83D DE00) sorts before U+FB01. Code-point order, the fleet Python's, puts U+FB01 first. |
| A1-3 | `{"9":1,"10":2,"a":3,"B":4}` | `7b223130223a322c2239223a312c2242223a342c2261223a337d` | `1bc7528f6306b91444da567d6cca3d34b797f560a7acb3b9c9cd369b80058c7a` | Keys are strings, sorted as strings: "10" before "9", upper case before lower. |
| A1-4 | `["\u0000\b\t\n\f\r\u001f\"\\\/\u007f\u2028\u00e9"]` | `5b225c75303030305c625c745c6e5c665c725c75303031665c225c5c2f7fe280a8c3a9225d` | `5dc6fe11a2022513137f0ef9bbdfcca6acb76c83537f170793ac9ded04082f62` | String escapes: the five short forms, \u00XX in lower-case hex for other controls, quote and backslash escaped; solidus, U+007F, U+2028 and non-ASCII emitted raw as UTF-8. |
| A1-5 | `{"a":1,"a":2}` | **refused** | — | A duplicate key is refused: JCS requires I-JSON, which has none. |
| A1-6 | `[true,false,null,{},[]]` | `5b747275652c66616c73652c6e756c6c2c7b7d2c5b5d5d` | `9ea8f3856a89c1190f602b6f66c9e6f950f0f23d7d20e63d0d6ce7e56aafc722` | Literals and empty containers are emitted as given. |

**A1-7** (json). 512 arrays nested: the deepest accepted input.

Input:

```
[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]
```

Canonical bytes (1024 bytes):

```
5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b
5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b
5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b
5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b
5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b
5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b
5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b
5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b
5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b
5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b
5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b
5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b
5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b
5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b
5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b
5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b
5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d
5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d
5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d
5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d
5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d
5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d
5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d
5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d
5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d
5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d
5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d
5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d
5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d
5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d
5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d
5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d
```

SHA-256: `674cf3304bf7104f5ef200c1bb17b24a9b1da199f47cc76bcdc7fd030da23491`

**A1-8** (json). 513 arrays nested: refused. Objects and arrays count together.

Input:

```
[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]
```

Result: **refused**.

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

**How a literal becomes a number.** A number literal is first rounded to the nearest IEEE 754
double. Then the checks above apply to that double, and it is serialized.
- `9007199254740991.4` becomes 2^53−1 and is accepted (A2-16).
- `-1e-400` becomes negative zero and is refused (A2-17).

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
| A2-1 | `1.0` | `31` | `6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b` | 1.0 is the number one: "1". |
| A2-2 | `1e21` | **refused** | — | Refused: magnitude over 2^53-1 (every such double is integral, so this is the prior's integer bound). JCS's positive-exponent form is therefore unreachable. |
| A2-3 | `1e-7` | `31652d37` | `5b33e02f2c5103a05d32f6ba9cb058294452bfbf393967f68bb30c1bdcbbab22` | Below 1e-6 the ECMAScript form uses an exponent: "1e-7". |
| A2-4 | `0.30000000000000004` | `302e3330303030303030303030303030303034` | `06bad31060c1212ae832de4c031f7b31e3b48aed57858294478cb19450cf34ca` | 0.1+0.2: the shortest round-trip digits, never rounded for display. |
| A2-5 | `0.000001` | `302e303030303031` | `159fb29a827ad04b260aa6c8ab6d8637f8f2b38af5c4f3cb49d6a21205e040f8` | At 1e-6 the ECMAScript form is still positional. |
| A2-6 | `{"multipleOf":0.01}` | `7b226d756c7469706c654f66223a302e30317d` | `3fb1e18a1bf5d4c51dddd0014fb118a19784fc2f84125ca4a7935c3a2bd4a773` | A schema number of the kind the rule exists for. |
| A2-7 | `9007199254740991` | `39303037313939323534373430393931` | `f40b423c2dd95ff2b2f027e22208f438cf7242862e5e746860e697308c9add26` | 2^53-1, the largest accepted magnitude. |
| A2-8 | `9007199254740992` | **refused** | — | 2^53: refused. |
| A2-9 | `-0` | **refused** | — | Negative zero is refused (JCS would print it as "0"; two inputs, one hash). |
| A2-10 | `-0.0` | **refused** | — | Negative zero written as a fraction: refused too. |
| A2-11 | `1E2` | `313030` | `ad57366865126e55649ecb23ae1d48887544976efea46a48eb5d85a6eeb4d306` | Exponent input, integral value: "100". |
| A2-12 | `12.50` | `31322e35` | `b902cc4550838229a710bfec4c38cbc7eb11082367a409df9135e7f007a96bda` | Trailing zeros are not significant: "12.5". |
| A2-13 | the native value `NaN` | **refused** | — | Not a JSON value; a native value that reaches the canonicalizer is refused. |
| A2-14 | the native value `Infinity` | **refused** | — | Not a JSON value; a native value that reaches the canonicalizer is refused. |
| A2-15 | the native value `-Infinity` | **refused** | — | Not a JSON value; a native value that reaches the canonicalizer is refused. |
| A2-16 | `9007199254740991.4` | `39303037313939323534373430393931` | `f40b423c2dd95ff2b2f027e22208f438cf7242862e5e746860e697308c9add26` | A literal is first rounded to the nearest double: this one is 2^53-1, accepted. |
| A2-17 | `-1e-400` | **refused** | — | Rounded to the nearest double this is negative zero: refused. |

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

**Scope.** These checks apply to every string that reaches the canonical object: names, `scope`,
`recoverability_basis`, set elements, and every string and member name inside `input_schema`.

**The description is checked twice.** The leading-U+FEFF rule applies to the description both as
given and after A4 normalizes it. So `"\n"` followed by U+FEFF and `abc` is refused: normalization
removes the LF and leaves U+FEFF first (A4-9).

| ID | Input | Canonical bytes (hex) | SHA-256 | Note |
|---|---|---|---|---|
| A3-1 | `"\u00e9"` | `22c3a922` | `f2886017e9c7abacf804b54d64787dce2b611c9544ba21f3affdd126a6e50086` | Composed e-acute (NFC). |
| A3-2 | `"e\u0301"` | `2265cc8122` | `3d68ce21f2899a475713cdbe7562ba9bdb6b1dfde8af1f221bdff4a0935b53b2` | Decomposed e-acute (NFD): different bytes and a different hash from A3-1. No normalization. |
| A3-3 | `"\ufeffabc"` | **refused** | — | A string that begins with U+FEFF is refused, not stripped. |
| A3-4 | `"a\ufeffb"` | `2261efbbbf6222` | `8fe96f5346abe2848adbcaa2865516914cdeb3c21df1bf6bf2c8483753b10236` | U+FEFF inside a string is preserved (bytes as given). |
| A3-5 | `"\ud800"` | **refused** | — | A lone surrogate is refused. |
| A3-6 | `{"\udc00":1}` | **refused** | — | A lone surrogate in a key is refused. |
| A3-7 | `"\ud83d\ude00"` | `22f09f988022` | `7a0c50b92434b015545fe93ab723db2d4b2cdd14a441405624a9ce8be29f1d5a` | A well-formed surrogate pair is one code point, emitted as 4 bytes of UTF-8. |

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

**The result is checked again.** A3's checks apply to the normalized description as well as to the
description as given (A4-9).

| ID | Input | Canonical bytes (hex) | SHA-256 | Note |
|---|---|---|---|---|
| A4-1 | `Reads a file.\xa0` | `526561647320612066696c652ec2a0` | `a7e1cf1bc9c841a88dcd05a0c6c91573c48590286f07a7fe0354e8e25aaf72f5` | M5: a trailing U+00A0 is preserved. |
| A4-2 | `line one\r\nline two\rline three` | `6c696e65206f6e650a6c696e652074776f0a6c696e65207468726565` | `26a5cd654e540e91433a2f237e2709743fc4753e764deb74ed37299c2f338ece` | CRLF and a lone CR become LF. |
| A4-3 | `a \t\x0c\x0b\nb` | `610a62` | `7e18f737311b2dc3b2f269dd78396b0351f14fb66efa879f768cb23181883c78` | Trailing space, tab, form feed and vertical tab are stripped per line. |
| A4-4 | `\n\n  \nText\n\n\nMore\n\n` | `546578740a0a0a4d6f7265` | `da2f7574dbdc209e24736804fdde6ce79e4f131983fec80c3950b75dad5a0097` | Leading and trailing newlines stripped (after the per-line strip); internal blank lines kept. |
| A4-5 | `one\u2028two\u2028` | `6f6e65e280a874776fe280a8` | `dd0774bcc9bc82e84317f06b2e7de6bee6d709633d594194f091aed0386da164` | U+2028 is neither a line break nor strippable here: preserved. |
| A4-6 | `  indented\u3000` | `2020696e64656e746564e38080` | `4e417b74afafac20b34c98a680ef60faeea540c1a614f9230f17751085828935` | Leading spaces and a trailing U+3000 are preserved. |
| A4-7 | `\n\n\n` | (empty) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | Only newlines: the empty string. |

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
7b226361706162696c6974795f636c617373223a22726561645f6f6e6c79222c
22636f6e7461696e6d656e745f646f6d61696e223a6e756c6c2c226465736372
697074696f6e223a224563686f2e222c22656c657661746564223a66616c7365
2c22696e7075745f736368656d61223a7b2270726f70657274696573223a7b22
74657874223a7b226465736372697074696f6e223a22546578742e2020222c22
74797065223a22737472696e67227d7d2c2274797065223a226f626a65637422
7d2c226e616d65223a226563686f222c22707269766163795f73656e73697469
7665223a66616c73652c227265636f7665726162696c6974795f626173697322
3a6e756c6c2c2273636f7065223a226563686f222c22756e747275737465645f
696e7075745f666163696e67223a66616c73657d
```

SHA-256: `96138956d85f1c432a5f40cff8aca81a248f1374f409e7dd85bff0d7b0411ad5`

**A4-9** (tool). The leading-U+FEFF rule applies to the description as given and after normalization: once the LF is removed, it begins with U+FEFF, so it is refused.

Input:

```json
{
  "name": "echo",
  "description": "\n\ufeffabc",
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

Result: **refused**.

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
`read_only`, `owned_state`, `state_change` or `arbitrary_exec` (A5-9). The remaining strings
(`scope`, `recoverability_basis`, set elements) follow A3.

| ID | Input | Canonical bytes (hex) | SHA-256 | Note |
|---|---|---|---|---|
| A5-1 | `echo` | `6563686f` | `092c79e8f80e559e404bcf660c48f3522b67aba9ff1484b0367e1a4ddef7431d` | Accepted. |
| A5-2 | `Echo` | **refused** | — | Upper case refused. |
| A5-3 | `note.append_v2-x` | `6e6f74652e617070656e645f76322d78` | `82afb05398868e083da3cf26e9b92aece70130338a67fa303a4e88c720871760` | Dot, underscore and hyphen allowed after the first character. |
| A5-4 | `_hidden` | **refused** | — | Must begin with a lower-case letter or digit. |
| A5-5 | `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz` | `7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a` | `72996563049cc84daa2c3f31fd5c3d10770e69d6ebbb8da5b6d76db303dbae43` | 64 characters: accepted. |
| A5-6 | `zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz` | **refused** | — | 65 characters: refused. |
| A5-7 | `\xe9cho` | **refused** | — | Non-ASCII refused. |
| A5-8 | `echo\n` | **refused** | — | A trailing newline is refused: the pattern must match the whole string (an end anchor that also matches before a final newline is the trap). |

**A5-9** (tool). capability_class, the other identifier (A5), outside the four rungs is refused.

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

**Every field reaches the bytes.** A6-5 sets every boolean to `true` and gives a containment
domain, so a canonicalizer that drops or fixes any field's value fails a vector.

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
7b226361706162696c6974795f636c617373223a22726561645f6f6e6c79222c
22636f6e7461696e6d656e745f646f6d61696e223a6e756c6c2c226465736372
697074696f6e223a2252657475726e732069747320746578742e222c22656c65
7661746564223a66616c73652c22696e7075745f736368656d61223a7b226164
646974696f6e616c50726f70657274696573223a66616c73652c2270726f7065
7274696573223a7b2274657874223a7b2274797065223a22737472696e67227d
7d2c227265717569726564223a5b2274657874225d2c2274797065223a226f62
6a656374227d2c226e616d65223a226563686f222c22707269766163795f7365
6e736974697665223a66616c73652c227265636f7665726162696c6974795f62
61736973223a6e756c6c2c2273636f7065223a226563686f222c22756e747275
737465645f696e7075745f666163696e67223a66616c73657d
```

SHA-256: `40e12e609f20f36ff25812f5249676a9b41ba509c08b4a9c978880651c2ff18c`

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

**A6-5** (tool). Every boolean true and a containment domain: each field's value reaches the bytes.

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
  "capability_class": "state_change",
  "untrusted_input_facing": true,
  "scope": "echo",
  "privacy_sensitive": true,
  "recoverability_basis": null,
  "elevated": true,
  "containment_domain": [
    "echo-sink"
  ]
}
```

Canonical bytes (354 bytes):

```
7b226361706162696c6974795f636c617373223a2273746174655f6368616e67
65222c22636f6e7461696e6d656e745f646f6d61696e223a5b226563686f2d73
696e6b225d2c226465736372697074696f6e223a2252657475726e7320697473
20746578742e222c22656c657661746564223a747275652c22696e7075745f73
6368656d61223a7b226164646974696f6e616c50726f70657274696573223a66
616c73652c2270726f70657274696573223a7b2274657874223a7b2274797065
223a22737472696e67227d7d2c227265717569726564223a5b2274657874225d
2c2274797065223a226f626a656374227d2c226e616d65223a226563686f222c
22707269766163795f73656e736974697665223a747275652c227265636f7665
726162696c6974795f6261736973223a6e756c6c2c2273636f7065223a226563
686f222c22756e747275737465645f696e7075745f666163696e67223a747275
657d
```

SHA-256: `da3b0e125fb21330488580ce205f93e16cb101b173faa2a8e1ff967a21f8f439`

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
| A7-1 | `["b", "a", "b", "B"]` | `5b2242222c2261222c2262225d` | `756ec021cad39e23f770a62070784c36f95d72f3a6a73be7e37f6ea44e7b058f` | Deduplicated, sorted by UTF-16 code units, case preserved. |
| A7-2 | `[]` | `5b5d` | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | The empty set: contained to nothing. Distinct from null. |
| A7-3 | `null` | `6e756c6c` | `74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b` | null: no containment claimed. |
| A7-4 | `["\ufb01", "\ud83d\ude00"]` | `5b22f09f9880222c22efac81225d` | `ee4f2693e8617d4562c6b6116dbd1ce97f032a01d43e2e68d164cf75132f7897` | UTF-16 order, as A1-2. |
| A7-5 | `{"required":["b","a"],"enum":[2,1]}` | `7b22656e756d223a5b322c315d2c227265717569726564223a5b2262222c2261225d7d` | `8fc1ca1946d9bbc38ea1a91e2ac91ae44ee8034d88a726b03a0947c49154fdb0` | Arrays inside input_schema are not sets: order kept. |

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
| A8-1 | `{"type":"object"}` | `7b2274797065223a226f626a656374227d` | `a2c799262a3ce3c19ef5cdd983bf3d12b43ab3c426227091b909dcb7054738c0` | Absent. |
| A8-2 | `{"type":"object","default":null}` | `7b2264656661756c74223a6e756c6c2c2274797065223a226f626a656374227d` | `7a9b699bd75d585d882389aaae4200a4b3c9f023eac0a0cbdd1bb282d1615b18` | null. |
| A8-3 | `{"type":"object","default":{}}` | `7b2264656661756c74223a7b7d2c2274797065223a226f626a656374227d` | `e0313a371c2076f7a0d4d7d085a241032c84e08e0ae2075d7c60eb69d2ead629` | Empty object. |
| A8-4 | `{"type":"object","default":[]}` | `7b2264656661756c74223a5b5d2c2274797065223a226f626a656374227d` | `0fe20ff703a1976b26e96034dd383a650ea08e468f975d4ed05e2b40657ada5b` | Empty array. Four inputs, four hashes. |

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

**Reading the manifest vector.** The manifest vector's canonical bytes contain the tool hashes as
64-character strings. In A9-2, the `tool_hash` of `echo` is A6-1's SHA-256 and that of
`note.append` is A9-1's.


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
7b226361706162696c6974795f636c617373223a226f776e65645f7374617465
222c22636f6e7461696e6d656e745f646f6d61696e223a5b226e6f7465732d66
696c65225d2c226465736372697074696f6e223a22417070656e6473206f6e65
206c696e6520746f20746865206f70657261746f722773206e6f7465732e5c6e
4e65766572207265777269746573206561726c696572206c696e65732e222c22
656c657661746564223a66616c73652c22696e7075745f736368656d61223a7b
226164646974696f6e616c50726f70657274696573223a66616c73652c227072
6f70657274696573223a7b226c696e65223a7b226d61784c656e677468223a35
30302c2274797065223a22737472696e67227d7d2c227265717569726564223a
5b226c696e65225d2c2274797065223a226f626a656374227d2c226e616d6522
3a226e6f74652e617070656e64222c22707269766163795f73656e7369746976
65223a747275652c227265636f7665726162696c6974795f6261736973223a22
617070656e642d6f6e6c79222c2273636f7065223a226e6f746573222c22756e
747275737465645f696e7075745f666163696e67223a747275657d
```

SHA-256: `8131e955204dbe8910ad9ea0e2fed4e435f3f1c6da0f8e197b621649ca7b8723`

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
7b2263616e6f6e6963616c5f666f726d5f76657273696f6e223a312c22746f6f
6c73223a5b7b226e616d65223a226563686f222c22746f6f6c5f68617368223a
2234306531326536303966323066333666663235383132663532343936373661
3962343162613530396330386234613963393738383830363531633266663138
63227d2c7b226e616d65223a226e6f74652e617070656e64222c22746f6f6c5f
68617368223a2238313331653935353230346462653839313061643965613065
3266656434653433356633663163366461306638653139376236323136343963
61376238373233227d5d7d
```

SHA-256: `e3e7c1348daa166f5e9c1bb01c4f314e102ee64e4a83b154d56a2a8ce53b1ff6`

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
7b2263616e6f6e6963616c5f666f726d5f76657273696f6e223a312c22746f6f
6c73223a5b7b226e616d65223a226563686f222c22746f6f6c5f68617368223a
2234306531326536303966323066333666663235383132663532343936373661
3962343162613530396330386234613963393738383830363531633266663138
63227d5d7d
```

SHA-256: `8aae96f12c5851c178d5a809b33d807e3990b72aa33b69639bfee97db588614a`

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
