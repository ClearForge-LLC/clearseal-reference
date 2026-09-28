# Rate limit: per-principal budget, refuses (CSR-WO-2007 §1.1, §1.2, §1.4)

Architecture §5 *Tripwire and rate limit* makes this one of two controls, not one: a principal over its
budget is refused with `429`, and nobody else is. §7.1 names it against *a compromised or impostor
client*, *a hostile authenticated principal* and *a stolen bearer token*: a valid token must still meet
an actual limit. It is not a global limiter (a node-wide flood meets the transport's concurrency cap and
the operator's edge) and not caller entitlement (P6).

**The standard, at the pinned edition (`66b640d`).** Architecture §8 cites §8 #9 for this row. At
`66b640d`, §8 #9 reads: *"Alert fatigue → re-sign on every legitimate change, so an unexplained drift
alert is always an incident."* It does not describe a rate limit, and it requires nothing of one. The
one sentence at `66b640d` that names a rate limit is §9 step 6: *"For every security decision the node
makes (auth, capability gating, elevated confirmation, egress allowlist, rate limit), list every input
and classify each: pinned / out-of-scope-with-a-named-control / UNPINNED AUTHORITY (finding)."* That list
is the last section of this file. The control itself is the architecture's ruling, not the standard's
text.

## Algorithm: a token bucket, and why

Each principal has a bucket of at most `burst` tokens, refilled continuously at `refillPerMinute`. A
request takes one token; a request that finds less than one is refused, and takes nothing. A bucket is
the default the work order expects, and it is the shape the problem has: an honest client is bursty (a
model turn issues several calls at once, then waits), so a fixed window would either refuse an honest
burst or let through twice the budget at a window edge; a bucket allows `burst` at once and a steady
rate after, with no edge. A refused request takes no token, so `Retry-After` is the truth: a client that
waits it is served.

## Rules

One rule per line, each with its red-proof (`test/rate-limit/`, `test/transport/rate-limit.test.ts`)
and a control-deletion row (`test/deletion/controls.json`).

| Rule | Statement | Red-proof |
|---|---|---|
| RL-1 | A principal whose bucket holds less than one token is refused: HTTP `429`, `Retry-After`, a JSON-RPC error (`-32600`, no `id`, `data.retryAfterS`), and exactly one `rate-limited` audit row carrying the principal. | A over budget → `429`, the header, the body and one row |
| RL-2 | Buckets are per principal: one principal's refusal never touches another's budget. | A refused and B, at the same moment, served |
| RL-3 | A bucket refills with the clock at `refillPerMinute`, up to `burst`; after waiting its `Retry-After`, the refused principal is served. | A refused; the clock advances by `Retry-After`; A served |
| RL-4 | `Retry-After` is whole seconds, rounded up, at least 1. | a wait of 0.1 s → `1`; of 2.5 s → `3` |
| RL-5 | Every authenticated request takes a token, whatever it is, before the transport takes a capacity slot or reads the body; an unauthenticated request is refused by auth first and touches no bucket. | a notification, a malformed body and a wrong `Content-Type` each drain A; a `401` drains nothing |
| RL-6 | Time is the injected monotonic clock, never the wall clock. | a frozen clock refills nothing while real time passes |
| RL-7 | Memory is bounded: at most `maxPrincipals` buckets. A bucket that has refilled to full decides exactly as no bucket does, so it is dropped: from the least-recently-used end on each request, and wherever it is when the table is full (the sweep, run no earlier than the first moment a bucket can be full). | drained buckets left to refill → none held; at the cap, a full bucket behind one still refilling is dropped for a newcomer |
| RL-8 | At the cap, a principal with no bucket is served untracked, and one `principal-state-full` row says so per episode; no tracked bucket is ever evicted. So the cap can neither refuse an innocent principal nor reset a limited one's budget. | the table full of limited principals: a fresh principal served; each limited one still refused; one row |
| RL-9 | The settings are validated before start: each a whole number from 1 to its ceiling; anything else refuses start, naming the variable. | `0`, `-1`, `1.5`, `x`, over the ceiling, each refused by name |

## At the cap, and why this choice

The three choices at the cap were: refuse the newcomer (refuses an innocent principal), evict a
tracked bucket (hands its owner a full budget, which resets a limited principal), or serve the newcomer
untracked. Only the third keeps both properties the work order names, so it is the rule (RL-8). Its
cost is stated rather than hidden: while the table is full, a principal without a bucket is not limited.
Reaching the cap takes `maxPrincipals` distinct authenticated principals each still refilling, which is
a mass compromise of the authorization server rather than one hostile principal; the transport's
concurrency cap still bounds the node, and the `principal-state-full` row makes the state loud.

## Settings and defaults (read in the snapshot, `node/settings.ts`)

| Variable | Default | Ceiling | Why this default |
|---|---|---|---|
| `RATE_LIMIT_BURST` | 1,500 | 1,000,000 | An honest MCP host issues a handful of requests per model turn, so any burst in the hundreds is past an honest turn. The floor is the suite's: its heaviest single-principal burst is the statelessness test's 1,100 sequential calls in about a third of a second, and the default must not refuse it (WO §1.4). 1,500 leaves margin; the sustained rate below is what a hostile principal meets. |
| `RATE_LIMIT_REFILL_PER_MINUTE` | 600 | 6,000,000 | Ten requests a second, sustained, is well above a model's pace and well below what a scripted sweep does. |
| `RATE_LIMIT_MAX_PRINCIPALS` | 10,000 | 1,000,000 | A bucket is two numbers and a key, so the table stays in the low megabytes; only principals still refilling are held. |

## Inputs to the decision (standard §9 step 6)

| Input | Class | Control |
|---|---|---|
| The principal's id | out of scope, with a named control | the verifier (`auth/`, `-1003`): audience-bound, signature-checked; the limit runs only after it |
| The time | out of scope, with a named control | the injected monotonic clock (RL-6) |
| `burst`, `refillPerMinute`, `maxPrincipals` | out of scope, with a named control | the operator's configuration, read in the snapshot before any edition code runs (`-1007b`) and validated (RL-9) |

No input is unpinned authority: nothing a tool, an edition or a client supplies changes the decision.
