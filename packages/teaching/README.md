# @clearseal/teaching

The ClearSeal teaching edition: a notes store as the carrier (architecture §3.3). It is thin by
rule (N1): it exports tool definitions, the path of its approved manifest, a configuration schema
and a deploy scaffold, and nothing else. The verifier, the pin gate, the registry, the transport
and the cage are the core's. The core's supply-boundary test holds this package to that list.

| Module | What it is | ClearSeal clause |
|---|---|---|
| `src/notes.ts` | `notes.read`, a `read_only` tool contained to the notes root | N7 (capability class, containment domain); the cage is the only way out |
| `src/config.ts` | the configuration schema, validated at start | N4: a configuration outside the schema refuses start |
| `src/start.ts` | the deploy scaffold: the core's `loadPinnedRegistry`, then `startTransport` | N1, N2: the only registration path is the core's |
| `src/index.ts` | the public entry, and its declared export kinds (`package.json`, `clearseal.exports`) | N1: the supply boundary |
| `bin/teaching-node.ts` | starts a node from the environment | — |

**The notes root is part of the pinned contract.** `notes.read`'s containment domain is the root,
and the domain is hashed. Moving the store (`TEACHING_NOTES_ROOT`) changes the tool's hash, so the
node refuses to start until the operator re-approves: `npm run pin -- approve --definitions
<definitions for the new root> --manifest <file> --yes`.

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
