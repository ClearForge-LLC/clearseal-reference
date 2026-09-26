# FEEDBACK: CSR-WO-1006a (a handler has no `this`; the running config is frozen)

Branch `wo/CSR-WO-1006a`, cut from `main` at `b0d51f9` (the docs commit after `-1006`'s merge at
`4182858`). Parked as one unmerged pull request. Built on Node v24.21.0. The P1 exit red-team runs
after this merges.

## Read this first

- **Both items are built, each with red-proofs.** Dispatch calls a handler with `this` undefined,
  and the running config is deeply frozen.
- **The adversary found more routes to the same two outcomes, and I closed the ones that sit inside
  §2's allowance.** The first cut closed only the routes the WO named. A handler could still build
  a cage with any domain and no audit hook from `ctx.cage.constructor`, with no import (H6), and
  read a file outside its domain unaudited. That is worse than A5, and it broke the goal's
  "cannot reach a cage dispatch does not own". A running setting could also still change by routes
  outside `t.config` (C5, C6, C2). **Three choices for you to ratify or reverse (D-1 to D-3):**
  - **D-1, H6: a handler's `ctx.cage` is now a frozen facade.** It is built in the handler call
    itself, the one `dispatch.ts` hunk §2 allows: four arrow functions that call dispatch's own
    cage, on a frozen plain object. Its `constructor` is `Object`, and there is no path back to the
    cage.
  - **D-2, C5, C6, C2: more freezing in `config.ts`, all of it "the freeze".** `resolveConfig`
    takes a `structuredClone` snapshot before freezing, so a non-string value the caller still holds
    (an `instructions` array, a URL object with `toJSON`) is not shared with the node. A value that
    cannot be cloned, such as a function, refuses the start with `ConfigError`. `SUPPORTED_VERSIONS`,
    `DEFAULT_LIMITS` and `DEFAULT_CONFIG` (lists included) are frozen: before, pushing to
    `SUPPORTED_VERSIONS` or emptying it changed every request's version check, and editing a
    default changed every node started later.
  - **D-3, C1b: `server.ts` freezes the `RunningTransport` it returns.** That is the one change
    there, so `t.config` cannot be reassigned to mislead a reader.
