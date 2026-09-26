// The AS-agnostic resource-server verifier (CSR-WO-1003 §1.4). It is configured by an issuer, a
// JWKS URL and an audience; it implements CHECKS.md row by row, and each check carries its id. The
// principal is the token's `sub` and nothing else. Every failure gives the client an RFC 6750 code
// only; the one-word reason goes to the audit seam.

import { X509Certificate } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import type { IncomingHttpHeaders } from "node:http";

import { type Alg, b64url, importKey, KNOWN_ALGS, keyFits, verifySignature } from "./jws.ts";
import { JwksClient } from "./jwks.ts";
import { JsonParseError, parseJsonStrict } from "../transport/json.ts";
import type { Verdict, Verifier } from "../transport/verifier.ts";

export interface JwtVerifierConfig {
  issuer: string;
  jwksUrl: string;
  audience: string;
  /** AUTH_JWKS_TTL_S, default 300. */
  jwksTtlS?: number;
  /** AUTH_CLOCK_SKEW_S, default 60: the stated constant. */
  clockSkewS?: number;
  /** AUTH_ALGS, default ES256, EdDSA, RS256. */
  algs?: readonly string[];
  /** AUTH_MAX_TOKEN_LIFETIME_S, default 86400, 60 to 604800: the furthest `exp` may lie beyond now
   *  (plus skew). */
  maxTokenLifetimeS?: number;
  /** AUTH_REQUIRE_AT_JWT: only `at+jwt` (or `application/at+jwt`) is accepted as `typ` (RFC 9068). */
  requireAtJwt?: boolean;
  /** Extra trust for the JWKS fetch only (see JwksOptions.ca). */
  jwksCa?: string;
  now?: () => number;
}

export class AuthConfigError extends Error {
  override name = "AuthConfigError";
}

export const DEFAULT_CLOCK_SKEW_S = 60;
export const DEFAULT_JWKS_TTL_S = 300;
export const DEFAULT_MAX_TOKEN_LIFETIME_S = 86_400;
export const MAX_TOKEN_LIFETIME_BOUNDS_S = [60, 604_800] as const;
/** A CA file larger than this is not a CA file. */
const MAX_CA_FILE_BYTES = 1024 * 1024;
/** `typ` values, lower-cased: RFC 7515 lets the `application/` prefix be omitted, so each type is
 *  accepted with it and without it. */
const TYP_LENIENT: ReadonlySet<string> = new Set(["jwt", "application/jwt", "at+jwt", "application/at+jwt"]);
const TYP_STRICT: ReadonlySet<string> = new Set(["at+jwt", "application/at+jwt"]);
const MAX_TOKEN = 8 * 1024;
const KID = /^[A-Za-z0-9._-]{1,128}$/;

type Fail = { ok: false; error: "invalid_request" | "invalid_token"; reason: string };
const fail = (reason: string, error: Fail["error"] = "invalid_token"): Fail => ({ ok: false, error, reason });

/** Strict UTF-8: an invalid byte is refused, never replaced with U+FFFD, so two different byte
 *  strings can never decode to the same `sub` (red-team F5). A BOM is kept, and the parser refuses it. */
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function json(buf: Buffer | undefined): Record<string, unknown> | undefined {
  if (buf === undefined) return undefined;
  let text: string;
  try {
    text = STRICT_UTF8.decode(buf);
  } catch {
    return undefined;
  }
  try {
    const v = parseJsonStrict(text, 16);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? v : undefined;
  } catch (err) {
    if (err instanceof JsonParseError) return undefined;
    throw err;
  }
}

export class JwtVerifier implements Verifier {
  readonly issuer: string;
  /** Public so the transport can audit, at start, an audience that differs from the resource URL. */
  readonly audience: string;
  readonly #audience: string;
  readonly #maxLifetimeS: number;
  readonly #requireAtJwt: boolean;
  readonly #skewS: number;
  readonly #algs: ReadonlySet<Alg>;
  readonly #now: () => number;
  readonly jwks: JwksClient;

