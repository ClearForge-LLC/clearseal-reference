// CSR-WO-2004 §1.2: the one ProvenanceSigner implementation, for tests only — the fake fixture key of
// CSR-WO-0102 §1.1. The seed is written as a byte pattern (eight 0x00, eight 0xd0, eight 0x0d, eight
// 0x00) so the leak gate's long-hex rule holds; every identifier here is fake and looks it.

import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject, sign } from "node:crypto";

import type { ProvenanceKeyData } from "../../src/provenance/allowlist.ts";
import type { ProvenanceSigner } from "../../src/provenance/signer.ts";

const PKCS8_ED25519 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);

export function fixtureSeed(): Uint8Array {
  return Uint8Array.from([...Array<number>(8).fill(0x00), ...Array<number>(8).fill(0xd0), ...Array<number>(8).fill(0x0d), ...Array<number>(8).fill(0x00)]);
}

export const FIXTURE_PRIVATE_KEY: KeyObject = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, fixtureSeed()]), format: "der", type: "pkcs8" });
export const FIXTURE_PUBLIC_KEY: KeyObject = createPublicKey(FIXTURE_PRIVATE_KEY);
/** CSR-WO-0102 §1.1: the fixture key's public key, base64 of the raw 32 bytes. */
export const FIXTURE_PUBLIC_RAW_B64 = "qikRoPRLUGmP2QuEpKRSJLhCB33v3l7Hcoi8vK6tTtY=";

export const KID = "test-fixture-key";
export const SENDER = "node.alerter-example";
export const OTHER_SENDER = "node.other-example";
export const OTHER_KID = "test-other-key";
export const NOW = 1_787_700_000;
export const CHANNEL = { name: "test-channel", authors: [SENDER], floor: "info" } as const;

/** A signer over a private key; the fixture key unless another is given. */
export function keySigner(kid: string, key: KeyObject = FIXTURE_PRIVATE_KEY): ProvenanceSigner {
  return { kid, sign: (bytes) => Promise.resolve(new Uint8Array(sign(null, bytes, key))) };
}

export const fixtureSigner: ProvenanceSigner = keySigner(KID);

/** A fresh Ed25519 key pair, for a second author or a wrong key. */
export function otherKeyPair(): { privateKey: KeyObject; publicKey: KeyObject } {
  return generateKeyPairSync("ed25519");
}

export function entry(over: Partial<ProvenanceKeyData> = {}): ProvenanceKeyData {
  return { kid: KID, sender_id: SENDER, publicKey: FIXTURE_PUBLIC_KEY.export({ format: "pem", type: "spki" }).toString(), notBefore: NOW - 86_400, notAfter: NOW + 86_400, ...over };
}
