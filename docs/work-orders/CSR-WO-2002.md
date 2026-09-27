# CSR-WO-2002 — Audit: the `AuditStore` interface, keyed argument digests, a hash chain, signed checkpoints to an anchor sink, and `audit verify`

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (must contain `-1007a`, merged `31a2bf3`).
**Branch:** `wo/CSR-WO-2002`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P2 · **Phase exit gate (the clauses this WO owns):** §8 row *Audit keyed digests, OS-log
store, signed checkpoints, `audit verify`* reads *built* for the core and JSON-lines parts, with its
red-proofs named; "`audit verify` reports a deliberately truncated chain" holds; each control has a
`-2008` control-deletion row.
**Grounds:** `docs/architecture.md` §5 rows *Audit argument digests* (keyed, never a bare hash) and
*Audit store and anchoring* (hash chain, signed checkpoints every N rows or T minutes, anchor sink,
`audit verify`), *Key identity and rotation* (every key carries a `kid` and a validity window), §7.1
rows *An attacker who can truncate the audit file* and *A hostile authenticated principal*, §8 row
named above; `docs/northstar.md` N4 (refused and recorded) and N5.

> **What this is:** the store behind the audit seam. Today every refusal writes one line through
> `audit(event, fields)` to stderr — recorded, but not tamper-evident, and nothing records a call that
> succeeded. This WO puts an `AuditStore` behind the same seam: every row carries the principal and
> hashes its predecessor; tool arguments appear only as keyed digests; every N rows or T minutes a
> checkpoint (head hash, row count, time) is signed and written to an anchor sink the service should
> not be able to rewrite; `audit verify` checks chain and checkpoints and names the first break. The
> core ships the interface, a JSON-lines store and a file anchor; the OS-log stores land with their
> editions (P3, P4). It is NOT the approval gate (`-2001`, which will write its grant and redemption
> events through this store), NOT message provenance (`-2004` — but the signer interface defined here
> is the one `-2004` reuses), and NOT the tripwire or rate limit (`-2007`).

**Cadence:** build, spec-first: write `packages/core/src/audit/RULES.md` first — one rule per line,
each with the red-proof that will make it fail — then the module. One PR, left unmerged for review.

## 1. Scope — numbered, specific

1. **The interfaces** (`packages/core/src/audit/`): `AuditStore` (append a row; flush; close),
   `AnchorSink` (append a checkpoint), and `Signer` (`kid`, `sign(bytes)`; Ed25519 through
   `node:crypto`, no new dependency). A row is `{ seq, time, event, principal?, fields, prev }` with
   `prev` the SHA-256 of the previous row's exact serialized bytes (the first row's `prev` is a
   stated constant). Choose the row serialization — it must be deterministic and must be what the
   hash covers byte for byte — and record why. The seam signature `(event, fields)` stays for callers;
   the store adds `seq`, `time`, `prev`, and the principal where the caller has one.
2. **Keyed argument digests.** Arguments never enter a row. A `tool-call` row is written for every
   call that reaches a handler, with its outcome, the principal, the tool, and
   `args: "hmac-sha256:<kid>:<base64url>"` — an HMAC over the canonical argument object under the
   operator's digest key. Reuse the core's existing canonical argument form (the one `request-state`
   binding digests); if it cannot be reused without changing a protected file, flag and stop. Equal
   arguments under the same key give equal digests; nothing else about them is recoverable. Every
   existing audit event is audited for bare values: no field in any row may carry an argument value,
   a token, or a header value — list each event and its fields in RULES.md.
3. **Checkpoints and the anchor.** Every N rows or T minutes, whichever first (operator-configured,
   safe defaults stated), and on clean close, the store writes a checkpoint
   `{ kid, seq, head, count, time, sig }` to the anchor sink, signed by the checkpoint `Signer`. The
   core ships a file anchor (a separate operator-named path, append-only open) and an in-memory
   anchor for tests. The honest limit, stated in RULES.md and the module header: rows written after
   the last checkpoint can be truncated undetectably; N and T bound that window; an attacker who can
   rewrite both the log and the anchor defeats the scheme — the anchor's value is different ownership.
4. **`audit verify`** — an operator command beside `pin`, same shape: given the log, the anchor, and
   a public-key allowlist of `{ kid, key, notBefore, notAfter }`, it checks every `prev` link, every
   checkpoint's signature (kid in the allowlist, checkpoint time inside that key's window), and that
   each checkpoint's `head` and `count` match the log. It exits non-zero and names the first failure:
   an edited row, a removed row, reordered rows, a truncation behind a checkpoint, a bad signature, an
   unknown kid, a kid outside its window. A torn final line (a crash mid-write) is reported as its own
   kind, distinct from tampering — choose how, record why.
