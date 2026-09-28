# FEEDBACK: CSR-WO-2007 (tripwire and rate limit, as two controls)

Branch `wo/CSR-WO-2007`, cut from `main` at `a00ac0a`, where the WO lives. Parked as one unmerged pull
request. Built on Node v24.21.0. Spec first: `rate-limit/RULES.md` and `tripwire/RULES.md` were
committed before either module. None of the §7 flag-and-stop conditions arose; the first one is
answered in *The standard's sentences*, below.

## Gates

- `npm run check` exits 0: 840 core and teaching tests (745 on `main`), spike 0102 69, spike 0101 8,
  `test:subset` 4.
- `control-deletion`: the self-test passes; the four shards, run locally one after another on the
  final code, turned 175 of 176 rows red by assertion (217, 235, 242 and 281 s); the one miss was my
  test's, fixed and re-proven red on its own (above).
- `node scripts/leak-gate.mjs --tree` and `--history` exit 0, run unpiped with the exit code checked
  directly, before every push.
- CI at `0553f27`, both runs (push and pull request): `test (ubuntu-latest)` and `test (windows-latest)`
  each 840/69/8/4 with no failure; every control-deletion shard, the self-test, the plan and the
  aggregate `control-deletion` green (all 176 rows red by assertion in CI); `leak-gate`, `audit`,
  `sbom` and provenance green.
- Protected surfaces diff to empty against `a00ac0a` (checked by the review too); `audit/**` changes
  only in `RULES.md` and `policy.ts`.
- The minted token lived in a mode-0600 scratch file, was never written to git config or a remote
  URL, and was deleted after the pull request was opened.

## Read this first

- **Amended after the architect's review of the pull request.** One commit, these changes only:
  - **The default burst is 300 again** (defaulted safe, architecture §5). I had raised it to 1,500 to
    fit the core's statelessness test (1,100 sequential calls from one principal in a third of a
    second). The ruling: the default is not raised to fit a test. That test now passes its own budget
    (`burst: 2000`) through the transport's `rateLimit` setting; the P1 evidence suite still trips
    nothing on the defaults (its clause, below, re-run on the amended code).
  - **Both RULES.md files cite "the standard §9 step 6; architecture §5"**, not the WO's §8 #9. At
    `66b640d`, §8 #9 is *"Alert fatigue → re-sign on every legitimate change, so an unexplained drift
    alert is always an incident."*, which is about neither control; the architect fixes the §8 rows on
    merge.
- **Ruled and approved at review:** the third audit event `principal-state-full`; the two lines in
  `node/start.ts` that hand the snapshot's settings to the transport; the SPEC-MAP edits (TL-11 to
  *impl*, the `429` in ST-3); reading the pinned class through `reachTargets`; and the tripwire firing
  once in the core's statelessness test, which stays: 1,100 `read_only` calls in a third of a second is
  a burst by construction, and the tripwire refuses nothing.
- **TW-6 read carefully (review F9).** The tripwire's own code cannot refuse or alter a call, and a
  sink that *throws* on its row changes no answer. Under a store-backed node, a failed append of any
  row (this one included) does not throw: it closes the node, the audit store's existing N4 policy
  (`-2002`). That is the store refusing to run unaudited, not the tripwire refusing a call.

## The standard's sentences, and the rules that answer them

| Sentence at `66b640d` | Rules |
|---|---|
| §8 #9: *"Alert fatigue → re-sign on every legitimate change, so an unexplained drift alert is always an incident."* | Not a tripwire or rate-limit requirement. What it bears on: TW-2, TW-3 (one row per burst, never a row per call) and the defaults set where no honest single client reaches them (TW-10, RL-9). |
| §9 step 6: *"For every security decision the node makes (auth, capability gating, elevated confirmation, egress allowlist, rate limit), list every input and classify each: pinned / out-of-scope-with-a-named-control / UNPINNED AUTHORITY (finding)."* | Each RULES.md ends with its inputs, classified. The limiter: principal (auth), time (the injected clock), settings (the snapshot): none unpinned. The tripwire: the capability class and admission are **pinned**; the rest as the limiter's. |

