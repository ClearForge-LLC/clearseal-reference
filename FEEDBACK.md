# FEEDBACK: CSR-WO-1002a (containment corrections: a kernel refusal is a recorded refusal, and a read_only tool's cage reads only)

Branch `wo/CSR-WO-1002a`, cut from `main` at `37472ca`, one commit. Parked as one unmerged pull
request. Built on Node v24.21.0.

## Gates

| Gate | Result |
|---|---|
| `npm run check` | exit 0 on Node v24.21.0: core **376** tests (25 files), spike 0102 69, spike 0101 8, `test:subset` 4 |
| CI | both runners, on the pull request |
| Protected surfaces | The four steering documents, `LICENSE`, `NOTICE`, `scripts/**`, `.github/**`, `spikes/**`, `docs/canonical-form.md`, `pinning/canonical.ts`, `pinning/gate.ts`, `pinning/manifest.ts`, `capability/**`, `containment/domain.ts`, `src/auth/**` and `src/transport/**` diff **empty** against `37472ca`. `pinning/registry.ts` changed only where it hands the class to the cage factory (and to the harness targets, D-2) |
| Leak gate | `--tree` and `--history` exited 0 before the push, each checked by exit code |
| Credentials | Pushed over the repository's write deploy key. A short-lived token was minted only to open this pull request, kept in a mode-0600 scratch file, and deleted straight after |

## The swap through dispatch (WO §3.2, §5.3)

`packages/core/test/containment/corrections.test.ts`. A `state_change` tool whose root holds the
leaf, so the class allows the write and only the swap stands in the way. The cage's check sees an
ordinary file (or none, for `wx`); the effect then swaps in a symlink to a victim outside the root
and makes the real mutating open with the cage's flags, and the handler writes through the handle.

```
SWAP
| mode | response | audit | victim after |
|---|---|---|---|
| w | 500 {"code":-32603,"message":"The tool reached outside its containment domain (file system)"} | containment-refused {"tool":"swap_w","kind":"fs","sink":"<root>/in/swap-w.txt"} | VICTIM-CONTENT |
| a | 500 {"code":-32603,"message":"The tool reached outside its containment domain (file system)"} | containment-refused {"tool":"swap_a","kind":"fs","sink":"<root>/in/swap-a.txt"} | VICTIM-CONTENT |
| wx | 500 {"code":-32603,"message":"The tool reached outside its containment domain (file system)"} | containment-refused {"tool":"swap_wx","kind":"fs","sink":"<root>/in/swap-wx.txt"} | VICTIM-CONTENT |
```

`wx` is a case of its own: with `O_CREAT|O_EXCL` the kernel answers `EEXIST` for a link, not
`ELOOP` (D-1).

## The read_only table (WO §3.3)

A `read_only` cage whose `fs:` root holds the file. Each write mode was tried on the existing file
and on a fresh name; afterwards the file is byte-identical and nothing was created.

```
READ_ONLY
| mode | cage | detail |
|---|---|---|
| r | allowed | read INSIDE-ORIGINAL |
| r+ | refused | containment refused a fs reach to <root>/in/ro.txt in mode r+ |
| w | refused | containment refused a fs reach to <root>/in/ro.txt in mode w |
| w+ | refused | containment refused a fs reach to <root>/in/ro.txt in mode w+ |
| wx | refused | containment refused a fs reach to <root>/in/ro.txt in mode wx |
| wx+ | refused | containment refused a fs reach to <root>/in/ro.txt in mode wx+ |
| a | refused | containment refused a fs reach to <root>/in/ro.txt in mode a |
| a+ | refused | containment refused a fs reach to <root>/in/ro.txt in mode a+ |
| ax | refused | containment refused a fs reach to <root>/in/ro.txt in mode ax |
| ax+ | refused | containment refused a fs reach to <root>/in/ro.txt in mode ax+ |
```

Odd modes (`W`, `" w"`, `rw`, `"r "`, `R`, `""`, the numbers `1`, `O_WRONLY` and
`O_RDWR|O_CREAT`) are refused for `read_only` and for `state_change` alike: the mode table is the
only source of flags, and an unknown mode is never widened (WO §5.2). After the adversarial pass
(A5), so are an object whose `toString` says `w`, the array `["w"]`, a `String` object, and the
names of inherited keys (`__proto__`, `constructor`, `toString`): only a primitive string that is
the table's own key opens anything.

**WO §5.1, writing through an `r` handle:** `HANDLE write through an r descriptor: EBADF`. The rule: the cage governs the open, and a
descriptor opened read-only refuses **data** writes at the OS (`write`, `writeFile`, `appendFile`,
`writev`, `writeSync`: `EBADF`; `truncate`: `EINVAL`). It does **not** refuse the owner's metadata
changes: the adversarial pass changed the mode (to `4777`, setuid) and the times through an `r`
handle (A1). That is now stated in the cage's docstring as the edition OS cage's job (a read-only
mount), and is under *decision-needed*.