5. **Wired through `startNode`, fail-closed.** The operator names the store in configuration:
   `AUDIT_LOG` (path), `AUDIT_ANCHOR` (path), `AUDIT_DIGEST_KEY_FILE` and `AUDIT_SIGNING_KEY_FILE`
   (each with its kid), the same file checks `CLEARSEAL_MANIFEST` gets (absolute, regular file, no
   link). Missing or invalid configuration refuses start. The one exception is an explicit
   `AUDIT_STORE=seam-only`, for development: it keeps today's stderr line and writes a loud
   `audit-unanchored` row at start. `manifest-loaded` becomes the chain's first row. The teaching
   edition's README and `.env.example` show both modes; a dev key-generation script lives under
   `scripts/` or `dev/`, labelled not-for-production.
6. **Control-deletion rows** (`test/deletion/controls.json`) for each control — chain link, keyed
   digest, checkpoint signing, each `verify` check, the fail-closed start — with stubs.
7. **`FEEDBACK.md`** per §6.

## 2. Invariants

- **N4** — every refusal and every call that reaches a handler is recorded, and the record is
  tamper-evident up to the last checkpoint.
- **Keyed, never bare** — no argument value, token or header value in any row, by test over every row
  the full suite writes.
- **N5** — every rule has a red-proof and a `-2008` row.

**Protected surfaces — must diff to empty:** the four steering documents, `LICENSE`, `NOTICE`,
`spikes/**`, `docs/canonical-form.md`, `pinning/**`, `capability/**`, `containment/**`, `auth/**`,
`packages/core/test/boundary/**` (the P1 exit re-test is running against it). Working surface: the new
`audit/**`, `node/start.ts` for wiring only, `transport/**` only where a call-site passes the principal
or writes the `tool-call` row (no behaviour change to any refusal), `index.ts` export lines,
`packages/teaching/README.md` and `.env.example`, tests, `test/deletion/**`, a dev key script.

## 3. Tests / acceptance

1. `npm run check` green on both runners; both leak-gate modes exit 0; `control-deletion` green.
2. A canary test: the full P1 evidence suite runs against a JSON-lines store with planted argument
   values; no row contains any canary — pasted.
3. `audit verify` against each tamper in §1.4, each named — pasted; and a clean log verifying.
4. Start refused for each missing or invalid `AUDIT_*` setting; `seam-only` starting with its
   `audit-unanchored` row — pasted.
5. Red-proofs for every rule — pasted.

## 4. Scope fence

- **OS-log stores** (journal, Event Log) — P3, P4.
- **The approval gate, grants, redemption** (`-2001`). **Provenance** (`-2004`), beyond the `Signer`
  interface it will reuse.
- **Tripwire and rate limit** (`-2007`).
- **Remote anchor sinks** — the interface admits them; none is built.
- **Key rotation tooling** — the allowlist format carries windows; no rotate command.
- **Any change to a refusal's status, message or order**, and anything in P2 supply-side hardening.

## 5. Adversarial pass

Fresh subagent; every attempt uses the operation that matters — changing the record without
`audit verify` noticing, or getting a value into it that should only be a digest.

1. Edit, delete, insert, reorder and truncate rows; splice two valid logs; replay an old checkpoint.
2. Forge or reuse a checkpoint: another kid, an expired key, a signature over different bytes, a
   checkpoint whose count matches but head does not.
3. Get an argument value, a token, or a header into any row — through a field name, an error
   message, a tool name, a principal string, a JSON-RPC id.
4. Serialization: make two different rows serialize identically, or one row serialize two ways.
5. Start the node with the store half-configured and get it serving.

## 6. Upward-feedback directive

`FEEDBACK.md`: gates line, the pastes in §3, the choices in §1.1 and §1.4 with reasons, the RULES.md
event/field table, adversarial findings with severity, what was not built.

## 7. Flag-and-stop conditions

- Reusing the canonical argument form needs a protected file changed.
- Writing the `tool-call` row or passing the principal needs a refusal's behaviour changed.
- The P1 exit re-test returns a finding against `main`: park this branch, report, and stop.
- A protected surface must change.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-2002` off current `main` where an AuditStore behind the existing audit seam
> writes a hash-chained JSON-lines log with the principal on every row and tool arguments only as
> keyed HMAC digests, signed checkpoints go to a separate anchor sink every N rows or T minutes, an
> `audit verify` command names every edit, removal, reorder, truncation behind a checkpoint, bad
> signature and out-of-window key, startNode refuses start without the audit configuration except an
> explicit seam-only development mode, RULES.md lists every rule with its red-proof, every control has
> a control-deletion row, `npm run check` is green on both runners, and the work is parked as one
> unmerged pull request. Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-2002 origin/main`. Node 24.21.0. Cadence:
> **build**, spec-first. Read `docs/work-orders/CSR-WO-2002.md` in full and `docs/architecture.md`
> §5 (the audit, key-identity and digest rows), §7.1 and §8. The boundary checker is protected: the
> P1 exit re-test is running against `main`. The gate is asleep until morning — decide what the WO
> leaves to you, record each choice and its reason in FEEDBACK, and flag-and-stop only on §7. Leak
> gate before every push, exit code checked directly. Delegate to subagents where it helps.
> Adversarial pass per §5 to a fresh subagent. Report the PR link and the pastes.
