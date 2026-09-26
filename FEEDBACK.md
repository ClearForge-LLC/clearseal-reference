# FEEDBACK: CSR-WO-1006 (frozen admitted tools, regular files only, a Windows cage that resolves links)

Branch `wo/CSR-WO-1006`, cut from `main` at `9761796` (the docs commit after `-1004`'s merge at
`bfeb418`). Parked as one unmerged pull request. Built on Node v24.21.0. **P1 exits only after this
merges.**

## Read this first

- **The three items are built, each with red-proofs, and CI is green on both runners.** Admitted
  tools are frozen. The cage refuses any non-regular file without waiting. On Windows the cage
  resolves links, measured first on `windows-latest`. The `-1004` Windows known-limit test now
  asserts the refusal.
- **Decision-needed, high: the adversary found a second N2 route that this WO's protected surfaces
  keep me from closing (A1).** `transport/server.ts` checks `PinnedRegistry.isGenuine` once at
  start (line 217). It then reads `options.registry`, `options.serverInfo` and
  `options.requestStateKey` from the caller's options object on every request (lines 413-417). So
  code that still holds that object can swap in a forged registry after start. `tools/list` then
  serves the forged description, and a call runs a forged handler with a forged `validate`. The
  admitted tools themselves cannot change. The registry the transport looks them up in can.
  `transport/**` is protected here, and §7 says to flag and stop when a protected surface must
  change, so I did not touch it. The fix is small: capture the checked registry, `serverInfo`
  and key once at start. It is asserted as a known limit
  (`frozen.test.ts`, *known limit (CSR-WO-1006 adversarial A1)*), so the fix turns that test red
  and flips it. Like `-1004`'s A6, it is supply-side: a handler never receives the options object.
- **Decision-needed, low: the audit line does not name the file type (D-1).** A non-regular file is
  refused, recorded with `fileType`, and heard by the audit seam. But `dispatch.ts` (protected)
  writes `containment-refused` with `tool`, `kind` and `sink` only. Naming the type in the audit
  line is a one-field change there.
- **Found and fixed in the working surface: A9.** Before this WO, a link inside a root into a
  directory whose real path is longer than `PATH_MAX` made `resolveReal` judge an ancestor
  instead. A `w` open then truncated the outside file before the Linux post-open check refused
  it. Now a resolution that fails for any reason but absence matches no root.

## §3.2 Admitted tools are immutable: the mutation attempts, then `tools/list` again

`packages/core/test/pinning/frozen.test.ts`, on a started node. Every attempt goes through a value
`list()` or `get()` returned, or a value the caller kept. `tools/list` is then asked again with the
identical request, and the two bodies are compared byte for byte:

```
FROZEN mutation attempts, then tools/list again (502 bytes before, 502 after, identical: true):
FROZEN get().definition.description = …: TypeError
FROZEN list()[0].definition.description = …: TypeError
FROZEN get().definition = { … }: TypeError
FROZEN Object.defineProperty(definition, description): TypeError
FROZEN Object.defineProperty(definition, title) (a new served field): TypeError
FROZEN Object.setPrototypeOf(definition, { toJSON }): TypeError
FROZEN definition.toJSON = …: TypeError
FROZEN schema.properties.q.description = …: TypeError
FROZEN schema.properties.injected = …: TypeError
FROZEN schema.required.push(…): TypeError
FROZEN delete schema.properties.q: TypeError
FROZEN get().handler = evil: TypeError
FROZEN Object.defineProperty(tool, handler): TypeError
FROZEN get().validate = () => true: TypeError
FROZEN get().paramHeaders.push(…): TypeError
FROZEN get().paramHeaders[0].header = …: TypeError
FROZEN list()[0] = evil tool: TypeError
FROZEN list().push(evil tool): TypeError
FROZEN the caller's schema: properties.q.description = …: no error
FROZEN the caller's definition: description = …: no error
FROZEN the caller's definition: handler = evil: no error
FROZEN the caller's Proxy answers differently after admission: no error
FROZEN tools/call a.search after the attempts → 200 "original handler"; missing required q → 400
```

The four "caller's" rows succeed on the caller's own objects and change nothing served. The gate
served its canonical snapshot (`JSON.parse` of the hashed canonical JSON, deep-frozen, `gate.ts`
line 126), not the caller's objects, so a shared schema, a later-edited definition and a Proxy that
answers differently after admission all reach nothing. That confirms §1.1's "already a frozen
snapshot". Every route through a value the registry handed out throws `TypeError` where it is
tried, and the test asserts it.