## Choices the WO left to me, with reasons

**§1.1, the algorithm: a token bucket.** An honest client is bursty; a fixed window either refuses an
honest burst or admits twice the budget at a window's edge. A bucket allows `burst` at once and a
steady rate after. A refused request takes nothing, so `Retry-After` is the truth: tested, and the
review fuzzed it (20,000 random configurations, 0 cases of a principal not served after waiting it).

**§1.1, where it runs: right after authentication, before the capacity slot and the body.** Every
authenticated request takes a token, whatever it is (a malformed body and a wrong `Content-Type`
included), and an over-budget principal's body is never read: a 2 MiB body is refused `429`, not read
and refused `413`. That keeps a hammering principal from spending the capacity the limit protects.

**§1.1, the 429's body.** An HTTP-level refusal, like capacity's `503` (SPEC-MAP ST-3): the same status,
headers and body in both eras, `-32600` (the transport's code for a client-side `4xx`), no `id` (the body
is not read), `data.retryAfterS`. The legacy-era test shows the two eras' answers identical.

**§1.2, §1.3, at the cap: the newcomer goes untracked; nothing is evicted.** Refusing the newcomer
refuses an innocent principal; evicting a bucket hands its owner a full budget, which resets a limited
one (and evicting a fired tripwire entry would let one burst write twice). Serving the newcomer
untracked keeps both properties. Its cost, stated: while a table is full, a principal without an
entry is neither limited nor counted. Filling it takes the cap's worth of distinct authenticated
principals, each still refilling or reading, which is a compromise of the authorization server, not
one hostile principal. The `principal-state-full` row makes it loud.

