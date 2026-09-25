# clearseal-reference — Roadmap

**What this is:** the order the build runs in, and how each phase is known to be finished.
**Date:** 2026-09-24 · **Author:** Claude (architect) · **Gate:** Scotty · **Builder:** a separate
coding-agent session, one work order per branch.
**Supersedes:** nothing — first roadmap for this repo. **Read first:** `northstar.md` (invariants,
cited here by number), `architecture.md` (shape and rulings, cited by section).

## How this document works

- **Phases are dependency-ordered, not calendar-ordered. No dates are assigned**, because a build
  done in whatever hours are available should be measured by gate completion, not by a schedule
  that will be wrong.
- Every phase carries a **goal**, **depends on**, **work orders**, and an **exit gate**. A gate is
  something a person who was not in the room can run and get an unambiguous yes or no.
- **"What do I build next" is answered from this document** — the first work order in the earliest
  phase whose dependencies are met and whose exit gate has not passed. Never from a parallel list,
  tracker, or state file.
- Invariants are **not** introduced here. They live in `northstar.md` and are cited as `N<n>`.
- Only phases whose shape is known are scoped to work-order level. Later phases state their intent
  and name the spike that will shape them.

## Work-order numbering

**PREFIX: `CSR`.** The scheme `<PREFIX>-WO-PSNN[a]` is defined in the `repo-genesis` skill (§6) and
is not restated here. Work orders live in `docs/work-orders/`.

**Subsection allocation within phase 0.** Subsection `0` is the skeleton and gates
(`CSR-WO-00NN`); subsection `1` is the spikes (`CSR-WO-01NN`). Phases 1 and up use subsection `0`
unless a phase grows a second concern, in which case the next subsection is allocated and recorded
in the reconciliation table.

**No legacy ids exist.** The steering documents themselves landed by pull request without a work
order number, deliberately: genesis precedes the first work order. This is the only unnumbered
change the repository will ever carry; everything after it is `CSR-WO-PSNN`.

---

## Critical path

```
P0 skeleton + gates ──► P1 pinning · reach · auth ──► P2 the rest of the core ──► P3 Linux edition ──┐
        │                                                    │                                      ├─► P5 upstream + templates
        └── spikes (protocol · approval · envelope) ─────────┘                    P4 Windows edition ┘
                                                                                                    P6 entitlement (trigger-gated)
                                                                                                    P7 conformance suite (intent)
```

**Where risk concentrates: P1, and the seam it creates.** Everything in P0 fails loudly — a
repository that will not build is obvious. P1 is where a defect produces a **confident wrong
answer**: a pin gate that registers every tool and then logs drift passes every test, reports green,
and leaves N2 false; a canonicalizer that is deterministic only over the inputs on hand passes every
test and leaves N3 false. P1 gets line-by-line review and its own adversarial pass and is not batched
with anything. The second concentration is the **core ↔ edition supply boundary** (`architecture.md`
§4): the moment an edition can serve a tool without the core's gate, N1 is false and the suite is
silent. The test that guards that boundary is a P1 deliverable, before any edition has a second tool.

**What runs in parallel.** The approval-transport and envelope spikes (`CSR-WO-0101`, `-0102`)
depend on nothing in P1 and can run alongside it; their findings are consumed in P2. P3 and P4
depend on P2 and not on each other. P5's canonical-form amendment can begin as soon as P1's
specification is ratified.

**Human-track work — not code, and the most likely thing to block delivery while everyone stares
at code.**

