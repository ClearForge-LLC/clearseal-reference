# FEEDBACK: CSR-WO-1002 (containment: the domain, the Cage, N7 at construction, per-call cages, the reach harness)

Branch `wo/CSR-WO-1002`, cut from `main` at `dbceb68`, one commit. Parked as one unmerged pull
request. Built on Node v24.21.0.

## Construction refusals (WO §3.2)

Pasted from `packages/core/test/containment/construction.test.ts`. Each refusal names the tool
and the entry. The domain is parsed from the gate's frozen snapshot, never from the live
definition.

| Case | Domain | Refusal |
|---|---|---|
| unknown scheme | `["file:/tmp/x"]` | tool "t": "file:/tmp/x": an unknown scheme (fs:, host: and svc: are the three) |
| relative path | `["fs:data/notes"]` | tool "t": "fs:data/notes": an fs: root must be an absolute path |
| path not normalized (..) | `["fs:/tmp/a/../b"]` | tool "t": "fs:/tmp/a/../b": an fs: root must be normalized (no empty, "." or ".." segment, no trailing slash) |
| path with a trailing slash | `["fs:/tmp/a/"]` | tool "t": "fs:/tmp/a/": an fs: root must be normalized (no empty, "." or ".." segment, no trailing slash) |
| the whole file system | `["fs:/"]` | tool "t": "fs:/": the whole file system is not a containment domain |
| host with a path | `["host:example.invalid/api"]` | tool "t": "host:example.invalid/api": a host is a lower-case name of letters, digits and hyphens, with no scheme, path, port syntax error or trailing dot |
| host with a scheme | `["host:https://example.invalid"]` | tool "t": "host:https://example.invalid": a port is 1 to 65535, written without a leading zero |
| host in upper case | `["host:Example.invalid"]` | tool "t": "host:Example.invalid": a host is a lower-case name of letters, digits and hyphens, with no scheme, path, port syntax error or trailing dot |
| host as an address | `["host:127.0.0.1"]` | tool "t": "host:127.0.0.1": a host is a name, never an address literal |
| port with a leading zero | `["host:example.invalid:0443"]` | tool "t": "host:example.invalid:0443": a port is 1 to 65535, written without a leading zero |
| service outside the name pattern | `["svc:Mail Queue"]` | tool "t": "svc:Mail Queue": a service name must match [a-z0-9][a-z0-9._-]{0,63} |
| arbitrary_exec with a domain | `["fs:/tmp/x"]` (arbitrary_exec) | tool "t": arbitrary_exec is refused a containment domain (N7) |
| arbitrary_exec at all (default flag) | `null` (arbitrary_exec) | tool "t": arbitrary_exec is refused while EXEC_TOOLS_FORBIDDEN is on (N7) |
| unsorted list (parser) | `["fs:/tmp/b","fs:/tmp/a"]` | "fs:/tmp/a" is out of order: the domain is not canonical (A7) |
| duplicated list (parser) | `["fs:/tmp/a","fs:/tmp/a"]` | "fs:/tmp/a" appears twice: the domain is not canonical (A7) |

**More refusals, from the adversarial pass:** NUL or a backslash in a root; a port over 65535;
hex host forms (`host:0x7f000001`, `host:a.0x1`); a numeric-leading last label (`host:1a`).

**A well-formed domain of all three schemes registers.** With the flag off, `arbitrary_exec` with
a null domain registers; with any domain it is still refused.

## The harness transcript (WO §3.3)

```
PASS read_note: reaches fs:/tmp/clearseal-reach/notes/today.txt (cage), fs:/tmp/clearseal-reach/notes/today.txt (shim)
PASS fetch_status: reaches net:status.example.invalid:443 (cage)
PASS pure_sum: reaches none
FAIL leaky: undeclared fs:/tmp/clearseal-reach/outside/secret.txt (shim)
```

- `leaky` declares `null` and reads a file with `fs` directly. The shim catches it, and it fails
  naming the tool and the sink.
- `fetch_status`'s allowed connect is stubbed in tests: nothing leaves the process.
- **The Windows runner** runs the same harness with the shim only, since the shim is the observer
  on both platforms. CI reports the same verdicts.

## The dispatch refusal and its audit line (WO §3.4)

```
DISPATCH response 500 {"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"The tool reached outside its containment domain (file system)"}}
DISPATCH audit containment-refused {"tool":"null_reacher","kind":"fs","sink":"/tmp/clearseal-reach/outside/secret.txt"} | containment-refused {"tool":"swallower","kind":"fs","sink":"/tmp/clearseal-reach/outside/secret.txt"}
```

