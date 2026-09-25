// A fixture server for the MCP conformance suite (modelcontextprotocol/conformance). It starts the
// real transport on loopback with the fixture tools the suite's server scenarios call, mirroring
// the behaviour of the suite's reference "everything" server for those tools. Nothing here ships.
//
//   node packages/core/test/conformance/fixture-server.ts [port]     (or CONFORMANCE_PORT; default 3999)
//
// Out of scope, deliberately not faked: resources, prompts, completion, logging, SSE (so no
// progress tool), subscriptions/listen, tasks.

import { randomBytes } from "node:crypto";

import { DEFAULT_LIMITS } from "../../src/transport/config.ts";
import type { JsonValue } from "../../src/transport/json.ts";
import { type CallContext, PlaceholderRegistry, type Tool, type ToolResult } from "../../src/transport/registry.ts";
import { compileSchema } from "../../src/transport/schema.ts";
import { startTransport } from "../../src/transport/server.ts";
import type { Verdict, Verifier } from "../../src/transport/verifier.ts";

/** TEST-ONLY. Admits every request as one synthetic principal, because the conformance suite has
 *  no way to send an Authorization header. It exists only for the conformance run and is never
 *  shipped or exported from src/. */
class ConformanceAdmitAllVerifier implements Verifier {
  verify(): Promise<Verdict> {
    return Promise.resolve({ ok: true, principal: { id: "conformance" } });
  }
}

// The suite's own 1x1 PNG and minimal WAV (examples/servers/typescript/everything-server.ts).
const IMAGE_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
const AUDIO_WAV = "UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAA=";

const NO_ARGS = { type: "object", properties: {} } as const;

type InputRequests = Extract<ToolResult, { resultType: "input_required" }>["inputRequests"];

const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });

const ask = (inputRequests: InputRequests, state?: JsonValue): Promise<ToolResult> =>
  Promise.resolve({ resultType: "input_required", inputRequests, ...(state === undefined ? {} : { state }) });

const elicit = (message: string, property: string, type = "string"): { method: string; params: Record<string, unknown> } => ({
  method: "elicitation/create",
  params: { message, requestedSchema: { type: "object", properties: { [property]: { type } }, required: [property] } },
});

const sample = (prompt: string, maxTokens: number): { method: string; params: Record<string, unknown> } => ({
  method: "sampling/createMessage",
  params: { messages: [{ role: "user", content: { type: "text", text: prompt } }], maxTokens },
});

const roots = { method: "roots/list", params: {} };

/** An inputResponses entry that is an accepted ElicitResult: `{ action: "accept", content: {...} }`. */
function accepted(ctx: CallContext, key: string): Record<string, unknown> | undefined {
  const r = ctx.inputResponses?.[key];
  if (typeof r !== "object" || r === null) return undefined;
  const { action, content } = r as { action?: unknown; content?: unknown };
  if (action !== "accept" || typeof content !== "object" || content === null) return undefined;
  return content as Record<string, unknown>;
}

function present(ctx: CallContext, key: string): Record<string, unknown> | undefined {
  const r = ctx.inputResponses?.[key];
  return typeof r === "object" && r !== null ? (r as Record<string, unknown>) : undefined;
}

function stateKind(ctx: CallContext): Record<string, unknown> | undefined {
  const s = ctx.state;
  return typeof s === "object" && s !== null && !Array.isArray(s) ? s : undefined;
}

const has = (caps: Record<string, unknown>, name: string): boolean => Object.hasOwn(caps, name);