## Through dispatch, and no regression (WO §3.3, §3.4)

```
DISPATCH read_only w: 500 {"jsonrpc":"2.0","id":5,"error":{"code":-32603,"message":"The tool reached outside its containment domain (file system)"}}
DISPATCH audit containment-refused {"tool":"ro_writer","kind":"fs","sink":"<root>/in/dispatch-ro.txt"}
DISPATCH state_change w: 200
```

A `state_change` tool with the same root writes inside it in all nine write modes (tested
directly), and through dispatch (above). `connect` and `service` are unchanged for `read_only`.

## The seam (WO §1.3)

**Choice: a small frozen policy object,** `CagePolicy { readonly capabilityClass: string }`, made
by `cagePolicy(class)`, rather than the bare class string.

- **Why:** the seam editions implement should not change shape again when a cage needs another
  field of the tag (for example `elevated`). A frozen object carries that without a new signature.
  It is frozen, so neither a factory nor a handler can re-class a tool.
- **Where it flows:** the registry reads `capability_class` from the gate's frozen snapshot (the
  same one the domain comes from) and calls `cageFor(domain, policy)`. The default
  `recordingCageFactory(domain, policy, effects?)` takes the policy as a **required** argument, so
  a factory cannot forget it. The harness's `makeCage(domain, policy)` receives the same policy,
  and `HarnessTool` gains a required `capabilityClass` (`reachTargets` fills it from the pinned
  tag).
- **The harness fails a policy-blind edition cage.** A cage that honours the domain but ignores the
  policy, with its open taken before any shim was installed (like an OS-level cage's own open, which
  the shim cannot see):

```
HARNESS policy-blind edition cage
FAIL ro_via_cage: undeclared fs:<root>/in/harness-ro.txt (cage, write)
PASS sc_via_cage: reaches fs:<root>/in/harness-sc.txt (cage, write)
```

  The harness judges the class itself from each recorded reach's mode, and never trusts the cage's
  `allowed`: a missing mode counts as a write. It also judges direct writes the shim sees, and now
  records the second, written path of `copyFile`, `cp`, `rename`, `link` and `symlink`:

```
HARNESS direct fs
FAIL ro_direct_write: undeclared fs:<root>/in/harness-direct.txt (shim, write)
FAIL ro_direct_copy: undeclared fs:<root>/in/harness-direct.txt (shim, write), fs:<root>/in/copy.txt (shim, write)
PASS ro_direct_read: reaches fs:<root>/in/harness-direct.txt (shim)
PASS sc_direct_write: reaches fs:<root>/in/harness-direct.txt (shim, write)
```

## Red-proofs (N5, WO §2, §3.5)

**The two WO §2 names, shown:**

- **The ELOOP mapping removed:** the swap through dispatch answers
  `{"code":-32603,"message":"The tool call failed"}`, a plain handler error, not the containment
  error. The cage-level test sees the raw `ELOOP` (`Error: ELOOP: too many symbolic links
  encountered, open '<root>/in/swap-direct.txt'`) instead of a `ContainmentRefusal`. The victim
  stays intact, as `O_NOFOLLOW` still holds; what is lost is the record.
- **The class check removed:** the `read_only` tool's write through dispatch answers `200` with no
  audit line (`DISPATCH read_only w: 200 …`, `DISPATCH audit` empty). The table test and the harness
  test go red with it.

