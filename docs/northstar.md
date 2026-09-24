# clearseal-reference — Northstar

**What this is:** why this project exists and what must stay true regardless of stack.
**Date:** 2026-09-24 · **Author:** Claude (architect) · **Gate:** Scotty (ratifies; nothing lands
without his direction) · **Builder:** a separate coding-agent session, one work order per branch.
**Supersedes:** nothing — first northstar for this repo. **Read next:** `architecture.md` (shape),
`roadmap.md` (order).

> **Authority note.** This document is the single authoritative source for invariants. Work orders
> cite them as `N1`…`N8` and nothing else; `architecture.md` and `roadmap.md` reference them by
> number and never restate them. Ratified by the gate at genesis.

---

## 1. The one sentence

> **clearseal-reference is the executable form of the ClearSeal standard: one implementation of
> every control the standard requires, proven by a test that shows each control refusing, carried
> unchanged into editions a reader can study and a machine can run — so that conformance is something
> you check rather than claim, and every node that adopts it inherits one mechanism instead of
> inventing a second.**

No language, protocol, vendor, or platform appears in that sentence deliberately. If the stack were
replaced entirely, it would still be the project.

## 2. The problem, stated precisely

ClearSeal exists as prose and as one private production node. Between those two there is nothing a
stranger can read, run, or depend on. Three measured facts, not arguments:

- **The standard's shipped templates are behind the standard, and the standard was behind its own
  node.** The fleet's build-standard skill regenerated its embedded copy of ClearSeal to v0.8 on the
  day this project began, and recorded in the same change that its code templates still pin
  **nine** fields, ship no `containment_domain`, no reach test, and no message provenance — so a
  server scaffolded from them is v0.7-conformant. Seven days earlier the standard itself had
  enumerated nine fields while its reference node had hashed a tenth for a week; nothing detected
  it, because an incomplete document states no falsehood. The chain — node ahead of standard,
  standard ahead of templates — has no executable link anywhere in it.
- **One canonical form, two implementations, one byte apart.** The standard specifies a single
  canonical form for the pinned tool object so that a manifest generated in one runtime verifies in
  another. The two shipped canonicalizers disagree on it: one strips all Unicode trailing whitespace
  from a description, the other strips four ASCII characters, so a description ending in a
  non-breaking space hashes differently per runtime. Cross-language identity is currently a
  measurement over the tools one node happens to have, not a property of the form.
- **The next three nodes are the empirical baseline the standard warns about.** The fleet's other
  servers are first-generation: a framework wrapper on the legacy transport, an exec tool built on
  `shell=True` behind a string denylist, tool arguments interpolated into shell commands with
  single quotes (an injection by construction, not by accident), and no application-layer auth on
  the endpoint. Porting the reference node's controls into each by hand is three re-inventions,
  and the second invention of a control is the one nobody audits.

**Why existing tooling did not already solve this.** The protocol's own auth substrate authenticates
*who is calling*; the official SDKs give transport and discovery; neither says whether the tool the
model sees is the one that was reviewed, or whether a call can reach past its declared sinks. The
fleet templates cover part of that gap — but a template is copied, and a copy is a fork the moment it
is made. What is missing is a *dependency*: one implementation, versioned, that a node imports and
does not edit.

## 3. End state

A public repository holding one core that implements every ClearSeal control, three editions built
on it — one to read, two to install — and a test suite in which every control has a test that goes
red when the control is removed. Conformance is demonstrated by running the suite, not by reading a
claim.

**Concrete walkthrough — the day it is done.** A reader clones the repository and runs the tests.
They edit one tool's description and restart: that tool is refused registration and the log names
it. They make a demo tool touch a sink outside its declared domain: the reach test fails and names
the sink. They send a message without a signature: it is rejected. They call a state-changing tool
without approval: it does not execute. They present a token minted for a different server: `401`.
Then they read the teaching edition top to bottom in one sitting, because it holds four tools and
every control is annotated with the clause it satisfies.

An operator installs the Linux edition on a fresh host: an environment file naming its secrets, one
install script, and a service that answers `401` with resource metadata to an unauthenticated
request and `200` on a bearer-free health route. A fleet port adds its node-specific tools in a
private repository, pins this repository by commit, and inherits every control defaulted-safe
without copying a line of it.

