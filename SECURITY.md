# Security policy

## Supported versions

Only `main` is supported until the first tag. From then on, the most recent tag and `main` are
supported. Older tags receive no fixes; upgrade to the latest.

## Reporting a vulnerability

Report it privately through this repository's **private vulnerability reporting**: the
repository's *Security* tab → *Report a vulnerability*
(<https://github.com/ClearForge-LLC/clearseal-reference/security/advisories/new>).

That is the only reporting path. There is no e-mail address or chat handle, deliberately:
a public address rots, and this repository's own leak gate refuses one. Please do not open a
public issue or pull request for a vulnerability.

## What to expect

- **Acknowledgement:** we aim to acknowledge a report within 7 days.
- **Updates:** we'll keep you posted in the private advisory, and credit you in it unless you ask
  us not to.
- **Fix and disclosure:** a fix lands on `main` and in the next tag. The advisory is published
  once the fix is available.
- **No bounty:** this project does not offer one.

## Scope

In scope: this reference implementation, meaning the core and its editions as they appear in this
repository. Out of scope: any deployment built on them. Report those to whoever runs them.