**§1.2, idle state.** A full bucket, an armed tripwire entry idle past its window, and a fired one idle
past its quiet period each decide exactly as no entry does, so each is dropped: from the least-recently
used end on every request, and by a sweep of the whole table when it is full. The sweep waits for the
first moment an entry can be dropped (review F2: it had run on every untracked request, 19 ms each at
the limiter's ceiling).

**§1.3, what counts, and refused calls count.** A `tools/call` naming an admitted tool whose pinned
class is `read_only`, counted where dispatch finds the tool: after the era and mirrored-header gates,
before `Mcp-Param-*` and the arguments. A sweep is a sweep whether or not each call is well formed, and
a tripwire that counted only successful reads could be kept quiet by probes that fail. A false alarm
costs one row. The class is read once at start from the registry's frozen snapshot through
`reachTargets`, its only public accessor for the class (with a placeholder corpus that is never run).
Approved at review (a dedicated accessor would need `pinning/**`, protected here; review F8).

**§1.3, the window.** Exact, not approximate: each principal keeps its last `threshold` timestamps in a
ring, and a burst is the oldest of them inside the window. Memory is `threshold × maxPrincipals`
timestamps, bounded at 5,000,000 (40 MB) by a start-time check. Re-arming after the quiet period starts
the count from zero, so the first read after a quiet period is never a burst of its own.

**§1.4, the settings.** Seven variables, each a whole number from 1 to a stated ceiling; unset takes the
default; anything else refuses start naming the variable. Both readers take the snapshot's frozen
copy and have no `process.env` default, so the `process.env` inventory test gains no read (it passes
unchanged; review confirmed no new read in the core's source). The transport checks the settings again
at start, for a direct caller.

| Variable | Default | Why |
|---|---|---|
| `RATE_LIMIT_BURST` | 300 | Defaulted safe: far past any honest turn (a handful of calls). A stress test passes its own budget. |
| `RATE_LIMIT_REFILL_PER_MINUTE` | 600 | Ten a second sustained: above a model's pace, below a scripted sweep's. |
| `RATE_LIMIT_MAX_PRINCIPALS` | 10,000 | A bucket is two numbers and a key; only principals still refilling are held. |
| `TRIPWIRE_THRESHOLD` | 200 | Past any honest single client's reading inside a minute, and past the P1 evidence suite's. |
| `TRIPWIRE_WINDOW_SECONDS` | 60 | A sweep is fast; honest reading spread over a session never gathers 200 in a minute. |
| `TRIPWIRE_QUIET_SECONDS` | 300 | One sweep with pauses is one row; a second sweep later is a second row. |
| `TRIPWIRE_MAX_PRINCIPALS` | 1,000 | 1.6 KB an entry at the default threshold: about 1.6 MB in all. |

**The clock.** `TransportOptions.monotonic`, default `performance.now`; both controls take it as a
required constructor argument and read nothing else. A test jumps `Date.now` a day ahead and shows the
limiter refilled nothing. A clock that steps back is treated as not having moved.

## §3.2 The documented cases, pasted

**The rate limit** (`test/transport/rate-limit.test.ts`): A over budget, B at the same moment, A after
its `Retry-After`, what counts, and the state cap.

```
RATE A over budget: 429 Retry-After: 1 {"jsonrpc":"2.0","error":{"code":-32600,"message":"Too Many Requests: this principal is over its request budget; retry after 1 s","data":{"retryAfterS":1}}}
RATE A's row: rate-limited {"principal":"alice","retryAfterS":1}
RATE B at the same moment: 200 {"content":[{"type":"text","text":"item b0"}],"resultType":"complete","_meta":{"io.modelcontextprotocol/serverInfo":{"name":"@clearseal/core","version":"0.0.0"}}}
RATE A refused (Retry-After 3), the clock advanced 3 s, A served: 200
RATE what counts: ten 401s took nothing; a 200, a 400 and a 415 took three tokens; then a 2 MiB body → 429, unread
RATE caps: 3 limited principals fill the table; 40 fresh principals → all 200; the 3 → still 429; 1 principal-state-full row
```

**The tripwire** (`test/transport/tripwire.test.ts`): a burst, one row, every answer unchanged; one burst,
one row; a second burst after the quiet period; what does not count; the state cap.

```
TRIPWIRE a burst of 12 read_only calls by A: rows [{"event":"tripwire-read-burst","fields":{"principal":"alice","count":5,"windowS":10}}]; 12 of 12 answers identical to a transport whose tripwire did not fire
TRIPWIRE 25 reads inside one burst → 1 row; 30 s quiet, then 5 reads → 2 rows in all
TRIPWIRE 20 state_change calls, 20 unknown tools, 20 tools/list → 0 rows; then 5 read_only calls → 1 row
TRIPWIRE caps: 3 principals in a burst fill the table; 40 fresh principals → all 200; the 3 read on → still 3 rows; 1 principal-state-full row
```

**The settings, from the snapshot, and each invalid one by name** (`test/node/cli.test.ts`):

```
SNAPSHOT RATE_LIMIT_BURST=5 and TRIPWIRE_THRESHOLD=3 captured, then rewritten to 1000: six calls → 200, 200, 200, 200, 200, 429; tripwire-read-burst {"principal":"user-42","count":3,"windowS":60}; rate-limited {"principal":"user-42","retryAfterS":60}
SETTING RATE_LIMIT_BURST=0 → RateLimitConfigError: RATE_LIMIT_BURST must be a whole number from 1 to 1000000 (got "0")
SETTING RATE_LIMIT_REFILL_PER_MINUTE=0 → RateLimitConfigError: RATE_LIMIT_REFILL_PER_MINUTE must be a whole number from 1 to 6000000 (got "0")
SETTING RATE_LIMIT_MAX_PRINCIPALS=0 → RateLimitConfigError: RATE_LIMIT_MAX_PRINCIPALS must be a whole number from 1 to 1000000 (got "0")
SETTING TRIPWIRE_THRESHOLD=0 → TripwireConfigError: TRIPWIRE_THRESHOLD must be a whole number from 1 to 10000 (got "0")
SETTING TRIPWIRE_WINDOW_SECONDS=0 → TripwireConfigError: TRIPWIRE_WINDOW_SECONDS must be a whole number from 1 to 86400 (got "0")
SETTING TRIPWIRE_QUIET_SECONDS=0 → TripwireConfigError: TRIPWIRE_QUIET_SECONDS must be a whole number from 1 to 86400 (got "0")
SETTING TRIPWIRE_MAX_PRINCIPALS=0 → TripwireConfigError: TRIPWIRE_MAX_PRINCIPALS must be a whole number from 1 to 100000 (got "0")
```

**The defaults, against the P1 evidence suite** (`packages/teaching/test/p1-exit.test.ts`):

```
EXIT | the rate limit's and the tripwire's defaults trip nothing across the P1 evidence suite (CSR-WO-2007 §3.2) | 4 node logs, 26 rows: no rate-limited, tripwire-read-burst or principal-state-full row
```

And measured once, not a test: the core's statelessness pattern (1,100 sequential `read_only` calls by
one principal) writes one `tripwire-read-burst` row on the default tripwire (`count` 200 in 60 s). On
the default rate limit (burst 300) it would be refused from its 301st call, which is why that test
passes its own budget (the amendment above).

## §3.3 Red-proofs and control-deletion rows

Every rule in both RULES.md files has a red-proof test and a row; 31 rows in all, plus two
earlier rows re-targeted at their files' new context with the same edits (`audit-start-wired`,
`concurrency-cap`). 176 rows in the manifest. Each stub deletes exactly its row's control, and each
named test goes red by its own assertion.

