# Provenance: a class-5 message is signed through an isolated signer, and accepted only through three gates (CSR-WO-2004)

Architecture §5 *Message provenance*, ruled 2026-09-25: **Option A**, the field contract of
`CSR-WO-0102` §1.1 byte for byte with a pluggable payload, its three open encoding decisions closed on
the verifier side (duplicate keys, non-shortest numbers, `-0`), so the wire is unchanged and a verifier
already in the field accepts what this core signs. §5 *Key identity and rotation*: every allowlist entry
carries a `kid` and a validity window, and rotation is an append. §8 *Message provenance, three gates*:
unsigned → refused; an unlisted author → refused; a valid signature requesting an above-floor effect →
refused.

The module is carried over from `spikes/0102-envelope/` (`common.ts`, `option-a.ts`): the gates and
their order are the spike's. It is not an ingress: nothing in the transport routes a message to it.

## The wire (PV-1)

`{"envelope":{v, sender_id, origin_class, key_id, issued_at, nonce, <payload key>: {...}}, "signature":
"<standard base64 of 64 bytes>"}`. The signature is Ed25519 over

```
canonical_bytes = CONTEXT ‖ for each field in the fixed order: uint32_be(byte_length(utf8(value))) ‖ utf8(value)
CONTEXT (alert schema, 31 bytes): "ClearSeal/M6-alert-envelope/v1\x00"
fixed order: v · sender_id · origin_class · key_id · issued_at · nonce · alert.severity · alert.text
```

Integers are written in shortest decimal form; strings as given, with no normalization on either side.
A payload schema (`PayloadSchema`) supplies its key, its CONTEXT, its fields' values in order, its own
strict parse and the effect it requests; the built-in one is the alert shape. Any change to the field
list or the framing bumps CONTEXT's `v1`.

## The signer contract (PV-2)

`ProvenanceSigner = { kid, sign(bytes) }`, written against without reading this module:

- `kid` is the allowlist entry whose public key verifies what `sign` returns.
- `sign` receives `canonical_bytes` exactly and resolves to the raw 64-byte Ed25519 signature over them:
  RFC 8032 pure Ed25519, no prehash, no context string. It must not alter, hash or frame the bytes.
- It rejects rather than resolves on any failure. `signMessage` refuses anything but 64 bytes back
  (`SignerError`).
- The module never asks for, reads or holds a private key. The one implementation ships in `test/`
  (the `-0102` fixture key, a fake seed written as a byte pattern). An OS keystore, a separate process
  or hardware is a port's implementation of this interface.

## Rules

