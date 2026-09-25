// The validation worker (CSR-WO-1005 adversarial finding F2). Validation is synchronous and, for
// some legitimate schema shapes, super-linear. It runs here, off the event loop, so the pool can
// terminate it at the validation deadline: the only way to bound a synchronous JavaScript
// computation. Messages: { id, op: "compile", key, schema } and { id, op: "validate", key, value }.

import { parentPort } from "node:worker_threads";

import { compileSchema } from "./schema.ts";

type Message = { id: number; op: "compile"; key: string; schema: Record<string, unknown> } | { id: number; op: "validate"; key: string; value: unknown };

const compiled = new Map<string, (value: unknown) => boolean>();

parentPort?.on("message", (msg: Message) => {
  try {
    if (msg.op === "compile") {
      compiled.set(msg.key, compileSchema(msg.schema));
      parentPort?.postMessage({ id: msg.id, ok: true, valid: true });
      return;
    }
    const validate = compiled.get(msg.key);
    if (validate === undefined) throw new Error("unknown schema key");
    parentPort?.postMessage({ id: msg.id, ok: true, valid: validate(msg.value) });
  } catch (err) {
    parentPort?.postMessage({ id: msg.id, ok: false, error: err instanceof Error ? err.name : "error" });
  }
});