- **The path** is in the audit line only, never in the response. On the legacy era the same body
  is served at `200`.
- **`swallower`** catches the refusal and returns normally; the call still fails (N4).
- **Every refusal is audited as it happens,** through the cage's callback, so a reach made after
  the handler returned is audited too.

## What was built

- **`containment/domain.ts`:** `fs:<absolute path>`, `host:<name>[:port]` and `svc:<name>`.
  - A malformed or non-canonical entry is refused, never fixed.
  - **Names, never addresses:** an IP literal, a hex form, or a last label that does not begin
    with a letter is refused.
  - `fs:/` is refused: the whole file system is not a bound.
- **`containment/cage.ts`:** the `Cage` interface and `RecordingCage`. It is in-process, and says
  so; it enforces and records.
  - **fs:** an absolute path, POSIX-normalized, with no backslash or drive prefix. A symlink leaf is
    refused. The real path must lie under a root's real path. On Linux, the opened descriptor's
    real path (`/proc/self/fd/N`) is verified after the open, and the file is closed and refused
    if it is outside.
  - **net:** by name, lower-cased; a declared port must match; the port is an integer from 1 to
    65535.
  - **svc:** exact name.
  - **Construction:** instances and the prototype are frozen. `recordingCageFactory` resolves a
    domain's roots once per registry.
- **The registry** is the construction hook (-1001's `Admission → PinnedRegistry`).
  - N7: `arbitrary_exec` is refused a domain, and refused outright while `EXEC_TOOLS_FORBIDDEN` is
    on. That is the default, unless the variable is exactly `false`, and it is named in
    `.env.example`.
  - It parses each domain from the frozen snapshot, and gives each tool a per-call cage factory.
  - `reachTargets(corpora)` builds harness targets from the frozen domains, and throws for a
    registered tool with no corpus.
- **Dispatch:**
  - a fresh cage per call, passed as `ctx.cage`;
  - `reached` is captured before the handler runs;
  - an undeclared reach fails the call with `-32603`, naming only the kind of sink;
  - every refusal reaches the audit seam with the tool and the full sink.
- **`containment/harness.ts`:** the reusable reach harness, for editions too.
  - It runs each tool's corpus under a `RecordingCage` (or an edition's `Cage`) plus a module shim
    over fs (and fs/promises), net, `net.Socket`, dgram, dns, http, https, tls, fetch, WebSocket,
    child_process (including `ChildProcess.prototype.spawn`) and Worker. Child processes and
    workers are refused while the shim is installed.
  - fs sinks are judged by their real path.
  - The shim drains (`setImmediate` plus 25 ms) before it is uninstalled.
  - A tool that never completed a run fails.
  - A second concurrent run is refused.
  - The principal is random, so a tool cannot detect the harness.
- **Fixtures** (`test/fixtures/containment-tools.ts`): `read_note` (`fs:`), `fetch_status`
  (`host:`), `pure_sum` (`null`), pinned in `containment-manifest.json` by the CLI; and `leaky`,
  the misbehaving one, kept out of the manifest.

## Deviations

| # | Deviation | Ruling |
|---|---|---|
| D-1 | **A WO defect:** the WO named `pinning/gate.ts` protected, while §1.4 requires parsing the domain and class from the frozen admitted definition, which only `gate.ts` holds. `AdmittedTool` gains `readonly capability`: the seven tag fields, taken from the same deep-frozen snapshot that was hashed. 8 lines added and 2 removed; nothing else in `gate.ts` moved, the hash input is unchanged, and `spec-check` passes | **Ruled by the architect** (flag-and-stop, WO §7): "the minimal gate.ts change is allowed and is the only gate.ts change allowed" |
| D-2 | **A non-canonical list** (unsorted or duplicated) is refused by `parseDomain`, as WO §3.2 asks. But through the gate a definition's list is first canonicalized by A7 (ratified: sets are sorted and deduplicated), so the registry never sees an unsorted list. The refusal holds at the parser, and is a precondition on the snapshot | Recorded; A7 is the canonical form's rule |
| D-3 | **WO §3.5's wording.** "Remove the domain check in RecordingCage → harness passes the misbehaving fixture" does not hold as written: `leaky` reaches through `fs` directly, so the **shim** catches it, not the cage. Removing the cage's check turns the cage, dispatch and harness-via-cage tests red instead. Removing the shim's judgment (`declared`) turns the `leaky` verdict red | Recorded; both red-proofs are below |

## Red-proofs (N5)

