# FEEDBACK: CSR-WO-2004 (message provenance: a signed envelope, an isolated signer, three fail-closed gates)

Branch `wo/CSR-WO-2004`, cut from `main` at `bd99b50` (contains `-2011`'s merge `f01801c` and this work
order). Built on Node v24.21.0 on Furnace, 2026-11-28; every commit's author and committer is
`clearforgekey[bot]`'s noreply address. **Security-critical:** parked as one unmerged pull request for
line-by-line review and the external red team (the Adversary) before merge.

## Read this first

- **The size cap is 16 KiB and the nonce-cache bound is 10,000; both were measured on Furnace.**

  | Bound | Value | Measurement and choice |
  |---|---|---|
  | `MAX_WIRE_BYTES` | 16,384 | Under the cap, a whole verify costs 70–76 µs at 554 B, 1.3 KiB and 4.3 KiB: the Ed25519 check dominates. Past it, decoding, parsing and Ed25519 grow linearly: 81 + 99 µs at 64 KiB, 1.5 + 0.9 ms at 1 MiB, 15 + 6.9 ms at 8 MiB. A wire over the cap is refused before it is decoded, in under 1 µs at any size. An alert is a short human message, and 16 KiB leaves about 16,000 characters of text. |
  | `DEFAULT_MAX_NONCES` | 10,000 | 521 B of heap per remembered 128-character nonce (502 B at 100,000), so 5 MiB at the bound. A full prune at the bound took 1.7 ms (13 ms at 100,000). A nonce is held until `issued_at + 300`, and messages may be issued up to 60 s ahead, so the bound sustains about 27 accepted messages a second per verifier; filling it took 0.94 s at about 10,700 verifies a second. A class-5 alert rate is orders of magnitude below that. At the bound, a new message is refused (`nonce-cache-full`, PV-7). |
  | `MAX_WIRE_DEPTH` | 8 | The alert message is 3 deep, which leaves room for a pluggable payload. |

- **What did not carry over from the spike, and why:**
  1. **Gate 3's effect ranking.** The spike ranked an effect by `indexOf` and accepted when it was at or
     below the floor. An effect the ordering does not know gives -1, which is "below" every floor, so
     a pluggable schema naming an unknown effect would be **accepted**. Now it is refused
     (`unknown-effect`).
  2. **`JSON.parse`.** The spike parsed with `JSON.parse` plus a surrogate walk. This module uses the
     core's strict parser, which refuses duplicate keys, depth and lone surrogates, then closes the
     other two encoding decisions with a lexical scan of the number tokens. `-0` would otherwise read as
     `0`, which is a fresh `issued_at` at the right time.
  3. **The nonce store.** The spike's store pruned every entry on every look and had no bound. This one
     looks up its entry directly, prunes only at capacity, and refuses at the bound.
  4. **The signer.** The spike signed with a `KeyObject`. Here signing goes through `ProvenanceSigner`
     only (PV-2), and the fixture key lives in `test/`.
  5. **Check names.** The spike's `field` and `unknown-field` covered several sites. Each site now has
     its own name (`sender-id`, `key-id`, `origin-class`, `issued-at`, `nonce`, `alert-*`), so each can
     be deleted alone.
  6. **Not applicable to Option A:** the spike's `alg: none` and HS256-keyed-with-the-public-key proofs
     (JOSE, Option C), and Option B's tests. Every Option A proof carried over: the 15 shared
     negatives, including the baseline, and the replay-after-prune proof.
- **Replay across a restart is a known limit**, not built (RULES.md). Nonces live in memory, so a
  verifier restarted inside a message's 300 s window would accept it again. The options are to persist
  the nonce memory, or to refuse messages issued before the process started, which also refuses honest
  in-flight ones. This is a ruling for the architect.

## -2011's findings, promoted

