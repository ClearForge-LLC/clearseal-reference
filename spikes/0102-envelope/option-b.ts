// CSR-WO-0102 option B: RFC 9421 HTTP message signatures over a POST whose JSON body is the payload.
// Covered components: @method, @authority, @path, content-type, content-digest (RFC 9530, sha-256),
// with parameters created, expires, nonce, keyid, alg and tag, in that order. Signing uses the
// library; verification rebuilds the signature base with the library's own functions but does
// every check itself, because the library's verifyMessage reads the clock from Date.now(), returns
// null (not false) for an unsigned message, and passes when any one of several signatures is valid.

import { createHash, sign as edSign, verify as edVerify, type KeyObject } from "node:crypto";

import { httpbis } from "http-message-signatures";
import { isInnerList, parseDictionary, serializeList, type Dictionary, type InnerList, type Item } from "structured-headers";

import {
  accept,
  ALERT_SCHEMA,
  type Alert,
  type Allowlist,
  assertWellFormed,
  type Body,
  bodyObject,
  type Effect,
  freshAndUnseen,
  gateAuthor,
  gateEffect,
  ID_RE,
  isTime,
  NONCE_RE,
  PAST_WINDOW,
  parseBody,
  parseJsonBytes,
  type PayloadSchema,
  refuse,
  selectKey,
  type SignInput,
  type Verdict,
  type VerifyContext,
} from "./common.ts";

export const TARGET = "https://receiver.example/v1/provenance";
export const LABEL = "sig1";
export const TAG = "clearseal-class5-v1";
export const COMPONENTS = ["@method", "@authority", "@path", "content-type", "content-digest"] as const;
const PARAMS = ["created", "expires", "nonce", "keyid", "alg", "tag"] as const;

export interface RequestB {
  method: string;
  url: string;
  headers: Record<string, string | string[]>;
  body: Uint8Array;
}

const utf8 = new TextEncoder();

function contentDigest(body: Uint8Array): string {
  return `sha-256=:${createHash("sha256").update(body).digest("base64")}:`;
}

/** Signs; throws SerializationRefusal on a lone surrogate. `body` overrides the serialized body so
 *  tests can sign what the verifier must refuse. */
export async function sign<P = Alert>(
  input: SignInput<P>,
  key: KeyObject,
  schema: PayloadSchema<P> = ALERT_SCHEMA as unknown as PayloadSchema<P>,
  body: Record<string, unknown> = bodyObject(input, schema),
): Promise<RequestB> {
  assertWellFormed(body, "body");
  assertWellFormed([input.key_id, input.nonce], "signature parameters");
  const bytes = utf8.encode(JSON.stringify(body));
  const request = {
    method: "POST",
    url: TARGET,
    headers: { "content-type": "application/json", "content-digest": contentDigest(bytes) } as Record<string, string | string[]>,
  };
  const signed = await httpbis.signMessage(
    {
      key: { id: input.key_id, alg: "ed25519", sign: (data: Buffer) => Promise.resolve(edSign(null, data, key)) },
      name: LABEL,
      params: [...PARAMS],
      fields: [...COMPONENTS],
      paramValues: {
        created: new Date(input.issued_at * 1000),
        expires: new Date((input.issued_at + PAST_WINDOW) * 1000),
        nonce: input.nonce,
        keyid: input.key_id,
        alg: "ed25519",
        tag: TAG,
      },
    },
    request,
  );
  return { ...signed, body: bytes };
}

