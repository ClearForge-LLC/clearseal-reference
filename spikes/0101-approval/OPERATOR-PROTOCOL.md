# Operator protocol: CSR-WO-0101, the hosted-client half

This measures what a **hosted MCP client** does with three ways of asking a human to approve an
in-flight tool call. It is written so that someone who was not part of building it can run it
alone. It takes about 30 minutes, and the harness should run for about 20 of them.

**The harness must not be left running** (see the README's first line). Every step that starts
something has a matching step in §6 that stops it. If anything goes wrong at any point, go
straight to §6.

## 0. Read this first

- **You were asked to run this** by someone who gave you a pull request and named the hosted MCP
  client to test. "The architect" below means that person, and you send the results back the way
  they asked. You do **not** need to run `probe.ts`: that is the builder's local half, already
  done.
- **Run every command from the repository's root directory.** Node 24 runs the `.ts` files
  directly; no build step is needed.
- **Never write an identifier anywhere in the results or your notes.** For this protocol an
  identifier is any of the following:
  - a hostname, IP address, URL or port;
  - a tunnel, proxy or account name, or an organisation or machine name;
  - an email address, a user name, a request or session id, the bearer, or a grant code.

  When you copy an error text or a reply, replace each identifier with `<removed>`. The name and
  version of the hosted client and of its model are not identifiers; record them.
- **Choose your action texts now.** Pick three short, harmless phrases with no identifiers, for
  example `rotate the demo key`, `delete the demo file` and `restart the demo`. You will type them
  exactly.
- **Unreached rows.** If you stop early, write `not reached` in every cell you did not get to.

## 1. Prepare (about 5 minutes)

1. **Check out the pull request's head commit.**
   - If you have no clone yet, clone the repository first; its address is on the pull request page.
   - The head commit's full id is also on the pull request page, under its commits.
   - Run `git fetch origin` and `git checkout <that commit>`.
   - Confirm that `git rev-parse HEAD` prints that commit.
2. **Check Node and install.**
   - `node --version` must print `v24.21.0`. If it does not, switch to that version (for example
     `nvm use 24.21.0`), or stop and tell the architect.
   - Then run `npm ci`. It is safe to run again.
3. **Open a history-free shell.** Open one terminal ("shell 1"), then run `bash` and `set +o
   history` in it. You will use it for everything up to §6, and **the server's log will appear
   in it.** Run `node --version` again in shell 1: it must print `v24.21.0`. A `nvm use` lasts only
   for the shell it ran in, so repeat it here if needed.
4. **Choose the port.**
   - Run `export CLEARSEAL_SPIKE_PORT=3999`.
   - Check that `ss -ltn | grep ':3999 '` prints nothing, which means the port is free. On macOS,
     use `lsof -iTCP:3999 -sTCP:LISTEN` instead. If it prints something, pick another number and
     use it everywhere below.
5. **Clear any stale key.** Check that `printenv CLEARSEAL_REQUEST_STATE_KEY` prints nothing. If it
   prints something, run `unset CLEARSEAL_REQUEST_STATE_KEY`. When the key is unset, the spike
   makes a fresh one for its own process.

## 2. Make the port reachable, configure, start (about 5 minutes)

1. **Make the port reachable.** Using your own means, make `127.0.0.1` on that port reachable by
   the hosted client, **before the server starts**.
   - This protocol does not describe that means, and your notes must not either.
   - It gives you a public address of the form `scheme://host[:port]`. That address is an
     identifier: keep it only in your head, the client's settings and this shell.
2. **Set the variables in shell 1, all with `export`.** Where `<public>` appears below, use your
   public address exactly: its scheme, host and `:port` if it shows one, with no trailing slash.
   Leave out a default port (`:443` for https, `:80` for http), because clients omit it from `Host`.
   - `export CLEARSEAL_SPIKE_BEARER="$(openssl rand -base64 36)"`. This gives a bearer of 48
     characters; the server refuses anything under 32.
   - `export CLEARSEAL_SPIKE_ALLOWED_HOSTS=<host[:port] of the public address>`, compared
     case-insensitively.
     - If your means passes requests on with `Host: 127.0.0.1:<port>` instead, that value is
       already allowed, and this variable does no harm.
   - `export CLEARSEAL_SPIKE_ALLOWED_ORIGINS=<public>`. It is used only if the client sends an
     `Origin` header.
   - `export CLEARSEAL_SPIKE_RESOURCE_URL=<public>/mcp`. The server names this URL in its `401`
     challenge.
3. **Copy the bearer now.** Shell 1 is about to belong to the server.
   - Run `printenv CLEARSEAL_SPIKE_BEARER`, copy the value to your clipboard, then run `clear`.
   - Some terminals keep scrollback after `clear`. If yours does, clear the scrollback from its
     menu.
4. **Start the server:** `node spikes/0101-approval/server.ts`.
   - Expect exactly one line: `[approval-spike] listening on http://127.0.0.1:<port>/mcp
     (loopback only)`. Do not copy it into the results; it holds a port.
   - If it says `refusing to start`, the bearer is missing or too short: repeat §2.2 and §2.3, then
     this step.
   - **The server prints nothing when a client connects.** It prints only grant lines (§4.4) and
     refusals of grant codes.
5. **Start your clock.** You will record the running time in minutes, not the time of day. The
   clock keeps running through any restart.

## 3. Register the server in the hosted client (about 5 minutes)

1. **Record the client.** Open the hosted client. Record its name and version, and the model's if
   shown, from its about or settings page, in Setup row 1.
2. **Add the server.** Add a custom (remote) MCP server whose URL is `<public>/mcp`.
3. **Authentication.** Choose a static header, `Authorization: Bearer <bearer>`, and paste the
   bearer from your clipboard. A field labelled "API key" or "bearer token" that adds `Bearer`
   itself counts as a static header: paste the bearer alone. Entering it into the client is intended: it is the only place it
   should go. Record the outcome in the "Authentication" row:
   - `static header accepted`;
   - `requires OAuth; static bearer not accepted`, then go to §6;
   - `no authentication option`, then go to §6;
   - or, for any other shape, describe it without naming any provider or account, then go to §6.
4. **Check the tool list.** The client should show three tools: `approve_via_mrtr`,
   `approve_via_task`, `approve_via_grant`. Record `three tools listed`, or the error text with
   identifiers removed, in the "Tool list" row.
   - If the error says 403 or "forbidden", the request's `Host` or `Origin` is not allowed.
     1. Check the two `ALLOWED_*` values against your public address.
     2. Press Ctrl-C in shell 1, correct the values with `export`, and start the server again as
        in §2.4. Your means of reachability and the registration stay as they are.
     3. In the client, use its reconnect or refresh control for the server if it has one;
        otherwise remove the server and add it again with §3.2–§3.3.
     4. Write `restarted for Host/Origin` in the "Restarts" row.
   - If the tools still do not list after one correction, go to §6.
   - Any other error, such as a 401 or a connection failure, goes to §6 after you record its
     text. The bearer cannot be re-copied once the server is running, which is deliberate.

## 4. Run each transport (about 15 minutes)

Use **one new conversation** for all of §4. For each call, ask the model in plain words, for
example: *"Call approve_via_mrtr with action 'rotate the demo key'."* Type the action text exactly.

**The two timing columns, in seconds, each measured from the message named in the row's step:**
- **Prompt:** until the **server's** approval prompt appears (§4.1, §4.2), or until the PENDING
  reply appears (§4.4). Write `—` in rows that have no prompt.
- **Done:** until the model's final reply to that message has **finished** appearing.

**What "Completed?" means:**
- In the approve and redeem rows: `yes` only if the reply is APPROVED.
- In the decline, cancel, second-redemption and expired rows, where a refusal is the right answer:
  `yes` if the call ended with a reply.
- Skipping the optional row: write `skipped` in each of its cells.

**The client's own permission dialog is not the measurement.** Many hosted clients first ask
something like *"Allow this tool to run?"* before calling any custom tool. That dialog does
**not** stop the Prompt clock. Approve it, and write `client permission dialog shown` in the row's
Notes.

The prompt under measurement is the server's. It reads **"Approve this action? \<your action
text\>"** and has a yes/no **Approve** field.

**If nothing new happens for 2 minutes**, write what you see (a spinner, an error, or nothing)
in that row's "Client behaviour" cell, `—` in Prompt and Done, and **Completed?** `no`. Then go on to the next
subsection (§4.1 → §4.2 → §4.3 → §4.4).

**Where replies go.** The final reply goes in "Client behaviour": quote the raw tool result if
the client shows it, otherwise summarise the model's reply and say that it is a summary. "Client
behaviour" also records what you saw before the reply.

### 4.1 `approve_via_mrtr`: approve

Measure from the message in step 1.

1. Ask for the call with your first action text.
2. When the "Approve this action? …" prompt appears, note in Client behaviour whether it shows
   your action text. Set Approve to yes and submit.
3. **Completed?** `yes` if the reply is `APPROVED via mrtr …`, otherwise `no`.
   - The reply contains `Waited N ms`: the server's own measure of the time between asking and
     receiving the answer. Copy that figure into Notes. A figure of a few milliseconds means no
     human answered.
   - **If the reply says APPROVED but the "Approve this action? …" prompt never appeared,** write
     `NO PROMPT SEEN` in capitals in Notes. That means the client or the model answered without
     you, which is the most important thing this run can find.
4. Any error text goes in Notes:
   - text containing `-32021` means the client did not declare that it can answer such prompts;
   - text mentioning the "legacy revision" means the client speaks the older `2025-11-25`
     protocol, which cannot carry this path.
5. **The "Protocol revision" row:**
   - `2026-07-28` if this step completed with APPROVED (only that revision carries it);
   - `2025-11-25` if the error mentions the "legacy revision";
   - otherwise `unknown`.

### 4.2 `approve_via_mrtr`: decline, and cancel

Measure each row from its own message. **Completed?** means the call ended with a reply; a
refusal is the expected, correct reply.

1. **Decline.** Ask for the call with your second action text. When the prompt appears, use its
   decline or reject button if it has one. Otherwise set Approve to no and submit.
   - Note in Notes which of the two you did.
   - Expect `REFUSED via mrtr …`.
2. **Cancel.** Ask again with the same action, and close the prompt without answering.
   - If the prompt appears again, close it once more, then write `repeated prompt` in Notes.
   - If the prompt has no close control, write `no cancel control` in Client behaviour and move on.
   - Expect a refusal.
3. **If either reply says APPROVED**, write `APPROVED AFTER DECLINE` or `APPROVED AFTER CANCEL`
   in capitals in its Notes, then carry on.

### 4.3 `approve_via_task`

1. Ask for the call with your first action text again.
   - The expected reply starts `NOT OFFERED`: this path is deliberately not offered on this server.
   - Prompt is `—`; Done runs from your message. "Completed?" is pre-filled `n/a`.

### 4.4 `approve_via_grant`

The code expires **120 seconds** after it is issued. Have the next message ready before you look
it up.

1. **Issue.** Ask for the call with your third action text. Measure **Prompt** from this message
   to the PENDING reply.
   - The reply should start `PENDING via grant`, and it must **not** contain a code (two groups of
     five letters and digits, like `ABCDE-12345`).
   - If it does contain one, write `CODE IN REPLY` in capitals in Notes.
2. **Find the code.** In shell 1, find the line `[approval-spike] GRANT issued: code XXXXX-XXXXX …`.
   The server never sends the code to the client. You are the only way it reaches the
   conversation.
3. **Redeem.** Within the 120 s, ask: *"Call approve_via_grant again with action '\<the same
   text\>' and code \<the code\>."* Measure **Done** from this message to the reply.
   - **Completed?** `yes` if the reply is `APPROVED via grant …`.
   - Write the seconds between the PENDING reply and this message in Notes.
   - If the reply says the code is "not for this call", the model changed the action text. Write
     `model changed action` in Notes and redo steps 1–3 once.
   - If it says "expired", you were slower than 120 s. Write `too slow` in Notes and redo steps
     1–3 once.
   - Record the successful attempt's times.
4. **Second redemption.** Ask for exactly the same redemption once more, and fill the "second
   redemption" row: Prompt `—`, Done from this message.
   - It must say `REFUSED via grant: the code is unknown or already used`.
   - If it says APPROVED, write `CODE REUSED` in capitals in Notes.
5. **Optional, expiry.** Issue a new code with step 1, wait 130 seconds, then redeem it. Fill the
   "expired" row: Prompt `—`, Done from the redeeming message. It must say `REFUSED via grant: the
   code is expired`.

## 5. The results tables

**Setup**

| Item | Value |
|---|---|
| Hosted client name and version (and model, if shown), from §3.1 | |
| Authentication (§3.3) | |
| Tool list (§3.4) | |
| Restarts (`none`, or `restarted for Host/Origin`) | |
| Protocol revision (§4.1 step 5) | |
| Harness running time (minutes, from §2.5 to §6.1) | |

**Transports**

| Transport | Client behaviour (what you saw; the final reply) | Prompt (s) | Done (s) | Completed? | Notes (no identifiers) |
|---|---|---|---|---|---|
| (a) MRTR: approve (§4.1) | | | | | |
| (a) MRTR: decline (§4.2.1) | | | | | |
| (a) MRTR: cancel (§4.2.2) | | | | | |
| (b) Tasks extension (§4.3) | | — | | n/a | |
| (c) grant: issue and redeem (§4.4.1–3) | | | | | |
| (c) grant: second redemption (§4.4.4) | | — | | | |
| (c) grant: expired, optional (§4.4.5) | | — | | | |

## 6. Stop (always do this, even if a step failed)

1. **Stop the server.** In shell 1, press Ctrl-C; the terminal returns to a prompt.
   - Open a new terminal and run `ps aux | grep '[s]pikes/0101-approval/server.ts'`. It must print
     nothing.
   - If it prints a line, run `kill <the second column of that line>` and check again.
   - Stop your clock, and write the minutes in the Setup row "Harness running time".
2. **Take down** whatever you used to make the port reachable.
3. **Remove the MCP server registration** from the hosted client. That also removes the bearer
   stored there.
4. **Delete the §4 conversation** in the hosted client: it holds the grant codes you typed.
5. **Close every terminal** you used, which discards the bearer and the public address from their
   environment. History was off in shell 1, where they were typed, so nothing was saved. Clear your
   clipboard.
6. **Send the results.** Check the tables once more for identifiers, as §0 defines them, then send
   them to the architect the way they asked.