  constructor(config: JwtVerifierConfig) {
    // G1: blank configuration refuses start.
    for (const [name, v] of [["AUTH_ISSUER", config.issuer], ["AUTH_JWKS_URL", config.jwksUrl], ["AUTH_AUDIENCE", config.audience]] as const) {
      if (typeof v !== "string" || v.trim() === "") throw new AuthConfigError(`${name} is not configured: the node does not start without it`);
    }
    const algs = config.algs ?? KNOWN_ALGS;
    for (const a of algs) if (!(KNOWN_ALGS as readonly string[]).includes(a)) throw new AuthConfigError(`AUTH_ALGS names ${a}, which this verifier does not implement`);
    const skew = config.clockSkewS ?? DEFAULT_CLOCK_SKEW_S;
    if (!Number.isFinite(skew) || skew < 0 || skew > 300) throw new AuthConfigError("AUTH_CLOCK_SKEW_S must be 0 to 300");
    const lifetime = config.maxTokenLifetimeS ?? DEFAULT_MAX_TOKEN_LIFETIME_S;
    const [minLife, maxLife] = MAX_TOKEN_LIFETIME_BOUNDS_S;
    if (!Number.isFinite(lifetime) || lifetime < minLife || lifetime > maxLife) throw new AuthConfigError(`AUTH_MAX_TOKEN_LIFETIME_S must be ${String(minLife)} to ${String(maxLife)}`);
    this.issuer = config.issuer;
    this.audience = config.audience;
    this.#audience = config.audience;
    this.#maxLifetimeS = lifetime;
    this.#requireAtJwt = config.requireAtJwt === true;
    this.#skewS = skew;
    this.#algs = new Set(algs as Alg[]);
    this.#now = config.now ?? Date.now;
    this.jwks = new JwksClient({ url: config.jwksUrl, ttlMs: (config.jwksTtlS ?? DEFAULT_JWKS_TTL_S) * 1000, now: this.#now, ...(config.jwksCa === undefined ? {} : { ca: config.jwksCa }) });
  }

  async verify(headers: IncomingHttpHeaders): Promise<Verdict> {
    const r = await this.#check(headers);
    return r;
  }

  async #check(headers: IncomingHttpHeaders): Promise<Verdict | Fail> {
    const auth = headers.authorization;
    if (auth === undefined) return { ok: false, reason: "missing" }; // H2: no error code
    // H3: another scheme is a missing token, with no error code (RFC 6750: the client used a method
    // this server does not support). "Bearer", case-insensitive, with anything but one token after
    // one space is a malformed request.
    if (!/^Bearer(\s|$)/i.test(auth)) return { ok: false, reason: "scheme" };
    const m = /^Bearer ([^\s]+)$/i.exec(auth);
    if (m === null) return fail("malformed-bearer", "invalid_request");
    const token = m[1] as string;
    // H4
    const parts = token.length <= MAX_TOKEN ? token.split(".") : [];
    if (parts.length !== 3) return fail("malformed");
    const [h, p, s] = parts as [string, string, string];
    const header = json(b64url(h)); // H5
    if (header === undefined) return fail("header");
    // H6: the allow-list, with none and HMAC refused before any key is consulted.
    const alg = header["alg"];
    if (typeof alg !== "string" || alg === "none" || /^HS/i.test(alg) || !this.#algs.has(alg as Alg)) return fail("alg");
    if (Object.hasOwn(header, "crit")) return fail("crit"); // H7
    // H8: jku, x5u, jwk and x5c are never read.
    // H10: JWT, at+jwt, or either with the application/ prefix, case-insensitive; absent is accepted unless
    // AUTH_REQUIRE_AT_JWT, which admits only the two at+jwt spellings.
    const typ = header["typ"];
    const typs = this.#requireAtJwt ? TYP_STRICT : TYP_LENIENT;
    if (typ === undefined ? this.#requireAtJwt : typeof typ !== "string" || !typs.has(typ.toLowerCase())) return fail("typ");
    const kid = header["kid"]; // H9: before any fetch
    if (typeof kid !== "string" || !KID.test(kid)) return fail("kid");
    const signature = b64url(s);
    const payload = json(b64url(p)); // C1
    if (signature === undefined || payload === undefined) return fail(signature === undefined ? "malformed" : "payload");
    // K1
    const found = await this.jwks.key(kid);
    // An unreachable key set is not a judgement on the token: the transport answers 503.
    if (!found.ok) return found.reason === "jwks-unavailable" ? { ok: false, reason: found.reason, unavailable: { retryAfterS: Math.max(1, Math.ceil(found.retryAfterMs / 1000)) } } : fail(found.reason);
    // K2: only a key that fits the alg is tried; one kid may name several (RFC 7517).
    const keys = found.jwks.filter((j) => keyFits(j, alg as Alg)).map((j) => importKey(j, alg as Alg)).filter((k) => k !== undefined);
    if (keys.length === 0) return fail("key-mismatch");
    // K3
    if (!keys.some((key) => verifySignature(alg as Alg, key, `${h}.${p}`, signature))) return fail("signature");
    // C2
    if (payload["iss"] !== this.issuer) return fail("iss");
    // C3: string-equal; a one-element array is the same audience; more than one is refused.
    const aud = payload["aud"];
    const audOk = aud === this.#audience || (Array.isArray(aud) && aud.length === 1 && aud[0] === this.#audience);
    if (!audOk) return fail("aud");
    const now = this.#now() / 1000;
    const exp = payload["exp"]; // C4
    if (typeof exp !== "number" || !Number.isFinite(exp) || !(now - this.#skewS < exp)) return fail("exp");
    // C4a: the lifetime horizon. The issuer sets the lifetime; this bounds it, and needs no iat.
    if (exp > now + this.#skewS + this.#maxLifetimeS) return fail("exp-horizon");
    const nbf = payload["nbf"]; // C5
    if (nbf !== undefined && (typeof nbf !== "number" || !Number.isFinite(nbf) || !(nbf < now + this.#skewS))) return fail("nbf");
    const iat = payload["iat"]; // C6
    if (iat !== undefined && (typeof iat !== "number" || !Number.isFinite(iat) || iat > now + this.#skewS)) return fail("iat");
    const sub = payload["sub"]; // C7
    if (typeof sub !== "string" || sub.length === 0 || sub.length > 256) return fail("sub");
    return { ok: true, principal: { id: sub } };
  }
}

/** AUTH_JWKS_CA_FILE: a PEM bundle of certificates, read once at start, trusted by the key-set
 *  client alone (never NODE_EXTRA_CA_CERTS, never process-wide). It must be a regular file of at
 *  most 1 MiB holding at least one certificate and nothing else; anything else refuses start. */
export function readCaFile(path: string): string {
  let text: string;
  let fd: number | undefined;
  try {
    // Opened once, without blocking (a FIFO would block a plain open), then judged by the
    // descriptor, so the file cannot be swapped between the check and the read (A9).
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    const st = fstatSync(fd);
    if (!st.isFile()) throw new AuthConfigError(`AUTH_JWKS_CA_FILE is not a regular file: ${path}`);
    const buf = Buffer.alloc(MAX_CA_FILE_BYTES + 1);
    let n = 0;
    for (let r = -1; r !== 0 && n < buf.length; n += r) r = readSync(fd, buf, n, buf.length - n, null);
    if (n > MAX_CA_FILE_BYTES) throw new AuthConfigError("AUTH_JWKS_CA_FILE is larger than 1 MiB");
    text = buf.subarray(0, n).toString("utf8");
  } catch (err) {
    if (err instanceof AuthConfigError) throw err;
    throw new AuthConfigError(`AUTH_JWKS_CA_FILE cannot be read: ${path}`);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  const blocks = text.match(/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g) ?? [];
  const certs = blocks.filter((b) => b.startsWith("-----BEGIN CERTIFICATE-----"));
  // Text between certificates is ignored as commentary, but no other PEM armour, in any case (A5).
  const rest = blocks.reduce((t, b) => t.replace(b, ""), text);
  if (certs.length === 0 || certs.length !== blocks.length || /-----/.test(rest)) throw new AuthConfigError("AUTH_JWKS_CA_FILE must hold PEM certificates and nothing else");
  for (const pem of certs) {
    try {
      new X509Certificate(pem);
    } catch {
      throw new AuthConfigError("AUTH_JWKS_CA_FILE holds a certificate that does not parse");
    }
  }
  return certs.join("\n");
}

/** The verifier from AUTH_* in the environment. A blank issuer, JWKS URL or audience throws. */
export function jwtVerifierFromEnv(env: NodeJS.ProcessEnv = process.env): JwtVerifier {
  // Plain decimal digits only: "0x3c", " 60 ", "6e1" and "60.5" are not a number of seconds (A6).
  const num = (v: string | undefined, d: number): number => (v === undefined || v === "" ? d : /^\d{1,9}$/.test(v) ? Number(v) : Number.NaN);
  const strict = env["AUTH_REQUIRE_AT_JWT"];
  if (strict !== undefined && strict !== "" && strict !== "true" && strict !== "false") throw new AuthConfigError("AUTH_REQUIRE_AT_JWT must be true or false");
  const caFile = env["AUTH_JWKS_CA_FILE"];
  const algs = env["AUTH_ALGS"];
  return new JwtVerifier({
    issuer: env["AUTH_ISSUER"] ?? "",
    jwksUrl: env["AUTH_JWKS_URL"] ?? "",
    audience: env["AUTH_AUDIENCE"] ?? "",
    jwksTtlS: num(env["AUTH_JWKS_TTL_S"], DEFAULT_JWKS_TTL_S),
    clockSkewS: num(env["AUTH_CLOCK_SKEW_S"], DEFAULT_CLOCK_SKEW_S),
    maxTokenLifetimeS: num(env["AUTH_MAX_TOKEN_LIFETIME_S"], DEFAULT_MAX_TOKEN_LIFETIME_S),
    requireAtJwt: strict === "true",
    ...(caFile === undefined || caFile === "" ? {} : { jwksCa: readCaFile(caFile) }),
    ...(algs === undefined || algs === "" ? {} : { algs: algs.split(",").map((a) => a.trim()) }),
  });
}