### 3.1 Who this is for

Two audiences, in this order. **Implementers** — anyone who has read ClearSeal and asks what it looks
like in code; this is the answer, and it is meant to be depended on, not admired. **Reviewers of the
work** — the repository is a public artifact of engineering process, so the commit history, the pull
request discipline, the steering documents, and the tests are judged at least as much as the code.
Sloppy history with good code is a worse artifact than modest code with a legible trail. That second
audience is why nothing here is committed directly to `main`, and why a claim never outruns a test.

## 4. Invariants

Numbered; **work orders cite these as `N1`…`N8` and nothing else.** Each is falsifiable — an
invariant nobody can test is a wish.

| N | Invariant | How to falsify |
|---|---|---|
| **1** | Every control the standard requires is implemented **once**, in the core, and every edition serves it from there. No edition implements, copies, or overrides a control. ***This invariant is the project.*** | Find a control implemented in an edition rather than imported; find a second copy of any control inside the core; find an edition that registers a tool by a path that does not pass through the core's gate |
| **2** | Every tool definition the model sees is verified against a committed, reviewed manifest **before** registration, and an unpinned or drifted tool is **refused** — never registered-then-logged. | Hand-edit a tool's description, restart, and find that tool still offered in `tools/list` |
| **3** | Every field any gate reads is inside the hashed canonical object, and the canonical form is specified precisely enough that an independent implementation produces identical bytes. | Find a field a gate branches on that is absent from the canonical field set (the subset test must be able to go red); or find a committed cross-language test vector whose hash differs between the core and the vector's stated origin |
| **4** | Fail closed. A missing token, wrong audience, missing manifest, unpinned tool, pin drift, or failed signature **refuses** — `401` or refuse-to-start — and never degrades. | Produce any of those conditions and receive a `2xx`, or a server that starts anyway |
| **5** | Every control ships with a negative test that proves it can go red, and the suite runs in CI. A control whose test has never been seen to fail is not counted as implemented. | Find a row in the traceability table with no red-proof; or a red-proof that still passes when the control it guards is deleted |
| **6** | Nothing in this repository identifies a deployment — no node names, hostnames, endpoints, topology, key custody, tunnel or topic names, operator paths, or account identifiers — and a leak gate scans the tree **and reachable history** on every push. | Find such an identifier in any tracked file or in reachable git history; or find a push to `main` that the gate did not run against |
| **7** | No edition ships a tool of capability class `arbitrary_exec`. The core models the rung — it refuses such a tool a containment domain at construction — and the documents say why exec is absent. | Find an `arbitrary_exec` entry in any edition's manifest; or an `arbitrary_exec` tool that was granted a non-null containment domain |
| **8** | Secrets by name only. Environment-variable names and blank templates live here; a live credential value never does. | Find a live credential in code, config, fixture, log, URL, test vector, or work order |

**What counts as a control under N1.** A control is a *policy and its decision point* — the code
that decides whether a tool registers, a call proceeds, a message is trusted, an event is recorded.
Two things are not second controls: an operating-system enforcement primitive (a Linux process cage,
a Windows service boundary) implemented in an edition behind an interface the core defines and
calls; and a test oracle in a second language whose only job is to generate vectors the core is
checked against. The first is the same control reaching a different platform; the second never
serves a request. Everything else that decides is in the core or it is a violation.

**Why N1 is the project and not N2.** The reference node already proves N2; a second node could
prove it again by copying. What no node can prove alone is that the *next* node will run the same
mechanism rather than a re-derivation of it. N1 is what turns a standard with one adopter into a
standard with a supply chain.

**N7 is a ruling, and its reason travels with it.** Under ClearSeal's Rule-of-Two an `arbitrary_exec`
tool can never discharge its human-in-loop obligation by containment — it is refused a domain by
construction — so its only discharge is a human approval per call. A public template that hands out
a shell is a template for the command-injection class that the standard's own empirical baseline
says most servers already carry. Nodes that need exec add it in their private repositories, case by
case, inheriting the rung's plumbing from the core; the reference teaches why the rung exists by
demonstrating its refusal, not by shipping it.

## 5. Non-goals

