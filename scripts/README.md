# scripts/

## The leak gate: what it is

`leak-gate.mjs` enforces N6: nothing in this repository identifies a deployment or carries a
credential. It scans every tracked file (`--tree`) and every line ever **added** in reachable
history, **plus every commit message including its trailers** (`--history`). It refuses on any
match of its rules: owned and infrastructure hostnames, operator and device paths, private and
routable addresses, hardware addresses, UUIDs, long hex, credential shapes (platform tokens, JWTs,
private-key blocks, cloud access keys, `Bearer` values, credentials in a URL query string), and
e-mail addresses.

It has no dependencies; it imports only `node:` modules. A finding prints the rule, the location,
and a mask of the match (the first four characters and the length), **never the match itself**.
`--self-test` plants one synthetic example per rule in a temporary repository built at run time,
and asserts that each rule fires by name, that a clean tree passes, that a shape removed by a later
revert is still found in history, that a shape present only in a commit-message trailer is found,
and that a stale allow fails. CI's `leak-gate` job runs all three modes on every push and pull
request, with full history.

History is scanned, so **a planted identifier can never be committed on a branch that will
merge**. To prove the CI job goes red, use a throwaway branch and delete it afterwards.

## How to run it

```sh
npm run leak-gate                        # --self-test, then --tree, then --history
node scripts/leak-gate.mjs --tree        # one mode at a time
```

Exit code 0 means clean. 1 means a finding, a malformed or stale allow entry, or a failed
self-test. 2 means a usage error.

## How to add a rule or an allow

**A rule** is an entry in `RULES`: a `name`, a global `pattern`, a one-line `reason`, and
optionally an `exempt` function with an `exemptReason`. Copy the shape of the one above it. Every
rule needs a synthetic example in `PLANTED`, assembled at run time from fragments or random bytes,
never written as a literal. The self-test fails on a rule without one, because a rule that has
never been seen to fire is not a rule (N5). The only exemptions today are the architect's two
rulings: the exact role identities in the `email` rule, and the `owner/repo@<40-hex>` action-pin
shape in the `long-hex` rule.

**An allow** is a line in `.leak-gate-allow`: `<path-glob> <rule-name> <justification>`. It
exempts that rule's findings in paths matching the glob (`*` stays within a directory, `**`
crosses directories). The file ships with **no entries**. The gate fails on a malformed entry, on
an unknown rule name, and on a **stale** entry, meaning one that suppressed no finding in that run.
An entry therefore has to keep earning its place, in each mode that reads it. **Every allow entry
is a review item**: a glob that matches everything also silences everything that rule would ever
find. Say why in the justification, and expect the review to ask.

## Known limitations

The gate matches one line at a time against plain text. It does **not** claim to catch:

- an identifier split across a line break or a Markdown soft wrap;
- an encoded identifier (base64, URL-encoding, or any other transform);
- identifiers inside binary files, when the file has both a binary extension and a NUL byte (such
  files are listed as skipped in the `--tree` summary), or in a binary diff in history;
- anything outside the repository: pull-request titles, descriptions, comments, and CI logs.

It is a floor, not a substitute for review.
