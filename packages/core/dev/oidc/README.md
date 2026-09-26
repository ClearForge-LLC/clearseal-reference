NOT FOR DEPLOYMENT. A development harness only: it is not part of ClearSeal, it never ships, and nothing here is a supported authorization server.

# The dev OIDC harness (CSR-WO-1003 §1.6)

It stands up a real, third-party authorization server, [node-oidc-provider](https://github.com/panva/node-oidc-provider)
(a dev dependency of `@clearseal/core`, pinned exactly), on loopback, and points the core's verifier
at it. That shows the verifier is AS-agnostic: it knows only an issuer, a key-set URL and an
audience, and it verifies tokens it did not mint.

- The provider serves HTTPS on `127.0.0.1` with a self-signed certificate generated per run. Only
  this process's verifier trusts it (the key-set client's own `ca`), never the process or the system.
- Its signing key is generated per run and never written anywhere.
- Its one client uses the client-credentials grant with a resource indicator, so the access token is
  a JWT whose `aud` is the node's resource URL and whose `sub` is the client id.
- The client secret is read from `DEV_OIDC_CLIENT_SECRET` (at least 32 characters) and never
  printed.

```sh
DEV_OIDC_CLIENT_SECRET=... node packages/core/dev/oidc/harness.ts          # one end-to-end call, then exit
DEV_OIDC_CLIENT_SECRET=... node packages/core/dev/oidc/harness.ts --serve  # stay up for manual curl
```

In `--serve` mode it prints the two loopback URLs and the path of the provider's public certificate
(for `curl --cacert`), and runs until interrupted. Nothing binds anything but `127.0.0.1`.
