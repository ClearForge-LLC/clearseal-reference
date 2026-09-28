# @clearseal/teaching

The ClearSeal teaching edition: a notes store as the carrier (architecture §3.3). It is thin by
rule (N1): it exports tool definitions and a configuration schema, and assembles nothing. The core's
`startNode` reads the configuration and the manifest the operator names, and builds the pin gate, the
registry and the transport (CSR-WO-1007, CSR-WO-1007a); the verifier and the cage are the core's too.
The edition imports only types from the core, and holds no core value. The core's supply-boundary
test holds this package to that.

**The operator names the manifest.** Set `CLEARSEAL_MANIFEST` to the approved manifest, an absolute
path or a `file:` URL; for these definitions that is `pins/teaching.json` at the repository root. The
node refuses to start without it, and at start writes one `manifest-loaded` audit line with the
file's path and SHA-256, to compare with the manifest you approved. The edition cannot name its own
manifest: an edition that could would approve itself.

| Module | What it is | ClearSeal clause |
|---|---|---|
| `src/notes.ts` | `notes.read`, a `read_only` tool contained to the notes root | N7 (capability class, containment domain); the cage is the only way out |
| `src/config.ts` | the configuration schema, read and validated by the core's `startNode` | N4: a configuration outside the schema refuses start |
| `src/index.ts` | the public entry: `definitions` and `configSchema`, each declared by kind (`package.json`, `clearseal.exports`) | N1: the supply boundary |

There is no `bin/`: the node's entry is the core's own `clearseal-node` (CSR-WO-1007b). It reads every
operator setting and the manifest **before** it imports this package, so nothing this package runs at
load time can choose what approves it.

**Installing.** Install editions with install scripts disabled: `npm install --ignore-scripts`, or
`ignore-scripts=true` in the operator's `.npmrc`. An install script is code that runs before any
node exists, so no check at start can see it. This package declares none, and the core's
supply-boundary check makes any edition that declares one (or ships a `binding.gyp`, which npm turns
into one) a finding, so an edition that needs install-time code is visible before it is installed
(CSR-WO-1007c).

**Starting a node.** `CLEARSEAL_EDITION=@clearseal/teaching clearseal-node`, with the settings in
`.env.example`. The edition is named, never pathed: the operator's own install decides what the name
resolves to. Start it without a module-loading flag: `clearseal-node` refuses to start when
`NODE_OPTIONS` or the command line carries `--import`, `--require`/`-r`, a loader, a config file, a
startup snapshot or a package map, because each runs code before the node reads its settings.

**The operator names the audit store too.** A node records every refusal and every call that
reaches a handler, in a hash-chained JSON-lines log with signed checkpoints to a separate anchor
file, or it does not start (CSR-WO-2002; the `AUDIT_*` settings in `.env.example`). Arguments are
never written, only keyed digests.

- **Deployed:** set `AUDIT_LOG`, `AUDIT_ANCHOR`, `AUDIT_DIGEST_KEY_FILE` and `AUDIT_DIGEST_KEY_ID`,
  and `AUDIT_SIGNING_KEY_FILE` and `AUDIT_SIGNING_KEY_ID`, with keys you made and hold. Check the
  log with `npm run audit -- verify --log … --anchor … --keys …`.
- **Development:** `node scripts/audit-dev-keys.mjs <a directory outside the repository>` prints
  those settings for throwaway keys (not for production). Or set `AUDIT_STORE=seam-only`, which
  keeps the stderr line and writes a loud `audit-unanchored` row at start.

**A rate limit, and a tripwire that refuses nothing** (CSR-WO-2007). Every authenticated request
counts against its principal's budget; a principal over it is refused with `429` and `Retry-After`,
and nobody else is. A principal reading `notes.read` unusually fast writes one loud
`tripwire-read-burst` audit row per burst, and every call is answered as it would be anyway. Both
are on by default, with defaults no honest single client reaches; the `RATE_LIMIT_*` and
`TRIPWIRE_*` settings in `.env.example` change them.

**Approval** (CSR-WO-2001). This edition pins no `elevated` tool, so it needs no approval backend. An
edition that does sets `APPROVAL_BACKEND=listener`: such a tool runs only after a different principal
approves that exact call on a second listener the caller cannot reach, and a call that discharges
Rule-of-Two is approved by a person only. The `APPROVAL_*` settings are in `.env.example`.

**The notes root is part of the pinned contract.** `notes.read`'s containment domain is the root,
and the domain is hashed. Moving the store is a code change (the root in `src/notes.ts`) that changes
the tool's hash, so the node refuses to start until the operator re-approves the committed manifest:
`npm run pin -- approve --definitions <definitions for the new root> --manifest <file> --yes`. The
root is not a variable, and the manifest is the operator's to name, never the edition's.

The committed manifest, `pins/teaching.json`, pins the default root. Its drift test fails CI when
the definitions and the manifest disagree.

**Windows.** The `fs:` grammar is POSIX-only (upstream entry 13), so the root is a POSIX path. On
Windows it names a directory on the current drive; the core's in-process cage compares such paths
lexically there, and an edition's OS cage is the boundary.

**Known limits of the core's in-process cage, stated for this edition** (architecture §5
*Containment matching*; measured in `test/notes.test.ts`). The core's in-process cage is not an OS
boundary, and this edition ships no OS cage (P3 and P4 editions do):

- A **hard link** placed in the notes root by someone with write access to it points wherever it
  was made to, and `notes.read` follows it. A read-only mount or an OS cage closes this.
- On **Windows**, a **symbolic link** in the root is followed too: the in-process cage resolves no
  links there.
- A **FIFO** placed in the root blocks the read until the handler times out, and the blocked open
  holds a worker thread and a slot of the concurrency cap past the timeout. Enough of them make the
  node unavailable until restart. This is a core defect, reported for a follow-up (it needs the cage
  to refuse a file that is not a regular one before it blocks).

So the notes root must be writable only by the operator who pins it.