40 mutants, each removing or weakening one check, were run against the containment and transport
tests, each run limited to 300 s. The script refuses to start on a tree with uncommitted changes.
37 go red. The three green ones are defence in depth, each equivalent while another layer stands,
and all three are named below.

| Mutant | Goes red in |
|---|---|
| domain | unknown scheme accepted |
| domain | relative path accepted |
| domain | normalization not checked |
| domain | whole file system accepted |
| domain | host labels not checked |
| domain | address literal accepted |
| domain | NUL or backslash accepted |
| domain | port over 65535 accepted |
| domain | port leading zero accepted |
| domain | service name not checked |
| domain | unsorted list accepted |
| domain | duplicate list accepted |
| cage | fs domain check removed |
| cage | symlink leaf allowed (A2) |
| cage | .. not normalized |
| cage | backslash accepted (A13) |
| cage | no post-open check (A3) |
| cage | port range unchecked (A15) |
| cage | port ignored |
| cage | service not checked |
| cage | refused reach not thrown |
| cage | instance not frozen (A8) |
| harness | shim reaches never judged |
| harness | real path not resolved (A4) |
| harness | no drain (A6) |
| harness | uncompleted tool passes (A6) |
| harness | overlapping runs allowed (A7) |
| harness | raw socket not observed (A5) |
| harness | spawn counted as declared |
| harness | verdict ignores undeclared |
| N7 | exec given a domain |
| N7 | exec not forbidden by default |
| registry | domain not parsed (empty cage for all) |
| registry | exec flag default off |
| dispatch | refused reach does not fail the call |
| dispatch | no cage from the tool |
| dispatch | refusals not audited (A9) |
| dispatch | reached read after the handler (A8) |
| registry | targets not required for every tool (A12) |
| dispatch | sink path in the response |

## Adversarial pass (fresh subagent, WO §5; its own scratch worktree, since removed)