| Row | Control | Named test(s) |
|---|---|---|
| `rate-limit-sweeps` | RL-7: at the cap, every full bucket is swept, wherever it is, before a newcomer goes untracked | 1 |
| `tripwire-sweeps` | TW-8: at the cap, every spent entry is swept, wherever it is, before a newcomer goes uncounted | 1 |
| `transport-default-clock-monotonic` | RL-6, TW-7: the transport's default clock for both controls is monotonic, never the wall clock | 1 |
| `rate-limit-episode-row` | RL-8: one principal-state-full row per episode; a new episode after the table has had room writes another | 1 |
| `tripwire-episode-row` | TW-9: one principal-state-full row per episode; a new episode after the table has had room writes another | 1 |
| `rate-limit-clock-steps-back` | RL-6: a clock that steps back is treated as not having moved, so no token is refilled twice | 1 |
| `tripwire-memory-bound` | TW-10: threshold × maxPrincipals over the memory bound refuses start | 1 |
| `rate-limit-refuses` | RL-1: a principal over budget is refused with 429, Retry-After and one rate-limited row | 2 |
| `rate-limit-per-principal` | RL-2: buckets are per principal; one principal's refusal never touches another's budget | 2 |
| `rate-limit-refills` | RL-3: a bucket refills with the clock; after its Retry-After a refused principal is served | 2 |
| `rate-limit-retry-after-rounds-up` | RL-4: Retry-After is whole seconds, rounded up, at least 1 | 1 |
| `rate-limit-before-body` | RL-5: every authenticated request takes a token before a capacity slot or the body; unauthenticated ones take none | 1 |
| `rate-limit-monotonic-clock` | RL-6: the limiter reads the injected monotonic clock, never the wall clock | 1 |
| `rate-limit-drops-full` | RL-7: a bucket refilled to full is dropped; the table holds only buckets still refilling | 1 |
| `rate-limit-cap-never-evicts` | RL-8: at the cap no tracked bucket is evicted, so a limited principal's budget never resets | 2 |
| `rate-limit-cap-serves-newcomer` | RL-8: at the cap a principal with no bucket is served, never refused | 2 |
| `rate-limit-settings-checked` | RL-9: a zero, negative or malformed rate-limit setting refuses start, naming the variable | 2 |
| `tripwire-counts-read-only` | TW-1: only a tools/call naming an admitted read_only tool counts | 1 |
| `tripwire-counts-refused-calls` | TW-1: a read_only call is counted where the tool is found, so one refused for its arguments counts too | 1 |
| `tripwire-fires` | TW-2: the threshold's reads inside one window write one tripwire-read-burst row | 2 |
| `tripwire-one-row-per-burst` | TW-3: continued reading inside one burst writes no further row | 2 |
| `tripwire-rearms-after-quiet` | TW-4: after the quiet period the tripwire re-arms, so a second burst writes a second row | 2 |
| `tripwire-rearm-clears-count` | TW-4: re-arming starts the count from zero | 1 |
| `tripwire-sliding-window` | TW-5: only reads inside one window count together | 1 |
| `tripwire-never-alters` | TW-6: nothing the tripwire does, its audit write included, can refuse or alter a call | 1 |
| `tripwire-monotonic-clock` | TW-7: the tripwire reads the injected monotonic clock, never the wall clock | 1 |
| `tripwire-drops-idle` | TW-8: an entry that can no longer affect a decision is dropped | 1 |
| `tripwire-cap-never-evicts` | TW-9: at the cap no entry is evicted, so a principal in a burst is never re-armed early | 2 |
| `tripwire-settings-checked` | TW-10: a zero, negative or malformed tripwire setting refuses start, naming the variable | 2 |
| `settings-controls-captured` | §1.4: the rate limit's and the tripwire's settings are read in the snapshot | 1 |
| `node-passes-control-settings` | §1.4: the node runs its transport on the snapshot's rate-limit and tripwire settings | 1 |

