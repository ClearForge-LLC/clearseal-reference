# FEEDBACK: CSR-WO-0102 (spike: which class-5 envelope the core should sign)

Branch `wo/CSR-WO-0102`, cut from `main` at `9b48111`. **Spike: implemented, measured, stopped.**
There is no ruling here and no core code. Built on Node v24.21.0. The Python oracle ran under
`uv run` (Python 3.14.6, `cryptography` 46.0.3, pinned inline in the script). Every commit carries
the role identity as author and committer. `leak-gate --tree` and `--history` were clean before
every push.

## Measurement table

| | **A — field contract, pluggable payload** | **B — RFC 9421 over a JSON body** | **C — detached JWS, EdDSA** |
|---|---|---|---|
| Implementation lines (code, excluding comments and blanks) | **100** (`option-a.ts`) | **177** (`option-b.ts`) | **121** (`option-c.ts`) |
| Shared by all three (`common.ts`: fixture, allowlist, schema, the three gates) | 200 | 200 | 200 |
| Python oracle lines for the option (hand-built from the spec, stdlib plus `cryptography`) | ~15 | ~40 | ~17 |
| Canonicalization decisions an implementer must make | **9** (listed below): **6 fixed by the contract**, **3 it leaves open** | **14**, all open to each implementer | **9**; of these, **4** are canonicalization proper |
| Second-language implementation matched on the first attempt | **yes**: canonical and wire bytes identical for all 4 vectors | **yes**: HTTP/1.1 wire bytes identical for all 4 vectors | **yes**: wire bytes identical for all 4 vectors |
| Runtime dependency tree | **none** beyond `node:crypto` | **2 packages**: `http-message-signatures` 1.0.6 (ISC), `structured-headers` 2.1.0 (MIT). No install scripts. 242 KB unpacked. Its types need the `DOM` lib (`BufferSource`) | **1 package**: `jose` 6.2.12 (MIT), no dependencies, no install script, 206 KB unpacked. It is already in the tree through the MCP SDK |
| Wire size of `minimal` | **307 B** (JSON; 145 B signed) | **618 B** (request line, `Host`, 4 headers, `Content-Length`, 101 B body; 390 B signed base) | **373 B** (token, LF, 101 B payload; 323 B signing input) |
| Field verifier accepts the output unchanged | **yes, by construction**. Same framing, context and fields; `sender_id` is synthetic | **no.** It needs a new verifier in the field (HTTP-signature parsing, a digest check, SF parsing), or a bridge that also emits A | **no.** It needs a JOSE verifier in the field with an `alg` allowlist, or a bridge that also emits A |
| verify ×10,000 (valid, fresh store; median of 3) | 1322 ms, **132 µs/op** | 1802 ms, **180 µs/op** | 1845 ms, **185 µs/op** |
| sign ×10,000 | 562 ms, 56 µs/op | 1078 ms, 108 µs/op | 797 ms, 80 µs/op |
| Structure refusal ×10,000 (`v:2`) | 30 ms, 3.0 µs/op | 215 ms, 21.5 µs/op | 64 ms, 6.4 µs/op |
| Parser-dependent answers found (§5.1) | duplicate JSON keys, injectable by **anyone** (the wire JSON is unsigned) | duplicate body keys (needs the signer); duplicate SF members, injectable by anyone | duplicate body and **header** keys (needs the signer), including `"alg":"none","alg":"EdDSA"` |

**What "the same canonical bytes" means per option.** A signs a length-prefixed field list, so the
verifier rebuilds it from parsed JSON. B and C sign the **body bytes as received**: B through a
digest, C as base64url. JSON never has to be re-canonicalized to verify. It only has to be
reproduced for the signer's byte identity with the oracle. What B and C canonicalize instead is
their own framing: HTTP components and SF serialization for B, and the header plus base64url for C.

### The canonicalization decisions, listed

