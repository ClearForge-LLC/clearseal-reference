# CSR-WO-1005a — Transport corrections from the `-0101` spike: a pool that closes, and a clean refusal for MRTR under the legacy era

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD; the
base must contain `spikes/0101-approval`).
**Branch:** `wo/CSR-WO-1005a`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P1 · **Phase exit gate (the clause this WO owns):** none new — it repairs two defects in
`-1005`'s substrate that the next spike measured.
**Grounds:** `docs/architecture.md` §5 rows *Transport hardening*, *Protocol revision*; §8 row
*Stateless transport*; `-0101` FEEDBACK ("one finding for the core" and the MRTR-under-legacy row);
`-1005` SPEC-MAP.

> **What this is:** two small repairs. The validation worker pool `-1005` introduced is never
> closed, so a Node process that has closed its server stays alive past a ten-second timeout
> despite `unref()` — a defect every edition's service manager would meet at shutdown. And a
> handler returning `resultType: "input_required"` to a request that arrived on the legacy era
> produces a `500`: the older protocol has no MRTR, and the transport must refuse that cleanly,
> not crash the response. It is NOT the approval gate, NOT the Tasks extension, and NOT a change
> to any limit.

**Cadence:** build. One PR, left unmerged for review.

## 1. Scope — numbered, specific

1. **Pool lifecycle.** The validation pool is owned by the server instance and closed when the
   server closes; `server.close()` resolves only after the workers have exited. A test starts a
   server, closes it, and asserts the process's active handles are back to the baseline within
   two seconds — the measurement the spike could not make from outside the core.
2. **MRTR under the legacy era.** When a handler returns an `input_required` result and the
   request's era is `2025-11-25`, the transport answers a JSON-RPC error — code and message per
   the schema page's nearest fit (record which; `-32601`-family if the schema has nothing closer),
   never `500` — and logs the tool name at the seam. A test asserts it, and SPEC-MAP gains the
   line.
3. **The Tasks extension, recorded not built.** FEEDBACK lists the three core changes the spike
   said the extension would need, each as one line, so `-2001` can decide with the cost known.
4. **`FEEDBACK.md`** per §6.

## 2. Invariants

- **N4** — a legacy-era request can never receive a `500` for a modern-only result; refusal is a
  proper error.
- **N5** — both repairs have a red-proof (comment out the close → the handle test fails; remove
  the era check → the `500` returns).

**Protected surfaces — must diff to empty:** the four steering documents, `LICENSE`, `NOTICE`,
`scripts/**`, `.github/**`, `spikes/**`, every file under `packages/core/src` other than the
transport's server lifecycle and the result-mapping path, `packages/core/test` may grow only.

## 3. Tests / acceptance

1. `npm run check` green on both runners.
2. The handle-count test pasted, with the number before and after `close()`.
3. The legacy-era MRTR refusal pasted: status, content type, code, message.
4. Both red-proofs pasted.
5. The three Tasks-extension changes listed in FEEDBACK.

## 4. Scope fence

- **Any approval logic, `requestState` semantics, or the spike's own harness.** `-2001`.
- **Implementing the Tasks extension.**
- **Any limit or default.**

## 5. Adversarial pass

1. Close the server while a validation is in flight; confirm the in-flight request completes or
   fails cleanly and the process still exits.
2. Send a legacy-era call to a fixture tool that returns `input_required` *and* an oversized
   result; confirm the era refusal wins and nothing is streamed.

## 6. Upward-feedback directive

`FEEDBACK.md`: gates line, the two pastes, the Tasks list, what did not work, what was not built.

## 7. Flag-and-stop conditions

- Closing the pool requires changing a limit's behaviour.
- A protected surface must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-1005a` off current `main` where the validation pool closes with the server
> and a test proves the process's handles return to baseline within two seconds, a legacy-era
> request that reaches an `input_required` result gets a proper JSON-RPC error instead of a `500`
> with a test and a SPEC-MAP line, the Tasks extension's three required core changes are listed in
> FEEDBACK, `npm run check` is green on both runners, and the work is parked as one unmerged pull
> request. Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-1005a origin/main`. Node 24.21.0. Cadence:
> **build**, small. Read `docs/work-orders/CSR-WO-1005a.md` in full and the two findings in
> `-0101`'s FEEDBACK it repairs. Two repairs with red-proofs, one list, nothing else; protected
> surfaces per WO §2. Leak gate before every push. Report the PR link and the two pastes.