- **Porting the existing reference node's code wholesale** — *the tempting-and-wrong option.*
  Measured, about sixty percent of that node is control scaffolding, and all of it is shaped by a
  phone, a non-root runtime, and one operator's deployment. Porting it would leak deployment detail
  into a public repository (N6) and bury the teaching value under device handling. More importantly,
  a copy is a fork: the goal is a dependency that node could itself consume later, not a second
  copy of it. Its tests are used as the specification of behaviour; its code is not used at all.
- **Being a fleet node.** No node-specific tools, no deployment configuration, no deploy loop, no
  alert topics. Those belong to the private repositories that consume this one. Reason: N6, and
  the public audience in §3.1.
- **Shipping arbitrary execution in any edition.** Because under Rule-of-Two an exec tool can
  never be contained, only approved per call, a public template that ships a shell ships the
  command-injection class the standard's baseline says most servers already carry; N7 records
  the ruling and its full reason, and a node that needs exec adds it privately, case by case.
- **Building an authorization server.** The reference is a *resource* server. A development-only
  harness that runs a real flow locally is shipped, labelled as not-a-product; an authorization
  server is a separate project with its own custody questions. Reason: the standard's ratified
  decisions #10 and #12 — conform to what the protocol mandates, do not re-derive it.
- **A hosted demo.** A public endpoint is an attack surface and a maintenance burden, and it proves
  less than the tests do. Reason: the tests are the product.
- **Amending ClearSeal v0.8 in place.** That version is frozen by adoption. What this build teaches
  the standard goes to the next version through the upstream-feedback lane the roadmap names.
- **Publishing a package to a registry — for now.** Consumers pin this repository by commit, which
  is git-anchored integrity, the same discipline pinning already uses. Publishing is a decision to
  be taken deliberately later, not a drift.
- **Becoming a general MCP framework.** One standard's controls, implemented once. Ergonomics
  beyond that are someone else's project.

## 6. What would make this a failure

Each is plausible rather than catastrophic, which is what makes it worth writing:

- **It ships green while failed open** — the pin gate registers every tool and merely logs drift;
  every test passes; N2 is false. This is the failure the reference node's own history names first.
- **Three editions quietly become three cores** — an edition patches a control "just this once" and
  the next port inherits the patch. N1 is false and nothing in the suite says so.
- **The teaching edition turns into a starter kit** — reuse ergonomics crowd out legibility until a
  reader can no longer hold it in their head, which was its only job.
- **The cross-language vectors are generated by the thing they test** — hashing bytes the core
  produced proves only that a hash function is a hash function.
- **A fleet identifier lands in a fixture or a work order** and the leak gate was not watching that
  path. History is forever; a public leak is unrecoverable.
- **The documents drift from the build**, and the next context-less session reconstructs a plan the
  code stopped matching weeks earlier. The reference node's amendment tables are a record of that
  fight; this repository starts with the discipline rather than earning it.

## 7. Amendments

| Date | Change | Rationale |
|---|---|---|
| 2026-09-24 | Created. Eight invariants ratified at genesis; N1 marked as the project; N7 recorded as a ruling with its reason. | First northstar for this repository. Written from the planning session of the same day, in which the monorepo shape (one core, three editions), the no-exec ruling, and the merge-gate arrangement were settled. |
| 2026-09-24 | N1's scope stated: a control is a policy and its decision point; OS enforcement primitives behind core interfaces in editions, and second-language test oracles, are not second controls. Re-ratified by the gate at merge. | Without the boundary, the first Linux cage commit and the first Python vector generator would each read as an N1 violation and be relitigated in a work order — the exact place an invariant should never be decided. Raised in the maturity review before any build began. |

## 8. Provenance

Written by Claude (architect) on 2026-09-24, in the co-architect planning session that opened this
repository, at the gate's direction. Rests on: the handoff document prepared for that session; a
read of the standard's reference node (its steering triad, its pin manifest, its test corpus of
964 tests, and its cross-language canonicalizer); ClearSeal v0.8, public edition
(`ClearForge-LLC/ClearSeal-public` @ `66b640d`, whose numbering matches the full standard); the fleet
build-standard skill's Known-gap note on its templates; the public failure notes in
`ClearForge-LLC/ClearProof`; and measurements of the fleet's first-generation servers made the same
day. The sixty-percent scaffolding figure in §5 was measured by module line count, not estimated.
