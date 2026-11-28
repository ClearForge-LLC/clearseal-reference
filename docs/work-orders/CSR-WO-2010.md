# CSR-WO-2010 — Spike: does an independent implementation of `2026-07-28` agree with ours?

**Repo:** `ClearForge-LLC/clearseal-reference` · **Base:** `main` at kickoff (verify live HEAD; it must
contain `-2008d`'s merge).
**Branch:** `spike/CSR-WO-2010`.
**Author:** Claude (architect) · **Builder:** the builder coding-agent session, in its own worktree.
**Phase:** P2 · **Phase exit gate:** none directly. This spike checks the transport every later control
sits on, and its findings become build WOs or §2 corrections.
**Grounds:**
- `docs/northstar.md` N1, N5.
- `docs/architecture.md`:
  - §2.2, the 2026-11-27 correction: the official TypeScript SDK's v2 exists, published under
    `@modelcontextprotocol/server`, `/client` and `/core`;
  - §2.1 *Served protocol revisions*, which records the conformance run at a pinned commit;
  - §5 *Language and SDK*: the core owns its transport; that ruling is not reopened here.
- `spikes/0100-protocol/`, the house precedent for an SDK probe.
- `packages/core/test/sdk-client/`, the existing v1 client test.

> **What this is:** the reference serves `2026-07-28` from its own transport. Until now the only check
> against an independent implementation was the official conformance suite at an older pinned commit,
> plus the v1 SDK client, and v1 does not speak `2026-07-28`. Two independent oracles now exist:
> - the v2 client, `@modelcontextprotocol/client` 2.4.0, which documents serving `2026-07-28`;
> - the conformance suite's alpha, `@modelcontextprotocol/conformance` 0.2.0-alpha.12, which has a
>   `server-stateless` scenario and `--requirements 2026-07-28`.
>
> This spike runs both against a real teaching node and reports every disagreement. It is NOT a
> runtime dependency on the SDK (never in `packages/*/dependencies`). It does NOT change the
> transport-ownership ruling, and it fixes NO disagreement; each one becomes a ruling or a WO.

**Cadence:** spike, then STOP. One PR with the spike's code under `spikes/2010-interop/` and its
FEEDBACK, left unmerged. The architect rules on the findings before any build.

## 0. Questions the spike must answer

1. Does the v2 client complete these against a teaching node on `2026-07-28`, each with its exact
   request and response recorded?
   - `server/discover`;
   - `tools/list`, including list TTL and `cacheScope`;
   - `tools/call` for a `read_only` tool;
   - an MRTR `input_required` round trip;
   - a tool error;
   - the `Mcp-Method` and `Mcp-Name` mirrored headers.
2. Does the v2 client complete the same against the legacy `2025-11-25` fallback, or does it refuse it?
3. Against the v2 client, does auth behave as specified?
   - The 401 carries protected-resource metadata (RFC 9728).
   - The client uses resource indicators (RFC 8707).
   - A wrong-audience token is refused.
   - `iss` is validated (RFC 9207). We are the resource server, so record what the client does with
     our metadata.
   - Use the local test issuer only. No real authorization server values are needed (N8).
4. The conformance alpha with `--requirements 2026-07-28`, run against the teaching node:
   - Give pass, fail and skip counts by scenario. Each failure is classified as one of: (a) a defect
     in ours, (b) an unimplemented primitive already planned (`-2009`), (c) the suite or SDK
     disagreeing with the specification text, or (d) a ClearSeal control deliberately stricter than
     the specification.
   - Quote the specification sentence for every (c) and (d).
5. Is any disagreement security-relevant? That is: a request ours accepts that the specification says
   to refuse, or ours refusing something the specification requires, in a way a client would route
   around.

## 1. Scope

1. `spikes/2010-interop/` has its own `package.json`, with exact pins for the v2 client and the
   conformance alpha (never ranges). It also has a harness that starts a real teaching node through
   `clearseal-node` with the local test issuer and a seam-only or JSON-lines audit, plus the probes
   for §0.1–0.4.
2. A findings table, one row per disagreement: what, where, which class (a)–(d), the specification
   sentence, and a recommendation.
3. Re-record §2.1's served-revision row from this run: the suite version, its scores, and the date.
4. `FEEDBACK.md` per the usual schema, findings first.

## 2. Invariants

- **N6:** the leak gate runs before every push.
- **No runtime dependency:** `packages/*/package.json` diffs to empty. The SDK lives only in the
  spike's own `package.json`.
- **Protected surfaces, which must diff to empty:** everything outside `spikes/2010-interop/` and
  `FEEDBACK.md`. A spike changes nothing it measures.

## 3. Acceptance

Every §0 question is answered with recorded output or marked blocked with its reason (never
estimated), and the findings table is complete.

## 4. Scope fence

- Fixing any finding.
- `-2009` (resources and prompts).
- Adopting the SDK anywhere in `packages/`.
- Running against any real or hosted authorization server or client.
- Adding the spike to CI as a required check (a later ruling).

## 5. Adversarial pass

A fresh subagent reads the findings table against the specification text and challenges each
classification, especially any (c) or (d) that excuses a disagreement as the other side's fault.

## 6. Upward feedback

`FEEDBACK.md`, after promote-or-needs-none of `-2008d`'s findings.

## 7. Flag-and-stop

- A security-relevant disagreement (§0.5). Report it at once and keep going only on the
  non-security probes.
- Any need to change `packages/**` to make a probe run.
- Any probe that needs a credential or host outside the local test issuer.

## 8. Kickoff prompt

`/goal`:
> Every way the official 2026-07-28 client and conformance suite disagree with our server is found,
> recorded with the specification sentence it turns on, and classified, with nothing in packages/
> changed. Parked as one unmerged PR from spike/CSR-WO-2010; a disagreement explained away without the
> specification text is not done.

Kickoff: sync from `main` (confirm `-2008d` is in it); cadence spike, then STOP. Read the WO, then
`spikes/0100-protocol/` for the probe pattern and architecture §2.1–2.2 for what is recorded now.
Recorded exemptions or blocked items are acceptable with their reasons. Flag-and-stop: WO §7.
Commit identity and push path as before.