export function conformanceTools(): Tool[] {
  return [
    // http-header-validation probes the FIRST listed tool with `arguments: {}`. tools/list is sorted
    // by name (TL-3), so this tool is named to sort first and accepts an empty call; otherwise the
    // probe lands on json_schema_2020_12_tool, whose schema rightly refuses `{}`.
    {
      name: "basic_no_args",
      description: "Takes no arguments and returns a fixed text (header-validation probe target)",
      inputSchema: NO_ARGS,
      handler: () => Promise.resolve(text("ok")),
    },

    // ── Content scenarios (tools-call-*) ─────────────────────────────────────────────────────────
    {
      name: "test_simple_text",
      description: "Tests simple text content response",
      inputSchema: NO_ARGS,
      handler: () => Promise.resolve(text("This is a simple text response for testing.")),
    },
    {
      name: "test_image_content",
      description: "Tests image content response",
      inputSchema: NO_ARGS,
      handler: () => Promise.resolve({ content: [{ type: "image", data: IMAGE_PNG, mimeType: "image/png" }] }),
    },
    {
      name: "test_audio_content",
      description: "Tests audio content response",
      inputSchema: NO_ARGS,
      handler: () => Promise.resolve({ content: [{ type: "audio", data: AUDIO_WAV, mimeType: "audio/wav" }] }),
    },
    {
      name: "test_embedded_resource",
      description: "Tests embedded resource content response",
      inputSchema: NO_ARGS,
      handler: () =>
        Promise.resolve({ content: [{ type: "resource", resource: { uri: "test://embedded-resource", mimeType: "text/plain", text: "This is an embedded resource content." } }] }),
    },
    {
      name: "test_multiple_content_types",
      description: "Tests response with multiple content types (text, image, resource)",
      inputSchema: NO_ARGS,
      handler: () =>
        Promise.resolve({
          content: [
            { type: "text", text: "Multiple content types test:" },
            { type: "image", data: IMAGE_PNG, mimeType: "image/png" },
            { type: "resource", resource: { uri: "test://mixed-content-resource", mimeType: "application/json", text: JSON.stringify({ test: "data", value: 123 }) } },
          ],
        }),
    },
    {
      name: "test_error_handling",
      description: "Tests error response handling",
      inputSchema: NO_ARGS,
      // A tool execution error (isError), not a JSON-RPC error: what the reference's thrown error becomes.
      handler: () => Promise.resolve({ content: [{ type: "text", text: "This tool intentionally returns an error for testing" }], isError: true }),
    },

    // ── JSON Schema 2020-12 (json-schema-2020-12), the suite's exact fixture schema ───────────────
    {
      name: "json_schema_2020_12_tool",
      description: "Tool with JSON Schema 2020-12 features for conformance testing (SEP-1613)",
      inputSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        $defs: { address: { $anchor: "addressDef", type: "object", properties: { street: { type: "string" }, city: { type: "string" } } } },
        properties: {
          name: { type: "string" },
          address: { $ref: "#/$defs/address" },
          contactMethod: { type: "string", enum: ["phone", "email"] },
          phone: { type: "string" },
          email: { type: "string" },
        },
        allOf: [{ anyOf: [{ required: ["phone"] }, { required: ["email"] }] }],
        if: { properties: { contactMethod: { const: "phone" } }, required: ["contactMethod"] },
        then: { required: ["phone"] },
        else: { required: ["email"] },
        additionalProperties: false,
      },
      handler: (args) => Promise.resolve(text(`JSON Schema 2020-12 tool called with: ${JSON.stringify(args)}`)),
    },

    // ── x-mcp-header (http-custom-header-server-validation) ────────────────────────────────────
    {
      name: "test_header_param",
      description: "Mirrors a string parameter into the Mcp-Param-Region header (SEP-2243 fixture)",
      inputSchema: { type: "object", properties: { region: { type: "string", "x-mcp-header": "Region" } } },
      handler: (args) => Promise.resolve(text(`region ${JSON.stringify(args["region"] ?? null)}`)),
    },

    // ── server-stateless diagnostics ───────────────────────────────────────────────────────────
    {
      name: "test_missing_capability",
      description: "Test tool requiring sampling",
      inputSchema: NO_ARGS,
      // Without the sampling capability, the input request below makes the transport answer
      // -32021 with data.requiredCapabilities (BI-9, MR-8); with it, the call succeeds.
      handler: (_args, ctx) => (has(ctx.clientCapabilities, "sampling") ? Promise.resolve(text("Success")) : ask({ need_sampling: sample("A sampling round", 10) })),
    },
    {
      name: "test_streaming_elicitation",
      description: "Diagnostic tool: must never place an independent request on a response stream",
      inputSchema: NO_ARGS,
      handler: () => Promise.resolve(text("Streaming complete")),
    },
    {
      name: "test_logging_tool",
      description: "Diagnostic tool: emits no log without a requested log level",
      inputSchema: NO_ARGS,
      handler: () => Promise.resolve(text("Logging evaluated")),
    },

    // ── MRTR (input-required-result-*) ─────────────────────────────────────────────────────────
    {
      name: "test_input_required_result_elicitation",
      description: "MRTR: returns InputRequiredResult with elicitation request",
      inputSchema: NO_ARGS,
      // Completes on an accepted ElicitResult under user_name, with or without requestState;
      // anything else (a wrong key, a malformed answer) is asked again rather than refused.
      handler: (_args, ctx) => {
        const answer = accepted(ctx, "user_name");
        if (answer !== undefined) return Promise.resolve(text(`Hello, ${typeof answer["name"] === "string" ? answer["name"] : "friend"}!`));
        return ask({ user_name: elicit("What is your name?", "name") });
      },
    },
    {
      name: "test_input_required_result_sampling",
      description: "MRTR: returns InputRequiredResult with sampling request",
      inputSchema: NO_ARGS,
      handler: (_args, ctx) => {
        const r = present(ctx, "sample_request");
        if (r !== undefined) {
          const content = r["content"] as { text?: unknown } | undefined;
          return Promise.resolve(text(`Sampling result: ${typeof content?.text === "string" ? content.text : "no response"}`));
        }
        return ask({ sample_request: sample("What is the capital of France?", 100) });
      },
    },
    {
      name: "test_input_required_result_list_roots",
      description: "MRTR: returns InputRequiredResult with roots/list request",
      inputSchema: NO_ARGS,
      handler: (_args, ctx) => {
        const r = present(ctx, "roots_request");
        if (r !== undefined) return Promise.resolve(text(`Found ${String(Array.isArray(r["roots"]) ? r["roots"].length : 0)} root(s)`));
        return ask({ roots_request: roots });
      },
    },
    {
      name: "test_input_required_result_request_state",
      description: "MRTR: returns InputRequiredResult with requestState",
      inputSchema: NO_ARGS,
      handler: (_args, ctx) => {
        if (stateKind(ctx)?.["kind"] === "request-state" && accepted(ctx, "confirm")?.["ok"] === true) return Promise.resolve(text("state-ok: requestState validated"));
        return ask({ confirm: elicit("Please confirm", "ok", "boolean") }, { kind: "request-state" });
      },
    },
    {
      name: "test_input_required_result_multiple_inputs",
      description: "MRTR: returns InputRequiredResult with multiple input requests",
      inputSchema: NO_ARGS,
      handler: (_args, ctx) => {
        const name = accepted(ctx, "user_name");
        const greeting = present(ctx, "greeting");
        const clientRoots = present(ctx, "client_roots");
        if (stateKind(ctx)?.["kind"] === "multiple-inputs" && name !== undefined && greeting !== undefined && clientRoots !== undefined) {
          const g = (greeting["content"] as { text?: unknown } | undefined)?.text;
          const n = Array.isArray(clientRoots["roots"]) ? clientRoots["roots"].length : 0;
          return Promise.resolve(text(`Name: ${String(name["name"])}; Greeting: ${typeof g === "string" ? g : "Hello there!"}; Roots: ${String(n)}`));
        }
        return ask({ user_name: elicit("What is your name?", "name"), greeting: sample("Generate a greeting", 50), client_roots: roots }, { kind: "multiple-inputs" });
      },
    },
    {
      name: "test_input_required_result_multi_round",
      description: "MRTR: multi-round InputRequiredResult workflow",
      inputSchema: NO_ARGS,
      handler: (_args, ctx) => {
        const s = stateKind(ctx);
        if (s?.["round"] === 1) {
          const step1 = accepted(ctx, "step1");
          if (step1 !== undefined) return ask({ step2: elicit("Step 2: What is your favorite color?", "color") }, { round: 2, name: typeof step1["name"] === "string" ? step1["name"] : "friend" });
        }
        if (s?.["round"] === 2) {
          const step2 = accepted(ctx, "step2");
          if (step2 !== undefined) return Promise.resolve(text(`Multi-round complete for ${String(s["name"])} who likes ${String(step2["color"])}`));
        }
        return ask({ step1: elicit("Step 1: What is your name?", "name") }, { round: 1 });
      },
    },
    {
      name: "test_input_required_result_tampered_state",
      description: "MRTR: HMAC-sealed requestState integrity test",
      inputSchema: NO_ARGS,
      // A tampered state never reaches this handler: the transport refuses it (MR-4).
      handler: (_args, ctx) => {
        if (stateKind(ctx)?.["kind"] === "tamper-test" && accepted(ctx, "confirm") !== undefined) return Promise.resolve(text("integrity-ok: state verified"));
        return ask({ confirm: elicit("Please confirm", "ok", "boolean") }, { kind: "tamper-test" });
      },
    },
    {
      name: "test_input_required_result_capabilities",
      description: "MRTR: respects client capabilities in inputRequests",
      inputSchema: NO_ARGS,
      handler: (_args, ctx) => {
        if (ctx.inputResponses !== undefined && Object.keys(ctx.inputResponses).length > 0) return Promise.resolve(text(`capabilities-ok: received ${Object.keys(ctx.inputResponses).join(",")}`));
        const requests: NonNullable<InputRequests> = {};
        if (has(ctx.clientCapabilities, "elicitation")) requests["elicit_input"] = elicit("Elicitation input", "value");
        if (has(ctx.clientCapabilities, "sampling")) requests["sample_input"] = sample("Sample request", 50);
        if (Object.keys(requests).length === 0) return Promise.resolve(text("No supported capabilities declared"));
        return ask(requests, { kind: "capabilities-test" });
      },
    },
  ];
}

function portFrom(): number {
  const raw = process.argv[2] ?? process.env["CONFORMANCE_PORT"] ?? "3999";
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) throw new Error("port must be 1–65535");
  return port;
}

async function main(): Promise<void> {
  const registry = new PlaceholderRegistry(compileSchema, DEFAULT_LIMITS);
  for (const tool of conformanceTools()) registry.register(tool);
  const t = await startTransport({
    registry,
    serverInfo: { name: "@clearseal/core", version: "0.0.0" },
    config: { host: "127.0.0.1", port: portFrom() },
    verifier: new ConformanceAdmitAllVerifier(),
    requestStateKey: randomBytes(32),
  });
  console.log(`conformance fixture listening on ${t.url}`);
  const stop = (): void => {
    void t.close().then(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

void main();