- **A (9).** Fixed by the contract:
  1. the field order;
  2. `uint32_be` of the **UTF-8 byte** length;
  3. integers in shortest decimal;
  4. no Unicode normalization;
  5. strict UTF-8, lone surrogates refused;
  6. the 31-byte CONTEXT with its NUL.

  **Left open by it:**

  7. duplicate JSON keys;
  8. JSON number lexemes (`1.0`, `1e0`, `-0`) on the wire;
  9. how strictly base64 is decoded. The spike accepts canonical encoding only.
- **B (14):**
  1. the set and order of covered components;
  2. the parameter set and order;
  3. RFC 8941 serialization of `@signature-params`;
  4. header values: OWS trimmed, obs-fold, multiple instances joined with `", "`;
  5. header-name case and duplicate headers;
  6. `@authority` normalization (case, default port);
  7. `@path` derivation (WHATWG URL parsing, dot-segments, percent-encoding);
  8. `@method` case;
  9. the Content-Digest algorithm and its SF byte-sequence form;
  10. the digest over raw body bytes versus content-coding;
  11. the label, and how many signatures are allowed;
  12. duplicate SF dictionary members (RFC 8941: last wins);
  13. the `created`/`expires` boundaries;
  14. the signature base's LF, with no trailing LF.
- **C (9):**
  1. header JSON serialization (signer only);
  2. strict base64url without padding;
  3. the `alg` allowlist;
  4. the detached payload's base64url in the signing input;
  5. duplicate header keys;
  6. `exp` exclusive versus `iat` inclusive;
  7. `typ`;
  8. `crit`;
  9. `kid` lookup.

  Items 1, 2, 4 and 5 are canonicalization proper.

## The three M5 vectors

Each option has four oracle vectors: `minimal`, `m5-nbsp`, `m5-composed` and `m5-decomposed`,
in `spikes/0102-envelope/vectors/option-{a,b,c}.json`. Each carries the exact signed bytes
(`signed_bytes_b64`), the wire bytes and `text_utf8`. The Python generator produced them; TypeScript
verifies them and signs identical bytes.

**A shows that no normalization occurred:** the last canonical field (`uint32_be` length ‖ text),
pasted from the test output.

```
A minimal:       signed tail 00 00 00 09 61 6c 6c 20 63 6c 65 61 72
A m5-nbsp:       signed tail 00 00 00 0b 61 6c 6c 20 63 6c 65 61 72 c2 a0        ← U+00A0 signed, not stripped
A m5-composed:   signed tail 00 00 00 05 63 61 66 c3 a9                          ← U+00E9 as given
A m5-decomposed: signed tail 00 00 00 06 63 61 66 65 cc 81                       ← e + U+0301 as given
```

The composed and decomposed texts are equal under NFC, but they are signed as different bytes. Put
the composed text into the decomposed vector's wire and it is refused `signature/bad-signature`.
That proves the verifier does not normalize either. Both are tests in `test/vectors.test.ts`.

**B** carries the text raw in the body. The body enters the signature base through its
content-digest:

```
m5-nbsp        body text bytes 61 6c 6c 20 63 6c 65 61 72 c2 a0   signed line "content-digest": sha-256=:yGge8BxxuMO8piSS5ckcRFKWCPpdkfU5qUxGs7qZI08=:
m5-composed    body text bytes 63 61 66 c3 a9                      signed line "content-digest": sha-256=:MVuWCJXY9FWPtf4+Zek2fn9FPNQCweYnxYgJh7I7oPs=:
m5-decomposed  body text bytes 63 61 66 65 cc 81                   signed line "content-digest": sha-256=:1T9VQmBKsJ6nFm8C5i/dk2a7gLnjPNwlI1FnRQcT7d0=:
```

**C** carries the text raw in the payload. The payload is signed as base64url inside the signing
input:

```
m5-nbsp        payload text bytes 61 6c 6c 20 63 6c 65 61 72 c2 a0   signing-input payload tail …QiOiJhbGwgY2xlYXLCoCJ9fQ
m5-composed    payload text bytes 63 61 66 c3 a9                      signing-input payload tail …IsInRleHQiOiJjYWbDqSJ9fQ
m5-decomposed  payload text bytes 63 61 66 65 cc 81                   signing-input payload tail …sInRleHQiOiJjYWZlzIEifX0
```

