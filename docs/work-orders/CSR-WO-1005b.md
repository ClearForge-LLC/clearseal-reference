# CSR-WO-1005b — Legacy-era JSON-RPC errors at HTTP 200: each era served by its own conventions

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD; the
base must contain `-1005a`'s SPEC-MAP line LG-8).
**Branch:** `wo/CSR-WO-1005b`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P1 · **Grounds:** `docs/architecture.md` §5 rows *Protocol revision* ("the legacy
handshake … as a pure function"), *Transport hardening*; `-1005a` FEEDBACK finding F7 and the
architect's ruling on PR #27; the `2025-11-25` Streamable HTTP page (a JSON-RPC error for a
well-formed request is a `200` with the error object) versus the `2026-07-28` transport page
(specific refusals mapped to `4xx` explicitly).

> **What this is:** one rule change, measured into existence. The official SDK client — which is
> what a `2025-11-25` client *is* — drops the JSON-RPC error body at HTTP `400` and raises a bare
> transport error; at `200` it surfaces the proper code and `data`. So the transport's rule
> "client-correctable errors get `400`" is right for the modern era, whose page says so, and wrong
> for the legacy era, whose convention is `200` plus the error object. This WO makes the status
> mapping **era-dependent**. It is NOT a change to any refusal's code, message, or gate, and NOT a
> change to HTTP-level refusals.

**Cadence:** build, small. One PR, left unmerged for review.

## 1. Scope — numbered, specific

1. **Era-dependent status mapping.** For a request whose era is `2025-11-25` and whose body
   parsed as a well-formed JSON-RPC request (an `id` exists), every JSON-RPC error the transport
   or a handler produces — unknown method, invalid params, validation failure, result too large,
   the LG-8 MRTR refusal, handler timeout — is returned with HTTP `200`, `application/json`, the
   error object unchanged. The modern era is untouched.
2. **HTTP-level refusals unchanged in both eras:** `401`/`403` (verifier, `Origin`, `Host`),
   `405`, `406`, `400` for a body that is not a single well-formed JSON-RPC message (malformed,
   batch, response-shaped, oversize, over-depth), `400` for version/header mismatches, `503` for
   the concurrency cap. These never carried a usable JSON-RPC `id` or are transport refusals the
   legacy page itself puts at the HTTP layer.
3. **SPEC-MAP:** the mapping table gains an era column; LG-8 is updated; one line cites the legacy
   page's sentence on error responses and one the modern page's explicit `4xx` cases.
4. **The `-0101` spike assertion** that pins `[400, -32601]` for the legacy MRTR call moves to
   `[200, -32601]` — the one permitted change under `spikes/**`, recorded as D-1.
5. **Measured, not asserted:** a test drives the official SDK client (dev dependency, pinned
   exactly, in `packages/core/test` only — the runtime import ban stands) against the transport
   in the legacy era and asserts it receives a JSON-RPC error with the `-32601` code and `data`,
   and a second test asserts the same call at `400` would have lost them (the before-state,
   proven with the mapping switched off). This is the F7 measurement, kept as a regression test.
6. **`FEEDBACK.md`** per §6.

## 2. Invariants

- **N4** — nothing that was refused becomes accepted; only the HTTP status of already-refused
  legacy calls changes.
- **N5** — the mapping has a red-proof (switch it off → the SDK-client test fails).
- **N6/N8** — unchanged; no credential, no identity.

**Protected surfaces — must diff to empty:** the four steering documents, `LICENSE`, `NOTICE`,
`scripts/**`, `.github/**`, `spikes/**` except the one assertion in §1.4, every file under
`packages/core/src` other than the transport's response-mapping path and SPEC-MAP.

## 3. Tests / acceptance

1. `npm run check` green on both runners.
2. The SDK-client test output pasted: code and `data` present at `200`; lost at `400`.
3. A table in FEEDBACK: every error the transport can produce × era × status, pasted from the
   test that enumerates them.
4. `--history` clean after the pin of the SDK as a dev dependency (its tree measured and pasted).

## 4. Scope fence

- **Any change to a refusal's code, message, or the gates that produce it.**
- **The modern era's mapping.**
- **Importing the SDK anywhere but `packages/core/test`.**

## 5. Adversarial pass

1. A legacy-era request with an `id` of `null`; confirm it is treated as a notification-shaped
   error, not given a `200` with `id: null`.
2. A legacy-era body that is a JSON-RPC *response* with an `id`: still `400`.
3. Confirm the modern-era table is byte-identical before and after.

## 6. Upward-feedback directive

`FEEDBACK.md`: the era × error × status table first; the SDK-client pastes; the dev-dependency
tree size; the standard entries.

## 7. Flag-and-stop conditions

- The legacy page turns out to require `4xx` for a case §1.1 lists — record the sentence, stop
  that case.
- A protected surface must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-1005b` off current `main` where legacy-era JSON-RPC errors for well-formed
> requests return HTTP 200 with the error object unchanged, HTTP-level refusals and the modern era
> are untouched, SPEC-MAP carries an era column, the `-0101` assertion reads `[200, -32601]`, a
> test drives the official SDK client (test-only dev dependency) and proves it receives the code
> and data at 200 and loses them at 400, `npm run check` is green on both runners, and the work is
> parked as one unmerged pull request. Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-1005b origin/main`. Node 24.21.0. Cadence:
> **build**, small. Read `docs/work-orders/CSR-WO-1005b.md` in full and `-1005a`'s FEEDBACK F7.
> One rule made era-dependent, HTTP-level refusals untouched, the SDK only as a test-only dev
> dependency pinned exactly, one spike assertion moved. Protected surfaces per WO §2. Leak gate
> before every push. Report the PR link and the era × error × status table.
