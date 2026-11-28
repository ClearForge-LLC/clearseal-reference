// A validation worker that acknowledges its schemas and exits on the first job, with no error event
// (CSR-WO-1005c adversarial pass).

import { parentPort } from "node:worker_threads";

parentPort?.on("message", (msg: { id: number; op: string }) => {
  if (msg.op === "compile") parentPort?.postMessage({ id: msg.id, ok: true, valid: true });
  else process.exit(1);
});