**Byte identity (§3.2):** TypeScript sign against the Python bytes, both sha256 in base64, from the
test output:

```
A minimal canonical: 145 bytes, sha256 ts=62E/Z0AGJ0VA036IIPXHIfSklr0QhGAqxzlFn7zK5ZQ= py=62E/Z0AGJ0VA036IIPXHIfSklr0QhGAqxzlFn7zK5ZQ=
A minimal wire: 307 bytes, sha256 ts=nZG01pz5n33qjPcwKPvm3L1uCJgyKT+43o8dXnVOa9k= py=nZG01pz5n33qjPcwKPvm3L1uCJgyKT+43o8dXnVOa9k=
A m5-nbsp wire: 309 bytes, sha256 ts=59Tqm4NfsgqI0pyoyB3/B5B307V9Zqk+7YKkp8zfwhc= py=59Tqm4NfsgqI0pyoyB3/B5B307V9Zqk+7YKkp8zfwhc=
A m5-composed wire: 303 bytes, sha256 ts=WXbkd933wEy9R2G6xciAcs9Pd4C/oQvXqpeMYQ5d9x8= py=WXbkd933wEy9R2G6xciAcs9Pd4C/oQvXqpeMYQ5d9x8=
A m5-decomposed wire: 304 bytes, sha256 ts=gzkawvPJWCDVykfw7m9+fDa3caqKq9VOLZqXz2m7lpQ= py=gzkawvPJWCDVykfw7m9+fDa3caqKq9VOLZqXz2m7lpQ=
B minimal wire: 618 bytes, sha256 ts=Xk9LWv8laxlwm+AuOuKUm9cX/uDonvDQto4pizRhbag= py=Xk9LWv8laxlwm+AuOuKUm9cX/uDonvDQto4pizRhbag=
B m5-nbsp wire: 620 bytes, sha256 ts=bhvNQQtdzt/aiu54JrSz2JZaek3MntAh9hIGglk0Jsk= py=bhvNQQtdzt/aiu54JrSz2JZaek3MntAh9hIGglk0Jsk=
B m5-composed wire: 614 bytes, sha256 ts=HflloUipuVccnD1rRYkhGH78nxeV6EUc5zrzj+FcbWY= py=HflloUipuVccnD1rRYkhGH78nxeV6EUc5zrzj+FcbWY=
B m5-decomposed wire: 615 bytes, sha256 ts=oC/W2khzYSycgZWnUth73KptzAGaMOHzAyg/qIIdKtg= py=oC/W2khzYSycgZWnUth73KptzAGaMOHzAyg/qIIdKtg=
C minimal wire: 373 bytes, sha256 ts=mRZbV1bQReVbe8tMBABZucqnhdmF5/L2PTXpmkgg4hY= py=mRZbV1bQReVbe8tMBABZucqnhdmF5/L2PTXpmkgg4hY=
C m5-nbsp wire: 375 bytes, sha256 ts=gDBqU39Tle6IR5lSfJQIs5y0mMWcCXKyEVANNo5oaNE= py=gDBqU39Tle6IR5lSfJQIs5y0mMWcCXKyEVANNo5oaNE=
C m5-composed wire: 369 bytes, sha256 ts=+7cPMY3aBNw6X3LVR+B7isOV/R363xErmCI1v7eyGas= py=+7cPMY3aBNw6X3LVR+B7isOV/R363xErmCI1v7eyGas=
C m5-decomposed wire: 370 bytes, sha256 ts=E9yybFxAY6kRlHgShVka+MYZEtKbzrzaO8QX9GIftwM= py=E9yybFxAY6kRlHgShVka+MYZEtKbzrzaO8QX9GIftwM=
```

The oracle's own reproducibility check: `uv run spikes/0102-envelope/oracle/gen_vectors.py --check`
regenerates all three files and compares them byte for byte, printing `same` for each.

