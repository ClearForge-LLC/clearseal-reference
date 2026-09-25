// Option C against the WO §1.2.3 negative list.

import * as C from "../option-c.ts";
import { bodyObject, ALERT_SCHEMA, FIXTURE_PRIVATE_KEY } from "../common.ts";
import { flipLastByteOf, negatives } from "./harness.ts";

negatives<C.DetachedJws>("option C", {
  sign: (input, key = FIXTURE_PRIVATE_KEY) => C.sign(input, key),
  withUnknownField: (input) => C.sign(input, FIXTURE_PRIVATE_KEY, ALERT_SCHEMA, { ...bodyObject(input, ALERT_SCHEMA), priority: "high" }),
  flipSignedByte: (w) => ({ ...w, payload: flipLastByteOf(w.payload, "all clear") }),
  unsigned: (w) => ({ ...w, jws: "" }),
  withLoneSurrogateEscape: (w) => ({ ...w, payload: new TextEncoder().encode(Buffer.from(w.payload).toString("utf8").replace("all clear", "all \\ud800clear")) }),
  verify: (w, allowlist, floor, ctx) => C.verify(w, allowlist, floor, ctx),
});
