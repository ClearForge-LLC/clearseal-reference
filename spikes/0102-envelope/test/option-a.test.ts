// Option A against the WO §1.2.3 negative list.

import * as A from "../option-a.ts";
import { FIXTURE_PRIVATE_KEY } from "../common.ts";
import { flipLastByteOf, negatives } from "./harness.ts";

const text = (w: Uint8Array): string => Buffer.from(w).toString("utf8");
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

negatives<Uint8Array>("option A", {
  sign: async (input, key = FIXTURE_PRIVATE_KEY) => Promise.resolve(A.sign(input, key)),
  withUnknownField: async (input) => {
    const wire = JSON.parse(text(A.sign(input, FIXTURE_PRIVATE_KEY))) as { envelope: Record<string, unknown> };
    wire.envelope["priority"] = "high";
    return Promise.resolve(bytes(JSON.stringify(wire)));
  },
  flipSignedByte: (w) => flipLastByteOf(w, "all clear"),
  unsigned: (w) => {
    const wire = JSON.parse(text(w)) as Record<string, unknown>;
    delete wire["signature"];
    return bytes(JSON.stringify(wire));
  },
  withLoneSurrogateEscape: (w) => bytes(text(w).replace("all clear", "all \\ud800clear")),
  verify: (w, allowlist, floor, ctx) => Promise.resolve(A.verify(w, allowlist, floor, ctx)),
});
