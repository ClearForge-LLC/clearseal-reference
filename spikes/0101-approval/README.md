**Never leave this harness running.** It accepts one static bearer with no OAuth, no expiry and no revocation. Anyone who has the bearer and can reach the server can call it. Start it for one measured run, then stop it.

# Spike 0101: approval transports (CSR-WO-0101)

A private spike package. It is not product code and not the approval gate (that is `-2001`). The
server runs on the core's own transport (`packages/core`, CSR-WO-1005), bound to loopback, with
three tools. Each one only waits for a human, then returns a string saying which path it used and
what the client did. **None executes anything.**

| Tool | Transport |
|---|---|
| `approve_via_mrtr` | An elicitation carried inside a multi round-trip request (MRTR, `2026-07-28`). The first call returns `input_required` with an `elicitation/create` request and a sealed `requestState`. The re-issued call carries the answer. A decline is a refusal. |
| `approve_via_task` | The Tasks extension, **not offered**. It is implementable from its own text, but not on the core transport as merged. The tool says why. |
| `approve_via_grant` | An out-of-band grant. The first call issues a single-use code that expires in 120 s, printed to the **server log** only (there is no notifier). A second call with the same `action` and the code redeems it. |

## Run

- **The local measurement** (a scripted client on loopback, with a random bearer per run):
  `node spikes/0101-approval/probe.ts`.
- **The server by hand:** set `CLEARSEAL_SPIKE_BEARER` (named in `.env.example`, at least 32
  characters), then run `node spikes/0101-approval/server.ts`. It refuses to start without the
  bearer.
- **The hosted-client half** is the operator's: follow `OPERATOR-PROTOCOL.md`.

## Variables

All are named in `.env.example` and never valued in the repository.

- `CLEARSEAL_SPIKE_BEARER`: required.
- `CLEARSEAL_SPIKE_PORT`: default 3999.
- `CLEARSEAL_SPIKE_ALLOWED_HOSTS` / `CLEARSEAL_SPIKE_ALLOWED_ORIGINS`: comma lists added to the
  loopback defaults, so a request arriving by the operator's own means passes the DNS-rebinding
  check.
- `CLEARSEAL_SPIKE_RESOURCE_URL`: the URL the 401 challenge names.
- `CLEARSEAL_REQUEST_STATE_KEY`: optional. Without it, a fresh key is made for each process and
  never stored.
