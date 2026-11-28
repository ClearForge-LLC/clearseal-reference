// The validation worker (CSR-WO-1005 adversarial finding F2). Validation is synchronous and, for
// some legitimate schema shapes, super-linear. It runs here, off the event loop, so the pool can
// terminate it at the validation deadline: the only way to bound a synchronous JavaScript
// computation. Messages: { id, op: "compile", key, schema } and { id, op: "validate", key, value }.

import { parentPort } from "node:worker_threads";

import { compileSchemaReporting, type SchemaVerdict } from "./schema.ts";

type Message = { id: number; op: "compile"; key: string; schema: Record<string, unknown> } | { id: number; op: "validate"; key: string; value: unknown };

const compiled = new Map<string, (value: unknown) => SchemaVerdict>();

parentPort?.on("message", (msg: Message) => {
  try {
    if (msg.op === "compile") {
      compiled.set(msg.key, compileSchemaReporting(msg.schema));
      parentPort?.postMessage({ id: msg.id, ok: true, valid: true });
      return;
    }
    const validate = compiled.get(msg.key);
    if (validate === undefined) throw new Error("unknown schema key");
    // CSR-WO-2011: a failing value's failures go back with its verdict (schema.ts SchemaFailure).
    const verdict = validate(msg.value);
    parentPort?.postMessage(verdict === true ? { id: msg.id, ok: true, valid: true } : { id: msg.id, ok: true, valid: false, failures: verdict.failures });
  } catch (err) {
    parentPort?.postMessage({ id: msg.id, ok: false, error: err instanceof Error ? err.name : "error" });
  }
});
