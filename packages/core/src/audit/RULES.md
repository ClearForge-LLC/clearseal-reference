# Audit rules (CSR-WO-2002)

This file is written before the module, one rule per line, and each rule names the red-proof that makes it fail. Its grounds are:
- `docs/architecture.md` §5, rows *Audit argument digests*, *Audit store and anchoring* and *Key identity and rotation*;
- §7.1, rows *A hostile authenticated principal* and *An attacker who can truncate the audit file*;
- §8, row *Audit keyed digests, OS-log store, signed checkpoints, `audit verify`*;
- northstar N4 and N5.

Tests are in `packages/core/test/audit/` unless another file is named. Each rule's control-deletion row is in `test/deletion/controls.json`, with the id in brackets.

## The chain

- **AU-1** A row is `{ seq, time, event, principal, fields, prev }`, serialized as the core's canonical JSON (`pinning/canonical.ts`: sorted keys, no whitespace, one spelling per value), one row per line. `prev` is the SHA-256, in lower-case hex, of the previous row's exact line bytes, without the newline. The first row of a log has `prev` of sixty-four zeros. Red-proof: "every row's prev is the SHA-256 of the line before it" [audit-chain-link].
- **AU-2** `seq` counts rows from 0 across the whole file, one per row, with no gaps, including across restarts: the store resumes from the last row it finds. Red-proof: "a restarted store continues seq and prev from the last row" [audit-chain-resume].
- **AU-3** Each row is written with one write of the line plus its newline, so a crash can leave at most a torn final line, never a torn row in the middle. Red-proof: covered by `audit verify` (AU-16) and the torn-tail refusal (AU-20).

## Principal and fields: keyed, never bare

- **AU-4** Every row carries `principal`. It is:
  - the caller's id, for a call-scoped row;
  - `unauthenticated`, for a request refused before a principal exists;
  - `node`, for a row the node writes about itself;
  - `unattributed`, for an event the table below does not know.

  Red-proof: "every row carries a principal" [audit-principal].
- **AU-5** Tool arguments never enter a row. A call that reaches a handler writes one `tool-call` row with the tool, the outcome, the principal and `args: "hmac-sha256:<kid>:<base64url>"`. The digest is HMAC-SHA256, under the operator's digest key, over a domain label and the core's existing canonical argument digest (`argumentsDigest` in `transport/request-state.ts`: SHA-256 of the canonical argument JSON, the form the request-state binding uses). Red-proofs: "a call that reaches its handler writes one tool-call row with a keyed digest" [audit-tool-call-row] and "equal arguments give equal digests, and the digest depends on the key" [audit-keyed-digest].
- **AU-6** Every field of every row is written bare only if the event table below lists it and the value is of the listed kind.
  - A listed field whose value is of the wrong kind keeps its name, and its value becomes a keyed digest.
  - Fields the table does not list, and every field of an unknown event, are never written under their own names, since a name could carry a value too. Together they become one field, `unlisted`, holding a keyed digest of their canonical JSON.
  - Nothing is dropped, and nothing unlisted is bare.

  Red-proof: "a field outside the table, or of the wrong kind, is written as a keyed digest" [audit-field-policy].
- **AU-7** `containment-refused`'s `sink` is always a keyed digest. The sink is the path or host a tool tried to reach, and a tool builds it from its arguments (for example, `notes.read` builds it from the note's name). Red-proof: "a containment sink is written as a keyed digest" [audit-sink-digest].
- **AU-8** Canary: the P1 evidence suite runs against a JSON-lines store while its calls carry planted canary values in arguments, a JSON-RPC id, a forged header value and an argument that is refused. No row of the log contains any canary. Red-proof: `packages/teaching/test/p1-exit.test.ts`, "keyed, never bare: no audit row carries a planted value" [audit-canary].

### The event table

