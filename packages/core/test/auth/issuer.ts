// The in-process test issuer (CSR-WO-1003 §1.5). It serves a JWKS over loopback HTTPS with a
// self-signed certificate, which only the verifier under test trusts (its per-client `ca`), and it
// mints tokens with any header and claims for the negative tests. Keys are generated per run (N8).
// The suite touches no network beyond 127.0.0.1.

import { createSign, generateKeyPairSync, type KeyObject, sign as cryptoSign } from "node:crypto";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";

import { selfSigned } from "./cert.ts";

export const ISSUER = "https://issuer.example.invalid";
export const AUDIENCE = "https://mcp.example.invalid/mcp";

export interface SigningKey {
  kid: string;
  alg: "ES256" | "EdDSA" | "RS256";
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
}

export const b64 = (v: unknown): string => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

/** A fresh key pair, its public half as a JWK with `kid`, `alg` and `use` set. */
export function key(kid: string, alg: SigningKey["alg"], rsaBits = 2048): SigningKey {
  const pair = alg === "ES256" ? generateKeyPairSync("ec", { namedCurve: "P-256" }) : alg === "EdDSA" ? generateKeyPairSync("ed25519") : generateKeyPairSync("rsa", { modulusLength: rsaBits });
  return { kid, alg, privateKey: pair.privateKey, jwk: { ...pair.publicKey.export({ format: "jwk" }), kid, alg, use: "sig" } };
}

export class TestIssuer {
  readonly ca: string;
  readonly keys: SigningKey[];
  /** Requests served, and their paths. */
  fetches = 0;
  readonly paths: string[] = [];
  /** ok serves the key set; down answers 503; hang never answers; redirect answers 302 to itself;
   *  drip sends the headers, then the key set one byte every 400 ms (never idle for 3 s). */
  mode: "ok" | "down" | "hang" | "redirect" | "drip" = "ok";
  /** Replaces the JWKS response body entirely (oversize, malformed…). */
  body: string | Buffer | undefined;
  #server: Server;
  #port = 0;

  private constructor(server: Server, ca: string, keys: SigningKey[]) {
    this.#server = server;
    this.ca = ca;
    this.keys = keys;
  }

  static async start(): Promise<TestIssuer> {
    const cert = selfSigned();
    const keys = [key("es-1", "ES256"), key("ed-1", "EdDSA"), key("rs-1", "RS256")];
    const ref: { issuer?: TestIssuer } = {};
    const server = createServer({ key: cert.keyPem, cert: cert.certPem }, (req, res) => {
      const issuer = ref.issuer;
      if (issuer === undefined) return;
      issuer.fetches++;
      issuer.paths.push(req.url ?? "");
      if (issuer.mode === "hang") return;
      if (issuer.mode === "drip") {
        const body = Buffer.from(JSON.stringify({ keys: issuer.keys.map((k) => k.jwk) }));
        res.writeHead(200, { "content-type": "application/json" });
        let i = 0;
        const timer = setInterval(() => {
          if (i >= body.length) {
            clearInterval(timer);
            res.end();
            return;
          }
          res.write(body.subarray(i, ++i));
        }, 400);
        res.on("close", () => {
          clearInterval(timer);
        });
        return;
      }
      if (issuer.mode === "redirect") {
        res.writeHead(302, { location: "/jwks" }).end();
        return;
      }
      if (issuer.mode === "down" || req.url !== "/jwks") {
        res.writeHead(issuer.mode === "down" ? 503 : 404).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end(issuer.body ?? JSON.stringify({ keys: issuer.keys.map((k) => k.jwk) }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const issuer = new TestIssuer(server, cert.certPem, keys);
    ref.issuer = issuer;
    issuer.#port = (server.address() as AddressInfo).port;
    return issuer;
  }

  get jwksUrl(): string {
    return `https://127.0.0.1:${String(this.#port)}/jwks`;
  }

  /** Adds a signing key to the served set (a rotation), or a given one. */
  rotate(kid: string, k: SigningKey = key(kid, "ES256")): SigningKey {
    this.keys.push(k);
    return k;
  }

  /** A signed token. `header` overrides the JOSE header; `using` picks the key by kid. */
  mint(claims: Record<string, unknown>, opts: { header?: Record<string, unknown>; using?: string; signer?: SigningKey } = {}): string {
    const k = opts.signer ?? this.keys.find((x) => x.kid === (opts.using ?? "es-1"));
    if (k === undefined) throw new Error(`the test issuer has no key ${String(opts.using)}`);
    const header = { alg: k.alg, typ: "at+jwt", kid: k.kid, ...opts.header };
    return this.sign(`${b64(header)}.${b64(claims)}`, k);
  }

  /** Signs any signing input (for hand-built, malformed segments) with a key's own algorithm. */
  sign(input: string, k: SigningKey = this.keys[0] as SigningKey): string {
    const data = Buffer.from(input, "ascii");
    const sig = k.alg === "ES256" ? cryptoSign("sha256", data, { key: k.privateKey, dsaEncoding: "ieee-p1363" }) : k.alg === "EdDSA" ? cryptoSign(null, data, k.privateKey) : createSign("sha256").update(data).sign(k.privateKey);
    return `${input}.${sig.toString("base64url")}`;
  }

  /** Standard valid claims, at `nowS` seconds. */
  static claims(nowS: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { iss: ISSUER, aud: AUDIENCE, sub: "user-42", iat: nowS - 10, nbf: nowS - 10, exp: nowS + 300, ...extra };
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.#server.close(() => {
        resolve();
      });
      this.#server.closeAllConnections();
    });
  }
}
