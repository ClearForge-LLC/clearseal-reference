// A validation worker that acknowledges the first schema it is sent and then hangs (CSR-WO-1005c
// adversarial pass): ready once, it never becomes ready again when a schema registered later arrives.

import { parentPort } from "node:worker_threads";

let answered = false;
parentPort?.on("message", (msg: { id: number }) => {
  if (answered) return;
  answered = true;
  parentPort?.postMessage({ id: msg.id, ok: true, valid: true });
});
