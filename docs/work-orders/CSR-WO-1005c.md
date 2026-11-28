# CSR-WO-1005c — A validation's deadline starts when its worker is ready, and a receive timeout fires when it says

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD; it must
contain `-2008c`'s merge).
**Branch:** `wo/CSR-WO-1005c`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P1 refinement, built during P2 (`-1005`'s transport hardening). The P2 exit gate still
applies, because it needs every control's row green.
**Grounds:**
- `docs/northstar.md` N5.
- `docs/architecture.md` §5 *Runtime input validation* and §8 *Runtime input validation against the
  pinned schema*.
- `-2008b`'s `FEEDBACK.md`, finding 0 (reproduced there idle and under load).
- Seams: `packages/core/src/transport/schema-pool.ts` (`#replace`, `#pump`, the slot lifecycle),
  `packages/core/test/transport/adversarial.test.ts` (F2's 500 ms settle),
  `packages/core/test/transport/era-status.test.ts` (the `deadline` server split),
  `test/deletion/controls.json` (`validation-deadline`).

> **What this is:** when a validation overruns, `#replace` terminates its worker and puts a fresh one
> in the same slot. `#pump` takes slots in order, so the next job lands on the worker that is still
> starting and being re-primed with every pinned schema, under the same deadline. Idle, that costs
> about 75 ms. At a 40 ms deadline the follow-up call answers 400 in 3 of 3 runs, and under load F2's
> follow-up failed 11 of 18.
>
> On a loaded host with a short deadline, one slot can fail every request in turn: each timeout
> replaces the worker that would have answered the next one. It fails closed, so no unvalidated call
> runs, but an honest caller gets refused, and the refusal reads as an argument error.
>
> `-2008b` made the tests stop tripping over this, as ruled. This WO fixes the pool. It is NOT a
> change to the deadline's length, the default, the error code, or the validator.

**Cadence:** build, small. One PR, left unmerged for review.

## 1. Scope — numbered, specific

1. **A job is never timed against a worker that is not ready.** Pick one approach by measurement and
   record why:
   - **(a)** a slot is not offered to `#pump` until its worker has acknowledged priming; or
   - **(b)** the timer starts only when the worker acknowledges the job.
   - (b) is weaker if a worker can hang before acknowledging. If you choose (b), bound that window
     separately and say so.
   - Either way, a worker that never becomes ready must not hold a job forever. Ready has its own
     bound: the slot is replaced again, the job goes to the next ready slot or waits in the queue, and
     a call never waits past its own deadline plus that bound.
2. **Revert `-2008b`'s workarounds.**
   - F2's follow-up `echo` goes straight after the timeout again, with no 500 ms settle, and must pass.
   - era-status's `deadline` server may stay if it reads better. Record which.
3. **Red-proofs:**
   - At a 40 ms deadline, a call straight after a timeout answers 200 (3 of 3 idle, and under the
     2-core load `-2008b` used).
   - A worker that never acknowledges priming is replaced, and the queued call still gets an answer
     within its bound.
   - A row whose stub restores today's behaviour (the job goes to an unready slot) turns the first
     red-proof red by assertion.
4. **The audit.** A worker replaced for failing to become ready writes its own audit event, distinct
   from `validation-timeout`.
5. **Receive timeouts fire at their setting** (added from `-2008c` finding 2).
   - Node checks `requestTimeout` only on its `connectionsCheckingInterval` sweep, every 30 s by
     default. So the transport's `requestTimeoutMs` (30 s) ends a stalled request 30–60 s after it
     starts, and the approval listener's 10 s ends one at about 30 s. Measured: 408 at
     30,004–30,011 ms for settings of 200 ms, 1 s and 10 s.
   - Set `connectionsCheckingInterval` on both servers so each timeout fires within a stated
     tolerance of its setting. Use the smaller of the setting and a bound you measure the CPU cost of,
     and record why.
   - Tighten `request-timeout.test.ts` and `listener-timeout.test.ts` to assert that the 408 arrives
     within that tolerance. Their rows' stubs must still turn them red.
   - This changes behaviour: a stalled request is now ended sooner, closer to what the setting says.
     Record it in FEEDBACK as a behaviour change, with the before and after timings.
6. **`FEEDBACK.md`** per §6.

## 2. Invariants

- **N5.** The new row is red by assertion. `validation-deadline` is still red (re-run it).
- **N6.** The leak gate runs before every push.
- **Fail closed.** No path lets a call reach its handler unvalidated. A pool that cannot produce a
  ready worker answers as today's timeout does, never with a 200 that skipped validation.
- **Protected surfaces, which must diff to empty:** the steering documents, every `src/**` module other than `schema-pool.ts` and the two `createServer` option objects §1.5 names
  (`server.ts`, `listener.ts`), `scripts/**`, `.github/**`, and existing stubs except `validation-deadline` (regenerate it
  only if the line it deletes moved, and show it still deletes the deadline).

## 3. Tests / acceptance

All of §1.3, plus `npm run check` and every shard green on CI, under five minutes.

## 4. Scope fence

- The deadline's value or default.
- The validator.
- The heap test and canary (`-2008d`).
- Any pool size or concurrency default.

## 5. Adversarial pass

A fresh subagent attacks the slot lifecycle:
- interrupt between "ready" and "job assigned";
- a worker that dies after acknowledging;
- `close()` while a replacement is priming;
- two timeouts back to back on a one-worker pool.

## 5a. Reduction pass

Diff-sized.

## 6. Upward feedback

`FEEDBACK.md`, after promote-or-needs-none of `-2008c`'s. Then the standard schema, gates, and
*deliberately not built*.

## 7. Flag-and-stop

- Any path where a call runs unvalidated.
- A fix that needs the deadline's semantics changed: for example, "the deadline includes start-up" is
  a design question, not a build step.
- A secret or a deployment identifier anywhere in the diff.

## 8. Kickoff prompt

`/goal`:
> An honest call made straight after a validation timeout is validated and answered, at any
> deadline, and nothing ever reaches a handler unvalidated. Parked as one unmerged PR from
> wo/CSR-WO-1005c; a fix that only passes because a test waits is not done.

Kickoff: sync from `main` (confirm `-2008c` is in it); cadence build, small. Read the WO, then
`-2008b`'s FEEDBACK finding 0, which is your own reproduction. Commit identity and push path as on
`-2008c`. Flag-and-stop: WO §7. Report the PR link, the approach chosen and why, and the 40 ms
red-proof idle and under load.
