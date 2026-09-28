# Tripwire: a read burst is recorded loudly, and refused nothing (CSR-WO-2007 §1.3, §1.4)

Architecture §5 *Tripwire and rate limit*: the tripwire is the second of two controls. It watches for
one principal reading unusually fast, the shape of a prompt-injected model sweeping everything it can
see (§7.1 *A prompt-injected model*, *A hostile authenticated principal*), and writes one loud audit
event per burst. It refuses nothing: a false alarm that refused would be a denial of service the node
did to itself. Delivering the event to a person is a notifier's job, later; the tripwire writes to the
audit store only.

**Grounds: the standard §9 step 6; architecture §5.** At the pinned edition (`66b640d`), §9 step 6 asks
every security decision to list its inputs and classify each as pinned, out of scope with a named
control, or unpinned authority; this file's last section does. The control itself is architecture
§5's ruling (*Tripwire and rate limit*): a read burst is recorded loudly and refused nothing. The
defaults are set where no honest single client reaches them (TW-10), and one burst is one row (TW-2,
TW-3), never a row per call.

## What counts, and why refused calls count

A `tools/call` counts when the tool it names is admitted (registered by the pin gate) and its pinned
capability class is `read_only`. It is counted where dispatch finds the tool: after the era, version,
`_meta` and mirrored `Mcp-Method`/`Mcp-Name` gates (a call refused there never names a tool), and before
the `Mcp-Param-*` headers and the arguments are checked, so a call then refused for its arguments still
counts. The reason: a
sweep is a sweep whether or not each call is well formed, and a tripwire that only counted successful
reads could be kept quiet by an attacker whose probes fail. A false alarm costs one audit row; a missed
sweep costs the detection. The class is the pinned one, read once at start from the registry's own
frozen snapshot (the same value the gate hashed), never a tool's annotations.

## Rules

| Rule | Statement | Red-proof |
|---|---|---|
| TW-1 | Only a `tools/call` naming an admitted tool whose pinned class is `read_only` counts; a call to any other class, an unknown tool, and every other method do not. | a burst of `state_change` calls, of unknown names and of `tools/list` → no row |
| TW-2 | When one principal's counted calls within the sliding window reach the threshold, exactly one `tripwire-read-burst` row is written, with the principal, the count and the window. | a burst → one row, naming A |
| TW-3 | Continued reading inside one burst writes no further row: the tripwire re-arms only after a quiet period with no counted call. | three thresholds' worth of reads in one burst → one row |
| TW-4 | After the quiet period it re-arms, and its count starts again from zero, so a second burst writes a second row and a single read after the quiet does not. | quiet, then a second burst → a second row; quiet, then one read → none |
| TW-5 | Reads spread wider than the window do not fire: only reads within one window count together. | the threshold's reads, each a window apart → no row |
| TW-6 | It never refuses, delays or alters a call: it runs synchronously where dispatch finds the tool, and any failure inside it, its audit write included, is caught. | a burst answered byte for byte as the same burst with the tripwire not firing; an audit sink that throws on the tripwire's row changes no answer |
| TW-7 | Time is the injected monotonic clock, never the wall clock. | a frozen clock keeps a spread of reads in one window while real time passes |
| TW-8 | Memory is bounded: at most `maxPrincipals` entries of at most `threshold` timestamps each. An entry that can no longer affect a decision (armed and idle past the window, or fired and idle past the quiet period) is dropped: from the least-recently-used end on each counted call, and wherever it is when the table is full (the sweep, run no earlier than the first moment an entry can be spent). | reads left idle → none held; at the cap, a spent entry behind a live one is dropped for a newcomer |
| TW-9 | At the cap, a principal with no entry is not counted, and one `principal-state-full` row says so per episode; no entry is evicted, so a fired entry is never re-armed early and one burst never writes two rows. | the table full of fired principals, then many newcomers: no fired principal fires again inside its burst |
| TW-10 | The settings are validated before start: each a whole number from 1 to its ceiling, and `threshold × maxPrincipals` at most 5,000,000; anything else refuses start, naming the variable. | `0`, `-1`, `x`, over a ceiling, over the product, each refused by name |

## Settings and defaults (read in the snapshot, `node/settings.ts`)

| Variable | Default | Ceiling | Why this default |
|---|---|---|---|
| `TRIPWIRE_THRESHOLD` | 200 | 10,000 | Two hundred `read_only` calls inside one window is past any honest single client's reading (a model reads a few items per turn) and far past the suite's (tens). |
| `TRIPWIRE_WINDOW_SECONDS` | 60 | 86,400 | A minute: a sweep is fast; honest reading spread over a long session never gathers 200 reads in one minute. |
| `TRIPWIRE_QUIET_SECONDS` | 300 | 86,400 | Five minutes without a counted read ends a burst: long enough that one sweep with pauses is one row, short enough that a second sweep later is a second row. |
| `TRIPWIRE_MAX_PRINCIPALS` | 1,000 | 100,000 | An entry holds up to `threshold` timestamps (1.6 KB at the default), so 1,000 entries is about 1.6 MB; only principals read recently are held. |

## Inputs to the decision (standard §9 step 6)

| Input | Class | Control |
|---|---|---|
| The principal's id | out of scope, with a named control | the verifier (`auth/`, `-1003`) |
| The tool's capability class | **pinned** | inside the canonical hash (`capability_class`), read from the registry's frozen snapshot |
| Whether the tool is admitted | **pinned** | the pin gate (`-1001`) |
| The time | out of scope, with a named control | the injected monotonic clock (TW-7) |
| `threshold`, `windowSeconds`, `quietSeconds`, `maxPrincipals` | out of scope, with a named control | the operator's configuration, read in the snapshot before any edition code runs (`-1007b`) and validated (TW-10) |

The tripwire decides only whether to write a row; it decides nothing a call depends on.
