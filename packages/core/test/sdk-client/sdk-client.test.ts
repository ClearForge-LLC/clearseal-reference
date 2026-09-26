// CSR-WO-1005b §1.5: the F7 measurement, kept as a regression test. The official SDK client is what a
// `2025-11-25` client is. It is a dev dependency of this package, pinned exactly, and imported here
// only: nothing under src/ may import it, and no runtime dependency names it (eras.test.ts, §1.15).
//
// At 200 the client surfaces the JSON-RPC error as McpError(code, data). At any non-2xx it throws a
// StreamableHTTPError whose `code` is the HTTP status and which carries no `data`. The second test
// serves the identical body at the refusal's modern-era status (400), which is the transport's
// mapping before this WO, and proves that the code and data are lost there.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LATEST_PROTOCOL_VERSION, McpError } from "@modelcontextprotocol/sdk/types.js";

import { BEARER, start, type Started } from "../transport/helpers.ts";

type Fetch = typeof fetch;

/** Serves every JSON-RPC error body that arrives at 200 at `status` instead, byte for byte. */
function errorsAt(status: number): Fetch {
  return async (input, init) => {
    const r = await fetch(input, init);
    if (r.status !== 200 || r.headers.get("content-type") !== "application/json") return r;
    const text = await r.text();
    const isError = (JSON.parse(text) as { error?: unknown }).error !== undefined;
    return new Response(text, { status: isError ? status : 200, headers: r.headers });
  };
}

interface Caught {
  name: string;
  isMcpError: boolean;
  isHttpError: boolean;
  code: unknown;
  data: unknown;
  message: string;
}

async function callMrtrTool(s: Started, fetchFn?: Fetch): Promise<{ negotiated: string | undefined; caught: Caught; onerror: string[] }> {
  const onerror: string[] = [];
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${String(s.t.port)}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${BEARER}` } },
    ...(fetchFn === undefined ? {} : { fetch: fetchFn }),
  });
  const client = new Client({ name: "sdk-client-test", version: "0.0.0" });
  client.onerror = (err): void => {
    onerror.push(err.constructor.name);
  };
  await client.connect(transport);
  try {
    await client.callTool({ name: "ask", arguments: {} });
    assert.fail("the MRTR tool must be refused on the legacy era");
  } catch (err) {
    if (!(err instanceof Error)) throw err;
    const e = err as Error & { code?: unknown; data?: unknown };
    return { negotiated: transport.protocolVersion, caught: { name: e.constructor.name, isMcpError: err instanceof McpError, isHttpError: err instanceof StreamableHTTPError, code: e.code, data: e.data, message: e.message }, onerror };
  } finally {
    await client.close();
  }
}

void describe("WO §1.5 the official SDK client against the legacy era (F7)", () => {
  let s: Started;
  before(async () => {
    s = await start();
  });
  after(async () => {
    await s.close();
  });

  void it("ST-2 at 200 the SDK client receives the JSON-RPC error: McpError, code -32601, data.requires", async () => {
    const { negotiated, caught, onerror } = await callMrtrTool(s);
    console.log(`SDK-CLIENT at 200: negotiated=${String(negotiated)} error=${caught.name} code=${String(caught.code)} data=${JSON.stringify(caught.data)} onerror=${JSON.stringify(onerror)} message=${JSON.stringify(caught.message)}`);
    assert.equal(LATEST_PROTOCOL_VERSION, "2025-11-25", "the pinned SDK is a legacy-era client");
    assert.equal(negotiated, "2025-11-25");
    assert.equal(caught.isMcpError, true, caught.name);
    assert.equal(caught.code, -32601);
    assert.deepEqual(caught.data, { requires: "2026-07-28" });
    assert.deepEqual(onerror, [], "no transport error is raised");
  });

  void it("ST-2 the same body at 400 (the mapping before CSR-WO-1005b): the SDK client loses the code and the data", async () => {
    const { caught, onerror } = await callMrtrTool(s, errorsAt(400));
    console.log(`SDK-CLIENT at 400: error=${caught.name} code=${String(caught.code)} data=${JSON.stringify(caught.data)} onerror=${JSON.stringify(onerror)} message=${JSON.stringify(caught.message)}`);
    assert.equal(caught.isHttpError, true, caught.name);
    assert.equal(caught.isMcpError, false);
    assert.equal(caught.code, 400, "the code is the HTTP status, not -32601");
    assert.equal(caught.data, undefined, "the data is gone");
    assert.deepEqual(onerror, ["StreamableHTTPError"], "the client also raises a transport error");
  });
});
