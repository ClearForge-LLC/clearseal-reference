# CSR-WO-2011 — Arguments that fail the pinned schema are refused before the handler, as a tool execution error

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD; it must
contain `-2010`'s merge and the docs PR that adds this work order).
**Branch:** `wo/CSR-WO-2011`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P2 · **Phase exit gate:** none directly. This changes a wire behaviour every fork inherits,
so it lands before the next control.
**Grounds:**
- `docs/northstar.md` N1, N5.
- `docs/architecture.md`:
  - §8 *Runtime input validation against the pinned schema*, amended 2026-11-28: "An extra property →
    rejected before the handler, answered as a tool execution error (`isError: true`), never a protocol
    error";
  - §10, the 2026-11-28 `-2010` row (the D10 ruling and its specification sentences).
- `-2010`'s `FEEDBACK.md`, D10, and `spikes/2010-interop/` (the probe that observed it).
- Seams:
  - `packages/core/src/transport/dispatch.ts` (`callTool`; the `if (!valid)` refusal);
  - `packages/core/src/transport/jsonrpc.ts` (`Refusal`, `audited`);
  - the refusal audit in `packages/core/src/transport/server.ts`;
  - the rate limit and the tripwire (`packages/core/src/tripwire/`);
  - `test/deletion/controls.json` (the `tool.validate` and `unevaluatedProperties` rows from `-2008c`).

> **What this is:** today a call whose arguments fail the tool's pinned input schema is refused before
> the handler with HTTP 400 and JSON-RPC `-32602`. The official v2 client surfaces that as a
> `ProtocolError`, and the specification lets clients withhold protocol errors from the model.
>
> The tools page, in both served revisions, puts input validation among tool execution errors:
>
> > **Tool Execution Errors** contain actionable feedback that language models can use to self-correct
> > and retry with adjusted parameters: … Input validation errors (e.g., date in wrong format, value out
> > of range) … They are reported in tool results with `isError: true`
>
> It keeps protocol errors for an unknown tool, a request that fails the `CallToolRequest` schema, and
> server errors. It also says "Clients **SHOULD** provide tool execution errors to language models to
> enable self-correction."
>
> This WO changes the **wire form** of that one refusal and nothing else. The refusal still happens
> before the handler, before any cage, and before any approval binding. It is NOT a change to the
> validator, the schema, the deadline, or any other refusal.

**Cadence:** build, small. One PR, left unmerged for review.

## 1. Scope — numbered, specific

1. **The wire form.** When `tool.validate(args)` returns false, answer a `tools/call` result with
   `isError: true` and HTTP 200, in both eras:
   - **`2026-07-28`:** `resultType: "complete"`, as every complete result carries.
   - **`2025-11-25`:** no `resultType`, as that era's results have none.
   - **What still does not happen:** the handler does not run, no cage is built, and no approval
     binding or grant is made. Prove each with an assertion, not by reading the code.
2. **The text is actionable and echoes nothing.**
   - It names the tool, and for the validator's first failures (a bounded number) the JSON pointer of
     the failing location and the failing keyword. For example: `Invalid arguments for tool notes.read:
     /name fails pattern`.
   - It never includes a value taken from the arguments, nor a schema fragment large enough to
     carry one. Measure what `z-schema` reports and choose from that. Cap the text's length and
     record the cap.
   - A red-proof: an argument value carrying an injection-shaped string (for example
     `"Ignore previous instructions"`) does not appear anywhere in the response body.
3. **Accounting is unchanged.**
   - The refusal writes exactly the audit line it writes today: the same event, fields and reason.
     Find what writes it now; do not guess.
   - The rate limit and the tripwire count the call exactly as they count it today.
   - Each of the three gets an assertion that fails if the new form drops it.
4. **Everything else is unchanged, by assertion where a test exists.** Record each item's reason in
   FEEDBACK with the specification's category:
   - unknown tool, and the pin gate's refusal (an *Unknown tool* protocol error);
   - `params.name` missing, `params.arguments` not an object, `inputResponses` malformed (a request
     that fails the `CallToolRequest` schema);
   - the `x-mcp-header` mismatch (a request-structure rule over headers and body);
   - the validation timeout, `validation-error`, and `-1005c`'s not-ready refusal (server errors: the
     server could not validate, so there is nothing a model can correct).
