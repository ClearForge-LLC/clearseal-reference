// A validation worker that comes online and never answers (CSR-WO-1005c): it acknowledges no schema
// and no job, as a worker that hangs while priming would.

import { parentPort } from "node:worker_threads";

parentPort?.on("message", () => undefined);
