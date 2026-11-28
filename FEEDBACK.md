# FEEDBACK: CSR-WO-2011 (arguments that fail the pinned schema: a tool execution error, before the handler)

Branch `wo/CSR-WO-2011`, cut from `main` at `e5ef83b`, which contains `-2010`'s merge `e2bf41a` and this
work order. Built on Node v24.21.0 on Furnace, 2026-11-28. Every commit's author and committer is
`clearforgekey[bot]`'s noreply address. Parked as one unmerged pull request.

## Read this first

- **A behaviour change, wire form only.** A call whose arguments fail the tool's pinned input schema
  is now answered HTTP 200 with a result carrying `isError: true`, in both eras. It is still refused
  before any cage, request state, approval or handler.
  - `2026-07-28` adds `resultType: "complete"` and `_meta`.
  - `2025-11-25` carries neither.
  - The text names the tool and, for each failure (at most three), a schema-declared JSON pointer and
    the failing keyword. No argument value appears.
- **Three architect rulings during the build** (all 2026-11-28), recorded below:
  - a fence widening into the validator;
  - context-only regeneration of two stubs;
  - a control-follows-code rewrite of `arguments-schema-refused.patch`.
- **Accounting is unchanged**, each by assertion. The audit line is the same `rpc-refused`, now
  written by `dispatch.ts` because a result no longer triggers `server.ts`'s. The rate limit takes its
  token before dispatch. The tripwire counts the call where the tool is found, before validation.

## Before and after, one refused call in each era

`2026-07-28`, the v2 client against a teaching node (`spikes/2010-interop` probe, `notes.read` with
`name: "../x"`):

