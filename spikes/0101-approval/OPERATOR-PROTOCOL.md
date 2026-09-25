# Operator protocol: CSR-WO-0101, the hosted-client half

This measures what a **hosted MCP client** does with three ways of asking a human to approve an
in-flight tool call. It is written so that someone who was not part of building it can run it
alone. It takes about 30 minutes.

**The harness must not be left running** (see the README's first line). Every step that starts
something has a matching step that stops it.

## What you need

- A checkout of this repository at the commit under review, with Node 24.21.0 and `npm ci` done.
- The hosted MCP client under test, with an account on it that can add a custom (remote) MCP
  server.
- **Your own means of making a server on this machine's loopback port reachable by that client.**
  This protocol does not describe that means, and your notes must not either. Do not write down
  any hostname, address, tunnel, account or machine name, anywhere in the results.
- A second terminal where you can watch the server's log.

## 1. Prepare (about 5 minutes)

1. Generate a bearer of at least 32 characters, for example `openssl rand -base64 36`. Keep it
   only in your shell session. Do not save it to a file in the repository.
2. In the first terminal, set these variables:
   - `CLEARSEAL_SPIKE_BEARER` to that bearer.
   - `CLEARSEAL_SPIKE_ALLOWED_HOSTS` to the `Host` value that requests will carry when they reach
     the server through your means: host, then `:port` if one is shown. Use a comma list if there
     is more than one.
   - `CLEARSEAL_SPIKE_ALLOWED_ORIGINS` likewise for `Origin`, only if the client sends one. If you
     do not know, leave it empty at first; step 3.3 tells you.
   - Optionally `CLEARSEAL_SPIKE_PORT` (default 3999) and `CLEARSEAL_SPIKE_RESOURCE_URL` (the
     public URL of the MCP endpoint, ending `/mcp`, used in the 401 challenge).
3. Start the server: `node spikes/0101-approval/server.ts`. Expect one line on stderr:
   `[approval-spike] listening on http://127.0.0.1:<port>/mcp (loopback only)`. If it says
   "refusing to start", the bearer is missing or too short.
4. Note the time. From now on the harness is running. Your stop step is §5.

## 2. Make it reachable and register it (about 5 minutes)

1. Make the loopback port reachable by the client with your own means. Record nothing about how.
2. In the hosted client, add a custom MCP server:
   - the URL is your means' public address plus `/mcp`;
   - the authentication is a static `Authorization: Bearer <bearer>` header, if the client offers
     one.

   **If the client offers only OAuth** (no static header), record `client requires OAuth; static
   bearer not accepted` in the results and go to §5. That is a finding, not a failure.
3. Check that the client lists three tools: `approve_via_mrtr`, `approve_via_task`,
   `approve_via_grant`. If it shows an error instead, copy the error text into the results, with
   any identifiers removed.

## 3. Run each transport (about 15 minutes)

Use one new conversation for all three. For each tool, ask the model to call it with an
`action` of your choosing, for example: *"Call approve_via_mrtr with action 'rotate the demo
key'."* Time each call from the moment you send the message.

### 3.1 `approve_via_mrtr`

1. Ask for the call. Watch what the client shows.
   - **A prompt or form asking you to approve?** Record its wording and whether it names the action.
   - **A spinner, an error, or nothing?** Record exactly that.
2. If a prompt appears, **approve** it. Record whether the call completes and what the final
   reply says. `APPROVED via mrtr …` means the whole round trip worked.
3. Ask for the call again with a different action, and this time **decline**. Record the reply.
   It should say `REFUSED via mrtr …`. If it says APPROVED after a decline, stop and record that
   prominently.
4. If the client showed an error, copy its text.
   - An error containing `-32021` means the client did not declare the elicitation capability.
   - An error mentioning the "legacy revision" means the client speaks the older `2025-11-25`
     protocol, which cannot carry this path.

### 3.2 `approve_via_task`

1. Ask for the call. The expected reply starts `NOT OFFERED`. Record what the client showed.
   This path is not offered on this server. The row records only that the client surfaced the
   reply.

### 3.3 `approve_via_grant`

1. Ask for the call with an action. The reply should start `PENDING via grant` and should **not**
   contain a code.
2. In the server log (second terminal), find the line `[approval-spike] GRANT issued: code
   XXXXX-XXXXX …`. **Only you** see this code; the client never does.
3. Ask the model to call `approve_via_grant` again with **the same action** and that code. Record
   whether it completes with `APPROVED via grant …`, and the time between the two calls.
4. Ask for the same redemption once more. It must say `REFUSED via grant: the code is unknown or
   already used`.
5. Optional: issue a new code and wait more than 120 s before redeeming it. It must say `REFUSED
   via grant: the code is expired`.

If any call fails with **403**, the request's `Host` or `Origin` is not in the allowed lists. Put
the value the server rejected into the right variable, restart from §1.3, and record that you had
to.

## 4. Fill the results table

| Transport | Client behaviour (what you saw) | Waited (s) | Completed? | Notes (error text, wording; no identifiers) |
|---|---|---|---|---|
| (a) MRTR-carried elicitation: approve | | | | |
| (a) MRTR-carried elicitation: decline | | | | |
| (b) Tasks extension | | | | |
| (c) out-of-band grant: redeem | | | | |
| (c) out-of-band grant: second redemption | | | | |
| Protocol revision the client used, if visible (`2026-07-28` or `2025-11-25`) | | | | |

## 5. Stop (always do this, even if a step failed)

1. Stop the server with Ctrl-C in its terminal. Confirm the process is gone.
2. Take down whatever you used to make it reachable.
3. Remove the MCP server registration from the hosted client.
4. Discard the bearer: close the shell, or unset `CLEARSEAL_SPIKE_BEARER`.
5. Note the stop time. The harness was running from §1.4 to here.
6. Send the filled table, with no identifiers of any kind, to the architect.
