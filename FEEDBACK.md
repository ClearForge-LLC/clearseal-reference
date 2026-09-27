# FEEDBACK: CSR-WO-2002 (the audit store behind the audit seam)

Branch `wo/CSR-WO-2002`, cut from `main` at `4a0bfa2`, where the WO lives (`-1007a` merged at
`31a2bf3`). Parked as one unmerged pull request. Built on Node v24.21.0. The gate was asleep, so every
choice the WO leaves open is made here, each with its reason. None of the §7 flag-and-stop
conditions arose.

## Read this first

- **Built, spec first.** `packages/core/src/audit/RULES.md` was written before the module: 25 rules
  (AU-1 to AU-25), each with its red-proof and its control-deletion row, plus the event/field table.
  The module is in `packages/core/src/audit/`:
  - `chain.ts`: the row and checkpoint formats;
  - `policy.ts`: the event table;
  - `digest.ts`: keyed digests;
  - `signer.ts`: the `Signer` and the allowlist;
  - `store.ts`: `AuditStore`, `AnchorSink`, the JSON-lines store, the file anchor and the in-memory
    anchor;
  - `verify.ts`: the verifier;
  - `config.ts`: `AUDIT_*` configuration;
  - `files.ts`: the operator-file checks;
  - `cli.ts`: `npm run audit -- verify`.
- **Wiring.** `node/start.ts` reads the audit configuration before the manifest, opens the store, and
  writes `manifest-loaded` as the run's first row. It closes the store after the transport, with a
  final checkpoint.
  - `transport/dispatch.ts` gains the one `tool-call` row, in a wrapper around the existing
    `runHandler`. Each exit point sets an outcome; no refusal's status, message or order changes.
  - `transport/server.ts` gains one option, `argumentDigest`, captured at start.
- **No protected surface changed.** `pinning/**`, `capability/**`, `containment/**`, `auth/**` and
  `test/boundary/**` diff to empty.
  - The canonical argument form is reused without touching any file. The digest is an HMAC over
    `argumentsDigest(args)`, the SHA-256 of the canonical argument JSON that the request-state
    binding already computes.
  - It is keyed, and equal arguments give equal digests. HMAC over a collision-resistant hash of the
    canonical form is as binding as HMAC over the form itself.
- **The adversarial pass found real gaps, and each one either became a rule or corrected RULES.md.**
  See the table below. The most important correction is to AU-12, the honest limit. The rows after
  the last checkpoint can be **rewritten, not only truncated**: the chain is a plain SHA-256, so
  anyone can recompute it. A restart then adopts those rows, and the next checkpoint covers them.
  - The adoption is now recorded: `audit-resumed` gives the count of unanchored rows adopted (AU-25).
  - The limit itself is the WO's design, and I did not change it. A keyed chain would not help
    against an attacker who already holds the service's keys.
  - RULES.md now says it plainly: an attacker who can **truncate** the anchor reopens what the lost
    checkpoints covered, and an attacker with the service's privilege can read the signing key and
    sign anything. The anchor's value is that someone else owns it.
- **One process slip, stated.** The control-deletion stub generator restores each file with
  `git checkout`, and I ran it before committing the hardening. That reverted four modules. I
  re-applied the same edits from their scripts and verified them: typecheck, lint, and every audit
  test green. I committed, and only then regenerated the stubs. The generator now refuses a dirty
  tree.

## Choices the WO left to me, with reasons

**§1.1, the row serialization.**
- A row is the core's canonical JSON: `pinning/canonical.ts`, JCS with sorted keys, no whitespace and
  one spelling per value. One row per line; `prev` is the SHA-256 of the previous line's exact UTF-8
  bytes; the first row's `prev` is sixty-four zeros.
- **Why:**
  - That form is already pinned and cross-language tested for the manifest, so a second
    implementation needs no new spec.
  - `audit verify` can prove that a line is the one serialization of its own content. It parses
    the line, refusing duplicate keys, re-serializes it, and treats any difference as a finding.
- The adversarial pass then showed that reading files as text let a byte-level respelling through
  (invalid UTF-8 became U+FFFD). Logs and anchors are now read as bytes and decoded strictly, so
  that case is a finding too.

**§1.4, the torn final line.**
- A missing final newline is `torn-final-line`, and `audit verify` exits 3 when it is the only
  finding: 0 is clean, 1 is tampering, 2 is a usage error.