/** HTTP/1.1 bytes of a request: what travels, for wire size and the byte-identity check. */
export function toHttp1(req: RequestB): Uint8Array {
  const url = new URL(req.url);
  const lines = [`${req.method} ${url.pathname}${url.search} HTTP/1.1`, `Host: ${url.host}`];
  for (const [name, value] of Object.entries(req.headers)) for (const v of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${v}`);
  lines.push(`Content-Length: ${String(req.body.length)}`, "", "");
  return Buffer.concat([utf8.encode(lines.join("\r\n")), req.body]);
}

/** The one header of this name, case-insensitively; undefined when absent or present twice. */
function onlyHeader(headers: Record<string, string | string[]>, name: string): { value?: string; count: number } {
  const found = Object.entries(headers).filter(([n]) => n.toLowerCase() === name);
  const values = found.flatMap(([, v]) => (Array.isArray(v) ? v : [v]));
  return values.length === 1 ? { value: values[0], count: 1 } : { count: values.length };
}

function onlyMember(dict: Dictionary): [string, Item | InnerList] | undefined {
  return dict.size === 1 ? [...dict.entries()][0] : undefined;
}

export interface AcceptedB<P> {
  body: Body<P>;
  keyid: string;
  created: number;
  nonce: string;
}

export function verify<P = Alert>(
  wire: RequestB,
  allowlist: Allowlist,
  floor: Effect,
  ctx: VerifyContext,
  schema: PayloadSchema<P> = ALERT_SCHEMA as unknown as PayloadSchema<P>,
): Verdict<AcceptedB<P>> {
  // ---- structure ----
  const sigInput = onlyHeader(wire.headers, "signature-input");
  const sigHeader = onlyHeader(wire.headers, "signature");
  if (sigInput.count === 0 && sigHeader.count === 0) return refuse("structure", "unsigned", "no Signature or Signature-Input header");
  if (sigInput.value === undefined || sigHeader.value === undefined) return refuse("structure", "duplicate-header", "Signature and Signature-Input must each appear exactly once");
  for (const name of ["content-type", "content-digest"]) {
    if (onlyHeader(wire.headers, name).value === undefined) return refuse("structure", "duplicate-header", `${name} must appear exactly once`);
  }
  let inputs: Dictionary;
  let sigs: Dictionary;
  let digests: Dictionary;
  try {
    inputs = parseDictionary(sigInput.value);
    sigs = parseDictionary(sigHeader.value);
    digests = parseDictionary(onlyHeader(wire.headers, "content-digest").value as string);
  } catch (err) {
    return refuse("structure", "malformed", `structured field: ${String(err)}`);
  }
  const inputMember = onlyMember(inputs);
  const sigMember = onlyMember(sigs);
  if (inputMember === undefined || sigMember === undefined || inputMember[0] !== LABEL || sigMember[0] !== LABEL) {
    return refuse("structure", "label", `exactly one signature, labelled ${LABEL}`);
  }
  const input = inputMember[1];
  if (!isInnerList(input)) return refuse("structure", "malformed", "signature input is not an inner list");
  const [items, params] = input;
  const covered = items.map(([v, p]) => (typeof v === "string" && p.size === 0 ? v : null));
  if (covered.length !== COMPONENTS.length || covered.some((c, i) => c !== COMPONENTS[i])) {
    return refuse("structure", "components", `covered components must be exactly ${COMPONENTS.join(" ")}`);
  }
  const paramNames = [...params.keys()];
  const unknownParam = paramNames.find((n) => !(PARAMS as readonly string[]).includes(n));
  if (unknownParam !== undefined) return refuse("structure", "unknown-field", `unknown signature parameter "${unknownParam}"`);
  if (paramNames.length !== PARAMS.length) return refuse("structure", "missing-field", "every signature parameter is required");
  const created = params.get("created");
  const expires = params.get("expires");
  const nonce = params.get("nonce");
  const keyid = params.get("keyid");
  if (!isTime(created) || !isTime(expires)) return refuse("structure", "field", "created and expires are integers");
  if (typeof nonce !== "string" || !NONCE_RE.test(nonce)) return refuse("structure", "field", "nonce");
  if (typeof keyid !== "string" || !ID_RE.test(keyid)) return refuse("structure", "field", "keyid");
  if (params.get("alg") !== "ed25519") return refuse("structure", "field", "alg must be the string ed25519");
  if (params.get("tag") !== TAG) return refuse("structure", "field", `tag must be ${TAG}`);
  const sigValue = sigMember[1];
  const sig = !isInnerList(sigValue) && sigValue[0] instanceof ArrayBuffer && sigValue[1].size === 0 ? new Uint8Array(sigValue[0]) : undefined;
  if (sig?.length !== 64) return refuse("structure", "signature-encoding", "signature is not a 64-byte byte sequence");
  const digestMember = onlyMember(digests);
  const digest = digestMember?.[0] === "sha-256" && !isInnerList(digestMember[1]) && digestMember[1][0] instanceof ArrayBuffer ? new Uint8Array(digestMember[1][0]) : undefined;
  if (digest?.length !== 32) return refuse("structure", "field", "content-digest must be exactly one sha-256 byte sequence");
  const parsed = parseBody(parseJsonBytes(wire.body), schema);
  if (!parsed.ok) return refuse("structure", parsed.check, parsed.why);
  const { body } = parsed;

  // ---- gate 1: signature ----
  const key = selectKey(allowlist, keyid, ctx.now);
  if (!key.ok) return refuse("signature", key.check, key.why);
  let base: string;
  try {
    const fields = httpbis.createSignatureBase({ fields: [...COMPONENTS] }, wire);
    fields.push(['"@signature-params"', [serializeList([input])]]);
    base = httpbis.formatSignatureBase(fields);
  } catch (err) {
    return refuse("signature", "base", `signature base: ${String(err)}`);
  }
  if (!edVerify(null, utf8.encode(base), key.entry.public_key, sig)) return refuse("signature", "bad-signature", "signature does not verify over the signature base");
  if (!Buffer.from(digest).equals(createHash("sha256").update(wire.body).digest())) return refuse("signature", "body-digest", "body does not match the signed content-digest");
  if (expires > created + PAST_WINDOW) return refuse("signature", "expires", "expires is later than the freshness window allows");
  if (ctx.now > expires) return refuse("signature", "stale", "past expires");
  const stale = freshAndUnseen(created, nonce, ctx);
  if (stale !== null) return refuse("signature", stale.check, stale.why);

  // ---- gate 2: author ----
  const author = gateAuthor(allowlist, body.sender_id, key.entry);
  if (author !== null) return refuse("author", author.check, author.why);

  // ---- gate 3: effect ----
  const effect = gateEffect(schema.effect(body.payload), floor);
  if (effect !== null) return refuse("effect", effect.check, effect.why);

  return accept({ body, keyid, created, nonce }, nonce, created, ctx);
}