**The full matrix,** 20 mutants (15 for the WO's repairs and seam, 5 for the adversarial fixes),
each run on a committed tree against `corrections.test.ts` and all the containment tests, limited to
300 s. **All 20 go red.**

| § | Mutant | Red in `corrections.test.ts` (the same count in all containment tests) |
|---|---|---|
| §1.1 | ELOOP mapping removed | RED 8: swap-then-open through dispatch in w, a and wx: the victim is byte-identical, the call fails with the contai |
| §1.1 | ELOOP only (no EEXIST-with-link) | RED 4: swap-then-open through dispatch in w, a and wx: the victim is byte-identical, the call fails with the contai |
| §1.1 | EEXIST mapped without the link check | RED 4: any other open error passes through unchanged and records nothing more |
| §1.1 | kernel refusal not recorded, only rethrown as ContainmentRefusal | RED 8: swap-then-open through dispatch in w, a and wx: the victim is byte-identical, the call fails with the contai |
| §1.2 | class check removed | RED 12: r inside the root is allowed; every write mode inside the root is refused, naming the mode, and the file is  |
| §1.2 | read_only admits r+ | RED 4: r inside the root is allowed; every write mode inside the root is refused, naming the mode, and the file is  |
| §1.2 | policy ignored by the cage | RED 12: r inside the root is allowed; every write mode inside the root is refused, naming the mode, and the file is  |
| §1.3 | factory drops the policy | RED 4: through dispatch: a read_only tool's write inside its root fails the call with the containment error and one |
| §1.3 | registry hands every tool state_change | RED 4: through dispatch: a read_only tool's write inside its root fails the call with the containment error and one |
| §1.3 | harness trusts the cage for writes | RED 4: a policy-blind edition cage: the read_only writer FAILS, naming the write; the state_change writer passes |
| §1.3 | harness trusts the shim for writes | RED 7: a read_only tool writing inside its root through fs directly fails (the shim sees the write); reading passes |
| §1.3 | harness hands every cage state_change | RED 11: a policy-blind edition cage: the read_only writer FAILS, naming the write; the state_change writer passes |
| §1.3 | shim second path not recorded | RED 4: a read_only tool writing inside its root through fs directly fails (the shim sees the write); reading passes |
| §1.3 | shim write functions not marked | RED 7: a read_only tool writing inside its root through fs directly fails (the shim sees the write); reading passes |
| §1.3 | cage reach with a write mode not marked | RED 4: a policy-blind edition cage: the read_only writer FAILS, naming the write; the state_change writer passes |
| A5 | inherited or coerced mode keys accepted | RED 4: A5: a mode that is not a primitive string, or names an inherited key, is refused for every class and never o |
| A6 | read_only check through a mutable Set | RED 4: A6: a handler that patches Set.prototype.has cannot widen a read_only cage |
| A7 | message assumes a string mode | RED 4: A7: a Symbol mode is a ContainmentRefusal, not a TypeError from the message |
| A2 | read-call flags not judged | RED 4: A2, A3: a read_only tool truncating through a read call's flag, or changing times through lutimes, fails the |
| A3 | lutimes and lchown not observed | RED 4: A2, A3: a read_only tool truncating through a read call's flag, or changing times through lutimes, fails the |

## Deviations

| # | Deviation | Why |
|---|---|---|
| D-1 | **`EEXIST` is mapped too, but only with a link at the leaf.** WO §1.1 names `ELOOP` and `EMLINK`. Under `O_CREAT|O_EXCL` (`wx`, `ax` and their `+` forms) the kernel refuses a symlink leaf with `EEXIST`, which WO §5.3's `wx` race produces. A bare `EEXIST` is also the ordinary answer for an existing file, so the cage records a refusal only when an `lstat` after the failure finds a link at the leaf. A mutant without the link check turns an ordinary `wx` on an existing file into a false refusal (red) | Measured: the `wx` swap returned `EEXIST`, not `ELOOP` |
| D-2 | **`reachTargets` also carries the class** into `HarnessTool`, so the harness can build the class-aware cage. That is the one other place in `registry.ts` where the class is handed onward (a second map, `#classes`, beside `#domains`) | WO §1.3: the harness must fail a cage that lets a `read_only` tool write, which needs the class |
| D-3 | **The harness's shim now records a two-path fs call's second path.** It saw only the first argument, so a `copyFile` into an undeclared path, by any class, recorded only the source. Found while building the write check | Without it a `read_only` tool could write by copying |
| D-4 | **`ContainmentRefusal`'s message names the mode** for an fs reach ("… in mode w"). The response still names only the kind, and the audit line is unchanged | WO §1.2: a refused reach that names the mode |

## Adversarial pass (fresh subagent, WO §5; its own scratch worktree, since removed)

The subagent attacked `8d05b8e` with three probe files of its own (not committed), every attempt
using the operation that matters: a real mutating open and a write for every swap, a real write for
every write check, outcomes read from the bytes on disk. **Both repairs held.** Every symlink swap
(ten modes, both classes, through dispatch, plus loops and dangling links) left the victim
byte-identical with the containment error and exactly one audit line; a `read_only` tool never got a
write-capable descriptor from the cage; no reach produced two audit lines; a handler that swallowed
the refusal still failed the call (§5.4).

| # | Finding | Severity | Status |
|---|---|---|---|
| A1 | Through an `r` descriptor, a `read_only` tool can still change metadata: `handle.chmod`, `fs.fchmodSync` (to `4777`, setuid), `handle.utimes`. Data writes are all refused by the OS | medium | **Stated** in the cage docstring and the harness header (descriptor calls carry no path, so the harness cannot judge them). *Decision-needed* below |
| A2 | `fs.promises.readFile(p, {flag: "w+"})` and the callback form truncated a file, and the harness passed the `read_only` tool | medium | **Fixed:** the shim reads the `flag`/`flags` option of read calls. Tested; red-proof A2 |
| A3 | `lutimes`, `lchown` (and `lchmod`) were not observed at all, inside or outside the root (from `-1002`) | medium (pre-existing) | **Fixed:** observed and judged as writes. Tested, including a `state_change` tool's `lutimes` outside its root; red-proof A3 |
| A4 | A hard link inside the root to a file outside it lets a `state_change` tool write outside (`w`, `a`, `r+`): the leaf is not a symlink and the real path is the in-root name. A tool cannot make the link through its cage, and the shim flags a direct `link` | medium | **Stated** as a limit in the cage docstring. Not built: refusing write modes when `nlink > 1` is a behaviour change beyond this WO, and the architecture's limit line is a protected surface. *Decision-needed* below |
| A5 | A mode that is not a primitive string was coerced: for `state_change`, `{toString: () => "w"}` and `["w"]` opened `w` and **wrote**; inherited keys (`__proto__`, …) opened read-only with a junk mode. `read_only` was never affected | low | **Fixed:** only a primitive string that is the table's own key yields flags. Tested for both classes; red-proof A5 |
| A6 | A handler that patched `Set.prototype.has` widened a `read_only` cage to `w` (the harness still failed the tool) | low | **Fixed:** a plain `mode === "r"` comparison. Tested; red-proof A6 |
| A7 | A `Symbol` mode made the refusal's message throw a `TypeError` (still recorded and audited) | low | **Fixed:** the message names a non-string mode without converting it. Tested; red-proof A7 |
| A8 | A FIFO at the leaf blocks the open until the handler times out (30 s), holding a threadpool thread | low (out of scope) | **Stated** as a limit |
| A9 | A symlink loop in an intermediate directory inside the root is refused by the kernel with `ELOOP` and recorded as an escape: a false positive that fails closed | info | **Stated** |
| A10 | A link swapped in and out again before the post-failure `lstat` leaves a `wx` `EEXIST` unrecorded; the victim is unchanged | info | **Stated**; not closable in-process |
| A11 | The audit line carries tool, kind and sink, not the mode, so a `read_only` write refusal reads like an out-of-domain reach in the log | info | *Decision-needed*: it needs `transport/**`, which is protected while `-1003` is in review |
| A12 | The harness can judge only what the cage records plus calls through patched functions: an edition cage that records `r` while opening `w` through a captured function passes | info | **Stated** in the harness header. A cage that records no mode is judged a writer |
| A13 | A directory at the leaf gives `EISDIR`, a plain handler error: correct, not an escape | info | No change |

**WO §5 items:** 1 write through an `r` handle: **pass** for data (`EBADF`/`EINVAL`), with A1 for
metadata. 2 odd modes: **pass** for `read_only`, and A5 fixed the coercion for other classes. 3 the
swap race with `a`, `wx`, `ax`, `r+`, `w+`, `a+`, `wx+`, `ax+`: **pass**, victim unchanged and one
line each. 4 a handler that catches the refusal: **pass**.

## Decision-needed

- **Hard links (A4).** Refuse write modes when the pre-open `lstat` shows `nlink > 1`? It closes
  the static case in-process (the race remains the OS cage's), and it would refuse legitimate files
  with several links. And should the architecture's *Containment matching* limit line name hard
  links beside intermediate directories?
- **Metadata through a read-only descriptor (A1).** State it as the OS cage's job (the current text),
  or have the cage hand a `read_only` tool a wrapped handle without `chmod`/`chown`/`utimes`? The
  raw `fd` would still reach `fs.fchmod`, so only the OS closes it fully.
- **The mode on the audit line (A11),** after `-1003` merges.

## What did not work, and why

- **My first harness test for the policy-blind cage passed for the wrong reason:** the test cage's
  open went through the patched `fs.promises.open`, so the shim caught the write and the harness's
  own judgment of cage reaches was never exercised. The cage now opens through a function bound
  before any shim, as an OS-level cage's would be, and the "harness trusts the cage" mutant is red.
- **The first cut of A2's fix read a bare string as a flag,** so `readFile(p, "utf8")` counted as a
  write; the existing read test caught it. A bare string there is the encoding.

## What was not built

- **A per-entry mode in the domain grammar** (`fs:/data:ro`): a canonical-form proposal, WO §4.
- **Intermediate-directory swaps:** still the edition OS cage's job, as *Containment matching*
  states. `openat2` is not emulated.
- **Network or service restrictions by class.**
- **Any change to `auth/**` or `transport/**`:** dispatch already fails the call and writes one
  audit line for a recorded refusal, so the kernel refusal needed only to be recorded.