- **Why:** the store writes each row in one write, line and newline together, so a crash can only
  cut the last line, while an edit in the middle shows as a chain or checkpoint break.
- After the adversarial pass: a tail that parses as a complete line is still checked. So removing
  a newline can never turn tampering into exit 3.
- The store refuses to start on a torn log, so the operator looks before the log grows.

**Also chosen here:**
- Checkpoints default to every 100 rows or 300 seconds, and on close.
- A checkpoint's `seq` counts checkpoints, and `count` is the rows covered.
- The signature covers a domain label plus the canonical checkpoint, so no other signed object
  can pass for a checkpoint.
- The allowlist is a JSON array of `{ kid, key, notBefore, notAfter }`, with the key as a raw
  Ed25519 public key in base64url.
- The row's principal is always present:
  - the caller's id, for call-scoped rows;
  - `unauthenticated`, before auth;
  - `node`, for the node's own rows;
  - `unattributed`, for an event the table doesn't know.
- A field the table does not list is never written under its own name, because a name could carry
  a value. Such fields go into one keyed-digest field, `unlisted`.
- `seam-only` uses a per-process key that is never stored, so even there no argument is written.

## The event/field table (RULES.md)

Every event and each of its fields is listed, with the kind a value must have to be written bare.
Anything else is a keyed digest. Full table: `packages/core/src/audit/RULES.md`.
- **Node rows** (principal `node`):
  - `manifest-loaded`: path, sha256.
  - `audit-unanchored`: mode.
  - `audit-resumed`: fromSeq, unanchored.
  - `pin-refused`: tool, reason, rule.
  - `pin-non-strict`: admitted, refused.
  - `auth-audience-differs`: the audience and resource from the operator's configuration.
- **Request rows** (the caller, or `unauthenticated`):
  - `verifier-timeout`, `verifier-contract`, `auth-unavailable` and `auth-refused`: fixed reason
    codes and integers.
  - `http-refused`: status, reason.
  - `rpc-refused`: code, and method. The method is bare only if the transport knows it.
  - `transport-error`: reason, bare only as one of the platform's error names.
- **Call rows** (the caller):
  - `result-over-cap`: method, limit.
  - `validation-timeout` and `validation-error`, `handler-timeout` and `client-disconnect`,
    `handler-error`, `legacy-input-required` and `request-state-unsealable`: tool, and limitMs where
    listed.
  - `containment-refused`: tool, kind, fileType, and sink. **The sink is always a keyed digest**:
    `notes.read` builds it from its argument.
  - `tool-call`: tool, outcome, and args as `hmac-sha256:<kid>:<base64url>`.
- **Any other event** is written as `unlisted`, its name and fields in one keyed digest.
- **No row** carries a token, a header value or a JSON-RPC id. The transport never passes one to the
  seam, and the policy would digest one that it did.

Examples from the tests (hashes shortened):
```
AUDIT ROW {"event":"http-refused","fields":{"reason":"origin-not-allowed","status":403},"prev":"53f1e8eb67c3…","principal":"unauthenticated","seq":1,"time":"2026-09-27T08:19:21.972Z"}
AUDIT RESUMED {"event":"audit-resumed","fields":{"fromSeq":3,"unanchored":3},"prev":"752bbb7083a3…","principal":"node","seq":3,"time":"2026-09-27T08:19:21.991Z"}
AUDIT DIGEST hmac-sha256:test-digest-1:v7ju2ygJkTOiYviU8P2ij3z41DE0hQ48pakKN0IeXTE
AUDIT POLICY {"event":"http-refused","fields":{"reason":"hmac-sha256:test-digest-1:zxPBnYSJBDes8J9F7cMsX3W74o9IVxCiyyPsw5qd7qE","status":401,"unlisted":"hmac-sha256:test-digest-1:Y8Z4wlWDj_Xtpgj7blcxVh14c_I9Bih9je7XCmAnwEU"},"prev":"000000000000…","principal":"unauthenticated","seq":0,"time":"2026-09-27T08:19:22.002Z"}
AUDIT CHECKPOINT {"count":2,"head":"763013ce496a…","kid":"test-ckpt-1","seq":0,"sig":"ACl3ggj5NrmBG1yQY6vOVHuV_9QvM_JMWpEluGCrocv0VbmZ7pSRtaJSxA3CdfTaxFWl70QuX4lFxASckSSCDQ","time":"2026-09-27T08:19:22.359Z"}
```

