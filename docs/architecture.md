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
| Repository state | One commit on `main`: license, notice, gitignore, README stub. `main` requires a pull request, linear history, no force-push, no deletion. Squash merges only; branches auto-delete on merge. | Created this session; protection read back from the branch-protection API after it was set |
| Continuous integration | None yet. No workflow exists; therefore no required status check is set on `main`. | `ls .github/` — absent |
| Standard of record | ClearSeal v0.8 public edition at the commit pinned in the header, one commit old; it mirrors the full standard's v0.8 text with deployment-specific material omitted and numbering preserved. | Both editions cloned and diffed; the differences are the changelog narrative, the node matrix, and status lines — no control text |
| The reference node (the standard's one adopter) | 26 pinned tools; manifest carries the ten hashed fields including `containment_domain`; 5 tools `elevated`; capability classes 16 `read_only` / 9 `state_change` / 1 `arbitrary_exec`; 63 test files, 964 test functions; a TypeScript canonicalizer kept byte-compatible with its Python one, exercised by a cross-language determinism test. | Its manifest parsed with `python3 -c` and its tests counted with `grep -c 'def test_'` on a clone taken this session |
| Which of that node's controls are mature | Pin gate (verify-before-register); ten-field canonicalizer with the TypeScript twin; capability tags and Rule-of-Two; `containment_domain` with a reach test; an AS-agnostic OAuth resource-server verifier with protected-resource metadata; a call-bound approval gate that separates a grant from its redemption and expires unredeemed grants; a tiered maintenance window with a capability ceiling, built defaulted-safe; a hash-chained audit with argument values replaced by hashes; a read-burst tripwire; a message-provenance verify core with a documented wire contract. | Module inventory of its source tree |
| Which are sketched or absent there | Egress caging (measured unreachable on that platform); manifest signing (custody ruled, key not generated); atomic release activation; token scope enforcement; **and its global call-rate limiter, which its own roadmap says to *verify was removed* before restoring — treat as unbuilt.** | Its architecture §14, its roadmap's audit sub-tier |
| Fleet template state | The fleet build-standard skill's templates pin **nine** fields and carry no `containment_domain`, no reach test, no message provenance; its own Known-gap note says so. The copy of that skill loaded in the planning environment was staler still: it embedded v0.6 and pinned **eight** fields. | `git show` of the skill repository's regeneration commit; the loaded skill's `canonical.ts` read directly |
| The M5 divergence | The reference node's Python `normalize_description` uses `rstrip()`, which strips all Unicode whitespace; its TypeScript twin strips `[ \t\f\v]`. A description ending in U+00A0 hashes differently per runtime. That node's own wire-contract document records this and designs its message envelope with *no* normalization for exactly that reason. | Read in both canonicalizers and in the node's envelope contract |
| First-generation fleet servers (the ports' targets) | A framework wrapper on the legacy SSE transport; an exec tool of `subprocess.run(..., shell=True)` guarded by a substring denylist; several tools interpolate their arguments into shell strings inside single quotes; the endpoint's only auth is network-layer. | One such server's source read in full: its `_run`, its `BLOCKED` list, and its `witness_*` tools |
| Windows proving ground | A Windows 11 machine with Node **v24.21.0** and npm **11.19.0** installed machine-wide this session; `winget` and `choco` are not available in the service session that installs run under, so installs go download-MSI → verify hash → `msiexec /qn`. The MSI hash was cross-checked against the publisher's checksum list fetched from two independent hosts before it ran. | `node --version`, `npm --version`, `Get-FileHash` on the installer, `[Environment]::GetEnvironmentVariable('Path','Machine')` |
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
| Which protocol revisions the official TypeScript SDK actually serves in stateless mode, and whether `server/discover` is reachable | Nothing is scaffolded; no SDK is installed | Phase-0 spike `CSR-WO-0100`: install the SDK at a pinned version, start a stateless server, probe the negotiated revision, record it in this table |
| Whether the hosted client honours multi-round-trip requests / the tasks extension for an in-flight approval | Requires a running server reachable by the real client | Phase-0 spike `CSR-WO-0101`, run against a local server exposed by whatever means the operator chooses; result recorded here before the approval mechanism is ruled |
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
     │             served revision probed and recorded (§2.3)           │
     │ auth-rs     401 + WWW-Authenticate → protected-resource metadata │
     │             → JWKS verify → audience must equal this resource    │
     │             → principal {iss, sub, client_id} handed downstream  │
     │ rate-limit  per-principal budget; a trip is an audit event       │
     │                                                                  │
     │ ┌─ registration + PIN GATE ────────────────────────────────────┐ │
     │ │ canonicalize the ten-field object → hash → compare to the    │ │
     │ │ committed manifest → MATCH: register · DRIFT/UNPINNED: refuse│ │
     │ └──────────────────────────────────────────────────────────────┘ │
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
     │ audit       append-only, hash-chained; args hashed never stored  │
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
| Language and SDK | **TypeScript on the official MCP TypeScript SDK; no framework wrapper in the security path.** | ClearSeal decision #13. A framework is a second interpretation of the spec between the code and the spec it must conform to; the fleet's measured case is a framework that could not reach the current revision. |
| Protocol revision | **Target the stateless `2026-07-28` revision; the revision actually served is probed and recorded (§2.3), never assumed.** | ClearSeal §B and §9 step 2. The reference node's first spike disproved a written assumption about exactly this. |
| Authorization server | **The verifier is AS-agnostic: an issuer, a JWKS location, and an expected audience, all configuration.** Tests use an in-process test issuer with a generated key. A development harness on a self-hosted library ships for local end-to-end runs, labelled not-a-product. Which AS a *node* uses is that node's decision. | Decisions #10/#12 — conform, do not re-derive. The reference node proved AS-agnosticism by verifying a second issuer with configuration alone, and found that its hosted AS strips custom scopes at registration — so identity must come from the token's subject and client, never from scope. |
| `arbitrary_exec` in the editions | **None ships it (N7).** The core implements the rung, refuses it a containment domain at construction, and carries the approval plumbing a port would need. | Recorded with its reason under N7 in `northstar.md`. |
| How fleet ports consume this | **A git dependency pinned by commit.** No registry publication for now. | Git-anchored integrity is the same discipline pinning already uses; a registry adds supply-chain surface and a publishing decision that should be taken deliberately later. |
| License | **Apache-2.0** for code. The standard stays CC BY 4.0 in its own repository and is cited. | Patent grant; the norm for reference implementations. |
| Visibility | **Public from the first commit.** | History discipline starts at commit one or it never starts. |
| Approval mechanism | **Do not decide the transport yet — spike it** (`CSR-WO-0101`). Ruled now: an `ApprovalBackend` interface in the core with a deterministic test backend and a console backend; editions plug in their own. Prior, held loosely: the spec-native multi-round-trip path if the hosted client honours it, otherwise the reference node's out-of-band grant-then-reinvoke pattern. | The decision turns on what the real client does, which is unmeasured. |
| Capability ceiling and tiered windows | **In the core**, defaulted-safe, sequenced after pinning, reach and auth. | Ports inherit it; a port that inherits a half-built ceiling has to invent one. |
| Message provenance (class 5) | **Do not decide the envelope yet — spike it** (`CSR-WO-0102`). Prior, held loosely: the reference node's documented wire contract byte-for-byte, with a pluggable payload schema, so the fleet's existing verifier can consume what this core signs. Alternatives to test: RFC 9421 message signatures over HTTP; a detached JWS envelope. | Interoperability with a deployed verifier is worth more than elegance; but the spike decides. |
| Caller entitlement | **Seam now, enforcement later.** The verifier yields the principal, the gate accepts it, and every audit row carries it from phase 1. Enforcement — a principal → allowed-tools map — is its own later phase and, when it lands, the map is a **second pinned artifact** verified at load. | Retrofitting caller identity into a shipped auth surface is far more expensive than allowing for it once (measured on the reference node). An entitlement map is a gate input, so decision #15 applies: pinned, or it is unpinned authority. |
| Canonical form | **Specify it, then implement it.** The core's canonicalizer is written from a written specification (key ordering, number formatting, exactly which characters description normalization strips, Unicode normalization or its explicit absence), shipped with committed cross-language vectors generated by the *other* runtime. | §2.2 row four. A property that holds only over the inputs you have is not a specification. The resulting amendment to the reference node's Python side is upstream work (§9). |
| Exec posture, if a port adds it | **Linux: a proven per-process cage, delivered as a test fixture in the edition. Windows: approval-only, no cage claimed.** *Departure from the fleet's platform-neutral wording, labelled as one.* | Linux has service-manager sandboxing and namespaces; the reference node's platform did not, which is why `containment_domain` was invented. Windows has no equivalent the edition can honestly claim. |
| Node version | **24.21.0**, pinned in CI and in the engines field. | The proving ground's version (§2.1). Bumping it is a commit. |
| Conformance suite for third parties | **A later phase, decided now** (roadmap P7). | High value, large scope; deciding it deliberately prevents drift into it. |
| Hosted demo | **No.** | Northstar non-goal. |

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
| Stateless transport on the official SDK, revision probed | §B, #13 | `transport` | Test asserts the served revision equals the recorded one | planned — P0 |
| `401` + protected-resource metadata; audience-bound verify | §1, §3, §B, #10 | `auth-rs` | Wrong-audience token → `401`; missing token → `401`; unauthenticated `/health` → `200` | planned — P1 |
| Canonicalizer from a written spec, cross-language vectors | §3, §8 #8 | `pinning/canonical` | A vector generated by the other runtime whose hash differs fails the suite | planned — P1 |
| Ten-field pinned object; subset invariant | §3, #14, #15, §8 #11 | `pinning/canonical`, `capability` | Gate reads a field outside the canonical set → test red | planned — P1 |
| Verify-before-register; drift and unpinned refused | §2 class 2, §8 #7 | `pinning/gate` | Edited description → tool absent from `tools/list`; unpinned tool → refused | planned — P1 |
| Cross-repo enumeration detector | §3 ("the executable form is authoritative") | `pinning/spec-check` | Local copy of the standard's list edited → test red | planned — P1 |
| Four-rung ladder, orthogonal untrusted flag, Rule-of-Two | §3, §4, §8 #1 | `capability` | An untrusted-facing `state_change` tool with neither approval nor containment → refused at construction | planned — P2 |
| `owned_state` with pinned recoverability basis | §3 (v0.6) | `capability` | `owned_state` without a one-line basis → refused | planned — P2 |
| `containment_domain` as a sink set; exec refused a domain | §3 (v0.8) | `containment` | Exec tool given a domain → refused at construction (N7) | planned — P1/P2 |
| Reach harness | §3 (v0.8), §5.1 of the reference node | `containment/reach` | Tool touching an undeclared sink → test red, sink named | planned — P1 |
| Approval gate; grant ≠ redemption; expiry | §3 (elevated confirm) | `approval` | Unapproved `elevated` call → not executed; expired grant → refused | planned — P2 |
| Capability ceiling and tiered windows | §3, §8 #11 (the elevated instance) | `ceiling` | A window opened for one principal authorises another → red; exec/mint/merge under a window → refused | planned — P2 |
| Message provenance, three gates | §2 class 5, §3, #16, §8 #12 | `provenance` | Unsigned → rejected; signed by an unlisted author → rejected; a valid signature requesting an above-floor effect → rejected | planned — P2 (envelope by spike) |
| Append-only hash-chained audit, args hashed | §8, §11 | `audit` | An argument value appearing in any audit row → test red; a broken chain → detected | planned — P2 |
| Rate limit, per principal | §8 #9, the reference node's audit sub-tier | `rate-limit` | A burst → one loud audit event; no refusal that would itself be a denial of service | planned — P2 |
| No URL credential path | §4, #11 | whole tree | `grep` for a query-string token path finds nothing | planned — P0 (gate) |
| Leak gate over tree and history | N6 | `.github/workflows` + script | Gate self-test proves it goes red on a planted identifier | planned — P0 |
| Linux per-process cage (fixture) | §3, §8 #1 (containment discharge) | `host-linux/cage` | Fixture tool attempting egress from inside the cage → blocked | planned — P3 |
| Caller entitlement | §1 (self-controlled clients), decision #15 | `entitlement` | Principal calling a tool outside its map → refused; map edited without re-pin → drift | deferred — P6, trigger named in roadmap |

## 9. Open questions

| Question | Decider | Blocks |
|---|---|---|
| Which approval transport the hosted client actually honours | Spike `CSR-WO-0101`; the gate rules on its findings | The approval gate's transport in P2 (its interface is not blocked) |
| Which class-5 envelope the core signs | Spike `CSR-WO-0102`; the gate rules | The provenance module in P2 |
| Exactly which characters description normalization strips, and whether NFC is applied | The canonical-form work order proposes; the gate ratifies; then an upstream amendment to the reference node and a candidate for the standard's next version | Every manifest — decided in P1 and not reopened |
| Whether the Windows edition registers through a service wrapper or a scheduled task | Spike at P4 | The Windows deploy scaffold |
| Whether the fleet's template set is upgraded in place or replaced by "consume the core" | The gate, at P5 | The template-upgrade phase's shape, nothing before it |
| Whether and when to publish to a registry | The gate | Nothing; consumption by commit works without it |

## 10. Amendments

**Any deviation from this document is recorded here as a dated amendment with its rationale.
Undocumented drift is a defect, not a shortcut.**

| Date | Change | Rationale |
|---|---|---|
| 2026-09-24 | Created. Ground truth measured (§2), including four corrections to written beliefs; shape, seams, rulings, posture, and traceability recorded at genesis with every control *planned*. | First architecture for this repository, written from the same-day planning session after the reading in `northstar.md` §8. |

## 11. Provenance

Written by Claude (architect) on 2026-09-24, in the co-architect planning session that opened this
repository, at the gate's direction. Rests on `northstar.md`; the handoff document for the session;
a full read of the standard's reference node (steering triad, manifest, canonicalizers, envelope
contract, test corpus); ClearSeal v0.8 public edition @ `66b640d`; the fleet build-standard skill
and its templates in two states of staleness; one first-generation fleet server read in full; and
the measurements in §2.1, each of which names its command. The rulings in §5 were made by the gate
in that session; where a ruling reads "spike it", the gate agreed that measurement precedes decision.