**Fixture key (§1.1):** the first test (`test/00-fixture.test.ts`) derives the public key from the
byte-pattern seed and asserts `qikRoPRLUGmP2QuEpKRSJLhCB33v3l7Hcoi8vK6tTtY=`. The Python oracle
derives the same key independently and records it in every vector file, and a test checks that
too. **The WO's `canonical_len = 149` does not match its own `minimal` JSON.** The arithmetic
(31 + 8×4 + 1+20+6+16+10+16+4+9) gives **145**, and both runtimes emit 145. The WO already notes
that the field vector's sender id differs; the 4-byte gap is consistent with that.

## Negative tests (§1.2.3) and red-proofs

One harness (`test/harness.ts`) runs the same list against each option. **Every case asserts the
gate and the check that refused it**, so a refusal for the wrong reason fails:

| Negative | Refused by (all three options) |
|---|---|
| unknown field (signed over, where the option can) | `structure/unknown-field` |
| wrong `v` (2, 0, and the string `"1"`) | `structure/version` |
| expired (`issued_at` = now−301) | `signature/stale` |
| issued beyond the +60 s skew | `signature/future` |
| replayed nonce | `signature/replay` |
| author not on the allowlist | `author/not-listed` |
| a listed author signing with another author's key | `author/key-not-author's` |
| effect above the floor | `effect/above-floor` |
| key outside its validity window (both edges) | `signature/key-window` |
| lone surrogate: the signer throws `SerializationRefusal`; the verifier refuses a `\ud800` escape | `structure/lone-surrogate` |
| one flipped byte of signed content | `signature/bad-signature` |
| signed by a key that is not the listed one for its kid | `signature/bad-signature` |
| unsigned | `structure/unsigned` |
| unknown kid | `signature/unknown-key` |

**Red-proof, one gate per option (§3.3).** Each option had one gate commented out in a scratch copy,
then ran its own test file:

```
=== option a — gate 1 (the edVerify line) commented out
  ✖ signature valid but over different signed bytes (one flipped byte) → refused (gate 1: signature)
  ✖ signed by a key that is not the listed one for its kid → refused (gate 1: signature)
ℹ pass 13
ℹ fail 2
=== option b — gate 2 (gateAuthor) commented out
  ✖ author not on the allowlist → refused (gate 2: author)
  ✖ listed author signing with another author's key → refused (gate 2: author)
ℹ pass 13
ℹ fail 2
=== option c — gate 3 (gateEffect) commented out
  ✖ effect above the floor → refused (gate 3: effect)
ℹ pass 14
ℹ fail 1
```

**And the full matrix, beyond what §3.3 asks.** Every negative was checked in every option: the
check that should refuse it was disabled in a fresh scratch copy (both checks where two stack), and
the result recorded. **27 of 27 go red on the final code:**

```
RED  option A/B/C · unknown field · wrong v · expired · replayed nonce · author not on · effect above
                  · validity window · lone surrogate · one flipped byte            (27 lines, exit 0)
