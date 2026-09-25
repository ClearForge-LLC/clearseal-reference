// CSR-WO-0102 option C: a detached JWS (RFC 7515 compact serialization, payload detached per its
// appendix F), alg EdDSA. The protected header carries kid and the claims iat, exp and jti, plus
// typ for domain separation; the payload is the same JSON body option B carries. Signing and the
// signature check use jose; the header, claims and body checks are this module's.

import type { KeyObject } from "node:crypto";

import { CompactSign, compactVerify, errors as joseErrors } from "jose";

import {
  accept,
  ALERT_SCHEMA,
  type Alert,
  type Allowlist,
  assertWellFormed,
  type Body,
  bodyObject,
  type Effect,
  exactKeys,
  freshAndUnseen,
  gateAuthor,
  gateEffect,
  ID_RE,
  isPlainObject,
  isTime,
  NONCE_RE,
  PAST_WINDOW,
  parseBody,
  parseJsonBytes,
  type PayloadSchema,
  refuse,
  selectKey,
  type SignInput,
  strictBase64,
  type Verdict,
  type VerifyContext,
} from "./common.ts";

export const TYP = "clearseal-class5+jws";
const HEADER_KEYS = ["alg", "typ", "kid", "iat", "exp", "jti"] as const;

export interface DetachedJws {
  /** `<protected header>..<signature>`: compact serialization with the payload segment empty. */
  jws: string;
  /** The detached payload bytes, carried beside the token. */
  payload: Uint8Array;
}

const utf8 = new TextEncoder();

/** Signs; throws SerializationRefusal on a lone surrogate. `body` and `header` override the
 *  defaults so tests can sign what the verifier must refuse. */
export async function sign<P = Alert>(
  input: SignInput<P>,
  key: KeyObject,
  schema: PayloadSchema<P> = ALERT_SCHEMA as unknown as PayloadSchema<P>,
  body: Record<string, unknown> = bodyObject(input, schema),
  header: Record<string, unknown> = { alg: "EdDSA", typ: TYP, kid: input.key_id, iat: input.issued_at, exp: input.issued_at + PAST_WINDOW, jti: input.nonce },
): Promise<DetachedJws> {
  assertWellFormed(body, "body");
  assertWellFormed(header, "header");
  const payload = utf8.encode(JSON.stringify(body));
  const compact = await new CompactSign(payload).setProtectedHeader(header as { alg: string }).sign(key);
  const [h, , s] = compact.split(".");
  return { jws: `${h ?? ""}..${s ?? ""}`, payload };
}

/** Bytes that travel: the token, a newline, then the payload (for wire size and byte identity). */
export function toWireBytes(w: DetachedJws): Uint8Array {
  return Buffer.concat([utf8.encode(`${w.jws}\n`), w.payload]);
}

class KeyRefusal extends Error {
  readonly check: string;
  constructor(check: string, why: string) {
    super(why);
    this.check = check;
  }
}

export interface AcceptedC<P> {
  body: Body<P>;
  header: { kid: string; iat: number; exp: number; jti: string };
}

export async function verify<P = Alert>(
  wire: DetachedJws,
  allowlist: Allowlist,
  floor: Effect,
  ctx: VerifyContext,
  schema: PayloadSchema<P> = ALERT_SCHEMA as unknown as PayloadSchema<P>,
): Promise<Verdict<AcceptedC<P>>> {
  // ---- structure ----
  if (typeof wire.jws !== "string" || wire.jws === "") return refuse("structure", "unsigned", "no token");
  const parts = wire.jws.split(".");
  if (parts.length !== 3 || parts[1] !== "") return refuse("structure", "malformed", "not a detached compact JWS (header..signature)");
  const [h = "", , s = ""] = parts;
  const headerBytes = strictBase64(h, true);
  const header = headerBytes === undefined ? undefined : parseJsonBytes(headerBytes);
  if (!isPlainObject(header)) return refuse("structure", "malformed", "protected header is not canonical base64url of a JSON object");
  const headerBad = exactKeys(header, HEADER_KEYS);
  if (headerBad !== null) return refuse("structure", headerBad.startsWith("unknown") ? "unknown-field" : "missing-field", `header: ${headerBad}`);
  const { typ, kid, iat, exp, jti } = header;
  // jose's `algorithms` option also enforces this; checked here too so the refusal does not rest
  // on a library option a caller could omit (adversarial pass: without it, HS256 keyed with the
  // raw public key verifies).
  if (header["alg"] !== "EdDSA") return refuse("structure", "field", "alg must be EdDSA");
  if (typ !== TYP) return refuse("structure", "field", `typ must be ${TYP}`);
  if (typeof kid !== "string" || !ID_RE.test(kid)) return refuse("structure", "field", "kid");
  if (!isTime(iat) || !isTime(exp)) return refuse("structure", "field", "iat and exp are integers");
  if (typeof jti !== "string" || !NONCE_RE.test(jti)) return refuse("structure", "field", "jti");
  if (strictBase64(s, true)?.length !== 64) return refuse("structure", "signature-encoding", "signature is not canonical base64url of 64 bytes");
  const parsed = parseBody(parseJsonBytes(wire.payload), schema);
  if (!parsed.ok) return refuse("structure", parsed.check, parsed.why);
  const { body } = parsed;

  // ---- gate 1: signature ----
  const attached = `${h}.${Buffer.from(wire.payload).toString("base64url")}.${s}`;
  let entryKid: string;
  try {
    const result = await compactVerify(
      attached,
      (protectedHeader) => {
        const key = selectKey(allowlist, String(protectedHeader.kid), ctx.now);
        if (!key.ok) throw new KeyRefusal(key.check, key.why);
        return key.entry.public_key;
      },
      { algorithms: ["EdDSA"] },
    );
    entryKid = String(result.protectedHeader.kid);
  } catch (err) {
    if (err instanceof KeyRefusal) return refuse("signature", err.check, err.message);
    const code = err instanceof joseErrors.JOSEError ? err.code : String(err);
    return refuse("signature", "bad-signature", code);
  }
  const key = selectKey(allowlist, entryKid, ctx.now);
  if (!key.ok) return refuse("signature", key.check, key.why);
  if (exp > iat + PAST_WINDOW) return refuse("signature", "expires", "exp is later than the freshness window allows");
  if (ctx.nonces.clock(ctx.now) >= exp) return refuse("signature", "stale", "at or past exp");
  const stale = freshAndUnseen(iat, jti, ctx);
  if (stale !== null) return refuse("signature", stale.check, stale.why);

  // ---- gate 2: author ----
  const author = gateAuthor(allowlist, body.sender_id, key.entry);
  if (author !== null) return refuse("author", author.check, author.why);

  // ---- gate 3: effect ----
  const effect = gateEffect(schema.effect(body.payload), floor);
  if (effect !== null) return refuse("effect", effect.check, effect.why);

  return accept({ body, header: { kid, iat, exp, jti } }, jti, iat, ctx);
}