| Item | Who | Blocks |
|---|---|---|
| Merge of every pull request — delegated to the architect on a passing review, held by the gate | Scotty | Every phase |
| Ratifying the canonical-form specification once proposed | Scotty | P1's exit; every manifest thereafter |
| Ruling on the approval-transport and envelope spikes | Scotty | P2 (their modules only) |
| Authorization-server configuration values for any test against the real hosted client — held outside this repository (N8) | Scotty | Spike `CSR-WO-0101`; the local test issuer needs none |
| A disposable Linux host or container for P3 acceptance (the fleet's production nodes are not proving grounds) | Scotty | P3's exit gate |
| Operator presence at the Windows proving ground for P4 acceptance | Scotty | P4's exit gate |
| Carrying the canonical-form amendment to the reference node's repository and proposing it for the standard's next version | Scotty ratifies; the architect authors | P5's exit gate |

---

## Phase map

### P0 · Skeleton, gates, and spikes
**Goal:** a repository that builds, tests, and refuses a leak — with the three unmeasured facts the
design depends on measured and recorded.
**Depends on:** the steering documents merged (this pull request).
**Invariants in play:** N5, N6, N8.
**Work orders:**
- `CSR-WO-0000` — repository skeleton: workspaces, TypeScript configuration, test runner, lint,
  Node pinned to the version in `architecture.md` §2.1, an empty `packages/core` that builds, CI
  running the suite on every push and pull request.
- `CSR-WO-0000a` — skeleton corrections from review: supported lint major; inline suppressions
  forbidden in control source and reviewable by config elsewhere; `dist/` build with exports from
  it, tests still on source (`architecture.md` §5 *How fleet ports consume this*, §10).
- `CSR-WO-0001` — the leak gate: a script with the sanitisation rules the fleet's public
  failure-notes repository already uses (owned domains, tunnel and tenant hostnames, device and
  operator paths, addresses, identifiers, token and key shapes), run over the working tree **and**
  over the additions in reachable history, with a `--self-test` that plants each shape and proves
  the gate exits non-zero. Then the required status check is set on `main`.
- `CSR-WO-0002` — governance and supply chain: `SECURITY.md` (platform private vulnerability
  reporting, no address), `CODEOWNERS`, `CHANGELOG.md`, `CONTRIBUTING.md` with a conservative
  default, the tagging convention; CI gains a bill-of-materials artifact on every run, signed build
  provenance on tags, a reporting vulnerability audit, and automated dependency updates that keep
  action pins as commit digests (`architecture.md` §5, rows *Supply chain in CI* and *Governance*).
- `CSR-WO-0002a` — corrections from review: the leak gate admits the platform bot's `Signed-off-by`
  trailer and full SHAs inside platform compare/commit URLs (public references by construction),
  with self-test cases; an explicit Node check joins `npm run check` (`.npmrc` stays — measured:
  the bot regenerates the lockfile under the exact pin).
- `CSR-WO-0100` — spike: install the official SDK at a pinned version, start a stateless server,
  probe the negotiated protocol revision and whether `server/discover` is reachable; record the
  result in `architecture.md` §2.3. STOP.
- `CSR-WO-0101` — spike: whether the hosted client honours multi-round-trip requests / the tasks
  extension for an in-flight approval, measured against a local server. STOP.
- `CSR-WO-0102` — spike: the class-5 envelope options in `architecture.md` §5, tested against the
  fleet's existing verifier contract for interoperability. STOP.
**Exit gate:** CI is green on a pull request that changes a source file; the leak gate's self-test
exits non-zero on every planted shape and zero on the tree; `grep` across the tree for a
query-string token path returns nothing; the three §2.3 rows for these spikes are replaced with
measured values; every CI run publishes a bill-of-materials artifact and a tag publishes a
provenance attestation; the dependency-update configuration exists and has opened at least one
pull request; `main` shows the `test` and `leak-gate` checks as required in its protection.

### P1 · Pinning, reach, and auth — *the controls that are the project*
**Goal:** the load-bearing controls exist, are proven able to refuse, and serve one tool in the
teaching edition through the only registration path there will ever be.
**Depends on:** P0.
**Invariants in play:** N1, N2, N3, N4, N7.
**Work orders:**
- `CSR-WO-1000` — the canonical form: a written specification (key ordering at every level, number
  serialization, the exact character set description normalization strips, whether Unicode
  normalization is applied, sorting of the containment set), the core canonicalizer implemented
  from it, and committed test vectors generated by an **independent implementation in a second
  language whose generator is also committed** — never by the core itself. Subset invariant test
  wired. **Property-based tests** over key order, Unicode normalization forms, surrogates,
  byte-order marks and the non-breaking space. Spike-first on the specification, STOP for
  ratification, then build.
- `CSR-WO-1001` — the pin gate: manifest format, verify-before-register, drift and unpinned refused,
  the approve/diff operator path, strict default, the cross-repo enumeration detector against the
  pinned public standard; `manifest_version` and the unenforced `build` block present from the
  first manifest (`architecture.md` §5, *Manifest schema*).
- `CSR-WO-1002` — containment: `containment_domain` as a sink set or null, `arbitrary_exec` refused
  a domain at construction, the reach harness that records every declared sink a tool touches.
- `CSR-WO-1003` — auth: `401` with resource metadata, JWKS verification, audience equality, issuer
  check, the principal handed downstream and carried on every audit row; an in-process test issuer;
  key-set caching, one refetch on an unknown key id, fail-closed on fetch failure, and a stated
  clock-skew constant, each with its negative test (`architecture.md` §5, *Key-set fetching*).
- `CSR-WO-1004` — the teaching edition's skeleton and its first tool (`read_only`), its manifest, and
  the supply-boundary test that fails if an edition exports anything other than tool definitions, a
  manifest, a deploy scaffold, or a registered implementation of a core interface.
- `CSR-WO-1005` — transport hardening and runtime validation: `Origin` and `Host` checks, body cap,
  per-call timeout, concurrency cap, batch refusal, bounded stateless `GET` stream, protocol-version
  header; every call validated against its pinned schema with `additionalProperties: false` by
  default; result size capped. Each limit is enforced by the core's own layer and asserted by its
  own test, so an SDK bump that adds or removes a default changes nothing silently (measured in
  `-0100`: a patch release added two protections).
**Exit gate:** each of N2, N3, and N4's falsification rows runs as a test and is proven able to fail
by deleting the control it guards; a hand-edited description leaves that tool absent from
`tools/list` on restart; `curl -i` unauthenticated returns `401` with a `WWW-Authenticate` header
carrying `resource_metadata`, and a token with a different audience also returns `401`; the
enumeration detector goes red when a local copy of the standard's field list is edited; every
committed cross-language vector hashes identically in the core; the supply-boundary test exists and
goes red on a planted edition-side control; a forged `Origin` and an extra request property are each
refused before any handler runs.

### P2 · The rest of the core, and a teaching edition a reader can hold
**Goal:** every control in `architecture.md` §8 through the provenance row is built with its
red-proof, and the teaching edition demonstrates every rung except exec.
**Depends on:** P1; the P0 spikes for the two modules they gate.
**Invariants in play:** N1, N5, N7.
**Work orders:**
- `CSR-WO-2000` — capability: the four-rung ladder, the orthogonal untrusted flag, Rule-of-Two
  computed as an obligation, `owned_state` with a pinned one-line recoverability basis.
- `CSR-WO-2001` — approval: the `ApprovalBackend` interface; grants bound to (principal, tool,
  argument digest, nonce, expiry) with the approver recorded, single-use, redemption a separate
  audited event; a deterministic test backend, a console backend, and the confirm-URL backend with
  a pluggable notifier; the approval route unreachable by the tool-calling principal, proven by a
  test; the transport the spike ruled.
- `CSR-WO-2002` — audit: the `AuditStore` interface with a JSON-lines backend; argument values
  replaced by keyed digests with a key-id prefix; hash-chained rows; signed checkpoints to an
  anchor sink; the `audit verify` command. The OS-log backends land with their editions (P3, P4).
- `CSR-WO-2007` — tripwire and rate limit, as two controls: a read-burst tripwire that emits one
  loud audit event and refuses nothing; a per-principal rate limit that answers `429` with
  `Retry-After` and leaves other principals untouched.
- `CSR-WO-2008` — the control-deletion job: each control stubbed out in turn, the suite required to
  fail for each; wired into CI as its own job.
- `CSR-WO-2003` — the capability ceiling and tiered windows, defaulted-safe.
- `CSR-WO-2004` — message provenance: the envelope the spike ruled, signing by a small isolated
  signer interface, verification through three fail-closed gates.
- `CSR-WO-2005` — the teaching edition completes: four tools, the construction-refused exec fixture
  in the test suite, every module annotated with its ClearSeal clause, and the guided failure tour
  (`npm run tour`) that runs each red-proof live and prints what refused and why.
- `CSR-WO-2006` — the development authorization-server harness under `dev/`, labelled not-a-product,
  with a written walkthrough of the flow completing locally.
**Exit gate:** every row of `architecture.md` §8 through *rate limit* reads *built* with its
red-proof named; the control-deletion job is green, meaning every stub made the suite fail; the northstar §3 walkthrough reproduces step for step on a fresh clone; an
unapproved `elevated` call is proven not to execute; a window opened for one principal is proven not
to authorise another; an unsigned message and a signed-but-unlisted-author message are both rejected;
the local walkthrough completes against the harness with an audience-bound token; a grant redeemed
twice is refused the second time; `audit verify` reports a deliberately truncated chain.

### P3 · Linux host edition
**Goal:** a generic Linux host server an operator can install in minutes, with the cage a port
would need proven as a fixture.
**Depends on:** P2.
**Invariants in play:** N1, N6, N7, N8.
**Work orders:**
- `CSR-WO-3000` — the tool set: status, journal, processes, disk and network summaries, file
  operations fenced to a configured root (real-path resolution, beneath-only, no final symlink
  follow — a symlink escape is a required negative test), service restarts bounded to a declared
  allowlist; each tagged, each with its containment domain; the edition's manifest; the system-journal
  `AuditStore` backend.
- `CSR-WO-3001` — the deploy scaffold: the service unit template, the dedicated non-root user, the
  `0600` environment file, the idempotent install script, `.env.example`.
  The install script installs from the lockfile only, refuses on an extraneous or missing package,
  and prints the installed bill-of-materials digest; `/health` reports it (`architecture.md` §5,
  *Dependencies*).
- `CSR-WO-3002` — spike, then build: the per-process cage fixture — service-manager sandboxing
  alone or a namespace tool, decided by measurement — and a fixture tool that attempts egress from
  inside it.
**Exit gate:** on a disposable host with nothing pre-installed, the install script completes without
manual steps; an unauthenticated request returns `401` with resource metadata and `/health` returns
`200` from off the host; the service is answering again after a reboot without intervention; the
fixture tool's egress attempt from inside the cage is blocked and the block is asserted by a test;
the edition's manifest contains no `arbitrary_exec` entry; a symlink planted inside the fenced root
that points outside it is refused; audit rows are present in the system journal after the reboot.

### P4 · Windows host edition
**Goal:** the same categories on Windows, proven on the proving ground and not only in CI.
**Depends on:** P2. Independent of P3.
**Invariants in play:** N1, N6, N7, N8.
**Work orders:**
- `CSR-WO-4000` — the tool set, PowerShell-backed, tagged and pinned.
- `CSR-WO-4001` — spike, then build: service registration (wrapper or scheduled task) under a virtual
  service account, never LocalSystem; the install script; a lint that rejects non-ASCII bytes, a
  byte-order mark, or shell chaining in any script the edition ships; the Event Log `AuditStore`
  backend.
  The install script has the same lockfile-only, refuse-on-drift, print-the-digest behaviour as
  the Linux one.
- `CSR-WO-4002` — acceptance on the proving ground, operator present.
**Exit gate:** CI runs the edition's suite on a Windows runner; on the proving ground the install
script completes, the `401`/`200` probes pass from another machine, and the service answers again
after a restart; the script lint goes red on a planted non-ASCII byte; the service runs as the
virtual account and not as LocalSystem, shown by the service's own identity query.

### P5 · Upstream feedback and the template upgrade
**Goal:** what this build proved reaches the standard and its templates, so the next node ports
instead of re-inventing.
**Depends on:** P2 for the template upgrade; P1 for the canonical-form amendment.
**Invariants in play:** N3.
**Work orders:**
- `CSR-WO-5000` — the canonical-form amendment: the specification from `-1000`, packaged for the
  reference node's Python side and proposed as an amendment for the standard's next version. Lands
  in other repositories; tracked here because it is this project's finding.
- `CSR-WO-5001` — the template upgrade in the fleet build-standard skill: either upgrade both
  canonicalizers to ten fields with `containment_domain`, exec refusal, the reach test, and
  provenance — or replace the templates with a pointer to this core. The gate rules which
  (`architecture.md` §9).
**Exit gate:** a server scaffolded from the upgraded templates (or from the pointer) passes the same
conformance checks the teaching edition passes; the standard's next version carries the
canonicalization amendment, or this table records the reason it does not.

### P6 · Caller entitlement — *trigger-gated*
**Goal:** a principal → allowed-tools map, enforced at the gate, pinned as a second artifact.
**Depends on:** P2. **Trigger:** any consumer needs a second principal with a different tool set.
Until then, no work is owed; the seam built in P1 is sufficient.
**Shape:** intent only. The spike that shapes it: whether the map is keyed on subject, client, or
both, given that the fleet's hosted authorization server strips custom scopes.
**Exit gate:** a principal calling a tool outside its map is refused; editing the map without
re-approval is reported as drift at load.

### P7 · Conformance suite for third parties — *intent*
**Goal:** black-box checks anyone can point at their own server to see how far it conforms.
**Depends on:** P2; P3 or P4 as a second server to run it against.
**Shape:** intent only. The spike that shapes it: which controls are observable from outside a
server (auth, `401` shape, audience rejection, rate behaviour) and which need a documented hook
(pin drift, reach).
**Exit gate:** the suite run against the teaching edition reports every externally observable control
as conformant, and run against a deliberately broken copy reports the break.

### Downstream — not phases of this roadmap
The fleet's node upgrades consume this repository from their own private repositories, pinning a
commit and adding node-specific tools. Their order is theirs to sequence; the expectation recorded
here is Linux nodes first, then the Windows node, each inheriting the core defaulted-safe and
deciding exec case by case (N7's reason).

---

## Standing cadence

- One work order per branch; one pull request per work order; **the builder never self-merges.**
  Merges are performed by the architect only on a passing review and only under the gate's standing
  delegation, which the gate can withdraw at any time.
- Every work order ends with an adversarial pass by a fresh session, then a `FEEDBACK.md`, then a
  parked pull request.
- Security-critical work orders — the canonical form, the pin gate, auth, provenance — get
  line-by-line review and are never batched.
- **At every phase boundary**, run the wider audit: does the code still match `architecture.md`,
  did any finding change an invariant, is the README's status line still true, has anything fallen
  through the numbering, and does every "these two must agree" sentence in the standard have a
  detector.
- **Maintenance is a cadence, not a hope.** The dependency-update automation's pull requests are
  reviewed like any other; the served protocol revision is re-probed whenever the SDK moves and the
  §2.3 row updated; the pinned Node version is bumped by a commit that also bumps the proving
  ground.
- The leak gate is not advisory. A pull request it rejects is not merged with an override; the
  identifier is removed and, if it reached history, the history is rewritten before anything else
  happens.

## Reconciliation

Divergence between what was planned and what was built. **History is left as written.**

| Number as built | What it actually was | What was planned |
|---|---|---|
| *(genesis pull request, unnumbered)* | The four steering documents | — (precedes the first work order, deliberately; recorded so the absence of a number is not read as an omission) |
| `CSR-WO-0000a` | Skeleton corrections from the `-0000` review: supported lint major, suppression policy, built `dist/` exports | Not planned; inserted as a refinement under `-0000` because all three are corrections to the skeleton the review exposed, and a port must never consume raw source (`architecture.md` §10) |
| `CSR-WO-0002a` | Corrections from the `-0002` review: the gate admits the platform bot's commit shapes; engine strictness moves from `.npmrc` to an explicit check | Not planned; inserted because the bot's commits would fail the gate and its lockfile regeneration would fail the exact engine pin — both discovered by the builder before the first bot run |

## Amendments

| Date | Change | Rationale |
|---|---|---|
| 2026-09-24 | Created. P0–P4 scoped to work-order level; P5 scoped; P6 and P7 stated as intent with their spikes named. | First roadmap for this repository, from the same-day planning session. P6 is trigger-gated rather than sequenced because its only justification is a second principal, which no consumer has yet. |
| 2026-09-24 | Maturity review folded in: `CSR-WO-0002` (governance and supply chain) added to P0; `-1005` (transport hardening and runtime validation) added to P1; `-2002` narrowed to audit, `-2007` (tripwire and rate limit as two controls) and `-2008` (control-deletion job) added to P2; acceptance lines added to `-1000`, `-1001`, `-1003`, `-1004`, `-2001`, `-2005`, `-3000`, `-4001`; P0, P1, P2, P3 and P4 exit gates extended; a maintenance cadence added. | Same review as the architecture's second amendment: what changes a schema or an interface is decided before P1; the rest becomes acceptance lines while the work orders are still unwritten. |

## Provenance

Written by Claude (architect) on 2026-09-24, in the co-architect planning session that opened this
repository, at the gate's direction. Rests on `northstar.md` and `architecture.md`; on the phase
shape the gate confirmed for phase 1 in that session (pin manifest and reach test as the load-bearing
pieces, one `read_only` tool, negative tests wired from the first commit); and on the reference
node's roadmap, whose stage order this follows where the controls are the same and departs from
where this repository has no live server to protect.
