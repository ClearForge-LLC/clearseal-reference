// First test (WO §1.1): the fixture keypair derived from the byte-pattern seed has the stated
// public key. Named 00- so the runner, which sorts files, runs it first.

import assert from "node:assert/strict";
import { test } from "node:test";

import { FIXTURE_PUBLIC_KEY, fixtureSeed, rawPublicKey } from "../common.ts";

void test("fixture: seed 8×0x00 ‖ 8×0xd0 ‖ 8×0x0d ‖ 8×0x00 derives the WO's stated public key", () => {
  const seed = fixtureSeed();
  assert.equal(seed.length, 32);
  assert.deepEqual([...seed.subarray(0, 8)], Array<number>(8).fill(0x00));
  assert.deepEqual([...seed.subarray(8, 16)], Array<number>(8).fill(0xd0));
  assert.deepEqual([...seed.subarray(16, 24)], Array<number>(8).fill(0x0d));
  assert.deepEqual([...seed.subarray(24, 32)], Array<number>(8).fill(0x00));
  assert.equal(Buffer.from(rawPublicKey(FIXTURE_PUBLIC_KEY)).toString("base64"), "qikRoPRLUGmP2QuEpKRSJLhCB33v3l7Hcoi8vK6tTtY=");
});