## §3.3 FIFO, socket, device and directory refusals, with timings and the slot count after

`packages/core/test/containment/regular-files.test.ts` (Linux run; the FIFO, socket and device
cases are POSIX, and the directory case runs on both runners):

```
REGULAR directory, mode r: ContainmentRefusal fileType=directory in 0.2 ms
REGULAR fifo, mode r: ContainmentRefusal fileType=fifo in 0.1 ms
REGULAR fifo, mode w: ContainmentRefusal fileType=fifo in 0.1 ms
REGULAR fifo, mode a: ContainmentRefusal fileType=fifo in 0.1 ms
REGULAR fifo, mode r+: ContainmentRefusal fileType=fifo in 0.1 ms
REGULAR socket, mode r: ContainmentRefusal fileType=socket in 0.1 ms
REGULAR /dev/null under a declared root /dev, mode r: ContainmentRefusal fileType=character-device in 0.1 ms
REGULAR /dev/zero under a declared root /dev, mode r: ContainmentRefusal fileType=character-device in 0.1 ms
REGULAR /dev/tty under a declared root /dev, mode r: ContainmentRefusal fileType=character-device in 0.1 ms
REGULAR regular → fifo, mode r (opens at once under O_NONBLOCK; the fstat refuses it): ContainmentRefusal fileType=fifo in 3.8 ms
REGULAR regular → fifo, mode w (no reader: ENXIO under O_NONBLOCK): ContainmentRefusal fileType=fifo in 2.0 ms
REGULAR regular → fifo, mode r+: ContainmentRefusal fileType=fifo in 3.3 ms
REGULAR regular → fifo, mode wx (O_EXCL: EEXIST, and a fifo now at the leaf): ContainmentRefusal fileType=fifo in 2.2 ms
REGULAR regular → fifo, mode ax+ (O_EXCL: EEXIST): ContainmentRefusal fileType=fifo in 3.5 ms
REGULAR regular → directory, mode w (EISDIR): ContainmentRefusal fileType=directory in 0.3 ms
REGULAR regular → directory, mode a+ (EISDIR): ContainmentRefusal fileType=directory in 0.2 ms
REGULAR regular → directory, mode wx (EEXIST): ContainmentRefusal fileType=directory in 0.2 ms
REGULAR regular → socket, mode r (ENXIO): ContainmentRefusal fileType=socket in 0.4 ms
REGULAR node: 8 fifo.read calls against 2 slots, handler timeout 3000 ms → statuses [500], slowest 12.2 ms; containment-refused lines 8; handler-timeout lines 0; inFlight after 0; a regular read after → 200
REGULAR audit line: containment-refused {"tool":"fifo.read","kind":"fs","sink":"/tmp/clearseal-regular-…/root/fifo","principal":"test-principal"}
```

The swap rows use a `CageEffects` wrapper that replaces the path just before the real open, so they
exercise the race between the lstat and the open. Before this WO, the same node case under the
`-1004` cage (`cage.ts` from `main`) did not finish in 60 s, and `timeout` terminated it. Blocking
FIFO opens pinned libuv's pool threads, and the close and every later call queued behind them.

## §3.4 The Windows measurement (`windows-latest`, CI run 36267618144, measure first)

The probe (`windows-links.test.ts`, its MEASURE lines) was pushed alone, before any change to the
cage. What `realpathSync.native` and `lstat` report there:

```
MEASURE platform=win32 realpath.native /tmp/clearseal-links-…/root: "D:\\tmp\\clearseal-links-…\\root"
MEASURE platform=win32 lstat /tmp/clearseal-links-…/root/junction: {"link":true,"dir":false,"file":false}
MEASURE platform=win32 realpath.native /tmp/clearseal-links-…/root/junction: "D:\\tmp\\clearseal-links-…\\outside"
MEASURE platform=win32 realpath.native /tmp/clearseal-links-…/root/junction/secret.txt: "D:\\tmp\\clearseal-links-…\\outside\\secret.txt"
MEASURE platform=win32 realpath.native /tmp/clearseal-links-…/root/unc-link.txt: "\\\\localhost\\C$\\Windows\\win.ini"
MEASURE platform=win32 realpath.native variant /TMP/CLEARSEAL-LINKS-…/ROOT: "D:\\tmp\\clearseal-links-…\\root"
MEASURE platform=win32 realpath.native variant /tmp/clearseal-links-…/ROOT: "D:\\tmp\\clearseal-links-…\\root"
MEASURE platform=win32 realpath.native variant d:/tmp/clearseal-links-…/root: "D:\\tmp\\clearseal-links-…\\root"
MEASURE platform=win32 realpath.native variant D:/tmp/clearseal-links-…/root: "D:\\tmp\\clearseal-links-…\\root"
MEASURE platform=win32 realpath.native variant d:\tmp\clearseal-links-…\root: "D:\\tmp\\clearseal-links-…\\root"
MEASURE platform=win32 realpath.native variant \\?\D:\tmp\clearseal-links-…\root: "D:\\tmp\\clearseal-links-…\\root"
```

