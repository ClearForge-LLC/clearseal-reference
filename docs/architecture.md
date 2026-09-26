# clearseal-reference — Architecture

**What this is:** the source of truth for what is being built and why each choice was made.
Implementation detail belongs in work orders; this document constrains them. **`roadmap.md` tracks
sequence; this tracks shape.**
**Date:** 2026-09-24 · **Author:** Claude (architect) · **Gate:** Scotty · **Builder:** a separate
coding-agent session.
**Supersedes:** nothing — first architecture for this repo.
**Invariant authority:** invariants are established in **`northstar.md`** and cited here as `N<n>`.
None is defined in this document.
**Standard of record:** ClearSeal **v0.8**, public edition — `ClearForge-LLC/ClearSeal-public` @
`66b640d`. Its section, decision, and adversarial-class numbers match the full standard, so every
`§` citation below resolves in either edition. **The pinned unit is the commit, not the version
label**; that version is frozen by adoption, and anything this build teaches it goes to the next
version (§9, roadmap P5).

---

## 1. How to use this document

Read `northstar.md` first; it is short and it constrains everything here. Then this document for
shape and rulings; then `roadmap.md` for what to build next. A work order cites this document by
section number and restates only the slice it touches.

**The divergence rule: any deviation from this document is recorded in §10 as a dated amendment with
its rationale. Undocumented drift is a defect, not a shortcut.** A change to an *invariant* is not
an amendment here — it goes to `northstar.md` and is re-ratified; this document records the
consequence, not the decision. Section numbers are never reused; new sections continue the sequence.

## 2. Ground truth — measured, not assumed

Nothing in this repository runs yet, so this section records the environment the build lands in and
the facts the design rests on. Every row says what was run. Where a measurement was blocked it is
reported as blocked with the harness that will produce it — never estimated.

### 2.1 What is there