## §3.2 The canary, over the P1 evidence suite

```
CANARY requests: an argument reaching the handler → 200; a refused extra argument → 400; a forged Origin → 403; a planted token → 401; an unknown tool name → 400; an unknown method → 404
EXIT | keyed, never bare: no audit row carries a planted argument, id, header, token, tool name or method (CSR-WO-2002) | 7 planted values; 4 logs, 26 rows scanned: none carries one; every row has a principal; every log verifies
```
The planted values were: an argument that reaches the handler (a note name), an extra argument
that is refused, a JSON-RPC id, a forged `Origin` value, a bearer token, an unknown tool name (in
params and `mcp-name`), and an unknown method. Every log the suite's nodes wrote was scanned, and
each one was verified.

## §3.3 `audit verify`: each tamper, named

```
VERIFY clean → exit 0; 8 rows, 3 checkpoints, 0 unanchored
VERIFY an edited row (seq 4) → exit 1; first: edited-row at log line 5: the row at seq 4 was edited: seq 5's prev does not match its bytes
VERIFY a removed row (seq 4) → exit 1; first: removed-rows at log line 5: seq 5 follows seq 3: 1 row(s) removed
VERIFY two rows swapped (seq 2 and 3) → exit 1; first: reordered-rows at log line 3: seq 3 at position 2, after seq 1: rows were reordered
VERIFY two valid logs spliced → exit 1; first: inserted-rows at log line 5: seq 0 follows seq 3 and appears twice: rows were inserted or spliced
VERIFY a row with a space added (same content, another spelling) → exit 1; first: non-canonical-row at log line 4: the line is not the canonical serialization of its own content
VERIFY a row with a duplicate key → exit 1; first: malformed-row at log line 4: A1: a duplicate key
VERIFY the last three rows removed (behind the close checkpoint) → exit 1; first: truncated-behind-checkpoint at anchor line 2: checkpoint 1 covers 6 rows; the log has 5: the log was truncated behind it
VERIFY the last row edited (no successor to notice) → exit 1; first: head-mismatch at anchor line 3: checkpoint 2's head is not the hash of row 7: the log was edited or re-chained behind it
VERIFY a row edited and every later prev recomputed (re-chained) → exit 1; first: head-mismatch at anchor line 1: checkpoint 0's head is not the hash of row 2: the log was edited or re-chained behind it
VERIFY a checkpoint whose count matches but whose head does not → exit 1; first: head-mismatch at anchor line 1: checkpoint 0's head is not the hash of row 2: the log was edited or re-chained behind it
VERIFY a checkpoint key not in the allowlist → exit 1; first: unknown-kid at anchor line 1: kid test-ckpt-1 is not in the key allowlist
VERIFY a checkpoint time after its key's notAfter → exit 1; first: key-out-of-window at anchor line 1: checkpoint time 2026-09-27T08:19:22.523Z is outside kid test-ckpt-1's window 2020-01-01T00:00:00Z to 2021-01-01T00:00:00Z
VERIFY a checkpoint time before its key's notBefore → exit 1; first: key-out-of-window at anchor line 1: checkpoint time 2026-09-27T08:19:22.523Z is outside kid test-ckpt-1's window 2099-01-01T00:00:00Z to 2100-01-01T00:00:00Z
VERIFY a checkpoint's count changed after signing → exit 1; first: bad-signature at anchor line 1: the signature does not verify under kid test-ckpt-1
VERIFY a checkpoint signed by another key under the same kid → exit 1; first: bad-signature at anchor line 1: the signature does not verify under kid test-ckpt-1
VERIFY the first checkpoint appended again → exit 1; first: checkpoint-replayed at anchor line 4: checkpoint seq 0 (count 3) where seq 3 (count at least 8) was expected: a checkpoint was replayed, removed or reordered
VERIFY a checkpoint removed from the anchor → exit 1; first: checkpoint-replayed at anchor line 2: checkpoint seq 2 (count 8) where seq 1 (count at least 3) was expected: a checkpoint was replayed, removed or reordered
VERIFY the last row cut mid-write (no final newline) → exit 3; first: torn-final-line at log line 8: the log does not end with a newline: its last line is incomplete (a crash mid-write), and is not part of the chain
```
And the command (`npm run audit -- verify`): exit 0 on a clean log, 1 on tampering (first failure
named, then every one), 2 on a usage error, 3 on a torn tail alone. These are exercised in
`verify.test.ts`, "the command: …".

