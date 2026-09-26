// A self-signed ECDSA P-256 certificate for the in-process test issuer, built with node:crypto and
// a minimal DER encoder: no dependency, and no shell-out. Test code only. The key is generated per
// run and never written to disk (N8).

import { createSign, generateKeyPairSync, randomBytes } from "node:crypto";

const len = (n: number): Buffer => (n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]));
const tlv = (tag: number, body: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...parts: Buffer[]): Buffer => tlv(0x30, Buffer.concat(parts));
const set = (...parts: Buffer[]): Buffer => tlv(0x31, Buffer.concat(parts));
/** An OID from its arcs, given as numbers (a dotted string would read as an address to the leak gate). */
const oid = (arcs: readonly [number, number, ...number[]]): Buffer => {
  const [a, b, ...rest] = arcs;
  const bytes = [a * 40 + b];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    for (let v = n >> 7; v > 0; v >>= 7) chunk.unshift((v & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
};
const utf8 = (s: string): Buffer => tlv(0x0c, Buffer.from(s, "utf8"));
const time = (d: Date): Buffer => tlv(0x17, Buffer.from(`${d.toISOString().slice(2, 19).replace(/[-:T]/g, "")}Z`, "ascii"));
const ECDSA_SHA256 = seq(oid([1, 2, 840, 10045, 4, 3, 2]));

export interface TestCert {
  keyPem: string;
  certPem: string;
}

/** A self-signed certificate for 127.0.0.1 and localhost, valid from an hour ago for a day. */
export function selfSigned(): TestCert {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  // A unique subject per certificate: TLS finds a trust anchor by subject name, so two test issuers
  // sharing one would leave the second untrusted even with both in the bundle (adversarial A3).
  const name = seq(set(seq(oid([2, 5, 4, 3]), utf8(`clearseal-test-issuer-${randomBytes(8).toString("hex")}`))));
  const now = Date.now();
  const san = seq(tlv(0x82, Buffer.from("localhost", "ascii")), tlv(0x87, Buffer.from([127, 0, 0, 1])));
  const extensions = tlv(0xa3, seq(
    seq(oid([2, 5, 29, 19]), tlv(0x01, Buffer.from([0xff])), tlv(0x04, seq(tlv(0x01, Buffer.from([0xff]))))),
    seq(oid([2, 5, 29, 17]), tlv(0x04, san)),
  ));
  const tbs = seq(
    tlv(0xa0, tlv(0x02, Buffer.from([2]))),
    tlv(0x02, Buffer.concat([Buffer.from([0x01]), randomBytes(8)])),
    ECDSA_SHA256,
    name,
    seq(time(new Date(now - 3_600_000)), time(new Date(now + 86_400_000))),
    name,
    publicKey.export({ type: "spki", format: "der" }),
    extensions,
  );
  const signature = createSign("sha256").update(tbs).sign(privateKey);
  const der = seq(tbs, ECDSA_SHA256, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const certPem = `-----BEGIN CERTIFICATE-----\n${der.toString("base64").replace(/.{64}/g, "$&\n")}\n-----END CERTIFICATE-----\n`.replace("\n\n", "\n");
  return { keyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string, certPem };
}
