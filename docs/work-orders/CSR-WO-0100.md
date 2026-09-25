# CSR-WO-0100 — Spike: what the official SDK actually serves in stateless mode

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD; the
base must contain `scripts/leak-gate.mjs` and a core that builds to `dist/`).
**Branch:** `wo/CSR-WO-0100`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P0 · **Phase exit gate:** the three §2.3 rows for the spikes are replaced with measured
values — this work order produces the first of them.
**Grounds:** `docs/architecture.md` §2.3 row one (*which protocol revisions the official SDK
serves in stateless mode, and whether `server/discover` is reachable*), §5 rows *Language and SDK*,
*Protocol revision*, *Transport hardening*, *Dependencies*; §8 rows *Stateless transport* and
*Transport hardening*; `docs/roadmap.md` P0. Code seams: `packages/core` (built, empty), the lint
and test substrate.

> **What this is:** a measurement. Install the official MCP TypeScript SDK at one exact version,
> stand up the smallest stateless Streamable HTTP server it allows, and *observe* — with `curl`
> and a script, not by reading documentation — which protocol revisions it negotiates, whether
> `server/discover` answers, what it does with `Origin` and `Host`, what session behaviour it has
> when told to be stateless, and how large its dependency tree is. It is NOT the transport module,
> NOT auth, NOT a control, and NOT a place to form opinions about the SDK. Why now: the
> architecture's first blocked measurement is exactly this, and every transport decision in P1
> rests on it. The reference node's very first spike disproved a written assumption about this
> same thing.

**Cadence:** spike — measure, record, **STOP**. No product code lands. The harness is committed for
reproducibility; the findings are the deliverable.

## 1. Scope — numbered, specific

1. **`spikes/0100-protocol/`** — a private workspace package (`"private": true`, added to the root
   `workspaces` so lint and typecheck cover it; excluded from any pack or release by being
   private). Contains `package.json` with the SDK pinned to **one exact version** (the current
   release at spike time; record it), a `tsconfig.json` extending the base, `server.ts`, and
   `probe.ts`.
