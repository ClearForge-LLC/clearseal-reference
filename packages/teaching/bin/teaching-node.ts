// Starts a teaching node from the environment (see .env.example and the edition's configSchema).
// ClearSeal: the node refuses to start rather than start unsafe (N4); the process stays up until
// interrupted, then closes the transport.

import { start } from "../src/index.ts";

const node = await start();
console.log(`teaching node listening on ${node.url}`);
const stop = (): void => {
  void node.close().then(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
