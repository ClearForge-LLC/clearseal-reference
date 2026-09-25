// CSR-WO-0100 spike: the smallest stateless Streamable HTTP server the pinned SDK permits.
// Loopback only, ephemeral port, one trivial tool, no auth. Never exposed. Not product code.
//
//   node spikes/0100-protocol/server.ts        prints the port it bound, serves until killed

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export interface SpikeServer {
  port: number;
  /** The most HTTP requests this server has had in flight at once (instrumentation for the probe). */
  peakInFlight: () => number;
  close: () => Promise<void>;
}

export interface SpikeOptions {
  /** The SDK's DNS-rebinding option; allowed host and origin are this server's own loopback address. */
  dnsRebindingProtection: boolean;
}

function mcpServer(): Server {
  const server = new Server({ name: "spike-0100", version: "0.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: "echo",
        description: "Returns its input.",
        inputSchema: { type: "object", properties: { text: { type: "string" } } },
      },
      {
        name: "sleep",
        description: "Waits `ms` milliseconds, then returns; lets the probe hold requests in flight.",
        inputSchema: { type: "object", properties: { ms: { type: "number" } } },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "sleep") {
      const ms = Number(request.params.arguments?.["ms"] ?? 0);
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
    return { content: [{ type: "text", text: JSON.stringify(request.params.arguments ?? {}) }] };
  });
  return server;
}

/** Starts the server on 127.0.0.1 and an ephemeral port. Stateless: a fresh server and transport per request. */
export async function startServer(options: SpikeOptions): Promise<SpikeServer> {
  let port = 0;
  let inFlight = 0;
  let peak = 0;
  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    res.on("close", () => inFlight--);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      ...(options.dnsRebindingProtection
        ? {
            enableDnsRebindingProtection: true,
            allowedHosts: [`127.0.0.1:${String(port)}`],
            allowedOrigins: [`http://127.0.0.1:${String(port)}`],
          }
        : {}),
    });
    const server = mcpServer();
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    server
      .connect(transport)
      .then(() => transport.handleRequest(req, res))
      .catch((err: unknown) => {
        if (!res.headersSent) res.writeHead(500).end(String(err));
      });
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", () => resolve());
  });
  port = (http.address() as AddressInfo).port;
  return {
    port,
    peakInFlight: () => peak,
    close: () => new Promise<void>((resolve) => http.close(() => resolve())),
  };
}

if (import.meta.main) {
  const s = await startServer({ dnsRebindingProtection: false });
  console.log(`spike-0100 server listening on 127.0.0.1:${String(s.port)} (stateless, loopback only)`);
}
