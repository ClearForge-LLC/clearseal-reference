# CSR-WO-1006a — Two transport corrections before the P1 exit red-team: a handler has no `this`, and the running config is frozen

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (must contain `-1006`, merged `4182858`).
**Branch:** `wo/CSR-WO-1006a`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P1 · **Phase exit gate:** the P1 exit red-team runs after this merges, so it tests the final state.
**Grounds:** `docs/northstar.md` N4; `-1006` FEEDBACK adversarial A5 and A7; `docs/architecture.md` §10 row for `-1006`.

> **What this is:** the two low findings `-1006` reported and left outside its scope. **A5:** dispatch
> calls `tool.handler(...)` as a method, so a handler's `this` is its frozen `RegisteredTool`; it can
> call `this.newCage()` and reach through a cage dispatch never sees — the reach is still refused, but
> no audit line is written and the call returns `200`. N4 says refused *and recorded*. **A7:**
> `RunningTransport.config` is the live, mutable config, so the code that started the node can set
> `limits.maxInFlight = 0` and every call answers `503`. Both are supply-side (the model reaches
> neither); both are one-line fixes. It is NOT any other transport change.

**Cadence:** build, small. One PR, left unmerged for review.

## 1. Scope

1. **No `this` for handlers.** Dispatch invokes the handler as a plain function (`Reflect.apply(handler,
   undefined, …)` or equivalent), so `this` is `undefined` in strict code. A test: a handler that
   reads `this` gets `undefined`; a handler that tries `this.newCage()` throws before any reach.
2. **Frozen running config.** The config `startTransport` resolves — including `limits` and every
   nested object — is deeply frozen before the node binds, and `RunningTransport.config` exposes that
   frozen object. A test mutates `config.limits.maxInFlight` and every other limit after start and
   shows behaviour unchanged.
3. **`FEEDBACK.md`** per §6.

## 2. Invariants

- **N4** — every refused reach is recorded; nothing outside the node's start can change its limits.
- **N5** — each item has a red-proof.

**Protected surfaces — must diff to empty:** everything except `packages/core/src/transport/dispatch.ts`
(the handler call only), `packages/core/src/transport/server.ts` and `config.ts` (the freeze only),
and tests. The four steering documents, `scripts/**`, `.github/**`, `spikes/**` as always.

## 3. Tests / acceptance

1. `npm run check` green on both runners; both leak-gate modes exit 0.
2. The A5 and A7 reproductions from `-1006` FEEDBACK, now refused/unchanged — pasted.
3. Both red-proofs pasted.

## 4. Scope fence

Any other transport, core, or edition change.

## 5. Adversarial pass

Fresh subagent: reach a cage dispatch does not own by any other route (`arguments.callee`, a bound
handler captured at definition, the context object's prototype); change a running limit by any route.

## 6. Upward-feedback directive

`FEEDBACK.md`: gates line, the pastes, adversarial findings with severity.

## 7. Flag-and-stop conditions

A handler in the tree depends on `this`; freezing the config breaks a documented runtime setting.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-1006a` off current `main` where dispatch calls every handler with no `this` so a
> handler cannot reach a cage dispatch does not own, the running transport's config is deeply frozen
> so no limit changes after start, red-proofs exist for both, `npm run check` is green on both
> runners, and the work is parked as one unmerged pull request. Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-1006a origin/main`. Read the WO and your own
> `-1006` FEEDBACK A5/A7. Two one-line fixes with red-proofs; protected surfaces per WO §2. The P1
> exit red-team waits for this. Leak gate before every push, exit code checked directly.