- before (`-2010`'s record): `400 {"jsonrpc":"2.0","id":4,"error":{"code":-32602,"message":"Invalid arguments for tool notes.read"}}`,
  which the client surfaces as `ProtocolError: Invalid arguments for tool notes.read`;
- after: `200 {"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"Invalid arguments for tool notes.read: /name fails pattern"}],"isError":true,"resultType":"complete","_meta":{"io.modelcontextprotocol/serverInfo":{"name":"clearseal-node","version":"0.0.0"}}}}`,
  which the client returns as a `CallToolResult` with `isError: true`.

`2025-11-25` (`arguments-refused.test.ts`, tool `pick`, `name` failing its pattern):

- before (the era-status table on `main`: `both([400, -32602], 200)`): `200 {"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"Invalid arguments for tool pick"}}`;
- after: `200 {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"Invalid arguments for tool pick: /name fails pattern"}],"isError":true}}`.

## -2010's findings, promoted

| -2010 finding | Durable home (architecture §10, 2026-11-28 `-2010` row) |
|---|---|
| D10: schema-invalid arguments as a protocol error | this work order |
| D5: resource-not-found code and `data.uri` | carried into `-2009` |
| D1–D4, D6–D9, D11, N1, B1, F1 | needs-none (ruled) |

## What was built

1. **The wire form (§1.1).** `dispatch.ts` `refusedArguments` handles a verdict that is not `true`. It
   writes `rpc-refused {code: -32602, method: "tools/call"}`, plus the principal through `ctx.audit`,
   and returns `{content: [{type: "text", text}], isError: true}`, adding `resultType` and `_meta` on
   `2026-07-28`. It returns before the cage is built, so no request state, approval or handler is
   reached.
2. **The text (§1.2).**
   - Measured on z-schema 12.8.0 (pattern, enum, maximum, const and `unevaluatedProperties`
     failures): `message` and `params` carry argument values, namely the failing string, the enum or
     const value, the number, and the extra property's name. `path` can carry a caller-chosen key.
   - So only `keyword` (or z-schema's fixed `code` when `keyword` is absent, as for `const`) and the
     instance `path` are used. Each `path` segment survives only if the schema declares it under
     `properties` on the failure's own `schemaPath`, or if it is an array index; any other segment
     becomes `*`.
   - Caps: 3 failures; 64 characters per segment; 200 per pointer (a longer one ends in `/…`); 40 per
     keyword; 512 for the whole text.
   - With the synchronous compiler (tests only), the text is `…: they do not match its input schema`.
3. **Accounting (§1.3).** These tests assert the audit line, the rate limit and the tripwire for a
   refused call:
   - `arguments-refused.test.ts` §1.1: exactly
     `[{event: "rpc-refused", fields: {code: -32602, method: "tools/call", principal: "alice"}}]` in
     each era. `p1-exit` asserts the same line on a real teaching node.
   - `arguments-refused.test.ts` §1.3: with a burst of 2, two refused calls spend it and the third is
     answered 429.
   - `tripwire.test.ts` TW-1: five refused `read_only` calls write one `tripwire-read-burst` row.
4. **Everything else unchanged (§1.4).** Each refusal below keeps its protocol-error form. The
   era-status table asserts each one's status and code unchanged, and only the schema row changed.

   | Refusal | Specification category (tools page, *Error Handling*) |
   |---|---|
   | unknown tool; the pin gate's refusal | "Unknown tool" |
   | `params.name` missing; `params.arguments` not an object; `inputResponses` malformed | "Malformed requests (requests that fail to satisfy CallToolRequest schema)" |
   | the `x-mcp-header` mismatch | a request-structure rule over headers and body (streamable HTTP's `HeaderMismatch`), not the tool's input |
   | the validation timeout; `validation-error`; `-1005c`'s not-ready refusal | "Server errors": the server could not validate, so there is nothing the model can correct |
5. **Deletion rows (§1.5).** See *Stubs* below. One new row, `arguments-tool-error-form`, has a stub
   that restores the 400 -32602 form, and it turns the new wire-form tests red.
6. **Interop re-run (§1.6).** `probe.ts` re-run: the refused-arguments step is now `{"ok": true}`, a `CallToolResult` with
   `isError: true` and the text above, where it was `ProtocolError`. Every other step's outcome is
   unchanged. `conformance.ts` re-run: 140 passed, 45 failed in total; the required set is
   96/15/6/2/1, as before; the not-passing set is identical (none newly failing, none newly
   passing). Only `spikes/2010-interop/results/` changed in the spike.

## Architect-ruled fence widening (WO §2 named `dispatch.ts` and one helper)

Ruled 2026-11-28: WO §1.2 needs the failing pointer and keyword, and only the validator has them.

| File | Why it changed |
|---|---|
| `packages/core/src/transport/dispatch.ts` | the refusal's wire form and text (in the fence) |
| `packages/core/src/transport/schema.ts` | `compileSchemaReporting` and `SchemaFailure`: the failures read from z-schema and capped. This is the WO's "helper it needs for the text". `compileSchema` is defined on top of it and stays boolean |
| `packages/core/src/transport/schema-worker.ts` | posts `{valid: false, failures}` for a failing value |
| `packages/core/src/transport/schema-pool.ts` | resolves a job with that verdict |
| `packages/core/src/transport/registry.ts` | `ValidationVerdict = boolean \| {failures}` for `validate` and `SchemaCompiler` |

The ruling's conditions, and how each holds:
- **(a) The outcome is unchanged for every input.** `compileSchema` returns `check(value) === true`,
  and the worker posts `valid: verdict === true`. Both come from z-schema's `.valid`, as before.
  `schema.test.ts` (rows `schema-closed`, `manifest-schema`, `edition-config-schema`) passes
  unchanged.
- **(b) The deadline, the timeout, the ready-worker rule and the pool size are untouched.** No line of the deadline, timer,
  readiness or pool-size code changed (`schema-pool.ts`'s diff is the reply type and the resolve
  value). Every `validation-*` row stays RED with its stub byte-identical:

  ```
  RED  validation-deadline | Runtime input validation against the pinned schema; output size cap | stub applied; 2/2 named test(s) red by assertion | 61114 ms
  RED  validation-ready-slot | Runtime input validation against the pinned schema; output size cap | stub applied; 1/1 named test(s) red by assertion | 3163 ms
  RED  validation-ready-rearm | Runtime input validation against the pinned schema; output size cap | stub applied; 1/1 named test(s) red by assertion | 3922 ms
  RED  validation-worker-exit | Runtime input validation against the pinned schema; output size cap | stub applied; 1/1 named test(s) red by assertion | 8646 ms
  ```
- **(c) Only pointers and keywords cross the worker boundary.** In `arguments-refused.test.ts`, the
  test *the worker's own reply* posts pattern, enum, extra-property and 20-deep failures straight to
  the worker. Each reply's keys are exactly `{id, ok, valid, failures}`, and each failure's are
  `{pointer, keyword}`. The posted JSON carries neither the injection string nor the schema's pattern
  source or enum value.
- **(d) The caps apply in the worker, before posting.** `failuresOf` runs in the worker, and the same
  test sees the 20-deep pointer cut at the cap.

## Stubs

Every stub was proven with `git apply --check` and `node scripts/control-deletion.mjs --row <id>
--show`. For each failing test, the `--show` reason is an assertion, not a crash.

**Context-only regenerations** (architect ruling 1). The removed and added lines are byte-identical
to the old stub (checked by `diff` of the `-`/`+` lines); only the context moved.

```
RED  mirrored-param-headers | Transport hardening (Origin/Host, body cap, timeouts, concurrency, batches, mirrored headers, x-mcp-header) | stub applied; 2/2 named test(s) red by assertion | 2164 ms
RED  tripwire-counts-refused-calls | Tripwire (read burst, loud, no refusal) | stub applied; 1/1 named test(s) red by assertion | 2159 ms
```

**Control-follows-code rewrite** (architect ruling, listed apart from the context-only ones):
`arguments-schema-refused.patch`.

| | removed line | added line |
|---|---|---|
| old stub | `if (!valid) throw new Refusal(400, INVALID_PARAMS, \`Invalid arguments for tool ${name}\`);` | `void valid;` |
| new stub | `if (valid !== true) return refusedArguments(era, name, valid, ctx);` | `void valid;` (byte-identical) |

The stub still deletes exactly the one control: the action on the validator's verdict. The validation
and its deadline still run, and failing arguments reach the handler.

```
RED  arguments-schema-refused | Runtime input validation against the pinned schema; output size cap | stub applied; 3/3 named test(s) red by assertion | 2487 ms
```

Its `mustFail` now names `arguments-refused.test.ts` §1.1, which goes red on the missing `isError`
because the handler answered `picked`. TL-10 (renamed for the new form) goes red because the echo
handler answered `hi` without `isError`. The teaching test WO §5.1 goes red because `../outside.md`
reached the `notes.read` handler. The era-status row `ST arguments fail the input schema` moved to the
new row: it checks only status and code, so it cannot tell a ran handler (200) from the refusal (200).

**New row** `arguments-tool-error-form`. Its stub restores the 400 -32602 form, the refusal itself
unchanged. It is in `rows.lock`.

```
RED  arguments-tool-error-form | Runtime input validation against the pinned schema; output size cap | stub applied; 3/3 named test(s) red by assertion | 3572 ms
```

`schema-closed` (the `unevaluatedProperties` row) keeps its stub byte-identical:

```
RED  schema-closed | Runtime input validation against the pinned schema; output size cap | stub applied; 2/2 named test(s) red by assertion | 2071 ms
```

## Adversarial pass (WO §5)

«ADV»

## Gates

«GATES»

## Deliberately not built

- Any other refusal's wire form; the validator's options (it still breaks on its first error, so a
  call usually reports one failure); `-2009`.
- Pointer segments for caller-chosen keys (`additionalProperties`, `patternProperties`): they read `*`.