So `realpathSync.native` follows symlinks and junctions (a junction's target is returned), and
`lstat` reports a junction as a link. One spelling comes back for every variant tried: the drive
letter upper-cased, backslashes, the on-disk case, the `\\?\` prefix dropped, and an 8.3 short
name expanded. The runner's temp directory, which `os.tmpdir()` reports with a `~1` component,
came back in its long spelling; those two lines are left out here because they carry a
user-profile path. That is an honest root comparison, so there was no flag-and-stop. Roots and
paths both go through the same resolver and compare exactly.

After the change (CI run 36268330192), real opens through the cage, then the teaching node:

```
LINKS platform=win32 a \\?\ prefix (\\?\D:\tmp\clearseal-links-…\root\inside.txt): refused
LINKS platform=win32 a dangling symlink (/tmp/clearseal-links-…/root/dangling.txt): refused
LINKS platform=win32 a drive-letter spelling (D:/tmp/clearseal-links-…/root/inside.txt): refused
LINKS platform=win32 a file symlink at the leaf, to outside (/tmp/clearseal-links-…/root/file-link.txt): refused
LINKS platform=win32 a file through a directory symlink, to outside (/tmp/clearseal-links-…/root/dir-link/secret.txt): refused
LINKS platform=win32 a file through a junction, to outside (/tmp/clearseal-links-…/root/junction/secret.txt): refused
LINKS platform=win32 a junction at the leaf (/tmp/clearseal-links-…/root/junction): refused
LINKS platform=win32 a regular file inside the root (/tmp/clearseal-links-…/root/inside.txt): opened "inside\n"
LINKS platform=win32 a symlink at the leaf to a file inside the root (a link is refused, wherever it points) (/tmp/clearseal-links-…/root/inside-link.txt): refused
LINKS platform=win32 a symlink to a UNC path (/tmp/clearseal-links-…/root/unc-link.txt): refused
LINKS platform=win32 backslash separators (\tmp\clearseal-links-…\root\inside.txt): refused
LINKS platform=win32 the root spelled upper-case (/TMP/CLEARSEAL-LINKS-…/ROOT/INSIDE.TXT): opened "inside\n"
LINKS platform=win32 the root's last component in another case (/tmp/clearseal-links-…/ROOT/inside.txt): opened "inside\n"
WINDOWS-MEASURE platform=win32 planted junction read: 500 {"jsonrpc":"2.0","id":14,"error":{"code":-32603,"message":"The tool reached outside its containment domain (file system)
WINDOWS-MEASURE platform=win32 planted symlink read: 500 {"jsonrpc":"2.0","id":13,"error":{"code":-32603,"message":"The tool reached outside its containment domain (file system)
test (windows-latest)	Run npm run check	2026-09-26T20:08:01.6440943Z REGULAR directory, mode r: ContainmentRefusal fileType=directory in 0.4 ms
```

The `-1004` teaching test flipped. It had asserted `200` with the outside text on win32 as a known
limit, and now asserts the refusal on every platform. It also gained a planted junction. The
`-1004` run measured `planted symlink read: 200 … SECRET OUTSIDE THE ROOT`, and that is the
before.

**What is and is not closed on Windows.** Closed: a symlink, directory symlink or junction planted
in a root, at the leaf or on the way, pointing outside; a UNC target; a dangling link; a leaf link
even to a file inside the root; and case and drive-letter spellings, which resolve to one form.
Drive-letter, `\\?\` and backslash spellings were already refused by the path grammar and still
are. **Not closed:** the check-then-open race. Windows has no `O_NOFOLLOW` and no post-open path
check here, so a link swapped in between the check and the open is followed. That stays the edition
OS cage's job (P4), and the docstring says so. Hard links are unchanged: not detectable here, as
stated.

## §3.5 Red-proofs (N5), each on a committed tree

Each mutant is applied to the committed source, the named test is run, and the file is restored.
The tree was asserted clean after each matrix.

| # | Mutant | Test | Result |
|---|---|---|---|
| M1 | `frozenTool` returns the tool as prepared | frozen | RED |
| M2 | the definition copied, not frozen | frozen | RED |
| M3 | `paramHeaders` not frozen | frozen | RED |
| M4 | the tool object not frozen (handler, validator swappable) | frozen | RED |
| M5 | `deepFreeze` stops at the top level | frozen | RED |
| M6 | `list()` returns an unfrozen array | frozen | RED |
| M7 | no `O_NONBLOCK` | regular-files | RED (timed out: the open waits) |
| M8 | no `fstat` of the descriptor after the open | regular-files | RED |
| M9 | no lstat pre-check of the leaf's type | regular-files | RED (the FIFO is opened) |
| M10 | `ENXIO` not recorded as a refusal | regular-files | RED |
| M11 | a FIFO counts as regular | regular-files | RED |
| M12 | a directory counts as regular | regular-files | RED |
| M13w | the pre-open leaf lstat removed, and no `O_NOFOLLOW` (the Windows layering, on Linux) | windows-links | RED |
| M14w | `resolveReal` unresolved, and no post-open `/proc` check (the `-1004` Windows cage, on Linux) | windows-links | RED |
| M15 | `resolveReal` walks up past any error (the pre-A9 fallback) | windows-links | RED |
| M16 | `EISDIR`, and `EEXIST` under `O_EXCL`, from a swap not recorded (the pre-P6-REC open) | regular-files | RED |

Two first-cut mutants stayed green on Linux, and that is how the composite rows came about. With
the leaf lstat alone removed, `O_NOFOLLOW` refuses the leaf link in the kernel. With `resolveReal`
alone unresolved, the Linux post-open `/proc/self/fd` check refuses the outside file. Windows has
neither layer, which is exactly why this WO's two checks matter there. So each composite mutant
removes the Linux layer as well, simulating the Windows cage on Linux. M13w first stayed green a
second time, because `nonRegular()` on the same lstat names a leaf link `symlink` and refuses it.
The mutant that goes red removes the pre-open lstat entirely. The Windows-native red is the
`-1004` CI measurement above.

## The choices (WO §1.1, §1.3)

- **§1.1: frozen in place, not frozen copies.** `list()` and `get()` return the registry's own
  objects, frozen at construction. The object dispatch runs is then the object `tools/list`
  serves, there is one identity per tool, and a `tools/list` costs no copy. Nothing that holds one
  can change it. `list()`'s array is fresh per call and frozen too.
- **§1.1: functions held by frozen references, not frozen themselves.** The handler is the
  edition's function object, and the validator and the cage factory are the core's. Freezing them
  would change objects the core does not own, and nothing served is read from them. What must not
  change is which function runs, and the frozen tool fixes that.
- **§1.1, the boundary stated: patching shared built-ins.** Code that patches
  `Object.prototype.toJSON`, `JSON.stringify` or `ServerResponse` changes every response, envelope
  and all. The adversary confirmed `Object.prototype.toJSON` and `Map.prototype.get` (A3, A4). No
  per-value freeze reaches that. It is whole-process compromise, which the supply-boundary check
  refuses edition-side (its forbidden globals) and an OS boundary contains.
- **§1.3: an exact comparison of canonical spellings, no case-folding.** Both sides come from
  `realpathSync.native`, which returns the on-disk case. Case-folding on top would wrongly match
  two directories that differ only in case under NTFS per-directory case sensitivity. An exact
  comparison fails closed there.
- **§1.2: the pre-open lstat refuses a non-regular leaf without opening it.** Only the descriptor
  `fstat` would suffice for the refusal, but opening a FIFO has an effect: it wakes a writer blocked
  on the other end. So a FIFO seen by the lstat is never opened (asserted by counting opens,
  M9). The `O_NONBLOCK` open plus `fstat` catches one swapped in after the lstat.

## Deviations

- **D-1: the audit line does not carry `fileType`.** See "Read this first". It is in the `Reach`
  record and the thrown `ContainmentRefusal` message, but `dispatch.ts` is protected.
- **D-2: `containment/harness.ts` changed, and `containment/within.ts` is new.** The reach harness
  called `resolveReal` and kept its own `/`-separator copy of `within`. Once `resolveReal` returns
  Windows native form, four harness tests failed on `windows-latest` (CI run 36268030776). The
  harness now imports the cage's one comparison from `within.ts`, an internal module the core's
  `index.ts` does not re-export, so the public API is unchanged. `harness.ts` is not on §2's
  protected list, but it is not a named working surface either, hence this line.
- **D-3: a known-limit test for A1** asserts today's behaviour, in the `-1004` known-limit pattern,
  so the transport fix flips it.

## Adversarial pass (fresh subagents, WO §5; each in its own worktree, since removed)

Two passes. The first finished §5.1 and found A1. Partway into §5.2 a safety classifier stopped its
response, and it had not written the §5.3 file. A second fresh subagent then ran §5.2 (212 POSIX
cases, each a real `cage.open` or a `tools/call` on a started node, timed with a hang watchdog) and
wrote the §5.3 Windows file. That file is committed as
`packages/core/test/containment/adversary-windows.test.ts` and runs in CI: on win32 each case
asserts the safe outcome, and on POSIX the one test asserts it is not on win32 and returns. I
spot-checked every claim below against the code or by running it before adopting it.

| ID | Route | What mattered | Outcome | Severity | Disposition |
|---|---|---|---|---|---|
| A1 | Replace `options.registry` (or `serverInfo`) on the object passed to `startTransport`, after start | `tools/list` served a forged description; a call without the required argument ran a forged handler (200) | **HOLE** | high (N2; supply-side, a handler never holds the options) | **Not fixed: `transport/server.ts` is protected.** Confirmed at `server.ts` lines 217 and 413-417. Asserted as a known limit. *Decision-needed* |
| A2 | The same, with another genuine `PinnedRegistry` | That registry was served without start-up's pin-refused audit or the strict check | HOLE (A1's root cause) | high | as A1 |
| A3, A4 | Pollute `Object.prototype.toJSON`; patch `Map.prototype.get` | `tools/list` bytes changed; a forged handler ran | whole-process built-in patching | — | Out of reach of any per-value freeze; stated in the choices |
| A5 | A handler's `this` is its frozen `RegisteredTool` (dispatch calls `tool.handler(...)` as a method); it calls `this.newCage()` itself | The open was refused, no escape; but that cage is not dispatch's, so no audit line, and the call returned 200 | audit bypass, no escape | low | Not fixed: `dispatch.ts` is protected; the fix is to call the handler unbound. Handler code is already trusted |
| A6 | `pinning.isRefused`, `pinning.refused`, the prototype, `setPrototypeOf(registry)`, `reachTargets()` output, the function objects | TypeError, or fresh objects; nothing served changed | HELD | — | — |
| A7 | `t.config.limits.maxInFlight = 0` after start | The next call got 503: the running config is not frozen | runtime config tamper | low | Outside this WO (transport); reported |
| A9 | A link in the root into a directory whose real path exceeds `PATH_MAX` | `resolveReal` judged an ancestor, so a `w` open truncated the outside file before the post-open check refused it | **HOLE** | high (N4, write modes) | **Fixed:** a resolution failing for any reason but absence matches no root. Red-proof M15; regression in `windows-links.test.ts` (all four modes refused, outside file byte-identical) |
| P1-P5, P7, P8 | FIFO in every mode, with and without a peer; socket; `/dev/tty`, `/dev/zero`, `/dev/stdin`, `/dev/fd/0`, `/proc/self/fd/0`, `/proc/self/root/...`; a FIFO via a directory link; `//`, `/./` and `..` spellings; a directory; trailing slashes | Refused naming the type (or as a link or out-of-root path), in 0.1-0.7 ms, no bytes; a peer's data still unread; nothing outside touched | HELD | — | — |
| P6 | FIFO, socket, directory or link-to-FIFO swapped in between the lstat and the open, every mode, with peers | Refused, no bytes, no wait (at most 2 ms) | HELD | — | — |
| P6-REC | The same swap to a directory in a write mode (`EISDIR`), or to a FIFO, socket or directory under `O_EXCL` (`EEXIST`) | No wait, no bytes, nothing touched, but a plain fs error with no refusal recorded | HOLE (recording only) | low | **Fixed:** recorded, naming the type. Red-proof M16; five swap rows in `regular-files.test.ts` |
| P10 | A started node, 2 slots, 2000 ms handler timeout: 40 calls in waves across FIFO, socket, `/dev/tty` and a directory, 5 swap calls, and a burst of 30 concurrent FIFO calls | All 500, none 503; slowest 14 ms; 0 handler-timeout lines; `inFlight()` 0 after; a normal read 200 | HELD | — | — |
| P11 | `O_NONBLOCK` on the regular-file handle the cage returns | The flag stays set on the descriptor; an 8 MiB read and a 4 MiB write were byte-exact | HELD (no effect) | info | Stated: a handler that hands the descriptor to other code passes the flag on |
| P12 | A FIFO swapped in while a real reader is blocked on it | Refused; the reader was woken with EOF (0 bytes), because the `O_NONBLOCK` open happens before the `fstat` closes it | HELD | info | Stated: "never opened" holds for a FIFO the lstat sees, not one swapped in after it |
| W1-W7 | Windows (§5.3), real opens on `windows-latest`: a junction to outside as the leaf and on the way (modes r, w, r+, and wx creating), a UNC link, a file link, a junction to inside as the leaf, a root declared as a junction (below it, `..` out of it, a junction to outside under it), and case variants of root, leaf, link and junction | Links to outside, and a junction leaf even to inside, refused (0.1-0.6 ms); the inside file opened through a junction to inside, the junctioned root and every case variant; nothing created outside (`outside` still holds only `secret.txt`) | HELD | — | — |
| W8 | DOS device names under the root (`NUL`, `nul.txt`, `CON`, `COM1`, `AUX`, `PRN`, `LPT1`, `CONIN$`, `CONOUT$`), mode r | `ENOENT`, never opened | HELD | — | — |
| W8b | `root/NUL` in mode `w` | **Opened**, and the case went red (CI run 36269527082). The raw-open probe then measured what it was: on this runner a `w` open of `NUL` in a directory creates a regular file named `NUL` (`{"file":true,"char":false,"size":0,"listed":["NUL"]}`), not the device | not a device hole on this runner | low | **Hardened anyway:** older Windows maps these names to the device in any directory, so on win32 a reserved device name in any component (any extension, trailing dots and spaces) is refused as a `character-device` before any open (`CON` in r+ likewise). Now HELD. The red-proof is the red run |
| W9 | Alternate data streams: an inside file's named stream and `::$DATA`; `::$DATA` and a named stream on a file link to outside; a stream on a junction; a directory's `::$INDEX_ALLOCATION`; a stream on the root | Inside streams opened inside data only; every link and junction form refused, or `ENOENT`; the directory refused as a directory | HELD | — | — |
| W10 | Trailing dot or space on an inside file, a file link, a junction on the way, a junction leaf | `ENOENT` for all: Win32's trailing-dot stripping does not apply to what Node passes | HELD | — | The first cut of the case counted an `ENOENT` on an inside file as a hole. It reads nothing, so the case was widened to accept an error (the second red, CI run 36269725642) |
| W11 | `.. ` and `...` components; `.. ` under a missing directory in mode w; the root's parent | `ENOENT`, or refused; nothing created outside | HELD | — | — |
| W6 | 8.3 short names: an inside file's; the base directory's, to a file inside and outside the root; a root declared by its 8.3 spelling | The inside file opened; the outside file refused; the 8.3-declared root matched its long spelling | HELD | — | A short name could not be set on the file link, so its case (W6b) was not measured |


## Gates

- `npm run check` exits 0 from a clean state (every `dist/` removed first, as CI runs it): 599
  core and teaching tests, spike 0102 69, spike 0101 8, `test:subset` 4.
- `node scripts/leak-gate.mjs --tree` exit 0; `--history` exit 0, run unpiped before every push
  with the exit code checked directly.
- CI: green on both runners (`ubuntu-latest`, `windows-latest`) with leak-gate, sbom and audit, at
  `b8b4f8a` (run 36269912585) before FEEDBACK; the head's run is in the pull request.
- Protected surfaces diff to empty against `9761796`. `pinning/registry.ts` and
  `containment/cage.ts` are the working surface, plus D-2.
- No token was needed until the PR. The minted token lived in a mode-0600 scratch file, was never
  written to git config or a remote URL, and was deleted after the PR was opened.

## What was not built

- The transport fix for A1 (protected; decision-needed).
- `fileType` in the `containment-refused` audit line (D-1; protected).
- The Windows check-then-open race (P4, the edition OS cage), hard links (unchanged, stated), and
  anything in the gate, the canonical form, auth or the teaching edition's source.