## §3.4 Start refused for each missing or invalid setting; seam-only

```
AUDIT START no AUDIT_* at all: AuditConfigError: the audit store is not configured (AUDIT_LOG, AUDIT_ANCHOR, AUDIT_DIGEST_KEY_FILE, AUDIT_DIGEST_KEY_ID, AUDIT_SIGNING_KEY_FILE, AUDIT_SIGNING_KEY_ID missing): a node records every refusal and call, or does not start; AUDIT_STORE=seam-only is for development only
AUDIT START AUDIT_LOG missing: AuditConfigError: the audit store is not configured (AUDIT_LOG missing): a node records every refusal and call, or does not start; AUDIT_STORE=seam-only is for development only
AUDIT START AUDIT_ANCHOR missing: AuditConfigError: the audit store is not configured (AUDIT_ANCHOR missing): a node records every refusal and call, or does not start; AUDIT_STORE=seam-only is for development only
AUDIT START AUDIT_DIGEST_KEY_FILE missing: AuditConfigError: the audit store is not configured (AUDIT_DIGEST_KEY_FILE missing): a node records every refusal and call, or does not start; AUDIT_STORE=seam-only is for development only
AUDIT START AUDIT_DIGEST_KEY_ID missing: AuditConfigError: the audit store is not configured (AUDIT_DIGEST_KEY_ID missing): a node records every refusal and call, or does not start; AUDIT_STORE=seam-only is for development only
AUDIT START AUDIT_SIGNING_KEY_FILE missing: AuditConfigError: the audit store is not configured (AUDIT_SIGNING_KEY_FILE missing): a node records every refusal and call, or does not start; AUDIT_STORE=seam-only is for development only
AUDIT START AUDIT_SIGNING_KEY_ID missing: AuditConfigError: the audit store is not configured (AUDIT_SIGNING_KEY_ID missing): a node records every refusal and call, or does not start; AUDIT_STORE=seam-only is for development only
AUDIT START AUDIT_STORE neither jsonl nor seam-only: AuditConfigError: AUDIT_STORE is "jsonl" (the default) or "seam-only" (development), not "off"
AUDIT START AUDIT_LOG relative: AuditConfigError: AUDIT_LOG must be an absolute path
AUDIT START AUDIT_LOG a directory: AuditConfigError: AUDIT_LOG cannot be opened (EISDIR)
AUDIT START AUDIT_ANCHOR the same file as AUDIT_LOG: AuditConfigError: AUDIT_LOG and AUDIT_ANCHOR name the same file: the anchor is a separate file
AUDIT START AUDIT_DIGEST_KEY_FILE missing on disk: AuditConfigError: AUDIT_DIGEST_KEY_FILE cannot be opened (ENOENT)
AUDIT START AUDIT_DIGEST_KEY_FILE under 32 bytes: AuditConfigError: AUDIT_DIGEST_KEY_FILE must hold at least 32 bytes (base64url)
AUDIT START AUDIT_DIGEST_KEY_ID malformed: AuditConfigError: AUDIT_DIGEST_KEY_ID must match [A-Za-z0-9._-]{1,64}
AUDIT START AUDIT_SIGNING_KEY_FILE an RSA key: AuditConfigError: AUDIT_SIGNING_KEY_FILE: the signing key is rsa, not Ed25519
AUDIT START AUDIT_SIGNING_KEY_FILE not a key: AuditConfigError: AUDIT_SIGNING_KEY_FILE: the signing key is not a PEM private key
AUDIT START AUDIT_LOG the digest key file: AuditConfigError: AUDIT_LOG is the same file as AUDIT_DIGEST_KEY_FILE: the log is its own file
AUDIT START AUDIT_LOG the signing key file: AuditConfigError: AUDIT_LOG is the same file as AUDIT_SIGNING_KEY_FILE: the log is its own file
AUDIT START AUDIT_ANCHOR the manifest: AuditConfigError: AUDIT_ANCHOR is the same file as CLEARSEAL_MANIFEST: the anchor is its own file
AUDIT START AUDIT_LOG the manifest: AuditConfigError: AUDIT_LOG is the same file as CLEARSEAL_MANIFEST: the log is its own file
AUDIT START AUDIT_STORE=seam-only with the store configured: AuditConfigError: AUDIT_STORE=seam-only while the store is configured (AUDIT_LOG, AUDIT_ANCHOR, AUDIT_DIGEST_KEY_FILE, AUDIT_DIGEST_KEY_ID, AUDIT_SIGNING_KEY_FILE, AUDIT_SIGNING_KEY_ID): choose one; a configured store is never silently ignored
AUDIT START the same id for both keys: AuditConfigError: AUDIT_DIGEST_KEY_ID and AUDIT_SIGNING_KEY_ID are the same: each key has its own id
AUDIT START an all-zero digest key: AuditConfigError: AUDIT_DIGEST_KEY_FILE holds a patterned key (fewer than 8 distinct byte values): generate it from a random source
AUDIT START two PEM blocks in the signing key file: AuditConfigError: AUDIT_SIGNING_KEY_FILE: the signing key file holds more than one PEM block: one key per file
AUDIT START an AUDIT_ANCHOR whose last line is not a checkpoint (named, never quoted): AuditConfigError: AUDIT_ANCHOR's last line is not a checkpoint
AUDIT START AUDIT_CHECKPOINT_ROWS zero: AuditConfigError: AUDIT_CHECKPOINT_ROWS must be an integer from 1 to 100000
AUDIT START AUDIT_CHECKPOINT_SECONDS too large: AuditConfigError: AUDIT_CHECKPOINT_SECONDS must be an integer from 1 to 86400
AUDIT START AUDIT_DIGEST_KEY_FILE a symbolic link: AuditConfigError: AUDIT_DIGEST_KEY_FILE cannot be opened (ELOOP)
AUDIT START AUDIT_LOG through a linked directory: AuditConfigError: AUDIT_LOG passes through a symbolic link: the audit uses paths with no link on the way
AUDIT START seam-only: audit-unanchored {"mode":"seam-only"} | manifest-loaded {"path":"<tmp>/manifest.json","sha256":"a4f2ba688d53…"}
AUDIT START tool-call row: {"event":"tool-call","fields":{"args":"hmac-sha256:test-digest-1:z_YlkA2JcqmK7f6N7A-XcFoHhKE47UgVEEcLqygG96o","outcome":"ok","tool":"echo"},"prev":"b958e7d4c57c…","principal":"user-42","seq":1,"time":"2026-09-27T08:19:21.842Z"}
```