| -2011 finding | Durable home |
|---|---|
| R1 (`rpc-refused` written in two places), R2 (the era tail duplicates `shapeResult`) | needs-none: kept by ruling, recorded in architecture §10's `-2011` row |
| F1–F3 (row proofs moved with the code) | needs-none: fixed in `-2011` |

## What was built

- **`packages/core/src/provenance/`**, 444 lines in five files (`index.ts` included): `envelope.ts` (the contract, `canonicalBytes`,
  the pluggable `PayloadSchema` and the built-in alert schema), `signer.ts` (`ProvenanceSigner`,
  `signMessage`), `allowlist.ts` (`loadAllowlist`, `checkChannel`), `verify.ts` (`ProvenanceVerifier`),
  and `RULES.md` (PV-1…PV-9, each tied to its red-proof). It is exported from the core as one namespace,
  `provenance`, so its names never collide with `audit`'s `Signer` and `KeyEntry`. That is the one
  `index.ts` export line.
- **The wire is unchanged (N3).** `canonical_bytes`, `CONTEXT` and the field order are `-0102` §1.1's.
- **The vectors are byte-identical.** For each of `spikes/0102-envelope/vectors/option-a.json`'s four
  (`minimal`, `m5-nbsp`, `m5-composed`, `m5-decomposed`), `canonicalBytes` equals `signed_bytes_b64`
  and `signMessage`'s whole wire equals `wire_b64`, byte for byte, through the fixture signer, and
  the verifier accepts the oracle's wire. The fixture public key equals §1.1's and the oracle's.
- **53 tests** in `test/provenance/provenance.test.ts`, every refusal asserted by gate and check.
- **The signer contract** (PV-2; RULES.md *The signer contract*): `kid` and `sign(bytes)`. It returns
  the raw 64-byte pure-Ed25519 signature over exactly `canonical_bytes`, and rejects on failure. The
  module never asks for, reads or holds key material.

## Deletion rows: 42, every one RED by assertion

Every new row maps to §8 *Message provenance, three gates*. Each stub removes exactly its check, while
keeping the copy buildable. Four first stubs deleted a type guard along with the check, so the copy no
longer built and the runner reported MISS; they were rewritten to remove only the check. The coverage
detector passes, `--self-test` passes, and the ids are in `rows.lock`.