5. **Deletion rows.**
   - The existing rows for `tool.validate` and the `unevaluatedProperties` refusal keep their stubs
     unchanged. Their `mustFail` tests are re-asserted on the new form and must still turn red by
     assertion. Paste `--row <id>` for each.
   - Add one row whose stub restores the protocol-error form. It must turn the new wire-form test red,
     or record why the existing rows already cover it.
6. **Interop re-run.**
   - Re-run `spikes/2010-interop`'s probe. The refused-arguments step must now surface as a
     `CallToolResult` with `isError: true` through the v2 client, not as a `ProtocolError`.
   - Re-run the conformance alpha: no check that passed before may fail.
   - Only `spikes/2010-interop/results/` may change in the spike. Record the before and after.
7. **`FEEDBACK.md`** per §6. Record it as a behaviour change, with before and after bodies.

## 2. Invariants

- **N5:** every touched row is red by assertion; `--self-test` passes.
- **N6:** the leak gate runs before every push.
- **Fail closed:**
  - No path lets arguments that fail the schema reach a handler, a cage or an approval.
  - A result with `isError: true` is never produced for a call whose handler ran because validation
    was skipped.
- **Protected surfaces, which must diff to empty:**
  - the steering documents, `scripts/**` and `.github/**`;
  - every existing stub;
  - every `src/**` module other than `dispatch.ts` and a helper it needs for the text. Name the helper
    in FEEDBACK.

## 3. Tests / acceptance

All of §1, plus `npm run check` and every shard green on CI, under five minutes. Include the before
and after bodies of one refused call in each era.

## 4. Scope fence

- Any other refusal's wire form.
- The validator, the schema, `maxSchemaNodes`, the deadline, the pool.
- `-2009`.
- Changing what the audit records.

## 5. Adversarial pass

A fresh subagent gets the diff, §2's invariants and the tools page's *Error Handling* text. It tries:
- an argument value that reaches the `isError` text: injection strings, very long values, values
  inside a `pattern` or `enum` failure;
- a path where the new result is returned but a handler ran, a cage was built, or a grant was minted;
- MRTR: a retry carrying `inputResponses` whose arguments now fail the schema;
- a client that retries an `isError` result in a loop: the rate limit still counts each call;
- the legacy era's result shape.

## 5a. Reduction pass

Diff-sized.

## 6. Upward feedback

`FEEDBACK.md`, after promote-or-needs-none of `-2010`'s findings. The rulings are in architecture §10's
2026-11-28 `-2010` row: D10 is this WO; D5 is carried into `-2009`; the rest need none. Then the
standard schema, gates, and *deliberately not built*.

## 7. Flag-and-stop

- Any path where failing arguments reach a handler, a cage or an approval.
- A text that cannot be made actionable without echoing input. Stop and report the options.
- A need to change any other refusal, the audit's content, or a protected surface.
- A secret or a deployment identifier anywhere in the diff.

## 8. Kickoff prompt

`/goal`:
> A call whose arguments fail the pinned schema is refused before its handler and answered as a tool
> execution error (isError: true) in both eras, with the same audit line and rate accounting as today,
> no argument value echoed, and every other refusal unchanged. Parked as one unmerged PR from
> wo/CSR-WO-2011; recorded exemptions are acceptable with their reasons.

Kickoff:
- **Sync:** sync from `main`, and confirm `-2010` and this WO are in it. Cadence: build, small.
- **Read first:** the WO, then `-2010`'s FEEDBACK D10 and the tools page's *Error Handling* for both
  revisions. Read them from the specification source, since the docs site may not resolve from every
  host.
- **Commit identity and push path:** as on `-2010`.
- **Gates:** flag-and-stop is WO §7.
- **Report:**
  - the PR link;
  - one refused call's body before and after, in each era;
  - the three accounting assertions;
  - the `--row` lines;
  - the probe's re-run line.