- **Reported, not fixed (outside §2): C7 is the one to rule on.** `ValidationPool` keeps its
  caller's options object and reads `timeoutMs` per job (`schema-pool.ts` line 50). The code that
  built the pool can shorten the validation deadline after start (every call then answers `400`,
  and the audit line names the config's limit instead), or lengthen it and remove F2's bound. It
  also means `config.limits.validationTimeoutMs` does not govern the pool. The fix, copying the
  options, is in `schema-pool.ts`, which this WO protects. The teaching edition passes a literal,
  so it is not exposed.
- **Neither §7 flag-and-stop condition held.** No handler in `packages/` or `spikes/` is a method or
  `function` that reads `this` (searched with `ast-grep` for method-shorthand and `function`
  handlers), and nothing in the tree writes to the resolved config after start. The only other
  caller of `resolveConfig` is a test that reads it.

## §3.2 The `-1006` reproductions, before and after

**A5**, `packages/core/test/transport/corrections-1006a.test.ts`. A `function` handler reports what
its `this` was, then tries the `-1006` route: build a cage from `this.newCage()` and open
`/etc/hostname` through it.

```
before (the handler called as a method, M1):
  tools/call this.probe → 200 "this=object; hidden cage: refused through a cage dispatch does not own"
  (refused, but by a cage dispatch never saw: no containment-refused line, and the call returned 200)
after:
  1006a A5: tools/call this.probe → 200 this=undefined; hidden cage: TypeError
  (no cage, so no reach at all, and nothing to record: 0 containment-refused lines)
```

**The adversarial routes, after the fix** (same file):

```
1006a H6: tools/call ctor.route → 200 ctx.cage.constructor: TypeError; Object.getPrototypeOf(ctx.cage).constructor: TypeError; ctx.reach through the facade → 500, containment-refused lines 1
1006a C5: instructions array pushed after start → server/discover unchanged; a resourceUrl with a toJSON function → ConfigError at start
1006a C6/C2/C1b SUPPORTED_VERSIONS.length = 0: TypeError
1006a C6/C2/C1b SUPPORTED_VERSIONS.push('2099-01-01'): TypeError
1006a C6/C2/C1b DEFAULT_LIMITS.maxBodyBytes = 10: TypeError
1006a C6/C2/C1b DEFAULT_CONFIG.allowedHosts.push(…): TypeError
1006a C6/C2/C1b DEFAULT_CONFIG.instructions = …: TypeError
1006a C6/C2/C1b running transport: t.config = …: TypeError
1006a C6/C2/C1b then a modern tools/call echo → 200
```

**A7**, the same file, on a node started with `maxInFlight: 4`:

```
1006a A7 mutation attempts after start:
1006a A7 config.limits.maxBodyBytes = 0: TypeError
1006a A7 config.limits.maxJsonDepth = 0: TypeError
1006a A7 config.limits.maxInFlight = 0: TypeError
1006a A7 config.limits.handlerTimeoutMs = 0: TypeError
1006a A7 config.limits.maxResultBytes = 0: TypeError
1006a A7 config.limits.maxSchemaDepth = 0: TypeError
1006a A7 config.limits.maxSchemaNodes = 0: TypeError
1006a A7 config.limits.requestStateTtlMs = 0: TypeError
1006a A7 config.limits.validationTimeoutMs = 0: TypeError
1006a A7 config.limits.validationWorkers = 0: TypeError
1006a A7 config.limits.verifierTimeoutMs = 0: TypeError
1006a A7 config.limits.requestTimeoutMs = 0: TypeError
1006a A7 config.limits = { maxInFlight: 0 }: TypeError
1006a A7 Object.defineProperty(config.limits, maxInFlight): TypeError
1006a A7 config.allowedHosts.push(…): TypeError
1006a A7 config.endpointPath = …: TypeError
1006a A7 the caller's own config: limits.maxInFlight = 0 and allowedHosts.push(…) succeed on the caller's object
1006a A7 then 4 concurrent tools/call echo → [200,200,200,200] (the -1006 route, maxInFlight = 0, answered 503); running config unchanged: true
```

Before the fix, the first of those assignments succeeded silently (`config.limits.maxBodyBytes = 0`:
no error, M5), and `-1006`'s adversary showed the consequence: `maxInFlight = 0` made every next
call answer `503`.

## §3.3 Red-proofs (N5), each on a committed tree

| # | Mutant | Result |
|---|---|---|
| M1 | the handler called as a method again (`tool.handler(...)`) | RED |
| M2 | `resolveConfig` returns the config unfrozen (first cut: the lists and limits still frozen) | RED |
| M3 | `limits` not frozen (first cut: the top level only) | RED |
| M4 | `allowedHosts` not frozen (first cut) | RED |
| M5 | no freeze of the resolved config (the `-1006` config) | RED |
| M6 | the handler gets dispatch's cage itself, not the facade (H6) | RED |
| M7 | no plain-data snapshot: the caller's objects kept (C5) | RED |
| M8 | `SUPPORTED_VERSIONS` not frozen (C6) | RED |
| M9 | `DEFAULT_LIMITS` not frozen (C2) | RED |
| M10 | the running transport object not frozen (C1b) | RED |

Each mutant was applied to the committed source, the test run, and the file restored. The tree was
asserted clean afterwards. M2 to M4 ran against the first cut's freeze, before it became the
snapshot-and-deep-freeze; M1 and M5 to M10 ran against the final source.

## The choices

- **`Reflect.apply(handler, undefined, …)`**, with the handler read once into a local. `this` is
  then `undefined` in strict code. A handler that is itself bound (`.bind(x)`), or written as sloppy
  code, carries its own `this` from its definition. That is the edition's code choosing what it
  holds, not dispatch handing it the registry's tool. See the adversarial table.
- **The freeze lives in `resolveConfig`,** so every resolved config is frozen, not only the running
  one. It freezes a `structuredClone` snapshot, so the starter's own objects are left mutable and
  unshared, and a value that is not plain data refuses the start.
- **The facade, not a constructor guard in the cage.** Refusing non-factory callers in
  `RecordingCage` would need `containment/cage.ts`, which this WO protects, and would still hand the
  handler the real object. The facade hands it only four calls.

## Adversarial pass (fresh subagent, WO §5; its own worktree, since removed)

The adversary made 23 probes, each a real `tools/call`, `server/discover`, `tools/list` or protected-resource
request on a started node, judged by the status, the body and the audit lines. The claims below were
spot-checked in the code (`dispatch.ts` lines 276-277, `config.ts` line 10, `schema-pool.ts` line 50)
before they were adopted.

| ID | Route | What mattered | Outcome | Severity | Disposition |
|---|---|---|---|---|---|
| H1, H1b, H2, H9 | Sloppy handlers from `new Function` and `vm`; `arguments.callee`; `.caller` chains | `this` is the global or the vm global, never the tool; callee is the handler; caller is null | HELD | — | — |
| H5, H5b | A class method captured by reference; `.bind(obj)` at definition | `this` undefined, or the author's own object, never the `RegisteredTool` | HELD | — | — |
| H6a, H8 | Walking the ctx object and its prototype; `Error.prepareStackTrace` call sites | Nothing reaches the tool | HELD | — | — |
| **H6** | `new ctx.cage.constructor(anyDomain)`, with no import | **200, the outside file's text returned, 0 `containment-refused` lines.** It passes the static supply-boundary check; the reach harness catches it, but only if a harness input takes that path | **HOLE** | medium | **Fixed (D-1): the facade.** Both constructor routes now throw `TypeError`, and a reach through `ctx.cage` is still refused and audited. Red-proof M6 |
| H7 | A closure over the registry, captured after admission: `registry.get(self).newCage().open(...)` | Refused, 0 audit lines, 200 (the A5 shape) | HOLE | low | **Not fixed:** anyone holding the registry can build a tool's cage. The supply-boundary check flags an edition that touches the registry ("registry-touched"); the core does not stop it at run time. *Decision-needed* |
| H11 | `new RecordingCage` imported from `@clearseal/core` | As H6 | classified | — | The supply-boundary check refuses the import (not in its allowed core imports). H6 was the no-import form |
| H10 | Patch `Array.prototype.filter` so dispatch's `reached().filter` sees nothing | Refused and audited, but the call returned 200 | out of scope | — | In-process JavaScript is not an isolation boundary, and the cage says so |
| — | `(() => 0).constructor` is `Function`; `F("return import('node:fs')")()` returns `fs` | It passes the supply-boundary checker's static read | checker gap | — | **Routed to the P1 exit red-team:** a `.constructor` route around the checker's ban on `Function` and on built-in imports. The checker says static reading is best effort |
| C1, C3, C4, C9 | `t.config` and its limits and lists (assign, `defineProperty`, `delete`, `setPrototypeOf`); the caller's config object after start; `Object.prototype` pollution; a deep walk | Every attempt throws; every key is an own property; real calls (capacity 503 at the set limit, 413 at the set body limit, Host 403, the ttl) unchanged | HELD | — | — |
| C1b | Reassign `t.config` (the `RunningTransport` was not frozen) | Allowed; the server's behaviour unchanged, but a reader is misled | information | low | **Fixed (D-3).** Red-proof M10 |
| C2 | Mutate `DEFAULT_LIMITS` / `DEFAULT_CONFIG` | The running node unchanged, but a node started later got `maxBodyBytes=10` and `allowedHosts=["evil.example"]` | HOLE (pre-start) | low | **Fixed (D-2).** Red-proof M9 |
| C5 | A non-string value in the config (an `instructions` array, a URL object with `toJSON`) mutated after start | `server/discover` instructions, the protected-resource document and the 401 `resource_metadata` changed | HOLE | low | **Fixed (D-2): a plain-data snapshot, deep-frozen; a function refuses the start.** Red-proof M7 |
| C6 | `SUPPORTED_VERSIONS` (exported, unfrozen, read on every request) | `.push("2099-01-01")` served that version; `.length = 0` made every modern call answer 400 -32022 | HOLE | low | **Fixed (D-2).** Red-proof M8 |
| **C7** | `ValidationPool` keeps its caller's options; `opts.timeoutMs = 1` after start | A call went from 200 to 400 "could not be validated within the time limit", and the audit line reported the config's `limitMs: 2000` | **HOLE** | low to medium | **Not fixed: `schema-pool.ts` is protected here.** *Decision-needed* (see "Read this first") |
| C8 | Replace `verifier.verify` on the verifier passed at start | A wrong bearer got 200 | out of scope | — | `verifier` is a core-only option an edition cannot pass; the default is built inside the core |

## Decision-needed

- **Ratify or reverse D-1 to D-3.**
- **C7:** `ValidationPool` copies its options (or the transport owns the pool's deadline), in
  `schema-pool.ts`.
- **H7:** whether the core should stop code that holds the registry from building a tool's cage at
  run time, beyond the supply-boundary check.
- **The `Function`-via-`.constructor` gap in the supply-boundary checker**, for the P1 exit
  red-team.

## Gates

- `npm run check` exits 0 from a clean state (every `dist/` removed first): 604 core and teaching
  tests, spike 0102 69, spike 0101 8, `test:subset` 4.
- `node scripts/leak-gate.mjs --tree` exit 0; `--history` exit 0, run unpiped before every push
  with the exit code checked directly.
- CI: the pull request's checks, on `ubuntu-latest` and `windows-latest` with leak-gate, sbom and audit.
- Protected surfaces diff to empty against `b0d51f9`. Only `transport/dispatch.ts` (the handler
  call, D-1), `transport/config.ts` (the freeze, D-2) and `transport/server.ts` (the freeze, D-3)
  changed in source, plus tests, this file and the changelog.
- The minted token lived in a mode-0600 scratch file, was never written to git config or a remote
  URL, and was deleted after the pull request was opened.

## What was not built

Any other transport, core or edition change (WO §4): C7 (`schema-pool.ts`), H7 and the checker
gap are reported above, not built.
