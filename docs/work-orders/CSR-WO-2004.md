# CSR-WO-2004 — Message provenance: a signed envelope, an isolated signer, and three fail-closed gates

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD; it must
contain `-2011`'s merge and the docs PR that adds this work order).
**Branch:** `wo/CSR-WO-2004`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P2 · **Phase exit gate:** *"every control in `architecture.md` §8 through the provenance row
is built with its red-proof"* (`docs/roadmap.md` P2). This is that row.
**Security-critical** (roadmap *Process*): line-by-line review, never batched, and an **external red
team (the Adversary) before merge**. The builder parks the PR; the architect arranges the red team
with the gate.
**Grounds:**
- `docs/northstar.md` N1, N3, N5, N6, N7.
- `docs/architecture.md`:
  - §5 *Message provenance*, ruled 2026-09-25: Option A, with duplicate keys, non-shortest integers
    and `-0` / `1.0` / `1e0` refused verifier-side;
  - §5 *Key identity and rotation*: every allowlist entry carries a `kid` and a validity window;
  - §2.3, the `-0102` measurement row;
  - §7.1, the forged inter-node message;
  - §8 *Message provenance, three gates*.
- `docs/work-orders/CSR-WO-0102.md` §1.1, the field contract, reproduced there byte for byte.
- `spikes/0102-envelope/`:
  - `option-a.ts` and `common.ts`, the three gates as spiked;
  - the committed vectors and the Python oracle;
  - the 27 red-proofs.
- Seams:
  - `packages/core/src/transport/json.ts`, the strict parser (duplicate keys, depth, lone surrogate);
  - the audit sink;
  - `packages/core/src/index.ts`, the public exports;
  - `test/deletion/controls.json`.

> **What this is:** the core gains a `provenance` module. It signs a class-5 message through a small
> **signer interface** whose key can live outside the process, and it verifies a message through
> **three gates in a fixed order**. The first refusal wins and names its gate:
>
> 1. **signature:** a key selected by `kid` from the allowlist, inside its validity window, over the
>    canonical bytes, with the message fresh and its nonce unseen;
> 2. **author:** the sender is on this channel's author list and owns that key;
> 3. **effect:** the requested effect is at or below the channel's floor.
>
> The wire is Option A's field contract, unchanged, so a verifier already in the field accepts what
> this core signs. The spike's three open encoding decisions close **on the verifier side only**.
>
> It is NOT a network ingress for messages (nothing in the transport routes to it yet). It is NOT
> key custody or key generation for any deployment, and NOT manifest signing or audit checkpoints,
> which share the `kid`-and-window rule but are other work orders.

**Cadence:** build. One PR, left unmerged for review **and** the external red team.

## 1. Scope — numbered, specific

1. **The envelope (Option A, as ruled).**
   - `canonical_bytes` is exactly `-0102` §1.1: the 31-byte `CONTEXT`, then each field in the fixed
     order, each as a `uint32_be` length followed by its UTF-8 bytes.
   - The payload is pluggable. A payload schema supplies its fields' place in the fixed order and the
     **effect** it requests. The built-in schema is the alert shape, so the field verifier accepts it.
   - Strings are used as given, with no normalization on either side. A lone surrogate is refused.
   - Integers are serialized in shortest decimal form.
   - `v` must be `1`; anything else is refused and never parsed best-effort. Bump `CONTEXT`'s `v1` on
     any change to the field list or the framing.
2. **The signer interface, isolated.**
   - `Signer = { kid: string; sign(bytes: Uint8Array): Promise<Uint8Array> }`. The module never asks
     for a private key, never reads a key file, and never holds key material itself.
   - One implementation ships, under `test/` only: the fixture signer from `-0102`'s fake seed. Keep
     the seed written as a byte pattern, so the leak gate's long-hex rule holds.
   - Any other implementation (OS keystore, separate process, hardware) is a port's concern. Record
     the interface's contract so one can be written against it without reading this module.
3. **The verifier and its three gates**, `verify(wire, channel, now) → accepted | refusal`.
   - **Before gate 1: structure.**
     - Refuse past a size cap measured before parsing (choose it by measurement and record it).
     - Parse with the core's strict parser: duplicate keys, depth and lone surrogates are refused.
     - Refuse an unknown key at either level, a non-shortest integer, `-0`, `1.0` and `1e0`.
     - Check each field's pattern against `-0102` §1.1.
   - **Gate 1, signature.**
     - The allowlist entry is selected by `kid`, and `now` must fall inside its validity window.
     - The key must be Ed25519. Refuse any other key type by assertion, and never select an algorithm
       from the message.
     - The signature is checked over `canonical_bytes` recomputed from the parsed fields, never over
       received bytes.
     - `issued_at` must be inside ±300 s, with at most +60 s of future skew.
     - The nonce must be unseen.
   - **Gate 2, author.** `sender_id` is on the channel's author list, and the selected key is that
     sender's.
   - **Gate 3, effect.** The payload's requested effect is at or below the channel's floor.
   - **Nonce memory.**
     - A nonce is remembered only when a message is **accepted**, and only for the freshness window.
     - The cache is bounded. When it is full, a new message is **refused**, not evicted: eviction
       would reopen a replay inside the window. Use a distinct check name and an audit line.
   - **Refusals and audit.**
     - Every refusal names its gate and check and writes one audit line, with no message content
       beyond the sender, `kid` and gate.
     - Every accept writes one line: sender, `kid`, effect.
