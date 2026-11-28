// The core's conformance fixture server (packages/core/test/conformance/fixture-server.ts), started
// for one run of probe.ts or conformance.ts and stopped by the caller.

import { spawn } from "node:child_process";
import { join } from "node:path";

export async function startFixture(port: string): Promise<{ url: string; stop: () => void }> {
  const server = spawn(process.execPath, [join(new URL(".", import.meta.url).pathname, "../../packages/core/test/conformance/fixture-server.ts"), port], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise<void>((resolve, reject) => {
    server.stdout.on("data", (d: Buffer) => {
      if (d.toString().includes("listening")) resolve();
    });
    server.once("exit", (code) => {
      reject(new Error(`fixture server exited ${String(code)}`));
    });
  });
  return { url: `http://127.0.0.1:${port}/mcp`, stop: () => server.kill() };
}