```
RED  provenance-size-cap | 1/1 named test(s) red by assertion | 2133 ms
RED  provenance-strict-utf8 | 1/1 named test(s) red by assertion | 2144 ms
RED  provenance-strict-parse | 1/1 named test(s) red by assertion | 2110 ms
RED  provenance-negative-zero | 1/1 named test(s) red by assertion | 2135 ms
RED  provenance-non-shortest-number | 1/1 named test(s) red by assertion | 2085 ms
RED  provenance-unknown-field-outer | 1/1 named test(s) red by assertion | 2088 ms
RED  provenance-unknown-field-envelope | 1/1 named test(s) red by assertion | 2166 ms
RED  provenance-version | 1/1 named test(s) red by assertion | 2160 ms
RED  provenance-origin-class | 1/1 named test(s) red by assertion | 2131 ms
RED  provenance-issued-at | 1/1 named test(s) red by assertion | 2092 ms
RED  provenance-integer-range | 1/1 named test(s) red by assertion | 2073 ms
RED  provenance-nonce-pattern | 1/1 named test(s) red by assertion | 2108 ms
RED  provenance-alert-unknown-field | 1/1 named test(s) red by assertion | 2148 ms
RED  provenance-signature-canonical | 1/1 named test(s) red by assertion | 2081 ms
RED  provenance-key-window | 1/1 named test(s) red by assertion | 2105 ms
RED  provenance-bad-signature | 1/1 named test(s) red by assertion | 2149 ms
RED  provenance-stale | 1/1 named test(s) red by assertion | 2092 ms
RED  provenance-future | 1/1 named test(s) red by assertion | 2129 ms
RED  provenance-replay | 1/1 named test(s) red by assertion | 2152 ms
RED  provenance-nonce-cache-full | 1/1 named test(s) red by assertion | 2063 ms
RED  provenance-clock-high-water | 1/1 named test(s) red by assertion | 2121 ms
RED  provenance-clock-on-accept | 1/1 named test(s) red by assertion | 2149 ms
RED  provenance-nonce-per-sender | 1/1 named test(s) red by assertion | 2103 ms
RED  provenance-remember-on-accept | 1/1 named test(s) red by assertion | 2088 ms
RED  provenance-author-listed | 1/1 named test(s) red by assertion | 2132 ms
RED  provenance-author-owns-key | 1/1 named test(s) red by assertion | 2099 ms
RED  provenance-effect-known | 1/1 named test(s) red by assertion | 2194 ms
RED  provenance-effect-floor | 1/1 named test(s) red by assertion | 2155 ms
RED  provenance-audit-refused | 1/1 named test(s) red by assertion | 2079 ms
RED  provenance-audit-accepted | 1/1 named test(s) red by assertion | 2124 ms
RED  provenance-allowlist-key-object | 1/1 named test(s) red by assertion | 2148 ms
RED  provenance-allowlist-public-pem | 1/1 named test(s) red by assertion | 2126 ms
RED  provenance-channel-authors-list | 1/1 named test(s) red by assertion | 2113 ms
RED  provenance-allowlist-duplicate-kid | 1/1 named test(s) red by assertion | 2126 ms
RED  provenance-allowlist-inverted-window | 1/1 named test(s) red by assertion | 2076 ms
RED  provenance-allowlist-ed25519 | 1/1 named test(s) red by assertion | 2080 ms
RED  provenance-allowlist-kid-pattern | 1/1 named test(s) red by assertion | 2174 ms
RED  provenance-allowlist-sender-pattern | 1/1 named test(s) red by assertion | 2078 ms
RED  provenance-allowlist-window-integers | 1/1 named test(s) red by assertion | 2072 ms
RED  provenance-channel-floor | 1/1 named test(s) red by assertion | 2130 ms
RED  provenance-signer-64-bytes | 1/1 named test(s) red by assertion | 2097 ms
RED  provenance-serialization-surrogate | 1/1 named test(s) red by assertion | 2135 ms
```

**15 reasoned exemptions** (`exempt.json`), each saying why no honest single-check stub exists:
- **Inside `json.ts` (protected):** the duplicate-key closure, whose honest deletion is the strict
  parse, the row `provenance-strict-parse`; the depth bound; and a lone surrogate on the wire.
- **Layers, where another named check refuses the same input:** a top level or envelope that is not an
  object; `unsigned` and `missing-field`; the `sender-id` and `key-id` patterns, where the
  allowlist's patterns and gates 1 and 2 refuse; `alert-shape` and `alert-missing-field`;
  `alert-severity`, where `unknown-effect` refuses; the allowlist's parse and public-key checks.
- **Fail closed by exception rather than by name:** `alert-text`; the signature's presence;
  `unknown-key`.
- **Belt-and-suspenders, labelled at the site:** gate 1's key-type assertion, behind the allowlist's
  Ed25519 rule.
- **No security role:** the channel name and author pattern.
- **Not a line:** the gate order (PV-9), proven by its own test.

## Adversarial pass (WO §5)

A fresh subagent (Opus, for judgement on a security path) was given the src diff, WO §1–§2 and §5, and
`-0102` §1.1, and ran probe scripts against the module. It found **six breaks, all fixed in this PR**
(`f135bc1`), each with a red-proof and a deletion row:

