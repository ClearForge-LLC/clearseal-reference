// Starts a teaching node (CSR-WO-1007 §1.2, CSR-WO-1007a §1.2): the core's startNode, given the
// edition's two values and nothing else. The core reads the configuration (see .env.example and the
// edition's configSchema) and the manifest the operator names in CLEARSEAL_MANIFEST, and refuses to
// start rather than start unsafe (N4). bin/ imports only the edition's own package entry, by name (the
// entry the supply-boundary check loads), and the core's startNode. The process stays up until it is
// interrupted.

import { startNode } from "@clearseal/core";
import { configSchema, definitions } from "@clearseal/teaching";

const node = await startNode({ definitions, configSchema });
console.log(`teaching node listening on ${node.url}`);
