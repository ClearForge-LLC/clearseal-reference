# clearseal-reference

The executable form of the [ClearSeal](https://github.com/ClearForge-LLC/ClearSeal-public)
standard for LLM-access nodes: one core that implements every control the standard requires, proven
by a test that shows each control refusing, and three editions built on it — a **teaching** edition
to read, and quickly deployable **Linux host** and **Windows host** editions to run.

**Status:** genesis complete; build not started. Phase P0 (skeleton, gates, spikes) is next of P0–P7, the last two of which are intent only.
Nothing here serves a request yet, and no control is built until its row in
[`docs/architecture.md`](docs/architecture.md) §8 reads *built*.

## Where to go

| I want to know | Read |
|---|---|
| Why this exists and what must stay true | [`docs/northstar.md`](docs/northstar.md) — invariants `N1`–`N8` |
| What it is, how it is shaped, and what was measured before it was designed | [`docs/architecture.md`](docs/architecture.md) |
| What order it gets built in, and what "finished" means for each phase | [`docs/roadmap.md`](docs/roadmap.md) |
| The standard being implemented | [`ClearSeal-public`](https://github.com/ClearForge-LLC/ClearSeal-public) (CC BY 4.0) |

## What this is not

Not a fleet node, not an authorization server, not a general MCP framework, and not a place where
arbitrary execution ships — each of those is a non-goal with its reason in the northstar. Nothing in
this repository identifies a deployment, and a gate enforces that on every push.

## Build model

A co-architect writes work orders into `docs/work-orders/` and reviews what a separate builder
session parks as a pull request. Every merge is gated by a human. The commit history is part of the
artifact: read it as you would the code.

License: Apache-2.0 for the code in this repository. The standard is licensed separately.

---

This README points; it does not define. Invariants, rulings, and sequencing each live in exactly one
document above, and a copy here would be a fourth place for the same fact to drift.