4. **The allowlist** is plain data: `{ kid, sender_id, publicKey, notBefore, notAfter }` entries, with
   a per-channel author list and floor.
   - Rotation is adding an entry with a new window, never editing one.
   - Loading refuses a duplicate `kid`, an inverted window, or a non-Ed25519 key.
5. **Vectors and red-proofs.**
   - The module signs the spike's committed vectors to the same bytes and verifies them.
   - Port every one of the spike's 27 red-proofs that applies to Option A, plus one per gate and one
     per §1.3 structure check.
   - Each refusal is asserted by its gate and check name, not by "it threw".
6. **Deletion rows.** One row per gate, one each for freshness, the nonce rule, the full-cache
   refusal and the three encoding closures, and one for the strict parse.
   - Each stub deletes exactly its check, and each `mustFail` turns red by assertion.
   - Map them to the §8 row so the coverage detector stays green.
7. **Exports and docs.**
   - The public surface goes into `packages/core/src/index.ts`, with a `provenance/RULES.md` in the
     style of the other modules, each rule numbered (PV-*n*) and tied to its red-proof.
   - The steering documents are not edited. The architect records the build in §8 and §10.
8. **`FEEDBACK.md`** per §6.

## 2. Invariants

- **N5:** every new row is red by assertion, and `--self-test` passes.
- **N6:** the leak gate runs before every push, and no real key, `sender_id` or other deployment
  identifier appears anywhere. Fixture values are fake and look fake.
- **N3:** the wire is byte-compatible with the field contract. A change to `canonical_bytes` is a
  flag-and-stop, not a build step.
- **Fail closed everywhere:** an unknown field, an unknown `kid`, an expired window, a full nonce
  cache or a parse doubt is a refusal. Nothing is accepted best-effort.
- **Protected surfaces, which must diff to empty:**
  - the steering documents, `scripts/**` and `.github/**`;
  - every existing stub;
  - every `src/**` module outside `provenance/` and the one `index.ts` export block. A helper
    shared with `json.ts` is a flag-and-stop.

## 3. Tests / acceptance

All of §1.5 and §1.6, with `--row` lines pasted. The vectors are byte-identical. `npm run check` and
every shard are green on CI, under five minutes.

## 4. Scope fence

- A transport route or any network ingress for messages.
- Key generation, key custody, or any non-test signer implementation.
- Manifest signing and audit checkpoints, which use the same `kid`-and-window rule but are other WOs.
- Changing the field contract, `CONTEXT`, or the alert schema's fields.
- The teaching edition's tour (`-2005`).

## 5. Adversarial pass, and the external red team

- **The builder's fresh-subagent pass** gets the diff, §1–§2 and `-0102` §1.1. It tries:
  - a signature that verifies over received bytes but not over recomputed ones;
  - `kid` confusion: one sender's `kid` used with another's key;
  - a window boundary, at exactly `notAfter` and at `issued_at` ±300 s and +60 s;
  - replay after a restart, and replay at a full cache;
  - a non-Ed25519 key slipped into the allowlist;
  - field reordering, an empty string, and the `uint32` length at its edges;
  - `-0`, `1.0`, `1e0`, `01`, and a duplicate key nested in the payload;
  - an effect name the floor ordering does not know.
- **The external red team (the Adversary)** runs on the parked PR before merge (roadmap *Process*).
  Its findings are reproduced, then ruled, fixed in this PR or deferred to a named WO, and recorded in
  FEEDBACK and §10.

## 5a. Reduction pass

Diff-sized.

## 6. Upward feedback

`FEEDBACK.md`, after promote-or-needs-none of `-2011`'s findings. Lead with:
- the size cap and the nonce-cache bound, with how they were measured;
- anything in the spike that did not carry over.

Then the standard schema, gates, and *deliberately not built*.

## 7. Flag-and-stop

- Any change to `canonical_bytes`, `CONTEXT` or the field order.
- A gate that cannot refuse independently of the others.
- A need to change `json.ts` or any `src/**` outside `provenance/`.
- A real key, a real `sender_id`, or any deployment identifier anywhere in the diff.

## 8. Kickoff prompt

`/goal`:
> A class-5 message is signed through an isolated signer interface on Option A's unchanged wire, and
> one is accepted only after passing, in order, the signature, author and effect gates, each refusing
> on its own and named, with every check red by assertion when deleted. Parked as one unmerged PR from
> wo/CSR-WO-2004 for review and the external red team; recorded exemptions are acceptable with their
> reasons.

Kickoff:
- **Sync:** sync from `main`, and confirm `-2011` and this WO are in it. Cadence: build.
- **Read first:**
  - this WO;
  - `-0102` §1.1, the contract;
  - `spikes/0102-envelope/common.ts` and `option-a.ts`, the gates as spiked, which you carry over
    rather than rewrite;
  - architecture §5 *Message provenance* and *Key identity and rotation*.
- **Commit identity and push path:** as on `-2011`.
- **Gates:** flag-and-stop is WO §7.
- **Check in at each green checkpoint:** push working state, since a usage limit can land mid-build.
- **Report:**
  - the PR link;
  - the vector byte-match;
  - the `--row` lines;
  - the size cap and nonce-cache bound with how each was chosen;
  - anything from the spike that did not carry over.
