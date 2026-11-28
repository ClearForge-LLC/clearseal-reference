// A request that sends its head and the first bytes of its body, then stalls (CSR-WO-2008c §1.1):
// what the server answers, and when, or what it had said when `waitMs` ran out.

import { connect } from "node:net";

export async function stalledRequest(port: number, request: string, waitMs: number): Promise<{ status: string; ms: number }> {
  const t0 = Date.now();
  const sock = connect(port, "127.0.0.1");
  const reply = await new Promise<string>((resolve) => {
    let text = "";
    const timer = setTimeout(() => {
      resolve(text);
    }, waitMs);
    sock.on("data", (d: Buffer) => (text += d.toString("latin1")));
    sock.on("close", () => {
      clearTimeout(timer);
      resolve(text);
    });
    sock.on("error", () => undefined);
    sock.write(request);
  });
  sock.destroy();
  return { status: reply.split("\r\n")[0] ?? "", ms: Date.now() - t0 };
}