1. **Accepted what it must refuse: a non-Ed25519 key from plain JSON configuration.**
   - `keyOf` passed any non-string through. A key-shaped object,
     `{type: "public", asymmetricKeyType: "ed25519", format: "jwk", key: <RSA JWK>}`, cleared both
     type checks, the label read as plain properties, and `edVerify` took it as a key spec. An
     RSA-signed message was accepted. P-256 was too, with `dsaEncoding`.
   - Now a non-string must be a genuine `KeyObject` (`provenance-allowlist-key-object`). Gate 1's
     belt checks `instanceof KeyObject` as well.
2. **A private key's PEM loaded as its public half**, contradicting PV-2. Now only SPKI public-key PEM
   text loads (`provenance-allowlist-public-pem`).
3. **Integer malleability for a pluggable schema.** A wire integer past 2^53−1 parses to a different
   integer than it spells: `9007199254740993` reads as `…992`, and was accepted under a `…992`
   signature. Now it is refused as `integer-range` (`provenance-integer-range`). The alert schema was
   not affected, since its integers are range-checked.
4. **Wrong gate named: nonce squatting.** One accepted author sending another's nonce first made the
   genuine message refuse as `replay`. Nonces are now held per sender
   (`provenance-nonce-per-sender`).
5. **Clock poisoning by a refused message.** The high-water reading advanced before the gates
   finished, so an authentic old wire checked at a far-future `now` locked out the present. Now it
   advances only on accept (`provenance-clock-on-accept`). An *accepted* message at a wrong `now`
   still moves it; that is recorded as a known limit in RULES.md.
6. **Throws instead of refusing.** The key-spec object made every message for its kid throw; fixed by
   (1). A channel without `authors` threw a `TypeError` and is now refused by name
   (`provenance-channel-authors-list`). The others are caller-typed (`wire` not bytes, a schema
   returning a non-string) and left as programming errors.

**Held, run by the subagent:**
- JSON escapes in fields and keys (the signature covers decoded values, by contract); a kid that
  extends another; every window boundary in both directions.
- Replay with other content or on another channel, at a full cache, and at exactly `issued_at + 300`.
- NUL bytes and fake length prefixes inside text; the size cap at 16,384 and 16,385 bytes.
- `01`, `1e400`, `-1`, `__proto__` and `constructor`; mutating `authors` after construction.
- The number scanner against `-0 1.0 1e0` inside strings and escapes; audit fields only
  pattern-checked; the verifier always loads its own allowlist.

**Recorded limits** (RULES.md *Known limits*): replay across a restart; no channel binding in
`canonical_bytes` (the contract's); an accepted message at a wrong future `now`; the refusal line's
`sender` is an unauthenticated claim.

## Gates

- The provenance suite: 53 of 53. `tsc` and `npm run lint` are clean. The coverage detector passes,
  `control-deletion --self-test` passes, and every row above is RED by assertion.
- Leak gate: `--self-test`, `--tree` and `--history` exit 0 before each push. The fixture key is the
  `-0102` fake seed, written as a byte pattern. Every `sender_id` and `kid` is `*.example` or `test-*`.
- Protected surfaces against `bd99b50`: `docs/`, `scripts/` and `.github/` diff to empty, and no
  existing stub changed. In `packages/*/src`, only `provenance/` and the one `index.ts` export line
  changed. `json.ts` is used, not changed.
- CI: green on `15b4b59` (push run 46142395997, pull_request run 46142399442), with control-deletion
  shards taking 101–214 s, under five minutes.
- Reduction pass (diff): the spike's `NonceStore`, `parseJsonBytes`, `wellFormedDeep` and the
  B/C-only helpers were not carried over. The verifier keeps one key-shape helper (`keyProblem`), which
  both levels and the payload use. Nothing left to remove: −0 net · 0 duplicates removed · 0 dead
  paths · 1 protected kept (gate 1's labelled key-type belt) · 0 findings.

## Deliberately not built

- A transport route or any ingress for messages; key generation and custody, and any non-test signer;
  manifest signing and audit checkpoints (other WOs); the teaching tour (`-2005`).
- Persistence of the nonce memory (the restart limit above).
