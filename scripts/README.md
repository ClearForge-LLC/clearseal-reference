# scripts/

## The leak gate: what it is

`leak-gate.mjs` enforces N6: nothing in this repository identifies a deployment or carries a
credential. `--tree` scans every tracked file's **path, contents and (for a symlink) target**.
`--history` scans every line ever **added** in reachable history, every path a commit touches, and
**every commit message including its trailers**, and **every commit's author and committer name
and e-mail**. It reads diffs with `--text`, so neither a
`.gitattributes` `-diff` nor a NUL byte can turn added lines into "Binary files differ". It reads
messages from the raw commit object, so a NUL byte cannot truncate one. It diffs a merge against its
first parent, so an evil merge's own lines are scanned. It runs git without system or global
config, replace refs or grafts, and pins the repository-local settings that could hide a root
commit or reshape a diff. It refuses a **shallow** history instead of calling a partial one clean.
Any line holding NUL bytes is also scanned with them removed, which catches UTF-16 and UTF-32
text in either mode. It refuses on any match of its rules:
owned, tunnel, identity-tenant, tailnet and hosting-platform hostnames; `user@host` ssh targets;
operator and device paths; private, link-local and routable IPv4; private and link-local IPv6;
hardware addresses; UUIDs; long hex; credential shapes (platform and vendor tokens, JWTs,
private-key blocks, cloud access keys, `Bearer`/`Basic` header values, credentials in a URL query
string or authority); and e-mail addresses.

It has no dependencies; it imports only `node:` modules. A finding prints the rule, the location,
and a mask of the match (at most its first four characters, never more than half of it, and the
length), **never the match itself**. A path that matches a rule is masked wherever it is printed. The person-identifying rules (`email`,
`user-at-host`) show no characters at all. Allow entries are printed as their line, rule and masked
glob, never their justification. Control characters in anything printed are escaped, so a file
name cannot inject a line into the CI log.
`--self-test` plants synthetic examples, one per alternative of every rule, in temporary
repositories built at run time. It asserts that each fires by name and nothing fires cross-rule,
and that a clean tree of near-misses passes. It also makes each scan mechanism go red: a shape
behind a revert, a message-only trailer, a `++` content line, a NUL-byte text file, a later `-diff`
attribute, an identifier in a file name, a symlink target, UTF-16 text, a shallow clone, masking,
and stale or malformed allows. CI's `leak-gate` job runs all three modes on every push and pull
request, with full history. On a pull request it checks out the branch's head, not GitHub's
synthetic merge commit, which never lands.

History is scanned, so **a planted identifier can never be committed on a branch that will
merge**. To prove the CI job goes red, use a throwaway branch and delete it afterwards.

## How to run it

```sh
npm run leak-gate                        # --self-test, then --tree, then --history
node scripts/leak-gate.mjs --tree        # one mode at a time
```

Exit code 0 means clean. 1 means a finding, a malformed or stale allow entry, a shallow history, an
error, or a failed self-test. 2 means a usage error. Locally, `--tree` reads the files `git ls-files`
lists, reading their working-tree contents: a new file is not scanned until it is `git add`ed, and
a staged change is scanned as it is on disk.

## How to add a rule or an allow

**A rule** is an entry in `RULES`: a `name`, a global `pattern`, a one-line `reason`, and
optionally an `exempt` function with an `exemptReason`. Copy the shape of the one above it. Every
rule needs a synthetic example in `PLANTED` (one per alternative in its pattern), assembled at run time from fragments or random bytes,
never written as a literal. The self-test fails on a rule without one, because a rule that has
never been seen to fire is not a rule (N5). The only exemptions today are the architect's two
rulings: the exact role identities in the `email` rule, and the `owner/repo@<40-hex>` action-pin
shape in the `long-hex` rule.

**An allow** is a line in `.leak-gate-allow`: `<path-glob> <rule-name> <justification>`. It
exempts that rule's findings in paths matching the glob (`*` stays within a directory, `**`
crosses directories). The file ships with **no entries**. The gate fails on a malformed entry, on
an unknown rule name, and on a **stale** entry, meaning one that suppressed no finding in that run.
An entry therefore has to keep earning its place, in each mode that reads it. Each applied entry is printed with its count. **Every allow entry
is a review item**: a glob that matches everything also silences everything that rule would ever
find. Say why in the justification, and expect the review to ask.

## Which Node guarantee lives where

The reference runs on exactly the Node version in `.node-version`, and three places hold that
line. **Install:** `.npmrc`'s `engine-strict=true` and the exact `engines.node` pin make `npm ci`
refuse any other Node. (The dependency bot still regenerates the lockfile under that pin; this was
measured.) **Suite:** `scripts/check-node.mjs` runs first in `npm run check` and refuses any other
Node, even when no install ran. **Host install scripts:** they run `npm ci --engine-strict`.

## Known limitations

The gate matches one line at a time against text. It does **not** claim to catch:

- an identifier split across a line break or a Markdown soft wrap;
- an encoded identifier (base64, URL-encoding, an IPv4 address written as one decimal or hex
  integer, or any other transform), and non-ASCII (IDN) host or e-mail domains;
- identifiers inside binary files in `--tree`, when the file has both a binary extension and a NUL
  byte (such files are listed as skipped in the summary; `--history` still scans their added lines
  as text);
- non-ASCII text in encodings other than UTF-8, UTF-16 and UTF-32;
- Git LFS content: only the pointer file is in the repository (its 64-hex object id fires
  `long-hex`, so an LFS file needs an allow, and that allow is a review stop, not a formality);
- unprefixed secrets: a 32-hex API key, a cloud secret access key, a `password=` assignment in
  config; routable IPv6 addresses; hardware addresses in dotted or bare twelve-hex form;
- vendor token shapes and hosting platforms not in its lists;
- anything outside `HEAD`'s ancestry: other branches (each is scanned when its own push runs the
  job), annotated tag messages, and notes;
- commit signatures and extra headers (the message with its trailers, and the author's and
  committer's name and e-mail, are scanned);
- anything outside the repository: pull-request titles, descriptions, comments, and CI logs.

An allow entry must suppress a finding in the mode that reads it, so a finding that exists only in
history cannot be allowed. That is deliberate: a history-only false positive is fixed by a more
precise rule, never by an allow.

It is a floor, not a substitute for review.
