// Option B against the WO §1.2.3 negative list.

import { createHash } from "node:crypto";

import * as B from "../option-b.ts";
import { bodyObject, ALERT_SCHEMA, FIXTURE_PRIVATE_KEY } from "../common.ts";
import { flipLastByteOf, negatives } from "./harness.ts";

/** The same request with a new body and a content-digest recomputed to match it. */
function withBody(w: B.RequestB, body: Uint8Array): B.RequestB {
  return { ...w, body, headers: { ...w.headers, "content-digest": `sha-256=:${createHash("sha256").update(body).digest("base64")}:` } };
}

negatives<B.RequestB>("option B", {
  sign: (input, key = FIXTURE_PRIVATE_KEY) => B.sign(input, key),
  withUnknownField: (input) => B.sign(input, FIXTURE_PRIVATE_KEY, ALERT_SCHEMA, { ...bodyObject(input, ALERT_SCHEMA), priority: "high" }),
  // The body changes by one byte and its digest is recomputed, so the signed base differs only in
  // the content-digest line: the signature no longer covers what is presented.
  flipSignedByte: (w) => withBody(w, flipLastByteOf(w.body, "all clear")),
  unsigned: (w) => {
    const headers = { ...w.headers };
    delete headers["Signature"];
    delete headers["Signature-Input"];
    return { ...w, headers };
  },
  withLoneSurrogateEscape: (w) => withBody(w, new TextEncoder().encode(Buffer.from(w.body).toString("utf8").replace("all clear", "all \\ud800clear"))),
  verify: (w, allowlist, floor, ctx) => Promise.resolve(B.verify(w, allowlist, floor, ctx)),
});