| Fact | Value | How measured |
|---|---|---|
| Repository state | *At genesis:* one commit on `main` — license, notice, gitignore, README stub. `main` requires a pull request, linear history, no force-push, no deletion. Squash merges only; branches auto-delete on merge. *Since:* the steering documents merged as the second commit (§10, first amendment); the row is left as the genesis measurement. | Created this session; protection read back from the branch-protection API after it was set |
| Continuous integration | None yet. No workflow exists; therefore no required status check is set on `main`. | `ls .github/` — absent |
| Standard of record | ClearSeal v0.8 public edition at the commit pinned in the header, one commit old; it mirrors the full standard's v0.8 text with deployment-specific material omitted and numbering preserved. | Both editions cloned and diffed; the differences are the changelog narrative, the node matrix, and status lines — no control text |
| The reference node (the standard's one adopter) | 26 pinned tools; manifest carries the ten hashed fields including `containment_domain`; 5 tools `elevated`; capability classes 16 `read_only` / 9 `state_change` / 1 `arbitrary_exec`; 63 test files, 964 test functions; a TypeScript canonicalizer kept byte-compatible with its Python one, exercised by a cross-language determinism test. | Its manifest parsed with `python3 -c` and its tests counted with `grep -c 'def test_'` on a clone taken this session |
| Which of that node's controls are mature | Pin gate (verify-before-register); ten-field canonicalizer with the TypeScript twin; capability tags and Rule-of-Two; `containment_domain` with a reach test; an AS-agnostic OAuth resource-server verifier with protected-resource metadata; a call-bound approval gate that separates a grant from its redemption and expires unredeemed grants; a tiered maintenance window with a capability ceiling, built defaulted-safe; a hash-chained audit with argument values replaced by hashes; a read-burst tripwire; a message-provenance verify core with a documented wire contract. | Module inventory of its source tree |
| Which are sketched or absent there | Egress caging (measured unreachable on that platform); manifest signing (custody ruled, key not generated); atomic release activation; token scope enforcement; **and its global call-rate limiter, which its own roadmap says to *verify was removed* before restoring — treat as unbuilt.** | Its architecture §14, its roadmap's audit sub-tier |
| Fleet template state | The fleet build-standard skill's templates pin **nine** fields and carry no `containment_domain`, no reach test, no message provenance; its own Known-gap note says so. The copy of that skill loaded in the planning environment was staler still: it embedded v0.6 and pinned **eight** fields. | `git show` of the skill repository's regeneration commit; the loaded skill's `canonical.ts` read directly |
| The M5 divergence | The reference node's Python `normalize_description` uses `rstrip()`, which strips all Unicode whitespace; its TypeScript twin strips `[ \t\f\v]`. A description ending in U+00A0 hashes differently per runtime. That node's own wire-contract document records this and designs its message envelope with *no* normalization for exactly that reason. | Read in both canonicalizers and in the node's envelope contract |
| First-generation fleet servers (the ports' targets) | A framework wrapper on the legacy SSE transport; an exec tool of `subprocess.run(..., shell=True)` guarded by a substring denylist; several tools interpolate their arguments into shell strings inside single quotes; the endpoint's only auth is network-layer. | One such server's source read in full: its `_run`, its `BLOCKED` list, and its `witness_*` tools |
| Windows proving ground | A Windows 11 machine with Node **v24.21.0** and npm **11.19.0** installed machine-wide this session; `winget` and `choco` are not available in the service session that installs run under, so installs go download-MSI → verify hash → `msiexec /qn`. The MSI hash was cross-checked against the publisher's checksum list fetched from two independent hosts before it ran. | `node --version`, `npm --version`, `Get-FileHash` on the installer, `[Environment]::GetEnvironmentVariable('Path','Machine')` |
| Served protocol revisions (`-1005`) | `server/discover` answers `["2026-07-28", "2025-11-25"]` and `/health` reports the same pair; asserted by a test on every run. Official conformance suite at a pinned commit: 140 pass / 45 fail on the modern set, 48 / 19 legacy — every failure a primitive not yet implemented (resources, prompts, completion, SSE progress, list caching for those). Runtime dependencies of the core: one (`z-schema` 12.4.6). | The test in `packages/core/test/transport/eras.test.ts`; the suite run recorded in `-1005` FEEDBACK |
| Node version to pin | **24.21.0** — the proving ground's version. The reference node's CI pins 24.19.0; the two are one minor apart and this repository pins its own. | As above |

### 2.2 Corrections — where measurement overturned a written belief

| Assumed | Measured |
|---|---|
| "Roughly a third of the reference node is scaffolding" (the handoff's estimate) | About **sixty percent** by module line count: auth 882 lines, pinning 694, core app/config/peer filter 960, ops (audit, ceiling, confirm, provenance, maintenance, tripwire, health) 2,321, capability/elevated gate/deferred 737 — roughly 5,600 of 9,182. The ruling to rebuild clean rather than port stands; what changed is the size of the behaviour specification the tests represent. |
| The fleet templates are one step behind the standard | Two steps in the loaded copy (v0.6, eight fields) and one in the repository copy (v0.8 embed, nine fields), against a ten-field standard. **The drift chain is longer than any one link suggested**, which is why the detector in §3.2 is a phase-1 deliverable and not a courtesy. |
| Rate limiting exists in the reference node and can be treated as a mature control to translate | Its roadmap's audit sub-tier says "verify it was removed, restore it". Treated as unbuilt; the core designs it fresh (§5). |
| The two canonicalizers are byte-identical because a test says so | Byte-identical *over the 26 tool definitions that node has*. The test states the inputs that would break the property. A property that holds only over the inputs you happen to have is a measurement, not a specification — hence the canonicalization ruling in §5. |

### 2.3 Blocked measurements — reported as blocked, never estimated

| Measurement | Why blocked | Harness that will produce it |
|---|---|---|
| **Measured (`CSR-WO-0100`, SDK 1.30.1 on Node 24.21.0):** which protocol revisions the official TypeScript SDK actually serves in stateless mode, and whether `server/discover` is reachable | **SDK 1.30.1 serves `2025-11-25` as its latest revision, and does not serve `2026-07-28`.** Its supported list is `2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07` [`sdk.SUPPORTED_PROTOCOL_VERSIONS`]. **`initialize` never refuses a revision.** Offered any supported one, it echoes it back. Offered `2026-07-28` or an unknown one, it answers HTTP 200 and counter-offers `2025-11-25` [`initialize.offer.*`]. After initialize, an `MCP-Protocol-Version` header outside the list is **refused, HTTP 400, JSON-RPC -32000**. That includes `2026-07-28`, and the check runs before the method is looked up [`header.mcp-protocol-version.*`, `header-gate.before-dispatch`]. A request with no header is served as `2025-03-26` [`sdk.DEFAULT_NEGOTIATED_PROTOCOL_VERSION`]. **`server/discover` is not reachable: HTTP 200 carrying JSON-RPC -32601 "Method not found"**, with or without a version header [`server/discover*`]. Stateless mode (`sessionIdGenerator: undefined`) runs on the pinned Node: no session header is ever set, and a client-supplied session id is ignored [`session.*`]. | Phase-0 spike `CSR-WO-0100`: `node spikes/0100-protocol/probe.ts`. The SDK is pinned exactly at 1.30.1 in `spikes/0100-protocol/package.json`. The result was identical across three runs, and every value was re-measured against 1.30.0 (unchanged for this row). |
| **Local half measured (`CSR-WO-0101`); client half pending the operator.** Which in-flight approval transport the hosted client honours | On the core's own transport: MRTR-carried elicitation is carried on `2026-07-28` (63 ms round trip) and refused cleanly when the client declares no elicitation support; on `2025-11-25` MRTR does not exist (the harness surfaced a `500` there — repaired in `-1005a`). The Tasks extension is implementable from its text but needs three core changes; not offered. The out-of-band grant works on both eras, codes never leave the server log, a second use / wrong action / expired code are all refused, zero grants survive the run. Adversarial: an MRTR approval can come from the token holder with no human (C1); a saved MRTR state re-sent with "accept" after a decline is APPROVED (B1); the harness cannot tell which connection redeems a grant and records no approver (B2); a same-machine caller can read the log (C2, spike-only). | The operator runs `OPERATOR-PROTOCOL.md` against the hosted client; the architect appends the client half here before `-2001` is ruled |
| Whether an audience-bound token flow completes against a self-hosted development authorization server on the chosen library version | No harness yet | Built inside the dev-AS work order in phase 2; the same twelve-line configuration that passed on the reference node is the prior |
| Whether a per-process egress cage on Linux is achievable with the service manager's sandboxing alone, or needs a namespace tool | No Linux edition yet | Phase-3 spike inside the cage-fixture work order |

## 3. Shape

### 3.1 The monorepo

```
clearseal-reference/
  packages/
    core/           every control, exactly once (N1): transport, auth-rs, pinning,
                    capability, containment + reach harness, approval, ceiling,
                    provenance, audit, rate-limit, ops
    teaching/       four demo tools, one per rung except exec, one refused at
                    construction; annotated; a reader holds all of it at once
    host-linux/     generic Linux host tools + service-manager deploy scaffold
    host-windows/   the PowerShell-backed equivalents + service registration
    conformance/    (later phase) black-box checks anyone can run at their server
  dev/
    as-harness/     (phase 2) a development-only authorization server; not a product
  docs/             northstar · architecture · roadmap · work-orders/
  pins/             one manifest per edition, committed and reviewed
```

Editions are thin. Each is a tool set, a manifest, a configuration schema, and a deploy scaffold.
Each registers its tools through the core's gate and nothing else; an edition has no code path that
can serve a tool the core has not verified. That property is tested, not assumed (§8).

### 3.2 The core, component by component

```
              client   (Authorization: Bearer …  — never a URL credential)
                │
     ┌──────────▼───────────────────────────────────────────────────────┐
     │ transport   stateless Streamable HTTP on the official SDK;       │
     │             served revision probed and recorded (§2.3); Origin  │
     │             and Host validated; body, time, concurrency capped   │
     │ auth-rs     401 + WWW-Authenticate → protected-resource metadata │
     │             → JWKS verify → audience must equal this resource    │
     │             → principal {iss, sub, client_id} handed downstream  │
     │ tripwire    read-burst detector: loud audit event, no refusal    │
     │ rate-limit  per-principal budget: 429 + Retry-After on breach   │
     │                                                                  │
     │ ┌─ registration + PIN GATE ────────────────────────────────────┐ │
     │ │ canonicalize the ten-field object → hash → compare to the    │ │
     │ │ committed manifest → MATCH: register · DRIFT/UNPINNED: refuse│ │
     │ └──────────────────────────────────────────────────────────────┘ │
     │ validate    every call checked against its pinned input_schema   │
     │             (additionalProperties:false default); output capped  │
     │ capability  four-rung ladder + untrusted_input_facing + scope;   │
     │             Rule-of-Two obligation computed, never bypassed      │
     │ containment containment_domain (a sink SET or null); exec is    │
     │             refused a domain at construction; reach harness     │
     │             watches every declared sink                         │
     │ approval    ApprovalBackend interface; grant ≠ redemption;       │
     │             unredeemed grants expire                             │
     │ ceiling     tiered windows (principal · tools · purpose ·        │
     │             duration); mint/merge/exec above the line            │
     │ provenance  class-5 envelope: sign, then verify through three    │
     │             fail-closed gates (signature → allowlist → floor)    │
     │ audit       append-only, hash-chained; args as keyed digests;    │
     │             signed checkpoints to an anchor sink                 │
     │ ops         /health is the only bearer-free route               │
     └──────────────────────────────────────────────────────────────────┘
```

**The cross-repo enumeration detector** lives in the core's test suite. It reads the standard's own
§3 field list from the pinned public edition and asserts it equals the core's `canonicalFieldSet()`.
The standard says "if these diverge, the executable form is authoritative and the list is the bug" —
that sentence names a failure without detecting it. This repository is the first place both sides
can be seen from one test, so it is where the detector lives (N3, N5).

### 3.3 The editions

**Teaching.** A sandboxed notes store as the carrier: a `read_only` read, an `owned_state` write
with a one-line recoverability basis, a `state_change` tool that faces untrusted input and is
contained by a declared sink, and an `elevated` tool that demonstrates the approval path. A fifth
definition exists only in the test suite: an `arbitrary_exec` tool claiming a containment domain,
refused at construction (N7). Every module is annotated with the ClearSeal clause it satisfies.
Optimized for being read whole, not for reuse — the editions carry reuse.

**Linux host.** Generic host operations shaped by what first-generation fleet servers actually
expose, minus what N7 forbids: system and service status, journal reads, process listing, disk
and network summaries, file reads and writes fenced to a configured root, and service restarts
bounded to a declared allowlist (a `state_change` tool whose containment domain *is* that list).
Exec is absent; the edition ships the cage as a proven fixture so a private port that adds exec
inherits a working sandbox (§6).

**Windows host.** The same categories, PowerShell-backed. No cage is claimed on Windows; exec, if a
port adds it, is approval-only, and the edition's documents say so rather than imply otherwise.

## 4. Seams, and which are boundaries

| Seam | Boundary? |
|---|---|
| Client ↔ server (HTTP, bearer, audience) | **Trust boundary.** The only place an unauthenticated or wrong-audience party is refused; everything downstream assumes it held (N4). |
| Pin verifier ↔ tool registry | **Trust boundary, and the load-bearing one.** N2 lives here. The boundary is *before* registration; a verifier that runs after registration has already failed open. |
| Tool ↔ host (files, services, network sinks) | **Blast-radius boundary.** `containment_domain` and the reach harness bound it; the approval gate stands in front of what cannot be bounded. |
| Core ↔ edition | **Supply boundary** (N1) — not a trust boundary against a hostile edition, but the line that keeps three editions from becoming three cores. Enforced by the rule that an edition's only registration path is the core's, and by a test that fails if an edition exports a control. |
| This repository ↔ a fleet port | **Dependency boundary.** A port pins a commit and adds tools in its own repository; nothing flows back except through a pull request here and the upstream lane (§9). |
| Teaching edition ↔ dev authorization-server harness | **Not a boundary.** A development convenience, labelled as such, never reachable from a deployed edition. Stated so it is not maintained as if it were one. |
| Application factory ↔ middleware chain inside the core | **Not a boundary** — a module seam. Stated so nobody hardens the wrong line. |

## 5. Ratified rulings

| Question | Ruling | Reason |
|---|---|---|
| One repository or three | **One repository, one core, three editions.** | A control invented twice is two controls and the second is the one nobody audited (the reference node's own template obligation). Three canonicalizers would recreate the M5 divergence inside one repository. |
| Language and SDK | **TypeScript. The core owns its transport — a stateless Streamable HTTP layer written directly against the `2026-07-28` specification text — and the official SDK is not in the request path and not a runtime dependency.** *Amended twice on 2026-09-25: see §10.* | ClearSeal decision #13's reason is that nothing should stand between the code and the specification it must conform to. The official SDK was measured (`-0100`) to serve only `2025-11-25`, no 2.x line is published, and the `2026-07-28` revision is a rewrite (no `initialize`, no session, no GET stream, `_meta` on every request, `server/discover`, MRTR, routing headers) that a 1.x SDK cannot be configured into. The fleet's own nodes reached the current revision the same way. Owning the transport also makes every limit the core's, which the *Transport hardening* ruling already required. |
| Protocol revision | **The reference serves `2026-07-28` — the stateless revision the standard is written for — natively, and serves the legacy `2025-11-25` handshake on the same endpoint as a pure function (no session, no stream) for clients that have not moved, with that path marked for removal at the end of the protocol's deprecation window.** The revision actually served is probed and recorded, never assumed. *Each era is served by its own conventions:* legacy-era JSON-RPC errors for well-formed requests are `200` with the error object; modern-era refusals follow the `2026-07-28` page's explicit `4xx` mapping; HTTP-level refusals are `4xx` in both (`-1005b`). | The gate's direction, after the architect first amended this to "serve what the SDK serves": the fleet's v2 nodes are on the current revision and a reference that is not is not a reference. ClearSeal §B. Dual-revision on one endpoint is how the fleet's own nodes and other stateless servers bridged the change. |
| Authorization server | **The verifier is AS-agnostic: an issuer, a JWKS location, and an expected audience, all configuration.** Tests use an in-process test issuer with a generated key. A development harness on a self-hosted library ships for local end-to-end runs, labelled not-a-product. Which AS a *node* uses is that node's decision. | Decisions #10/#12 — conform, do not re-derive. The reference node proved AS-agnosticism by verifying a second issuer with configuration alone, and found that its hosted AS strips custom scopes at registration — so identity must come from the token's subject and client, never from scope. |
| `arbitrary_exec` in the editions | **None ships it (N7).** The core implements the rung, refuses it a containment domain at construction, and carries the approval plumbing a port would need. | Recorded with its reason under N7 in `northstar.md`. |
| How fleet ports consume this | **Release tarballs, pinned by tag and integrity hash, built and provenance-attested by CI** (`-0002`); the tag's changelog entry records the commit, so the commit pin survives. No registry publication for now. *Amended from "a git dependency pinned by commit" — see §10.* | Measured in `-0000`: the runtime does not strip types under `node_modules`, and a consumer's `ignore-scripts` (which every fleet node sets) prevents the `prepare` build a git dependency relies on. A tarball built and attested by CI is both consumable and stronger evidence than a commit. |
| License | **Apache-2.0** for code. The standard stays CC BY 4.0 in its own repository and is cited. | Patent grant; the norm for reference implementations. |
| Visibility | **Public from the first commit.** | History discipline starts at commit one or it never starts. |
| Approval mechanism | **Do not decide the transport yet — spike it** (`CSR-WO-0101`, after `-1005`). Ratified as a *prior* by the gate: **tiered by capability class** — an out-of-band grant (approver ≠ token holder) for `elevated`; MRTR-carried elicitation acceptable for a contained `state_change` where the claim is "a human is present", not "a different principal approved"; the Tasks extension only if the hosted client uses it. Ruled now: an `ApprovalBackend` interface in the core with a deterministic test backend and a console backend; editions plug in their own. Prior, held loosely: the spec-native multi-round-trip path if the hosted client honours it, otherwise the reference node's out-of-band grant-then-reinvoke pattern. | The decision turns on what the real client does, which is unmeasured. |
| Capability ceiling and tiered windows | **In the core**, defaulted-safe, sequenced after pinning, reach and auth. | Ports inherit it; a port that inherits a half-built ceiling has to invent one. |
| Message provenance (class 5) | **Spike done (`-0102`, §2.3). Architect's recommendation from the table: Option A** — the field contract byte-for-byte with a pluggable payload — with its three open encoding decisions closed on the verifier side (duplicate keys refused; integers in shortest form only; `-0`, `1.0`, `1e0` refused) so the wire format is unchanged and the deployed verifier still accepts it. **Ruled by the gate, 2026-09-25: Option A**, with those three decisions closed on the verifier side; `-2004` builds it. | Only A needs no dependency and is accepted unchanged by a verifier already in the field; it is also the smallest signed surface. Its weaknesses are parser-side and fixable without touching the wire. |
| Caller entitlement | **Seam now, enforcement later.** The verifier yields the principal, the gate accepts it, and every audit row carries it from phase 1. Enforcement — a principal → allowed-tools map — is its own later phase and, when it lands, the map is a **second pinned artifact** verified at load. | Retrofitting caller identity into a shipped auth surface is far more expensive than allowing for it once (measured on the reference node). An entitlement map is a gate input, so decision #15 applies: pinned, or it is unpinned authority. |
| Canonical form | **Specified and ratified 2026-09-26 (`docs/canonical-form.md` v1, on the `-1000` branch until stage B lands):** RFC 8785 for the JSON layer with duplicate keys refused; numbers per ECMAScript `Number::toString` with `NaN`, the infinities, `-0` and magnitudes over 2^53−1 refused; strings as given, no Unicode normalization, lone surrogates and a leading BOM refused; only the top-level `description` normalized, by the fleet's post-M5 rule; ASCII tool names; exactly the ten pinned fields, **all always present at the top level** (`null` where the standard says "null unless"), absent/`null`/`{}`/`[]` distinct only inside `input_schema`; `containment_domain` deduplicated and sorted by UTF-16 code units; `tool_hash` and `manifest_hash` with **the version inside the manifest hash**; `canonical_form_version: 1`. Vectors carry plain hex digests under one leak-gate allow entry for the vectors file. **Specify it, then implement it.** The core's canonicalizer is written from a written specification (key ordering, number formatting, exactly which characters description normalization strips, Unicode normalization or its explicit absence), shipped with committed cross-language vectors generated by the *other* runtime. | §2.2 row four. A property that holds only over the inputs you have is not a specification. The resulting amendment to the reference node's Python side is upstream work (§9). |
| Exec posture, if a port adds it | **Linux: a proven per-process cage, delivered as a test fixture in the edition. Windows: approval-only, no cage claimed.** *Departure from the fleet's platform-neutral wording, labelled as one.* | Linux has service-manager sandboxing and namespaces; the reference node's platform did not, which is why `containment_domain` was invented. Windows has no equivalent the edition can honestly claim. |
| Node version | **24.21.0**, pinned in CI and in the engines field. | The proving ground's version (§2.1). Bumping it is a commit. |
| Conformance suite for third parties | **A later phase, decided now** (roadmap P7). | High value, large scope; deciding it deliberately prevents drift into it. |
| Hosted demo | **No.** | Northstar non-goal. |
| Manifest schema | **From the first manifest:** `manifest_version`, and a `build` block with slots for the commit, a distribution digest, a signature, and a key id — populated as *unenforced* until the release-integrity control lands (§8). | A manifest is a consumer-facing schema; adding fields later is a migration for every port pinned by commit. Slots cost nothing; migrations cost every consumer. |
| Key identity and rotation | **Every signing or verification allowlist entry carries a key id (`kid`) and a validity window** — provenance authors, manifest signers, audit checkpoint keys. Rotation is adding an entry with a new window, never editing one. | Rotation bolted on later always breaks the allowlist format; designed in, it is an append. |
| Approval binding | **A grant binds to (principal, tool, canonical argument digest, nonce, expiry) and records the approver; it is single-use, and redemption is a separate audited event from the grant.** **The approval channel is never reachable by the tool-calling principal.** *Added from `-0101`:* an MRTR `requestState` is consumed on first redemption and **a decline is terminal** — the same state can never later be accepted; a grant is redeemable only by the principal that requested it; the approver's identity is recorded on every redemption. | Without argument binding an approval for one call authorises another; without channel separation a prompt-injected model can approve itself — the confused-deputy loop the gate exists to break. |
| Audit argument digests | **Keyed** — an HMAC over the canonical argument object with a server key named in the environment, the key id prefixed to the digest. Never a bare hash. | A bare hash of a low-entropy argument (a path, a service name) is reversible by dictionary; the "never stored" claim would be false. Keyed digests keep correlation (equal arguments, equal digest) without reversal. |
| Audit store and anchoring | **Host editions write audit rows to the operating system's log facility** (the system journal on Linux, the Event Log on Windows) as the primary store, because the service user can append there and cannot truncate it; the teaching and development backend is a JSON-lines file. **Every row hashes its predecessor; every N rows or T minutes a checkpoint** (head hash, row count, timestamp) is signed with the provenance signer and emitted to an anchor sink — the system log by default, a remote sink by configuration. An `audit verify` command checks chain and checkpoints. | A hash chain a same-privilege attacker can truncate and re-chain is decoration. Tamper evidence needs a store with different ownership or an anchor the attacker cannot reach; the OS log gives the first for free, the checkpoint gives the second. |
| Tripwire and rate limit | **Two controls, not one.** The *tripwire* detects read bursts and emits a loud audit event without refusing (the reference node's design). The *rate limit* is a per-principal budget that refuses with `429` and `Retry-After` on breach. | The genesis draft conflated them under "never a refusal that would itself be a denial of service". A per-principal refusal denies only that principal; a hostile token holder must meet an actual limit. Corrected. |
| Transport hardening | **Required, not optional, and owned by the core's own layer with tests that assert each limit — never inherited from an SDK default.** `Origin` validated against an allowlist and `Host` checked (measured off by default in the SDK); request body size capped (the SDK's 4 MiB arrived in a patch release and was absent one patch earlier); a concurrency cap (the SDK has none); JSON-RPC batches refused (accepted by the SDK though dropped from the protocol); the stateless `GET` event stream bounded (the SDK leaves it open); a per-call tool timeout; the protocol-version header handled per the served revision. Each has a negative test. | Origin validation is a MUST in the transport specification; the rest is the layer a reference is judged on first and mentioned last. |
| Runtime validation and output caps | **Every call is validated against its pinned `input_schema` (JSON Schema 2020-12, external `$ref` refused, depth and time bounded) before the handler runs, with `additionalProperties: false` as the default; tool results are capped in size.** Defaults, configurable per edition: body 1 MiB, parse depth 64, in-flight requests 32 then `503` with `Retry-After`, handler timeout 30 s, result 256 KiB. | Pinning proves the schema was not changed; it does not validate the call. Results flow back into the model as untrusted input, so their shape is bounded even though no control here is a prompt-injection defence. |
| Where OS primitives live | **The core defines the interfaces — `Cage`, `ApprovalNotifier`, `AuditStore` — and an edition may export only tool definitions, a manifest, a deploy scaffold, and registered implementations of those interfaces.** The supply-boundary test enforces exactly that enumeration. | Northstar N1's scope note. Gives the boundary test a rule instead of a judgement. |
| Headless approval path | **The core ships a confirm-URL backend** — a one-time link plus a short code, served by the node itself on a route reachable only out-of-band, with a pluggable notifier — alongside the test and console backends. | A console backend is useless for a service; every host edition needs a real path, and this is the shape the reference node converged on. |
| File fence | **Resolve the real path of the root and of the candidate, require the candidate to sit beneath the root after resolution, and open without following a final symlink.** The remaining time-of-check race is documented, not hidden. | A prefix check on the requested string is defeated by a symlink inside the root — the classic fence failure. |
| Windows service identity | **A virtual service account, never LocalSystem.** | Least privilege. The fleet's current choice is the fleet's; the reference defaults to the safe one. |
| Key-set fetching | **JWKS cached with a TTL; one refetch on an unknown `kid`; a fetch failure with no valid cache answers `401`, never accepts; clock-skew tolerance is a stated constant.** | Each of these is a fail-open when left to a library default. |
| Server-initiated requests | **The reference initiates no sampling and no elicitation.** If a future edition needs either, it is gated like an `elevated` tool and ruled here first. | Both invert the trust direction — the server asks the model to act — and neither has a control in the standard yet. |
| Supply chain in CI | **A software bill of materials produced on every run; signed build provenance on tagged releases; automated dependency updates that keep action pins as commit digests; a vulnerability audit that reports.** | "Pinned by SHA" is a claim; a bill of materials and a provenance attestation are evidence. |
| Governance | **`SECURITY.md` pointing at the platform's private vulnerability reporting (no address, so the leak gate stays honest); `CODEOWNERS`; `CHANGELOG.md`; version tags with the commit beside them so consumers pin either.** | A public artifact of process needs a front door for disclosure and a way to name a version. |
| Dependencies: pinned, few, checked at deploy | **Every dependency, runtime and development, is pinned exactly** (`save-exact`, a committed lockfile, `npm ci` only) — including a package's *runtime* `dependencies`, so a consumer installs exactly what was tested (the cost, duplicate versions in a consumer's tree, is accepted for a security reference with few runtime dependencies). **Necessary and limited**: a dependency is added only when writing the code is the larger risk, and each is named in the changelog with its reason. **Deploy-time check:** every host edition's install script runs the install with the lockfile, refuses on any extraneous or missing package, and prints the bill-of-materials digest it installed; the health route reports that digest beside the commit (the `build` block); the runbook's first line after "service is up" is *compare the digest to the release's*. | A tree that drifts from what was tested is the quietest way for a proven control to stop being the proven one. Pinning makes drift impossible at install; the digest makes it visible at run time; the runbook line makes someone look. |
| Completeness bar for a public reference | **Where the specification gives a server a MAY that a generic deployer could reasonably use, the reference implements it fully rather than refusing it — unless it conflicts with a control, in which case the refusal and its reason are documented.** First application: `x-mcp-header` — the server-side handling (validation, Base64-sentinel decoding, `HeaderMismatch`) is implemented and tested with a fixture tool; no shipped tool declares it. | The gate's direction: this is an open-source reference for anyone, not a fleet-minimal build, and it is meant to show the quality of the architecture and process. A reference that refuses spec features because *our* nodes do not need them is a fleet build wearing a public name. |
| Unhashed tool fields | **A tool definition carries no field the manifest does not hash — no `title`, no `annotations`.** A field a gate does not cover is a field a prompt-injected model can be steered by; a port that needs one adds it to the canonical form first, as a version bump, never beside it. | Ruled at `-1001` review (D-4). The same rule as A6's generating rule, applied to what the client sees rather than what the gate reads. |
| Containment matching | **A domain is a canonical set of `fs:<absolute root>`, `host:<name>[:port]` and `svc:<name>` entries, or `null`; anything else is refused at construction, never repaired.** Hosts match by lower-case name, never by address (an address literal is refused as an entry). A root that is itself a symlink is followed once, at registration, and the resolved bound holds. `[]` and `null` stay distinct, as A7 ratified. The core's `RecordingCage` is in-process and says so: on POSIX it opens with `O_NOFOLLOW` and re-checks the descriptor on Linux, but a swap of an *intermediate* directory between check and open is not closed in-process (that needs `openat2`/`RESOLVE_BENEATH`, which Node does not expose) — the edition's OS-level `Cage` is the boundary, and must pass the same reach harness. An undeclared reach fails the call even when the handler catches the refusal; the sink goes to the audit seam, the response names only its kind. A sink the three schemes cannot express is an edition's proposal to the canonical form (a version bump), never a fourth scheme beside it. **v1 limit, queued as `-1002a`:** an `fs:` root grants every open mode; a `read_only` tool's cage will admit read modes only. | Ruled at `-1002` review. The review found the in-process cage's one overclaim by measurement (R-1: a write-mode open through a swapped leaf truncated a file outside the root before the post-open check refused the handle) and fixed it before merge; the remaining limit is stated rather than hidden. The fleet node's extra sinks are the fleet's concern under the completeness bar: the reference stays generic. |
| Test discipline for parsers | **Property-based tests on the canonicalizer and the envelope parser** (key-order independence, Unicode normalization forms, surrogates, byte-order marks, the non-breaking space that is M5); **a control-deletion job in CI** that stubs each control and asserts the suite fails. | Parser-shaped code gets fuzzed or it gets found; and N5's falsification ("a red-proof that still passes when the control is deleted") is a gate only if something runs it. |

## 6. Runtime and deployment

**Common to every edition.** Loopback bind by default; TLS terminates at whatever edge the operator
puts in front, which this repository does not specify. Configuration by environment variables named
in a committed `.env.example` with blank values (N8). `/health` is the only route that answers
without a bearer. Refuse to start when the manifest is missing or unparseable, when any tool is
unpinned or drifted under the strict default, or when the audience is unconfigured.

**Linux host edition.** A service-manager unit template running as a dedicated non-root user with
the standard hardening directives, an environment file at mode `0600`, and an install script that
is idempotent and prints the two probes the operator runs afterwards (`401` with resource metadata
unauthenticated; `200` on `/health`). The cage fixture (§5) is a separate unit-scoped sandbox
applied per invocation, not the service unit's own sandbox — the service needs egress to its
authorization server's key set; a caged tool needs none.

**Windows host edition.** Registration as a service through a documented wrapper or a scheduled
task — ruled at that edition's spike (roadmap P4), prior: the wrapper, because the fleet's Windows
node already runs its services that way. Scripts are ASCII-only, without a byte-order mark, and
avoid shell chaining, because those three have each broken a deployment on that platform before.
Proven on the Windows proving ground, not only in CI.

**Release integrity.** Out of scope for the reference beyond what CI proves about a commit. The
reference node's atomic-release and off-box-verification design is fleet infrastructure; this
repository documents the contract a port should honour (a build that reports its own commit, and a
health route that exposes it) and stops there.

## 7. Security posture

**What the reference claims.** Conformance to every ClearSeal control in §8, evidenced by a negative
test per control that CI runs (N5). Fail-closed startup and auth (N4). Tool definitions pinned
before registration (N2). Every gate input inside the hash (N3).

**What it does not claim, stated so the claim means something.**

- *A pin attests the model-visible definition, not the handler body.* The reach harness is what
  keeps a body's real reach inside its declared domain, and it holds in CI on a reviewed commit —
  not against an attacker editing a deployed tree. Module-digest signing at release is the
  intended closure and belongs to whoever deploys.
- *A hostile holder of a valid token is out of scope.* The read surface exists so an authenticated
  collaborator can use it. The reference bounds and makes visible — rate limit, audit — it does not
  prevent. Containment of a hostile authenticated caller is the entitlement phase's problem.
- *The development authorization server is not an authorization server.* No identity, consent,
  storage, revocation, or key custody. It exists so a reader can watch the flow complete locally.
- *No control here is a prompt-injection defence.* The standard's own §0 says so; believing
  otherwise is its primary failure mode.

### 7.1 Threat model — who each control is for

A control with no adversary is ceremony. This table is the map; a control missing from it, or an
adversary with no control, is a finding.

| Adversary | Capability assumed | Controls that answer it |
|---|---|---|
| A prompt-injected model (confused deputy) | Calls any tool it can see, with any arguments, at any rate; cannot reach the approval channel | Pin gate (only reviewed tools are visible); capability ladder and Rule-of-Two; `containment_domain` + reach; approval binding and channel separation; runtime validation; output caps; tripwire |
| A compromised or impostor client | Presents tokens minted for another server; replays; forges `Origin` | Audience equality; `401` + resource metadata; transport `Origin`/`Host` validation; per-principal rate limit |
| A hostile authenticated principal | Holds a valid token; hammers the read surface; probes for reach | Rate limit (`429`); tripwire; audit with keyed digests; caller entitlement (deferred, P6); containment |
| A stolen bearer token | Full use until expiry | Short token lifetime (authorization-server policy, outside this repository); audience binding limits the blast radius to one node; audit for detection; rate limit |
| A compromised dependency | Runs code in the process at install or at runtime | `ignore-scripts`; actions and dependencies pinned by digest; bill of materials and provenance so the change is visible; the supply-boundary and control-deletion tests so a substituted control is caught in CI |
| An attacker with write access to the deployed tree | Edits a handler body or the manifest in place | Verify-before-register catches definition drift; the `build` block and release-integrity control (deferred) catch body drift; audit checkpoints anchored outside the tree make the edit's timing evident. **Until release integrity lands this adversary is only partially answered, and this section says so.** |
| An attacker who can truncate the audit file | Same privilege as the service | OS-log store the service user cannot truncate; signed checkpoints to an anchor sink; `audit verify` |
| A forged inter-node message | Sends a well-formed message claiming an author | Class-5 provenance: signature, author allowlist with key ids, effect floor |

**The unpinned-authority sweep applies from phase 1.** Every security decision in the core — auth,
capability gating, approval, ceiling, rate limit — lists its inputs, and each is either inside the
canonical hash, inside a second pinned artifact, or documented as out of scope with its own named
control. There is no third category (decision #15). The subset test is the executable half.

## 8. Traceability

Every control points home. Status is one of *planned* (a roadmap phase names it), *built* (merged
with its red-proof), or *deferred* (named trigger). At genesis every row is planned; this table is
where the build reports.

| Control | ClearSeal | Core module | Red-proof (what must fail) | Status |
|---|---|---|---|---|
| Stateless transport, owned, both eras, revision measured | §B, #13 (as amended) | `transport` | Test asserts `server/discover` answers exactly the recorded pair; a legacy `initialize` never yields a session header | **built** — `-1005` (`2d0c50b`) |
| `401` + protected-resource metadata; audience-bound verify | §1, §3, §B, #10 | `auth-rs` | Wrong-audience token → `401`; missing token → `401`; unauthenticated `/health` → `200` | planned — P1 |
| Canonicalizer from a written spec, cross-language vectors | §3, §8 #8 | `pinning/canonical` | A vector generated by the other runtime whose hash differs fails the suite; the oracle's regeneration diffed in CI | **built** — `-1000` (`865adc1`): 69 vectors, 8,394 property inputs per run, 0 mismatches |
| Ten-field pinned object; subset invariant | §3, #14, #15, §8 #11 | `pinning/canonical`, `capability` | Gate reads a field outside the canonical set → `test:subset` red | **built** — `-1000`; one field list in `capability/fields.ts`, imported by both |
| Verify-before-register; drift and unpinned refused | §2 class 2, §8 #7 | `pinning/gate`, `pinning/registry` | Edited description → tool absent from `tools/list`; unpinned tool → refused; a registry built from anything but the gate's admission → refused at compile time and run time; the served definition is the frozen copy that was hashed | **built** — `-1001` (`63b2e4b`); 32 red-proofs |
| Cross-repo enumeration detector | §3 ("the executable form is authoritative") | `pinning/spec-check` | Local copy of the standard's list edited → test red | **built** — `-1001`: the standard at `66b640d` lists the same ten fields the core hashes; no divergence; plain equality asserted |
| Four-rung ladder, orthogonal untrusted flag, Rule-of-Two | §3, §4, §8 #1 | `capability` | An untrusted-facing `state_change` tool with neither approval nor containment → refused at construction | planned — P2 |
| `owned_state` with pinned recoverability basis | §3 (v0.6) | `capability` | `owned_state` without a one-line basis → refused | planned — P2 |
| `containment_domain` as a sink set; exec refused a domain | §3 (v0.8) | `containment` | Exec tool given a domain → refused at construction (N7) | built — P1 (`-1002`, `e95048f`) |
| Reach harness | §3 (v0.8), §5.1 of the reference node | `containment/reach` | Tool touching an undeclared sink → test red, sink named | built — P1 (`-1002`, `e95048f`) |
| Approval gate; grant ≠ redemption; expiry | §3 (elevated confirm) | `approval` | Unapproved `elevated` call → not executed; expired grant → refused | planned — P2 |
| Capability ceiling and tiered windows | §3, §8 #11 (the elevated instance) | `ceiling` | A window opened for one principal authorises another → red; exec/mint/merge under a window → refused | planned — P2 |
| Message provenance, three gates | §2 class 5, §3, #16, §8 #12 | `provenance` | Unsigned → rejected; signed by an unlisted author → rejected; a valid signature requesting an above-floor effect → rejected | planned — P2 (envelope by spike) |
| No URL credential path | §4, #11 | whole tree | `grep` for a query-string token path finds nothing | planned — P0 (gate) |
| Leak gate over tree and history | N6 | `.github/workflows` + script | Gate self-test proves it goes red on a planted identifier | planned — P0 |
| Linux per-process cage (fixture) | §3, §8 #1 (containment discharge) | `host-linux/cage` | Fixture tool attempting egress from inside the cage → blocked | planned — P3 |
| Transport hardening (`Origin`/`Host`, body cap, timeouts, concurrency, batches, mirrored headers, `x-mcp-header`) | §B; transport specification MUST | `transport` | Forged `Origin` → rejected; oversized body → rejected; a handler that never returns → call times out and its slot is held until it finishes; 62 red-proofs in one run | **built** — `-1005` |
| Runtime input validation against the pinned schema; output size cap | §3, §4 | `transport/validate` | An extra property → rejected before the handler; external `$ref` → refused at registration; validation runs off the event loop with a 2 s deadline; an oversized result → refused | **built** — `-1005` (pinning of the schema itself is `-1001`) |
| Tripwire (read burst, loud, no refusal) | §8 #9 | `tripwire` | A burst → exactly one loud audit event; no refusal | planned — P2 |
| Rate limit (per principal, refuses) | §8 #9 | `rate-limit` | Over budget → `429` with `Retry-After`; another principal unaffected | planned — P2 |
| Audit keyed digests, OS-log store, signed checkpoints, `audit verify` | §8, §11 | `audit` | A bare argument value in any row → red; a truncated chain → `audit verify` reports it; a checkpoint with a bad signature → rejected | planned — P2 |
| Manifest `build` block and release-integrity check | §8 #12, the reference node's A2/A5 | `pinning/manifest`, `release` | Slots present (`-1001`, nullable, unenforced; `manifest_hash` recomputable so a hand edit is caught without a signature); **enforcement deferred** — trigger: the first fleet port that deploys from a release, at which point a digest mismatch at start must refuse | deferred — trigger named |
| Supply chain: bill of materials, provenance on tags, dependency automation, audit report | §8 #12 (integrity of what runs) | `.github/workflows` | A run without the bill-of-materials artifact → red; a tag without provenance → red | planned — P0 (`-0002`) |
| Control-deletion job | N5 | `.github/workflows`, `test/deletion` | Any single control stubbed out → the suite fails | planned — P2 |
| Property-based tests on parsers | §3, §8 #8 | `pinning/canonical`, `provenance` | A key-order permutation or a Unicode form that changes the hash → red | planned — P1 |
| Caller entitlement | §1 (self-controlled clients), decision #15 | `entitlement` | Principal calling a tool outside its map → refused; map edited without re-pin → drift | deferred — P6, trigger named in roadmap |

## 9. Open questions

| Question | Decider | Blocks |
|---|---|---|
| Which approval transport the hosted client actually honours | Spike `CSR-WO-0101`; the gate rules on its findings | The approval gate's transport in P2 (its interface is not blocked) |
| **Measured (`CSR-WO-0102`):** which class-5 envelope the core signs | Three options built behind the same three gates, Python-generated vectors verified in TypeScript, 27 red-proofs. **A** (the field contract, pluggable payload): 100 lines, 9 encoding decisions of which the contract fixes 6, no runtime dependency, 145 signed bytes for the minimal vector, the deployed verifier accepts its output unchanged, verify 132 µs. **B** (RFC 9421): 177 lines, 14 decisions, 2 packages, 390 bytes, needs a new verifier. **C** (detached JWS): 121 lines, 9 decisions, 1 package (`jose`, which accepted HS256 keyed with the public key until `algorithms` was set), 323 bytes, needs a JOSE verifier. All three signed the M5 bytes as given; A shows no normalization on either side. A's three open decisions — duplicate JSON keys, non-shortest number forms, `-0` — can be refused in the verifier without a wire change. | Ruling in §5, *Message provenance*. |
| Exactly which characters description normalization strips, and whether NFC is applied | The canonical-form work order proposes; the gate ratifies; then an upstream amendment to the reference node and a candidate for the standard's next version | Every manifest — decided in P1 and not reopened |
| Whether the Windows edition registers through a service wrapper or a scheduled task | Spike at P4 | The Windows deploy scaffold |
| Whether the fleet's template set is upgraded in place or replaced by "consume the core" | The gate, at P5 | The template-upgrade phase's shape, nothing before it |
| Whether and when to publish to a registry | The gate | Nothing; consumption by commit works without it |
| Whether the reference implements the *resources* and *prompts* primitives — the 45 + 19 conformance failures are exactly these | The gate ruled yes under the completeness bar; sequenced as `-2009` after the controls so they inherit pinning and validation | Nothing before P2 |
| Whether a running node attests its own distribution digest at start (self-attestation with the deployer's key) or relies on the deploy loop alone | The gate, when the release-integrity trigger fires | Nothing before that trigger |
| Whether external contributions are accepted beyond issues and documentation | The gate | `CONTRIBUTING.md` in `CSR-WO-0002` ships a conservative default and says it is a default |

## 10. Amendments

**Any deviation from this document is recorded here as a dated amendment with its rationale.
Undocumented drift is a defect, not a shortcut.**

| Date | Change | Rationale |
|---|---|---|
| 2026-09-24 | Created. Ground truth measured (§2), including four corrections to written beliefs; shape, seams, rulings, posture, and traceability recorded at genesis with every control *planned*. | First architecture for this repository, written from the same-day planning session after the reading in `northstar.md` §8. |
| 2026-09-24 | §2.1 "Repository state" annotated: the one-commit figure was true at genesis; the steering documents then merged as `main`'s second commit (`2b96f08`, pull request #1). No ruling changed. | The row is a measurement with a date, not a standing claim, and the first reader after the merge would otherwise take it for a stale one. Recorded as an amendment rather than silently edited, because that is what the table is for. |
| 2026-09-24 | Maturity review folded in before any build: seventeen rulings added to §5 (manifest schema slots, key ids and rotation, approval binding and channel separation, keyed audit digests, OS-log audit store with signed checkpoints, tripwire/rate-limit split, transport hardening, runtime validation and output caps, where OS primitives live, headless approval path, file fence, Windows service identity, key-set semantics, no server-initiated requests, supply chain, governance, parser test discipline); §7.1 threat model added; §8 gained nine rows, the audit row was replaced by its keyed form and the rate-limit row split; §9 gained two questions; the §3.2 diagram updated. One correction to the genesis draft: the rate-limit ruling had conflated a tripwire with a limit. | Raised by the architect and ratified by the gate as a set, on the principle that whatever changes a consumer-facing schema or an interface is decided before P1 lands, and the rest is cheaper as acceptance lines now than as retrofits. |
| 2026-09-24 | Consumption ruling amended (§5): release tarballs with integrity and provenance replace "a git dependency pinned by commit". Two smaller rulings from the `-0000` review recorded here for traceability: the lint major moves to a supported version (the genesis WO named an unsupported one from stale knowledge — the architect's error), and inline lint suppressions are forbidden in control source and reviewable-by-config only. All three land in `CSR-WO-0000a`. | The `-0000` builder measured that raw source exports cannot be consumed as a git dependency under the fleet's own `ignore-scripts` posture; the ruling was false in the built system before any consumer existed, which is the cheapest moment to fix it. |
| 2026-09-25 | §2.3 row one replaced with the `CSR-WO-0100` measurement; *Protocol revision* ruling amended (serve the newest revision the pinned SDK offers, gap to `2026-07-28` recorded, reopen condition named); *Transport hardening* ruling amended (the core owns every protection with its own tests, after a patch bump of the SDK was measured to change two of them silently). | The first spike falsified a ratified ruling — the pinned official SDK does not serve the revision genesis targeted, and never refuses a revision at `initialize`. A measurement that overturns a ruling is the spike doing its job; the ruling is corrected here rather than defended. |
| 2026-09-25 | *Language and SDK* and *Protocol revision* amended again, reversing the architect's same-day amendment: the reference serves `2026-07-28` natively (plus the legacy handshake, stateless, for one deprecation window) and **owns its transport**; the official SDK leaves the runtime path. | The gate ruled that the fleet standard is the current stateless revision ("we want MCP 2.x"). Measured the same hour: no 2.x line of the official SDK is published; 1.30.1 cannot be configured into a revision that removes `initialize`. Between an official SDK on the wrong revision and a transport written against the specification, the second is the smaller interpretation. The architect's first amendment had privileged decision #13's letter over the standard's target; corrected. |
| 2026-09-25 | The gate ruled on the nineteen open choices: §2.3 row three replaced with the `-0102` measurement and Option A recorded as the architect's recommendation with the ruling pending; the tiered approval prior ratified as a prior; JSON-only responses in P1, SSE only when a tool needs progress, `subscriptions/listen` deferred; the limit defaults above; the legacy era kept until the hosted client is measured modern and the window passes; a *Completeness bar* row added on the gate's direction that this is a generic public reference (`x-mcp-header` now implemented rather than refused); bot majors for the compiler and the runtime types ignored by configuration; `docs/upstream.md` opened as the ledger for the standard's next version. | Recorded as a set from the gate's answers so no ruling lives only in a chat. |
| 2026-09-25 | *Message provenance* ruled: Option A (the field contract, pluggable payload) with duplicate keys, non-shortest integers and `-0`/`1.0`/`1e0` refused verifier-side. | The gate's ruling after the `-0102` table; the architect's recommendation adopted. |
| 2026-09-25 | `-1005` merged: §2.1 gains the served-revision measurement; three §8 rows move to *built*; §9 gains the resources/prompts question, ruled yes under the completeness bar and sequenced as `-2009`. Two `-1005` rulings recorded in its FEEDBACK and SPEC-MAP: a legacy `initialize` without the version header is accepted (that era's design), and the legacy path's review date is the window's end. | The transport is the substrate the rest of P1 is proven on; its state belongs in ground truth the day it lands. |
| 2026-09-25 | `-0101` local half measured and lifted into §2.3; *Approval binding* gains three requirements the spike exposed (state consumed on first use, decline terminal, grant bound to its requesting principal with the approver recorded); `-1005a` inserted to repair the unclosed validation pool and the MRTR-under-legacy `500`. | The spike did its job: it found the shape `-2001` must refuse before `-2001` exists. |
| 2026-09-26 | `-1005a` merged (pool closes with the server; MRTR under the legacy era is `-32601`, not a `500`). *Protocol revision* gains a clause: **status mapping is era-dependent** — legacy-era JSON-RPC errors for well-formed requests are `200` with the error object (the official SDK client, i.e. a legacy client, drops the body at `400`), modern-era refusals follow the `2026-07-28` page's explicit `4xx` cases, HTTP-level refusals `4xx` in both. `-1005b` implements it. | The architect's ruling on PR #27's F7, made from the measurement the builder took. |
| 2026-09-26 | `-1005b` merged: the era-dependent status mapping is built and measured (19 legacy cells changed, modern era byte-identical; the official SDK client receives the code and `data` at 200 and loses them at 400 — kept as a regression test with the SDK as a test-only exact dev dependency). Rulings: D-2 (the SDK ban reads "no file names it except the SDK-client test"), A3 (a header-less legacy `initialize` claiming the modern version stays `400/-32020` — self-contradictory requests are HTTP-level refusals in both eras), A2 (an unserializable result stays `500` with no `id`; tracked as ST-5). **Repository governance changed the same night:** `enforce_admins` is now on, so the architect's app can no longer merge past a red check — found when the architect pushed a leak-gate finding through a piped exit code and the merge went through anyway; `main` was rewritten once, with the gate's operator disabling the org baseline ruleset for the minutes it took, and no standing bypass was granted. | The measurement decided the mapping; the incident decided the governance. |
| 2026-09-26 | Canonical form ratified (stage A of `-1000`, draft PR #32): the builder argued two priors down with vectors and both were adopted — all ten fields always present at the top level (the same tool hashed two ways under the prior), and the version inside the manifest hash (the pin gate decides on it, so A6's own rule puts it in). C-5 ruled against spaced hex: one leak-gate allow entry for the vectors file, plain digests. | The first spec-first control: a document ratified before a line of the canonicalizer exists. |
| 2026-09-26 | `-1000` merged (`865adc1`): the canonical form is code, checked against a Python oracle; two §8 rows to *built*. Stage-B rulings: the 512 nesting limit is **in version 1** (an open depth guarantees the divergence class the control exists to kill); the leading-BOM rule applies to the description as given and after normalization; literals round to the nearest double first; a vector's id names the rule that refuses it; the spec document shows plain digests under its own allow line. `-1001` (the pin gate) written. | The pin gate consumes the canonical form directly; nothing else should land between them. |
| 2026-09-26 | `-1001` merged (`63b2e4b`): the pin gate; three §8 rows to *built*. Its adversarial pass found the finding the WO exists for — a `description` key inside a capability tag replaced the hashed description while the node served the real one, and `verify` passed it; the gate now freezes each definition once and the registry serves only that copy. Rulings: D-3 (served schema in canonical order, served description normalized — what the client sees is what was hashed); D-4 (*Unhashed tool fields* row above); the standard's §3 wording is read with parentheticals stripped and the detector measured **no divergence** — the fleet-template gap the field module described is the templates', not the standard's. `-0101`'s spike now registers through the gate (D-1). | The first control whose adversarial pass found a full bypass of the control itself before it shipped. |
| 2026-09-26 | `-1002` merged (`e95048f`): containment; two §8 rows to *built*; §5 gains *Containment matching*. Two WO defects, both the architect's: the WO listed `gate.ts` as protected while requiring the capability tag that only `gate.ts` holds (D-1 — ruled: `AdmittedTool` gains `capability` from the same frozen snapshot that was hashed, hash input unchanged); and §3.5's red-proof wording named the wrong layer (D-3 — the shim, not the cage, catches a direct `fs` reach; both layers now have red-proofs). Architect review found R-1 by measurement — a write-mode open through a leaf swapped between check and open truncated a file outside the root while the cage reported a refusal; the builder's adversarial pass had tested the race with a read. Fixed before merge with `O_NOFOLLOW`, a red-proof in `w` and `a`, and an honest docstring. `-1002a` queued: the kernel's `ELOOP` becomes a recorded, audited refusal, and a `read_only` tool's cage admits read modes only. | A race tested only with a non-mutating operation proves nothing about the mutating one; the review now asks which mode an adversarial test used. |

## 11. Provenance

Written by Claude (architect) on 2026-09-24, in the co-architect planning session that opened this
repository, at the gate's direction. Rests on `northstar.md`; the handoff document for the session;
a full read of the standard's reference node (steering triad, manifest, canonicalizers, envelope
contract, test corpus); ClearSeal v0.8 public edition @ `66b640d`; the fleet build-standard skill
and its templates in two states of staleness; one first-generation fleet server read in full; and
the measurements in §2.1, each of which names its command. The rulings in §5 were made by the gate
in that session; where a ruling reads "spike it", the gate agreed that measurement precedes decision.