```

The F1 fix below has its own red-proof. With the high-water line reverted, the three
clock-step-back tests fail (`ℹ fail 3`).

## Opinion (the builder's; the architect rules)

A. It is the only option the deployed verifier accepts unchanged. It has the smallest code and no
dependency. Its canonical form is fully specified, so it is the only one whose "decisions" were
already decided. Its two weaknesses are fixable at the verifier without changing the wire: duplicate
keys (F2) and integer lexemes (F7). Refuse both at structure, then write that into the contract as
v1 verifier rules. B pays for HTTP binding that class 5 does not need, with the widest surface
(F5, F6). C is a reasonable second choice if a JOSE ecosystem ever matters.

## Findings

The adversarial pass was delegated to a fresh subagent (WO §5). Each item below was re-run by me
before I adopted it. **Fixed** items are in the code, with tests. **Recorded** items are
measurements, and fixing them is a design decision.

| # | Finding | Severity | Status |
|---|---|---|---|
| F1 | **A nonce was accepted again after the verifier clock stepped backwards.** A later message pruned the store at now+301; the first message then replayed at now+10. Reproduced in A, B and C | **fail-open** (conditional on a non-monotonic clock) | **fixed**. `NonceStore` keeps a high-water clock, and freshness uses it. Tests are in `test/adversarial.test.ts`, with a red-proof |
| F2 | **A's wire JSON is unsigned, so anyone can prepend duplicate keys.** JS `JSON.parse` keeps the last value and verifies it, while a first-wins parser reads the decoy: `severity:"confirmed_attack"` before the real `"info"`, or another `sender_id`. The real message is still accepted, because the nonce is the same. That is not a second acceptance | parser-dependent | **recorded**. The fix is a duplicate-rejecting parse at structure, plus a rule that downstream code consumes only the verifier's returned message. This also applies to the field verifier, which is upstream (§9) |
| F3 | B and C accept duplicate keys **inside the signed body**, and C inside the **protected header**: `"alg":"none","alg":"EdDSA"` verifies as EdDSA. This needs a listed signer | parser-dependent | **recorded**. Same fix |
| F4 | B: duplicate SF dictionary members (`sig1=…, sig1=…`) parse last-wins per RFC 8941, so the "exactly one signature" check cannot see them. A third party can prepend a garbage label | parser-dependent | **recorded** |
| F5 | B: the library upper-cases `@method`, so `post` and `PoSt` verify a `POST` signature. RFC 9421 §2.2.1 says the method is not case-transformed | conformance | **recorded** |
| F6 | B: `@query` and `@scheme` are not covered, and URL normalization happens before the base is built. So `?admin=1`, `http:`, `/x/../` and `%2e%2e` all verify. The verifier also trusts the method and URL it is handed | binding gap | **recorded**. Cover `@query` and `@target-uri`, and build the request from the raw request line |
| F7 | A: number forms are malleable on the wire. `v:1.0`, `1e0`, `1.0000000000000001`, `issued_at:1.7877e9` and `-0` all verify. The last is not "never best-effort parsed", and a Python verifier following the contract would refuse it | malleability | **recorded**. Fix: check integer lexemes at structure |
| F8 | A: **no two distinct envelopes have the same canonical bytes.** The framing is uniquely decodable, and a 200,000-envelope fuzz found 0 collisions. **But** the pluggable schema does not enforce a unique `context`: a second schema that reuses the alert context accepts an alert's signature | design | **recorded**. A schema registry must enforce unique contexts and fixed arity |
| F9 | B: `structured-headers` accepts unpadded or bit-altered base64 byte sequences, and a Decimal `created=…0` re-serialized as an Integer. Header OWS and name case are tolerated (per spec). Obs-fold, reordered parameters, `application/JSON` and split Signature-Input are refused | malleability | **recorded** |
| F10 | The whole-second edges differ: at `issued_at = now−300`, A and B accept and C refuses (JWT's `exp` is exclusive). The key window is checked at `now`, not at `issued_at`. Nonces are global, so one listed author can burn another's | info | **recorded**. Pick one boundary convention; key nonces per sender |
| F11 | C: jose **without** the `algorithms` option accepts HS256 keyed with the raw public-key bytes (pinned as a measurement test). With the Ed25519 `KeyObject`, it throws `TypeError` | info | **fixed**. C checks `alg === "EdDSA"` at structure as well as via jose |
| F12 | `NonceStore.has` scans the whole map on every call. A shared store holding 10k live nonces adds about 45–50 µs/op | performance | **recorded** |
| F13 | B's library, `http-message-signatures`, is CJS and loads its own copy of `structured-headers`. A second, ESM copy is what the spike imports, and `Token` differs across the two copies. The spike parses and serializes with one copy only, so this is a latent risk | info | **recorded** |
| F14 | B's library `verifyMessage` cannot serve as a gate. It reads the clock from `Date.now()`, returns `null` rather than `false` for an unsigned message, and passes when **any one** of several signatures is valid. The spike rebuilds the base with the library's functions and does every check itself | info | **recorded** |

**§5 results.**

1. Duplicate keys: parser-dependent in all three (F2–F4).
2. A canonical collision: none exists, by argument and by fuzz (F8). Wire malleability is recorded (F7).
3. B header variations: F9, with the binding gaps in F5 and F6.
4. C alg confusion:
   - **`alg: none`** (empty, garbage and valid Ed25519 signatures) is refused.
   - **`alg: HS256`** keyed with the raw public key or the SPKI PEM is refused (`test/adversarial.test.ts`).
   - `Ed25519`, `eddsa` and `EDDSA` are refused.
5. Timing: see the table. That is the median of 3 runs of 10,000 on the builder's machine.

**Held under attack.** These are the adversarial pass's results, spot-checked:

- kids named after prototype properties;
- duplicate kid entries (refused as `ambiguous-key`);
- the `strictBase64` edge cases;
- lone surrogates in keys;
- raw invalid UTF-8, a BOM and overlong forms;
- C's `b64:false`+`crit`, a re-attached payload, and four segments;
- the oracle's independence: it imports only the stdlib and `cryptography`, and reads only `vectors/`;
- the vector contents: synthetic ids, `receiver.example`, and the fixture key only.

## Gates line

| Gate | Result |
|---|---|
| `npm run check` | exit **0** on v24.21.0: typecheck (the spike's tsconfig adds `DOM` for `structured-headers`' types), lint, directives, build, `@clearseal/core` 1 test, and the spike's **69 tests in 6 files** |
| Vectors | generated by the Python oracle only (N3). The TypeScript side verifies all 12 and signs 12 byte-identical wires |
| Leak gate | `--tree` and `--history` clean before every push. Every commit uses the role identity. No session trailer |
| CI | the push run on the first commit was green (test ×2, leak-gate, sbom, audit). The final head's run shows on the PR |
| Credentials | none needed to push; pushes used the repository's write deploy key. A short-lived token was minted **only** to open this pull request, kept in a mode-0600 scratch file for that call, and **deleted** straight after |
| Protected surfaces | the steering documents, `LICENSE`, `NOTICE`, `packages/**`, `scripts/**`, `.github/**` and `spikes/0100-protocol/**` diff **empty** against `main` |

**Outside the spike directory, only the root `package.json` changed, in two places.** The
workspace list gained `spikes/0102-envelope`. The `test` script now also runs
`scripts/test.mjs "spikes/0102-envelope/test/*.test.ts"`, which §3.1 requires: the spike's tests
run under `npm run check`. `package-lock.json` changed to match. No §7 condition fired: B and C
stayed far under fifty packages, and none declares an install script.

## What did not work, and why

- **`erasableSyntaxOnly` refuses TypeScript parameter properties.** The first run of the C test
  files failed to load (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`), and the fix was a plain field. This
  was a syntax failure, not a byte mismatch. No vector mismatched on any run.
- **Lint:** node:test's `describe`/`it` return promises (`no-floating-promises`), so they are
  `void`-prefixed as in `packages/core`. B's `verify` had no `await`, so it is now synchronous.
- **The first red-proof matrix missed two checks because of how I disabled them.** Commenting out
  the effect-gate `return` made it refuse everything, and a multi-line jose call cannot be commented
  out one line at a time. Both now use exact replacements, and both go red.
- **The spike imports `structured-headers` directly, so it declares that package directly.** Relying
  on the library's copy would be a phantom dependency. The tree size is unchanged.

## What was deliberately not built

- **No choice between the options,** no core code, and no provenance module (`-2004`).
- **No duplicate-key parser, integer-lexeme check or B URL hardening** (F2–F7). These are the
  measured surface. Fixing them in one option would skew the comparison the architect rules on.
- **No key generation, storage or rotation tooling.** The only key is the WO's fake fixture key.
- **No wiring** into a transport, an audit checkpoint or a tool.
- **The red-proof matrix and the adversarial probes are not committed.** They live in the builder's
  scratch space and are pasted above. The committed tests are the negative harness, the vectors,
  and the adversarial regressions that were fixed.
