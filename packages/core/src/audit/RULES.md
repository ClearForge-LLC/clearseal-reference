# Audit rules (CSR-WO-2002)

This file is written before the module, one rule per line, and each rule names the red-proof that makes it fail. Its grounds are:
- `docs/architecture.md` §5, rows *Audit argument digests*, *Audit store and anchoring* and *Key identity and rotation*;
- §7.1, rows *A hostile authenticated principal* and *An attacker who can truncate the audit file*;
- §8, row *Audit keyed digests, OS-log store, signed checkpoints, `audit verify`*;
- northstar N4 and N5.

Tests are in `packages/core/test/audit/` unless another file is named. Each rule's control-deletion row is in `test/deletion/controls.json`, with the id in brackets.

## The chain

- **AU-1** A row is `{ seq, time, event, principal, fields, prev }`, serialized as the core's canonical JSON (`pinning/canonical.ts`: sorted keys, no whitespace, one spelling per value), one row per line. `prev` is the SHA-256, in lower-case hex, of the previous row's exact line bytes, without the newline. The first row of a log has `prev` of sixty-four zeros. The log and the anchor are read as bytes and decoded as strict UTF-8, so the text hashed is the bytes on disk. An invalid byte sequence is a finding for `verify` and a refusal at start, never a replacement character. Red-proofs: "every row's prev is the SHA-256 of the line before it" [audit-chain-link], and in `adversarial.test.ts`, "a row's bytes altered into invalid UTF-8 are a finding, never a replacement character" [audit-utf8-strict].
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
  - An event the table does not list is written as `unlisted`, and its name goes into that digest.
  - A member named `__proto__` is kept as data. A BigInt, NaN, the infinities, `-0` and `undefined` each digest distinctly and never throw.
  - Nothing is dropped, and nothing unlisted is bare. A symbol-keyed member is outside the seam's contract (`Record<string, …>`) and is not read.

  Red-proof, in `adversarial.test.ts`: "an event the table does not know is written as unlisted, its name only in the digest; nothing is dropped" [audit-event-unlisted].

  Red-proof: "a field outside the table, or of the wrong kind, is written as a keyed digest" [audit-field-policy].
- **AU-7** `containment-refused`'s `sink` is always a keyed digest. The sink is the path or host a tool tried to reach, and a tool builds it from its arguments (for example, `notes.read` builds it from the note's name). Red-proof: "a containment sink is written as a keyed digest" [audit-sink-digest].
- **AU-8** Canary: the P1 evidence suite runs against a JSON-lines store while its calls carry planted canary values in arguments, a JSON-RPC id, a forged header value and an argument that is refused. No row of the log contains any canary. Red-proof: `packages/teaching/test/p1-exit.test.ts`, "keyed, never bare: no audit row carries a planted value" [audit-canary].

### The event table