| # | Finding | Severity | Status |
|---|---|---|---|
| A1 | A private IPv4 address in a test tripped the leak gate's private-ip rule (`--tree` and `--history`) | **blocker** | **Fixed:** `host:127.0.0.1` (loopback is exempt, and still refused as an address). The branch was squashed to one commit before any push, so history is clean |
| A2 | A dangling symlink leaf passed the check, and a write through it created a file outside the root | **high** | **Fixed:** a symlink leaf is refused. Tested: nothing is created outside |
| A3 | TOCTOU: the check resolved the real path, but the open used the unresolved one; a same-tick swap won 2 of 2000 races | **high** | **Fixed on Linux:** the opened descriptor's real path is verified, and the file is closed and refused if it is outside. Tested with an effect that opens a different file. **On other platforms the RecordingCage has no descriptor check;** the edition's OS cage is the boundary there, as the docstring says |
| A4 | A direct `fs` read through an in-root symlink passed the harness (lexical comparison) | medium | **Fixed:** the harness judges real paths. Tested |
| A5 | Many routes escaped the shim | medium | **Mostly fixed:** `net.Socket#connect`, dgram, dns (both APIs), WebSocket, `ChildProcess#spawn` and Worker (refused), plus the missing fs functions. **Residue, documented in `harness.ts`:** a function reference captured before the run, `process.binding`, `process.dlopen` and native addons. `realpath` is not observed, since the cage itself uses it. Tested for net, raw socket, dns and Worker |
| A6 | The harness passed vacuously: a handler that throws before reaching, a reach after return, and a principal the tool could detect | medium | **Fixed:** a tool that never completes a run fails; the shim drains before uninstalling; the principal is random. Tested |
| A7 | Concurrent harness runs corrupted the shim and left it installed | medium | **Fixed:** a reentrancy guard. Tested, including that the shim is restored |
| A8 | A handler could hide a swallowed refusal by replacing `ctx.cage.reached` or patching the prototype | low–medium | **Fixed:** the cage and its prototype are frozen, and dispatch captures `reached` before the handler. Tested |
| A9 | A refusal after the handler returned was never audited | low | **Fixed:** the cage reports each refusal through a callback, and dispatch audits it. Tested |
| A10 | Scale: every call's cage re-resolved all N roots (about 185 ms at 10,000 roots), and an allowed check did N realpath calls | medium (perf) | **Partly fixed:** roots are resolved once per registry, and the path once per check; the check itself is a linear scan over roots. Measured: parsing 10,000 entries takes about 10 ms. A prefix index is a proposed follow-up if a real tool ever declares thousands of roots |
| A11 | Gaps: several mutants survived | medium | **Fixed:** tests for a shared cage (#25), a declared fs tool reaching outside (#26), the harness ignoring cage refusals (#37), the net shim (#35/#40), spawn not blocked (#33), the shim not uninstalled (#38), NUL/backslash (#12) and the upper port bound (#17). See the matrix |
| A12 | The harness took a hand-kept tool list and the **live** domain | low–medium | **Fixed:** `PinnedRegistry.reachTargets(corpora)` builds targets from the frozen domains, and throws for a registered tool with no corpus |
| A13 | Windows: a backslash path passed POSIX normalization and could open outside the root | medium on Windows (inferred) | **Fixed:** a path with a backslash or a drive prefix is refused. Tested |
| A14 | Hex address forms were accepted as host names | low | **Fixed:** a hex label is refused, and the last label must begin with a letter. Tested |
| A15 | A nonsense port was allowed on a portless entry | low | **Fixed:** 1 to 65535, integers only. Tested |
| A16 | Semantics, stated for the architect | info | See below |

### Rules and semantics stated (WO §5 item 3, adversarial A16)

- **Names, never addresses.** The cage matches the declared host string, lower-cased. A connect by
  an IP literal to a host declared by name is refused, even when the name resolves to that
  address. An edition may only widen this on the declaration side, by declaring the name it
  connects to; the core never resolves names to compare addresses.
- **A root that is itself a symlink** is followed once, at registration, and that real path is the
  bound.
- **`[]` and `null` are distinct,** as A7 ratified: `[]` claims containment to nothing, `null`
  claims no containment. Both refuse every reach. With `arbitrary_exec`, `[]` gets the "refused a
  domain" refusal.
- **An `fs:` root grants every mode:** read, write, append. Per-mode domains would be a canonical-
  form change.
- **An `fs:` path may contain a newline.** It is not refused, because it is a legal file name
  character; a later WO may narrow the character set.
- **A construction refusal stops the node** even when `PIN_STRICT=false`. Non-strict relaxes pin
  drift, never a containment rule.

**Held (measured by the subagent):**
- `parseDomain` fuzzing: 200k soundness runs and 100k completeness runs, 0 violations.
- A domain widened on the live definition after admit has no effect.
- The N7 matrix is correct.
- 200 interleaved concurrent calls did not leak cages.
- The legacy era serves the same body at 200, with no path.
- A symlink inside a root to outside is refused.
- `..`, relative paths, prefix siblings and `file://` are refused.
- Protected surfaces diff empty apart from D-1.

**Decision-needed (WO §6):** whether the fleet's 26-tool reference node uses a sink the three
schemes cannot express. I did not measure it here: the reference node's tool catalogue is outside
this repository. Candidates to check are a per-mode file sink (read-only vs write), a device sink
(a phone's clipboard or sensors, which that node exposes), and a sink named by URL path rather than
host. Each would be a new scheme, which is a canonical-form version change.

## Gates

| Gate | Result |
|---|---|
| `npm run check` | exit 0: core **358** tests (24 files), spike 0102 69, spike 0101 8, `test:subset` 4 |
| CI | both runners, on the pull request |
| Protected surfaces | The four steering documents, `LICENSE`, `NOTICE`, `scripts/**`, `.github/**`, `spikes/**`, `docs/canonical-form.md`, `canonical.ts`, `fields.ts`, `manifest.ts`, the oracle and the vectors diff **empty**. `gate.ts` has only D-1. The registry and dispatch changed only where they construct and pass the cage. `transport/registry.ts` has the `cage` field on `CallContext` and `newCage` on `RegisteredTool` |
| Leak gate | `--tree` and `--history` exited 0 before the push, each checked by exit code |
| Credentials | Pushes went over the repository's write deploy key. A short-lived token was minted only to open this pull request, kept in a mode-0600 scratch file, and deleted straight after |

## What did not work, and why

- **The first red-proof matrix found four green mutants.** All four were redundant code (a double
  containment check, a redundant spawn line, a redundant null-domain clause). They are removed.
  The remaining green one is equivalent on Linux only (see the table).
- **My squash commit first left out the working-tree changes,** because `reset --soft` does not
  stage them, and `--history` refused it on the old address. I amended with everything staged and
  re-ran both gates: exit 0.

## What was deliberately not built

- **An OS sandbox:** editions, P3/P4, behind `Cage`.
- **Approval, the ceiling, and audit** beyond the log line.
- **Any shipped tool** (`-1004`).
- **Re-normalizing a domain.**
- **A prefix index for very large domains** (A10), proposed.