## §3.5 Red-proofs and control-deletion rows

Every rule's red-proof is a named test in `packages/core/test/audit/` (`store`, `verify`, `start`,
`adversarial`), or the canary clause in `packages/teaching/test/p1-exit.test.ts`. There are 43 new
control-deletion rows (`audit-*`). Each names its rule, and each goes red by the test's own assertion
(the gates line gives the full run). Some existing stubs were
regenerated against the wiring with their changes unchanged:
- the `-1007a` `startnode-*` stubs;
- `startnode-committed-file`, now in its try block.

Three existing tests' expectations now include the new row, since the refusals themselves are
unchanged:
- `auth/corrections.test.ts`: a handler error is followed by its `tool-call` row;
- `transport/limits.test.ts`: the timeout's line, then `tool-call`;
- `node/start.test.ts`: in seam-only mode, `audit-unanchored` comes before `manifest-loaded`.

## Adversarial pass (WO §5)

A fresh subagent, working in its own worktree, ran every §5 attempt through the real store, verifier
and `startNode`. I checked its causes against the code before acting. Each finding was either closed
with a red-proof and a row, or written into RULES.md as a limit.

| # | Finding | Severity (subagent) | Disposition |
|---|---|---|---|
| X1 | Edit, delete, insert, reorder or truncate inside a covered range; splice two logs; replay a checkpoint | none | all named |
| X2 | The unanchored window can be **rewritten**, not only truncated (the chain is plain SHA-256), and a restart adopts it under the next signed checkpoint | High | **the WO's design limit; restated in AU-12.** The adoption is now recorded: `audit-resumed` gives the count of unanchored rows (AU-25) [audit-resumed] |
| X3 | Truncating the anchor, not only rewriting it, reopens covered ranges | High if the attacker can write the anchor | **stated in AU-12**: the anchor's ownership is the protection |
| X4 | Removing the anchor's final newline turned tampering into exit 3 | Medium | **fixed** (AU-20): a tail that parses is still checked [audit-torn-checked] |
| X5 | Invalid UTF-8 bytes were read as U+FFFD, so one row had several byte spellings that verified | Medium | **fixed** (AU-1, AU-16): strict UTF-8 in `verify` and at start [audit-utf8-strict] |
| X6 | `transport-error`'s reason is `err.name`, and tool code can set it from arguments (a canary reached a row through a real node) | High by the rubric | **fixed**: kind `errname`, bare only for the platform's error names [audit-errname] |
| X7 | An unknown event's name was bare; `__proto__` was dropped; a BigInt threw; NaN, undefined and -0 digested alike | Medium, Low | **fixed** (AU-6) [audit-event-unlisted] |
| X8 | The log could be pointed at a key file or the manifest, and the node served, writing rows into it | Medium | **fixed** (AU-21) [audit-log-not-a-key] |
| X9 | A bad anchor failed with a raw SyntaxError quoting the file (the first characters of a key) | Low–Medium | **fixed**: named, never quoted |
| X10 | `seam-only` with a store configured silently ignored the store | Low–Medium | **fixed**: refused (AU-22) |
| X11 | The start-time anchor check did not verify the checkpoint's signature | Low | **fixed** (AU-24) for the store's own kid [audit-start-anchor-signature] |
| X12 | Several spellings of one signature verified; the allowlist accepted duplicate members, extra members, a padded key, 30 February, hour 24, and `[]`; a `count = 0` checkpoint passed | Low | **fixed** (AU-19) [audit-checkpoint-form], [audit-allowlist-strict] |
| X13 | Weak keys: an all-zero digest key; two PEMs in one file; one id for both keys | Low | **fixed** (AU-21) [audit-strong-digest-key] |
| X14 | A leaked retired key can backdate checkpoints into its window, because the window is checked against the signed time | Medium | **stated in AU-19**: remove the entry, and keep windows short |
| X15 | A code-shaped value passed directly to `append` is written bare in a code field; the principal (the token's `sub`) is bare by design | Medium (direct append only) | **kept, stated**: every code field is filled from the core's own constants, and no request value reaches one. The subagent's own canary run over a real node confirmed that everything except X6 stayed out |

Where the subagent said RULES.md claimed more than the code did, the rule was corrected or the code
was fixed: AU-1, AU-6, AU-12, AU-16, AU-19, AU-20, AU-21 and AU-24, as above.

## Gates

- `npm run check` exits 0: 693 core and teaching tests (655 before; 38 new, in four audit test files
  and the canary clause), spike 0102 69, spike 0101 8, `test:subset` 4.
- `control-deletion`: 128 rows (85 before, 43 new), all red by assertion on the final code;
  `--self-test` passes.
- `node scripts/leak-gate.mjs --tree` exit 0; `--history` exit 0, run unpiped before every push with
  the exit code checked directly. Hashes in these pastes are shortened, and every key the tests use
  is generated at run time.
- CI: the pull request's checks, on both runners, with `control-deletion`.
- Protected surfaces diff to empty against `4a0bfa2`: the steering documents, `LICENSE`, `NOTICE`,
  `spikes/**`, `docs/canonical-form.md`, `pinning/**`, `capability/**`, `containment/**`, `auth/**` and
  `packages/core/test/boundary/**`.
- The minted token lived in a mode-0600 scratch file, was never written to git config or a remote
  URL, and was deleted after the pull request was opened.

## What was not built

- OS-log stores: journal and Event Log (P3, P4). A remote anchor sink, which the `AnchorSink`
  interface admits. Key-rotation tooling: the allowlist carries windows, and there is no rotate
  command.
- The approval gate (`-2001`, which will write through this store), provenance (`-2004`, which
  reuses `Signer`), and the tripwire and rate limit (`-2007`).
- A keyed chain, or anything else that protects the unanchored window against an attacker who holds
  the service's keys. That is the WO's design limit, stated in AU-12.
- Log rotation. A log grows until the operator moves it and points `AUDIT_LOG` and `AUDIT_ANCHOR` at
  a fresh pair.
- The §8 row's *built* marking, in the protected architecture document.
