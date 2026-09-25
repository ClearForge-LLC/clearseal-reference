# CSR-WO-0102 — Spike: which class-5 envelope the core should sign

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD).
Independent of `-0100` and `-0101`; may run before or after them.
**Branch:** `wo/CSR-WO-0102`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P0 · **Phase exit gate:** the §2.3 row on the envelope replaced with a measured value.
**Grounds:** `docs/architecture.md` §2.3, §5 rows *Message provenance (class 5)* ("do not decide
the envelope yet — spike it"), *Key identity and rotation*, *Canonical form* (the M5 lesson);
§7.1 row *A forged inter-node message*; §8 row *Message provenance, three gates*;
`docs/roadmap.md` P2 (`-2004`). The interoperability target is reproduced in §1.1 below.

> **What this is:** three candidate envelopes implemented side by side, each with the same three
> fail-closed gates, measured against one target: **a verifier that already exists in the field
> and whose contract is fixed.** Option A is that contract, byte for byte, with the payload made
> pluggable. Option B is RFC 9421 HTTP message signatures. Option C is a detached JWS. The spike
> measures interoperability, canonicalization surface, cross-language reproducibility, and
> implementation size — and reports; the architect rules. It is NOT the provenance module, NOT a
> key-management design, and NOT a ruling. Why now: the reference node's own history recorded a
> silent verification break from one whitespace character; the envelope choice decides how many
> such places exist.

**Cadence:** spike — implement, measure, **STOP**.

## 1. Scope — numbered, specific

### 1.1 The interoperability target (Option A's contract, reproduced)

A signed message is `{ "envelope": {...}, "signature": "<base64 Ed25519, 64 bytes>" }`. The
signature is over `canonical_bytes(envelope)`, **not** over JSON:

```
canonical_bytes = CONTEXT ‖ for each field in FIXED ORDER: uint32_be(byte_length(utf8(value))) ‖ utf8(value)
CONTEXT (31 bytes): "ClearSeal/M6-alert-envelope/v1\x00"
FIXED ORDER: v · sender_id · origin_class · key_id · issued_at · nonce · alert.severity · alert.text
```

Fields: `v` integer, must be `1` (anything else refused, never best-effort parsed); `sender_id`
and `key_id` match `[a-z0-9][a-z0-9._-]{1,63}`; `origin_class` is `"system"` for node-originated
messages; `issued_at` epoch seconds, `0 ≤ t ≤ 2^53−1`, freshness window ±300 s with +60 s future
skew; `nonce` matches `[A-Za-z0-9_-]{16,128}`, unique per message, remembered for the freshness
window only; `alert.severity` one of `info` · `warn` · `critical` · `confirmed_attack`;
`alert.text` free string. **No other key may appear** at either level; an unknown field is a
refusal. Integers serialize in shortest decimal form. Strings are used **as given** — no Unicode
normalization on either side, ever. UTF-8 strict; a lone surrogate is refused. If the field list
or framing changes, the trailing `v1` in CONTEXT is bumped so old and new fail loudly.

Fixture keypair (fake, tests only) — the 32-byte Ed25519 seed is, in order: eight `0x00` bytes,
eight `0xd0` bytes, eight `0x0d` bytes, eight `0x00` bytes (written out as a byte pattern rather
than a hex string so the leak gate's long-hex rule is not tripped by a fake key); its public key
is base64 `qikRoPRLUGmP2QuEpKRSJLhCB33v3l7Hcoi8vK6tTtY=` — the builder derives it and asserts
equality as the first test. **Vector 1 — `minimal`**, `canonical_len = 149`:
`{"v":1,"sender_id":"node.alerter-example","origin_class":"system","key_id":"test-fixture-key","issued_at":1787700000,"nonce":"AAAABBBBCCCCDDDD","alert":{"severity":"info","text":"all clear"}}`
— **note:** the field verifier's fixture used a different `sender_id`; the canonical length and
signature below therefore differ from the field vector and must be **re-derived** by the builder
with the fixture key: the *shape* is the target, and reproducing the field vector exactly is not
possible without its sender id, which is a deployment identifier and stays out (N6). The builder
generates and commits this repository's own vectors from the same key.

### 1.2 Deliverables

1. **`spikes/0102-envelope/`** — private workspace package. Three modules, one per option, each
   exporting `sign(payload, key) → wire` and `verify(wire, allowlist, floor) → accepted | refusal`,
   with the **same three gates** in the same order: (1) signature over the canonical bytes with the
   key selected by `key_id` from an allowlist entry that carries `kid` and a validity window; (2)
   author on the allowlist for that channel; (3) requested effect at or below the channel's floor.
   Each gate refuses independently and names itself in the refusal.
   - **A** — the §1.1 contract with `alert` generalized to a pluggable payload schema; the
     built-in schema is the alert shape above so the target verifier would accept it.
   - **B** — RFC 9421 HTTP message signatures over an HTTP request carrying the same payload as a
     JSON body: covered components, `@signature-params`, `created`/`expires`/`nonce`/`keyid`.
   - **C** — a detached JWS (`EdDSA`) over the same payload with the header carrying `kid` and the
     protected claims carrying `iat`/`exp`/`jti`; compact serialization with the payload detached.
2. **Cross-language vectors.** For each option, a Python generator (committed under the spike, a
   test oracle — not a control, per northstar §4's scope note) produces signed vectors from the
   fixture key; the TypeScript verifier must accept them and the TypeScript signer's output must
   be byte-identical to the generator's for the same inputs. Include the M5 case for each: a
   payload string ending in U+00A0, and one containing U+0301 (a combining mark) both composed
   and decomposed — the vector must show the bytes signed, and A must show *no* normalization
   occurred.
3. **Negative tests, per option:** unknown field → refused; wrong `v` → refused; expired →
   refused; replayed nonce → refused; author not on allowlist → refused; effect above floor →
   refused; key outside its validity window → refused; lone surrogate → refused at
   serialization; signature valid but over *different* canonical bytes (one flipped byte) →
   refused.
4. **Measurement table** in FEEDBACK — for each option: implementation lines; number of
   normalization or canonicalization decisions an implementer must make (list them); whether a
   second-language implementation matched on the first attempt; the size of the dependency tree
   the option needs (A: none expected beyond the runtime's crypto; B and C: name them); the
   wire size of the `minimal` vector; and whether the field verifier (A's contract) would accept
   the output *unchanged* — yes only for A by construction; say what B and C would need.
5. **`FEEDBACK.md`** per §6.

## 2. Invariants — restated by number from the northstar

- **N1** (scope note) — the Python generators are test oracles, not controls; they live under the
  spike and are named as oracles.
- **N3** — every vector is generated by the *other* runtime; the TypeScript side never generates
  the bytes it is checked against.
- **N6** — no field sender id, key id, channel name, or node name appears; `sender_id` values in
  every vector are synthetic. Leak gate before every push.
- **N8** — the fixture key is the fake one above and nothing else; no key material is generated
  and committed.

**Protected surfaces — must diff to empty:** the four steering documents, `LICENSE`, `NOTICE`,
`packages/**`, `scripts/**`, `.github/**`, other spike directories.

## 3. Tests / acceptance — what must be proven, not asserted

1. `npm run check` green with the spike package (its tests run under `node --test` — this spike
   *does* have a `test/` directory, because the negative tests are the measurement).
2. For each option: the Python-generated vectors verify in TypeScript; the TypeScript signature
   over the same inputs is byte-identical to the generator's; pasted `cmp`/hash output.
3. Every negative case in §1.2.3 is a failing test that goes red when its gate is commented out
   (do it for one gate per option and paste).
4. The M5 vectors pasted with the exact bytes, per option, showing where normalization did or did
   not happen.
5. The measurement table complete, with the dependency listing for B and C.

## 4. Scope fence — what is NOT in this work order

- **Choosing.** The architect rules from the table; the builder may state a preference under
  *opinion*.
- **Key generation, storage, rotation tooling, or the anchor sink.** `-2004` and later.
- **Wiring any option into a transport, an audit checkpoint, or a tool.** `-2004`.
- **Bringing in a JOSE or HTTP-signature library as a runtime dependency of `packages/core`.**
  The spike may depend on one to measure it; that is a measurement, not a decision.

## 5. Adversarial pass

1. Feed each verifier a message whose JSON has duplicate keys (`{"v":1,"v":2}`); record which
   value each option signs and verifies — a parser-dependent answer is a finding.
2. For A, craft two different envelopes with the same canonical bytes (they should not exist —
   prove it, or find one).
3. For B, vary header whitespace and casing in a signed request; record what still verifies.
4. For C, present a token with `alg: none` and one with `alg: HS256` keyed with the public key;
   both must be refused.
5. Time the verify path for each at 10,000 iterations.

## 6. Upward-feedback directive

`FEEDBACK.md`: lead with the **measurement table** and the three M5 vectors. Then the negative
test list with one red-proof paste per option. Then, labelled *opinion*: which option the builder
would choose and why, in five lines or fewer. Then the standard entries.

## 7. Flag-and-stop conditions

- Option B or C cannot be implemented without a runtime dependency that itself declares an
  install script or exceeds fifty transitive packages — implement what you can, record the count,
  and stop that option there; it is a finding.
- Any vector that would require a real key or a field identifier.
- A protected surface that must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-0102` off current `main` with a private spike package implementing three
> class-5 envelope options behind the same three fail-closed gates, cross-language vectors
> generated in Python and verified in TypeScript for each including the M5 cases, the full
> negative-test list per option with red-proofs, a measurement table, `npm run check` green, and
> the work parked as one unmerged pull request. Implement, measure, STOP. Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-0102 origin/main`. Cadence: **SPIKE** —
> implement three options, measure, stop; no ruling, no core code. Read
> `docs/work-orders/CSR-WO-0102.md` in full — §1.1 is the interoperability target and §1.2.3 the
> negative list — and `docs/architecture.md` §5 (*Message provenance*, *Key identity and
> rotation*, *Canonical form*). Vectors come from the Python oracle, never from the TypeScript
> side; every `sender_id` is synthetic; the fixture key is the fake one in the WO and nothing
> else. Leak gate before every push. Flag-and-stop: WO §7. Report the PR link and the
> measurement table.