Two of these the control-deletion job itself caught in my own work, before they reached you:
- `rate-limit-refuses`: the first stub disabled the refusal in a way that broke TypeScript's narrowing,
  so the copy did not build (a MISS, not a red). Re-targeted to keep the narrowing.
- `transport-default-clock-monotonic`: the first test replaced `Date.now` after the transport started,
  so a transport that had kept a reference to it passed. The test now installs its wall clock first.

## Review pass (WO §5)

A fresh subagent read the diff against §1 and §2, ran the new suites, and fuzzed the limiter and the
tripwire against unbounded reference models (3,000 runs each, 0 mismatches; the tripwire's cap never
exceeded). It found **no High**. Every protected surface diffs to empty.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| F1 | Medium | the at-cap sweep had no red-proof in either control | **fixed**: a test each, where only the sweep can free a slot; two rows |
| F2 | Low | at the cap, every untracked request re-swept the table (19 ms at the limiter's ceiling) | **fixed**: the sweep waits for the first moment an entry can be dropped |
| F3 | Low | the default clock was not proven monotonic | **fixed**: `Date.now` jumped a day, nothing refilled; a row |
| F4 | Low | "one row per episode" had no test for the reset | **fixed**: a second episode writes a second row, both controls; two rows |
| F5 | Low | "a clock that steps back" was unproven | **fixed**: a test and a row |
| F6 | Low | RL-7's "every full bucket is dropped" overstated the trim | **fixed**: RL-7 and TW-8 name the trim and the sweep |
| F7 | Low | "counted before the headers are checked" overstated | **fixed**: the gates before and after are named |
| F8 | Low | the read_only set was built outside the start guard | **fixed**; the accessor question is above, for you |
| F9 | Info | a store-backed node closes on a failed append, the tripwire's row included | recorded above |
| F10 | Info | for a direct `startTransport` caller, a bad setting now outranks `PinRefusedError` at start | recorded; the node path is unchanged, and no request-path refusal moved |
| F11 | Info | TW-6's comparison is against a tripwire that does not fire, not one removed | recorded; the stub `tripwire-never-alters` covers the failing-sink half |
| F12 | Info | `node/start.ts` and `SPEC-MAP.md` changed outside the named surface | recorded above |
| F13 | Info | the row's `count` is always the threshold | true at the moment of firing, by construction |
| — | — | TW-10's memory product had no row | **fixed**: `tripwire-memory-bound` |

## What was not built

- Caller entitlement (P6); a global or unauthenticated limiter; delivering alerts (a notifier);
  adaptive thresholds. No existing refusal's status, message or order changed.
- A dedicated capability-class accessor on the registry (`pinning/**` is protected).
- Architecture §8's two rows still read *planned*; the steering documents are yours.