| Rule | Statement | Red-proof (`test/provenance/provenance.test.ts`) |
|---|---|---|
| PV-1 | The module signs to the committed vectors' bytes: canonical bytes and whole wire, and verifies them. | *PV-1 \<vector\>* for each of `spikes/0102-envelope/vectors/option-a.json`'s four |
| PV-2 | Signing goes through `ProvenanceSigner` only, on exactly `canonical_bytes`; a signer returning other than 64 bytes is refused; a lone surrogate is refused at serialization. | *PV-2* (three) |
| PV-3 | **Structure**, before any gate, each refusal named: `too-large` (over `MAX_WIRE_BYTES`, before decoding); `malformed` (not strict UTF-8, a BOM, not JSON, not an object); the core's strict parser's `duplicate-key`, `depth` (over `MAX_WIRE_DEPTH`) and `lone-surrogate`; `negative-zero`, `non-shortest-number` (any number with a fraction or exponent) and `integer-range` (an integer past 2^53−1, which reads as a different integer than it spells); `unknown-field`, `unsigned`, `missing-field`; `version` (`v` not the integer 1); `sender-id`, `key-id`, `origin-class`, `issued-at`, `nonce` (each against `-0102` §1.1); the payload's own checks (`alert-shape`, `alert-unknown-field`, `alert-missing-field`, `alert-severity`, `alert-text`); `signature-encoding` (not canonical base64 of 64 bytes). | one test per check, by name; *integer-range* with a pluggable integer field |
| PV-4 | **Gate 1, signature**: the entry for `kid` (`unknown-key`), `now` inside its inclusive window (`key-window`), its key Ed25519 (`key-type`; the algorithm is never taken from the message), the signature over `canonical_bytes` **recomputed from the parsed fields** (`bad-signature`), `issued_at` no more than 300 s behind the verifier's clock (`stale`) and no more than 60 s ahead (`future`), the nonce unseen (`replay`) and storable (`nonce-cache-full`). | *unknown-key*, *key-window* (both edges, and exactly at each bound), *bad-signature* (three), *stale*, *future*, *replay*, *nonce-cache-full* |
| PV-5 | **Gate 2, author**: the sender is on the channel's author list (`not-listed`) and owns the selected key (`key-not-authors`). **Gate 3, effect**: the payload's effect is one the floor ordering knows (`unknown-effect`) and at or below the channel's floor (`above-floor`). Each gate refuses with the others passing. | *not-listed*, *key-not-authors*, *above-floor*, *unknown-effect* |
| PV-6 | The allowlist is plain data `{kid, sender_id, publicKey, notBefore, notAfter}`. The key is SPKI public-key PEM text or a genuine `KeyObject`: a key-shaped plain object, which node:crypto would take as a key spec in any format, and a private key's PEM, which would load as its public half, are refused. Loading refuses a duplicate `kid` (rotation adds a `kid`), an inverted window, a key that is not Ed25519 (RSA, P-256 and X25519 tried), and a `kid`, sender or window outside the contract. A channel with an unknown floor, or without an authors list, is refused. | *the allowlist (PV-6)* |
| PV-7 | A nonce is remembered only when a message is **accepted**, until `issued_at + 300`, and **per sender**: one author sending another's nonce first never blocks the other's message. The memory holds at most `maxNonces` (default `DEFAULT_MAX_NONCES`); when it is full after expired nonces are forgotten, a new message is refused (`nonce-cache-full`), never admitted by evicting one, since eviction reopens a replay inside the window. The verifier's clock never runs behind its latest **accepted** reading, so a clock stepped back does not make a stale message fresh; a refused message moves nothing, so a wrong `now` on one cannot lock the verifier out. | *replay* (a refused message's nonce is not remembered), *replay is per sender*, *nonce-cache-full*, *stale: the clock never runs behind*, *the clock moves only on accept* |
| PV-8 | Every verdict writes one audit line: `provenance-refused {gate, check, sender?, kid?}`, or `provenance-accepted {sender, kid, effect}`. `sender` and `kid` appear only once they have matched the contract's pattern; no other message content is written. | *baseline*, *every refusal writes one line* |
| PV-9 | The order is fixed (structure, signature, author, effect) and the first refusal wins, naming its gate. | *the order is fixed* |

## Limits, and how they were chosen (CSR-WO-2004 FEEDBACK)

| Constant | Value | Why |
|---|---|---|
| `MAX_WIRE_BYTES` | 16,384 | Measured on Furnace: under it a verify costs 70–76 µs, the signature check dominating; decoding, parsing and Ed25519 grow linearly past it (2.4 ms at 1 MiB, 22 ms at 8 MiB). An alert is a short human message; 16 KiB holds about 16,000 characters of text. Refused before decoding (under 1 µs at any size). |
| `MAX_WIRE_DEPTH` | 8 | The alert message is 3 deep; a pluggable payload gets room, and no more. |
| `DEFAULT_MAX_NONCES` | 10,000 | About 510 B per 128-character nonce (5 MiB at the bound); a full prune at the bound took 1.7 ms. A nonce is held for 300 s (+60 s skew), so the bound sustains about 27 accepted messages a second per verifier, far above a class-5 alert rate. |

## Inputs to the decision (standard §9 step 6)

| Input | Class | Control |
|---|---|---|
| The wire bytes | unpinned, refused unless every PV-3 check passes | structure (PV-3), then gate 1's signature over recomputed bytes (PV-4) |
| The allowlist and channels | out of scope, with a named control | the operator's configuration, checked at load (PV-6) |
| `now` | out of scope, with a named control | the caller's clock, held to its latest reading (PV-7) |
| The algorithm | **fixed** | Ed25519 only; never read from the message (PV-4) |

## Known limits

- **A caller's clock jumping forward on an accepted message.** The reading advances on accept (PV-7), so
  a message accepted at a far-future `now` makes later messages at the true time stale until real time
  catches up. `now` is the caller's clock, a named input.
- **No channel binding.** `canonical_bytes` carries no channel (the contract's), so a message accepted on
  one channel is valid on another verifier's channel with the same author and floor. Nonces are per
  verifier.
- **The refusal line's `sender`** on a gate-1 refusal is the message's claim, unauthenticated; it has
  matched the pattern and nothing more.
- **Replay across a restart.** Nonces live in the verifier's memory. A verifier restarted inside a
  message's freshness window would accept it again. Persistence, or refusing messages issued before the
  process started, is a later decision (CSR-WO-2004 FEEDBACK).