2. **`server.ts`** — the smallest stateless Streamable HTTP server the SDK permits: no session id
   generator, loopback bind on an ephemeral port printed at start, one trivial tool (`echo`), no
   auth (this server is never exposed; the spike's harness talks to it on loopback only).
3. **`probe.ts`** — a script that starts the server and measures, printing one line per finding:
   - the SDK's exported protocol-version constants (latest, supported list) as the package
     exposes them;
   - the revision returned by `initialize` when the client offers the latest known revision, and
     when it offers each older revision the SDK lists — which are accepted, which are refused, and
     how (status code, error body shape);
   - the server's behaviour when the `MCP-Protocol-Version` header is absent, present-and-matching,
     and present-and-unknown, on a post-initialize request;
   - whether a `server/discover` request is answered, what it returns, or how it is refused;
   - what the SDK does with an `Origin` header it has not been told to allow, and with a `Host`
     header that is not loopback — both with and without whatever DNS-rebinding protection option
     the SDK offers (name the option; measure both settings);
   - whether the server ever sets a session header when configured stateless, and what it does
     with a client-supplied session id;
   - request body size and concurrency: whether the SDK enforces any limit by default (send a
     10 MB body; send 200 concurrent initializes) and what happens;
   - the dependency count of the SDK's install (`npm ls --all | wc -l` and the top-level list),
     and whether any package in that tree declares an install script (`ignore-scripts` is on;
     count what it suppressed).
4. **`FEEDBACK.md`** at the repository root on this branch, per §6 — the findings ARE this work
   order's output, and §6 says how they are laid out so the architect can lift them into
   `architecture.md` §2.3 and §5 without rephrasing.
5. **A proposed §2.3 row**, verbatim, at the top of FEEDBACK: the row's *Measurement* text replaced
   by what was measured, with the SDK version and the probe command that produced each value.

## 2. Invariants — restated by number from the northstar

- **N5** — a measurement is not a claim: every finding line in FEEDBACK names the command or
  request that produced it, and the harness reproduces it on a fresh clone.
- **N6** — the spike server binds loopback only and is never exposed; no hostname, path, or
  identifier in the harness, its output, or FEEDBACK. Run `node scripts/leak-gate.mjs --tree` and
  `--history` before every push.
- **N8** — no secret; the spike has no auth and needs none.

**Protected surfaces — must diff to empty:** the four steering documents, `LICENSE`, `NOTICE`,
`packages/**`, `scripts/**`, `.github/**`, and the root lint and TypeScript configuration except
for the one line that adds the spike to `workspaces` (if the workspaces field is not a glob).

## 3. Tests / acceptance — what must be proven, not asserted

1. `npm ci && npm run check` still exits zero with the spike package present (lint and typecheck
   cover it; the test runner ignores it because it has no `test/` directory — confirm that is why,
   not because it was excluded).
2. `node --experimental-strip-types spikes/0100-protocol/probe.ts` (or the pinned Node's
   equivalent invocation) prints every finding in §1.3 with a value; none says "unknown" without
   the request and response that produced the uncertainty.
3. The `initialize` exchanges are pasted raw (request and response bodies) for the latest
   revision and for one refused one.
4. The `Origin`/`Host` measurements are pasted raw for each of the four combinations.
5. The dependency listing and install-script count are pasted.
6. All three CI jobs green on the final commit.

## 4. Scope fence — what is NOT in this work order

- **Building the transport module, auth, Origin validation, body limits, or any control.** P1
  (`CSR-WO-1005`, `-1003`). This work order finds out what the SDK gives; P1 decides what to add.
- **Any measurement that needs the hosted client.** That is `CSR-WO-0101`.
- **Choosing an SDK version policy.** Pin one; the maintenance cadence owns bumps.
- **Editing `architecture.md`.** The architect lifts the findings; the builder proposes the row
  text in FEEDBACK.
- **Exposing the spike server** by any means.

## 5. Adversarial pass — try to break the measurement, not the server

1. Re-run the probe three times; any finding that varies between runs is reported as unstable
   with all three values.
2. Change the pinned SDK version to the previous release and re-run once; report any finding that
   changed — the architect needs to know which facts are version-sensitive.
3. Send a malformed JSON-RPC body and a body with an unknown method; record the exact error shape,
   because P1's fail-closed behaviour must not be looser than the SDK's default.
4. Confirm the harness fails loudly (non-zero) if the server does not start, rather than printing
   findings from a dead port.

## 6. Upward-feedback directive

`FEEDBACK.md` at the repository root on this branch. **Lead with the proposed §2.3 row.** Then one
table for the findings: `finding · value · command or request · stable across runs? · version-sensitive?`.
Then the raw exchanges §3 asks for. Then, separately and clearly labelled *opinion, not
measurement*: anything the builder noticed that P1 should know (an SDK option that looks like a
control but is off by default; a default that fails open). Then the standard entries: gates line,
what did not work and why, what was deliberately not built.

## 7. Flag-and-stop conditions

- The SDK cannot run stateless at all on the pinned Node (record how it fails; that is itself the
  finding — stop and report, do not work around).
- The SDK install pulls a package that refuses to install under `ignore-scripts`.
- Anything that would require exposing the server or minting a credential.

## 8. Kickoff prompt

`/goal` text:
> A branch `wo/CSR-WO-0100` off current `main` with a private spike package that pins one exact
> SDK version, a loopback-only stateless server, and a probe whose output measures the negotiated
> revisions, `server/discover`, `Origin`/`Host` handling, session behaviour, body and concurrency
> limits, and the dependency tree — each finding naming the command that produced it, raw
> exchanges pasted, a proposed §2.3 row at the top of `FEEDBACK.md`, `npm run check` still green,
> and the work parked as one unmerged pull request. Measure and STOP. Stop at parked.

Kickoff:
> Sync: `git fetch origin && git checkout -b wo/CSR-WO-0100 origin/main`; confirm
> `scripts/leak-gate.mjs` and `packages/core/dist` (after `npm run build`) exist on the base.
> Cadence: **SPIKE** — measure, record, stop; no product code. Read
> `docs/work-orders/CSR-WO-0100.md` in full and `docs/architecture.md` §2.3 and §5. The findings
> are the deliverable; lead `FEEDBACK.md` with the proposed §2.3 row. Every finding names the
> command that produced it; raw `initialize` and `Origin`/`Host` exchanges pasted. Loopback only,
> never exposed, no credential. Protected surfaces per WO §2. Run the leak gate before every push.
> Flag-and-stop: WO §7. Adversarial pass per §5 is about the *measurement's* stability. Report the
> PR link and the SDK version measured.