Kinds of field:
- `code`: matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`.
- `int`: a safe integer.
- `tool`: a tool name as A5 allows it.
- `method`: one of the MCP methods the transport knows.
- `hex64`: a lower-case SHA-256.
- `config`: a string of at most 2048 characters with no control character. It comes from the operator's configuration, never from a request.
- `argdigest`: an `hmac-sha256:<kid>:<base64url>` string.
- `digest`: always written as a keyed digest.

| Event | Written by | principal | Fields (kind) |
|---|---|---|---|
| `manifest-loaded` | `node/start.ts` | node | path (config), sha256 (hex64) |
| `audit-unanchored` | `audit/config.ts` (seam-only start) | node | mode (code) |
| `pin-refused` | `transport/server.ts` | node | tool (tool), reason (code), rule (code) |
| `pin-non-strict` | `transport/server.ts` | node | admitted (int), refused (int) |
| `auth-audience-differs` | `transport/server.ts` | node | audience (config), resource (config) |
| `verifier-timeout` | `transport/server.ts` | unauthenticated | limitMs (int) |
| `verifier-contract` | `transport/server.ts` | unauthenticated | reason (code) |
| `auth-unavailable` | `transport/server.ts` | unauthenticated | reason (code), retryAfterS (int) |
| `auth-refused` | `transport/server.ts` | unauthenticated | reason (code) |
| `http-refused` | `transport/server.ts` | caller, else unauthenticated | status (int), reason (code) |
| `rpc-refused` | `transport/server.ts` | caller | code (int), method (method) |
| `transport-error` | `transport/server.ts` | caller, else unauthenticated | reason (code) |
| `result-over-cap` | `transport/dispatch.ts` | caller | method (method), limit (int) |
| `validation-timeout` | `transport/dispatch.ts` | caller | tool (tool), limitMs (int) |
| `validation-error` | `transport/dispatch.ts` | caller | tool (tool) |
| `containment-refused` | `transport/dispatch.ts` | caller | tool (tool), kind (code), sink (**digest**), fileType (code) |
| `handler-timeout`, `client-disconnect` | `transport/dispatch.ts` | caller | tool (tool), limitMs (int) |
| `handler-error` | `transport/dispatch.ts` | caller | tool (tool) |
| `legacy-input-required` | `transport/dispatch.ts` | caller | tool (tool) |
| `request-state-unsealable` | `transport/dispatch.ts` | caller | tool (tool) |
| `tool-call` | `transport/dispatch.ts` | caller | tool (tool), outcome (code), args (argdigest) |

No event carries a token, a header value or a JSON-RPC id. The transport never passes one to the seam, and AU-6 would digest one that it did. `principal` is the caller's id as the verifier returned it. It is the one caller-derived string written bare, because recording who acted is the row's purpose.

## Checkpoints and the anchor

- **AU-9** Every `AUDIT_CHECKPOINT_ROWS` rows (default 100) or every `AUDIT_CHECKPOINT_SECONDS` seconds (default 300), whichever comes first, and on a clean close, the store writes a checkpoint to the anchor sink. It only does so when rows were written since the last one. The log is fsync-ed first, so a checkpoint never covers a row that is not on disk. Red-proofs: "a checkpoint is written every N rows" [audit-checkpoint-rows], "a checkpoint is written after T" [audit-checkpoint-time] and "close writes a final checkpoint" [audit-checkpoint-close].
- **AU-10** A checkpoint is `{ kid, seq, head, count, time, sig }`, one canonical JSON line in the anchor file:
  - `seq` counts checkpoints from 0 with no gaps;
  - `count` is the number of rows it covers;
  - `head` is the SHA-256 of the line of row `count - 1`;
  - `sig` is Ed25519, base64url, over `clearseal-audit-checkpoint-v1\n` followed by the canonical JSON of `{ kid, seq, head, count, time }`.

  Red-proof: "a checkpoint is signed over its own canonical bytes" [audit-checkpoint-signed].
- **AU-11** The anchor is a separate, operator-named file, opened append-only. The core also ships an in-memory anchor for tests. A remote anchor fits the `AnchorSink` interface, and none is built.
- **AU-12** **The honest limit.**
  - Rows written after the last checkpoint can be truncated without detection. N and T bound that window.
  - An attacker who can rewrite both the log and the anchor defeats the scheme. The anchor's value is that someone else owns it (an operator-held file, a remote sink, the OS log in P3 and P4).
  - `audit verify` reports how many rows lie beyond the last checkpoint.

## `audit verify`

`npm run audit -- verify --log <file> --anchor <file> --keys <allowlist.json>`. The allowlist is a JSON array of `{ kid, key, notBefore, notAfter }`: the key is the raw 32-byte Ed25519 public key in base64url, and the times are RFC 3339.
- It exits 0 on a clean log, 1 on any tamper finding, 2 on a usage error, and 3 when the only finding is a torn final line.
- It names the first failure and lists every one.

- **AU-13** An edited row is named: the next row's `prev` does not match its bytes. An edited last row is caught by the checkpoint that covers it (AU-18). Red-proof: "verify names an edited row" [audit-verify-edit].
- **AU-14** A removed row is named: `seq` jumps. Red-proof: "verify names a removed row" [audit-verify-remove].
- **AU-15** Reordered, inserted or spliced rows are named: `seq` goes backwards or repeats. Red-proof: "verify names reordered rows" [audit-verify-reorder].
- **AU-16** A row that is not the canonical serialization of its own content is named as non-canonical, since one row can then be serialized two ways. Red-proof: "verify names a non-canonical row" [audit-verify-canonical].
- **AU-17** A truncation behind a checkpoint is named: the checkpoint's `count` exceeds the rows in the log. Red-proof: "verify names a truncation behind a checkpoint" [audit-verify-truncation].
- **AU-18** A checkpoint whose `head` does not match the log's row at `count - 1` is named: the log was edited or re-chained behind it. Red-proof: "verify names a head mismatch" [audit-verify-head].
- **AU-19** A checkpoint is named if:
  - its kid is not in the allowlist [audit-verify-unknown-kid];
  - its time is outside its key's window [audit-verify-window];
  - its signature does not verify [audit-verify-signature];
  - its `seq` repeats or goes backwards, which is a replay [audit-verify-replay].

  Red-proofs: the four tests of the same names.
- **AU-20** A torn final line is its own kind (`torn-final-line`), distinct from tampering: the file does not end with a newline and its last line does not parse. A crash mid-write leaves exactly that shape. Tampering in the middle of the file never does, because every earlier line ends with a newline. The store refuses to start on a torn log, so the operator must look at it before it grows. Red-proofs: "verify reports a torn final line as its own kind" [audit-verify-torn] and "the store refuses to start on a torn log" [audit-torn-refused].

## Start, fail-closed

- **AU-21** `startNode` refuses to start without its audit configuration. It needs:
  - `AUDIT_LOG` and `AUDIT_ANCHOR`: absolute paths, each a regular file or not yet existing, in an existing directory, with no link on the path, and not the same file;
  - `AUDIT_DIGEST_KEY_FILE` with `AUDIT_DIGEST_KEY_ID`: a regular file with no link, holding at least 32 bytes in base64url;
  - `AUDIT_SIGNING_KEY_FILE` with `AUDIT_SIGNING_KEY_ID`: a regular file with no link, holding a PKCS#8 PEM Ed25519 private key;
  - optionally, `AUDIT_CHECKPOINT_ROWS` (1 to 100000) and `AUDIT_CHECKPOINT_SECONDS` (1 to 86400).

  Each missing or invalid setting refuses start, naming it. Red-proof: "start is refused for each missing or invalid AUDIT_* setting" [audit-start-fail-closed].
- **AU-22** The one exception is `AUDIT_STORE=seam-only`, for development. It keeps today's stderr line and writes an `audit-unanchored` row first. Any other `AUDIT_STORE` value refuses start. Red-proof: "seam-only starts with its audit-unanchored row" [audit-seam-only].
- **AU-23** `manifest-loaded` is the first row a start writes. Red-proof: "manifest-loaded is the first row of the run" [audit-first-row].
- **AU-24** On start the store checks the anchor's last checkpoint against the log. A log shorter than that checkpoint, or one whose row at `count - 1` does not hash to its `head`, refuses start. Red-proof: "the store refuses to start on a log behind its last checkpoint" [audit-start-anchor-check].
