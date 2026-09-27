// Starts a teaching node (CSR-WO-1007 §1.2): the core's startNode, given the edition's three values
// and nothing else. The core reads the configuration (see .env.example and the edition's
// configSchema) and the committed manifest, and refuses to start rather than start unsafe (N4). The
// process stays up until it is interrupted.

import { startNode } from "@clearseal/core";

import { configSchema, definitions, manifestPath } from "../src/index.ts";

const node = await startNode({ definitions, manifestPath, configSchema });
console.log(`teaching node listening on ${node.url}`);