Kinds of field:
- `code`: matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`. Every code field is filled from the core's own constants: a refusal's reason word, a verifier reason, a reach kind, an outcome.
- `errname`: one of the platform's error names (`Error`, `TypeError`, `RangeError`, `SyntaxError`, `ReferenceError`, `EvalError`, `URIError`, `AggregateError`, `AbortError`, `TimeoutError`), or `Refusal`, `unhandled` or `unknown`. `transport-error`'s reason is an error's name, and a tool's code can name an error after its arguments, so any other name is digested. Red-proof: the same test [audit-errname].
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
| `manifest-refused` | `node/start.ts` | node | path (config), sha256 (hex64), reason (errname) |
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
| `transport-error` | `transport/server.ts` | caller, else unauthenticated | reason (errname) |
| `result-over-cap` | `transport/dispatch.ts` | caller | method (method), limit (int) |
| `validation-timeout` | `transport/dispatch.ts` | caller | tool (tool), limitMs (int) |
| `validation-error` | `transport/dispatch.ts` | caller | tool (tool) |
| `containment-refused` | `transport/dispatch.ts` | caller | tool (tool), kind (code), sink (**digest**), fileType (code) |
| `handler-timeout`, `client-disconnect` | `transport/dispatch.ts` | caller | tool (tool), limitMs (int) |
| `handler-error` | `transport/dispatch.ts` | caller | tool (tool) |
| `legacy-input-required` | `transport/dispatch.ts` | caller | tool (tool) |
| `request-state-unsealable` | `transport/dispatch.ts` | caller | tool (tool) |
| `tool-call` | `transport/dispatch.ts` | caller | tool (tool), outcome (code), args (argdigest) |
| `audit-resumed` | `audit/store.ts` | node | fromSeq (int), unanchored (int) |
| any other event | — | unattributed | written as `unlisted`: its name and fields in one keyed digest |

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
- **AU-12** **The honest limit.** This rule was restated after the adversarial pass, which showed the first version claimed too little risk.
  - Rows after the last checkpoint are not protected. They can be truncated, and also rewritten or added to: the chain is a plain SHA-256 that anyone can recompute. A restart then adopts them, and the next checkpoint covers them. The adoption is recorded (AU-25), and N and T bound the window.
  - The anchor is the protection, so it must be owned by someone else: an operator-held file, a remote sink, or the OS log in P3 and P4.
  - An attacker who can truncate the anchor, not only rewrite it, reopens the rows its lost checkpoints covered. `verify` cannot know how many checkpoints there should have been.
  - An attacker with the service's own privilege can read the signing key, sign whatever they like, and so defeat the scheme too. Signed checkpoints add value only while the signing key is out of that attacker's reach, or the anchor is.
  - `audit verify` reports how many rows lie beyond the last checkpoint.

## `audit verify`

`npm run audit -- verify --log <file> --anchor <file> --keys <allowlist.json>`. The allowlist is a JSON array of `{ kid, key, notBefore, notAfter }`: the key is the raw 32-byte Ed25519 public key in base64url, and the times are RFC 3339.
- It exits 0 on a clean log, 1 on any tamper finding, 2 on a usage error, and 3 when the only finding is a torn final line.
- It names the first failure and lists every one.

- **AU-13** An edited row is named: the next row's `prev` does not match its bytes. An edited last row is caught by the checkpoint that covers it (AU-18). Red-proof: "verify names an edited row" [audit-verify-edit].
- **AU-14** A removed row is named: `seq` jumps. Red-proof: "verify names a removed row" [audit-verify-remove].
- **AU-15** Reordered, inserted or spliced rows are named: `seq` goes backwards or repeats. Red-proof: "verify names reordered rows" [audit-verify-reorder].
- **AU-16** A row that is not the canonical serialization of its own content is named as non-canonical, since one row can then be serialized two ways. A byte-level respelling is caught by AU-1's strict UTF-8. Red-proof: "verify names a non-canonical row" [audit-verify-canonical].
- **AU-17** A truncation behind a checkpoint is named: the checkpoint's `count` exceeds the rows in the log. Red-proof: "verify names a truncation behind a checkpoint" [audit-verify-truncation].
- **AU-18** A checkpoint whose `head` does not match the log's row at `count - 1` is named: the log was edited or re-chained behind it. Red-proof: "verify names a head mismatch" [audit-verify-head].
- **AU-19** A checkpoint is named if:
  - its kid is not in the allowlist [audit-verify-unknown-kid];
  - its time is outside its key's window [audit-verify-window];
  - its signature does not verify [audit-verify-signature];
  - its `seq` repeats or goes backwards, which is a replay [audit-verify-replay].

  Red-proofs: the four tests of the same names.

  In addition:
  - A checkpoint must have exactly its six members.
  - `count` must be at least 1.
  - Its signature must be in its one base64url spelling: 86 characters, no padding. A signature with another spelling is `malformed-checkpoint`. Red-proof: "a checkpoint's signature has one spelling, and a checkpoint covers at least one row" [audit-checkpoint-form].
  - The allowlist must be a non-empty array of entries, each with exactly `kid`, `key`, `notBefore` and `notAfter`, no member twice, the key in its one 43-character spelling, and calendar-valid times. Red-proof: "the allowlist is strict …" [audit-allowlist-strict].
  - **Limit:** the window is checked against the time the checkpoint itself signs. A retired key that leaks can backdate checkpoints into its old window. The answer is to remove its allowlist entry, and rotation should keep windows no longer than a key can be kept secret.
- **AU-20** A torn final line is its own kind (`torn-final-line`), distinct from tampering: the file does not end with a newline. A crash mid-write leaves exactly that shape, and tampering in the middle of the file never does, because every earlier line ends with a newline.
  - A final line that parses as a complete line is checked like any other, and is still reported as torn. So removing a final newline never hides a line from the checks, and never turns tampering into exit 3. Red-proof, in `adversarial.test.ts`: "a final newline removed from a complete line never hides it from the checks" [audit-torn-checked].
  - The store refuses to start on a torn log, so the operator must look at it before it grows. Red-proofs: "verify reports a torn final line as its own kind" [audit-verify-torn] and "the store refuses to start on a torn log" [audit-torn-refused].

## Start, fail-closed

- **AU-21** `startNode` refuses to start without its audit configuration. It needs:
  - `AUDIT_LOG` and `AUDIT_ANCHOR`: absolute paths, each a regular file or not yet existing, in an existing directory, with no link on the path, and not the same file;
  - `AUDIT_DIGEST_KEY_FILE` with `AUDIT_DIGEST_KEY_ID`: a regular file with no link, holding at least 32 bytes in base64url;
  - `AUDIT_SIGNING_KEY_FILE` with `AUDIT_SIGNING_KEY_ID`: a regular file with no link, holding a PKCS#8 PEM Ed25519 private key;
  - optionally, `AUDIT_CHECKPOINT_ROWS` (1 to 100000) and `AUDIT_CHECKPOINT_SECONDS` (1 to 86400).

  Each missing or invalid setting refuses start, naming it. Also refused at start:
  - the log or the anchor being the same file as either key file or the manifest;
  - the same id for both keys;
  - a patterned digest key (fewer than 8 distinct byte values);
  - more than one PEM block in the signing key file;
  - an existing log whose last line is not the row its position requires;
  - an anchor whose last line is not a checkpoint. The setting is named and the file's content is never quoted.

  Red-proofs: "start is refused for each missing or invalid AUDIT_* setting" [audit-start-fail-closed], [audit-log-not-a-key], [audit-strong-digest-key].
- **AU-22** The one exception is `AUDIT_STORE=seam-only`, for development. It keeps today's stderr line and writes an `audit-unanchored` row first. It refuses start if any store setting is also set, so a configured store is never silently ignored. Any other `AUDIT_STORE` value refuses start. Red-proof: "seam-only starts with its audit-unanchored row" [audit-seam-only].
- **AU-23** `manifest-loaded` is the first row a start writes to a new log, and it is written only after the manifest parses (CSR-WO-1007b §1.6). A manifest that is read but refused writes `manifest-refused` with the same path and hash instead, and start is refused. On a resumed log it follows `audit-resumed` (AU-25). Red-proof: "manifest-loaded is the first row of the run" [audit-first-row].
- **AU-24** On start the store checks the anchor's last checkpoint against the log. A log shorter than that checkpoint, or one whose row at `count - 1` does not hash to its `head`, refuses start. So does a checkpoint under the store's own kid whose signature does not verify under its own key. A checkpoint under another kid, from a rotated key, is left to `audit verify` and its allowlist. Red-proofs: "the store refuses to start on a log behind its last checkpoint" [audit-start-anchor-count, audit-start-anchor-head] and "the store checks its own last checkpoint's signature at start" [audit-start-anchor-signature].
- **AU-25** A store that resumes a log with rows in it writes `audit-resumed` as the run's first row. The row records `fromSeq` and `unanchored`, the number of rows after the last checkpoint that this run adopts and will cover with its next checkpoint (AU-12). Red-proof: "a resumed store records the unanchored rows it adopts" [audit-resumed].
