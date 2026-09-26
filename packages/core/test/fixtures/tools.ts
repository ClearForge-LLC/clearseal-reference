// The transport's fixture tools, as pinnable definitions (CSR-WO-1001 §1.7). Tests only: the
// transport tests serve them through the pin gate, against fixtures/manifest.json, which the CLI
// generated from this module:
//
//   npm run pin -- approve --yes --definitions packages/core/test/fixtures/tools.ts --manifest packages/core/test/fixtures/manifest.json
//
// Editing any definition here drifts it, and the transport tests then refuse to start until the
// manifest is approved again. That is the control working.

import type { CapabilityTag, PinnableTool } from "../../src/pinning/manifest.ts";
import { Refusal } from "../../src/transport/jsonrpc.ts";

/** A read-only tag with the tool's name as its scope; tests override what they exercise. */
export function tag(scope: string, overrides: Partial<CapabilityTag> = {}): CapabilityTag {
  return { capability_class: "read_only", untrusted_input_facing: false, scope, privacy_sensitive: false, recoverability_basis: null, elevated: false, containment_domain: null, ...overrides };
}

export interface Gate {
  promise: Promise<void>;
  open: () => void;
}
export function gate(): Gate {
  let open = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

export const held = { gates: [] as Gate[] };

const text = (t: string): { content: { type: "text"; text: string }[] } => ({ content: [{ type: "text", text: t }] });

/** Fixture tools, served only by tests. */
export function fixtureTools(): PinnableTool[] {
  return [
    {
      name: "echo",
      capability: tag("echo"),
      description: "Returns its text.",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      handler: (args) => Promise.resolve(text(String(args["text"]))),
    },
    {
      name: "no_args",
      capability: tag("no_args"),
      description: "Takes nothing.",
      inputSchema: { type: "object" },
      handler: () => Promise.resolve(text("ok")),
    },
    {
      name: "region_query",
      capability: tag("region_query"),
      description: "A fixture declaring x-mcp-header on string, integer, boolean and nested properties.",
      inputSchema: {
        type: "object",
        properties: {
          region: { type: "string", "x-mcp-header": "Region" },
          limit: { type: "integer", "x-mcp-header": "Limit" },
          dry: { type: ["boolean", "null"], "x-mcp-header": "Dry" },
          scope: { type: "object", properties: { zone: { type: "string", "x-mcp-header": "Zone" } } },
          query: { type: "string" },
        },
        required: ["query"],
      },
      handler: (args) => Promise.resolve(text(JSON.stringify(args))),
    },
    {
      name: "slow",
      capability: tag("slow"),
      description: "Never returns until aborted.",
      inputSchema: { type: "object" },
      handler: (_args, ctx) =>
        new Promise((_, reject) => {
          ctx.signal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    },
    {
      name: "hold",
      capability: tag("hold"),
      description: "Returns when the test opens its gate.",
      inputSchema: { type: "object" },
      handler: async () => {
        const g = gate();
        held.gates.push(g);
        await g.promise;
        return text("released");
      },
    },
    {
      name: "big",
      capability: tag("big"),
      description: "Returns `size` bytes of text.",
      inputSchema: { type: "object", properties: { size: { type: "integer", minimum: 0 } }, required: ["size"] },
      handler: (args) => Promise.resolve(text("x".repeat(Number(args["size"])))),
    },
    {
      name: "ask",
      capability: tag("ask"),
      description: "MRTR: asks for a name, then greets.",
      inputSchema: { type: "object" },
      handler: (_args, ctx) => {
        if (ctx.state === undefined) {
          return Promise.resolve({
            resultType: "input_required" as const,
            inputRequests: { who: { method: "elicitation/create", params: { mode: "form", message: "Name?", requestedSchema: { type: "object", properties: { name: { type: "string" } } } } } },
            state: { step: 1, tool: "ask" },
          });
        }
        return Promise.resolve(text(`state ${JSON.stringify(ctx.state)} responses ${JSON.stringify(ctx.inputResponses ?? {})}`));
      },
    },
    {
      name: "ask_other",
      capability: tag("ask_other"),
      description: "MRTR: a second tool whose state must not be accepted by `ask`.",
      inputSchema: { type: "object" },
      handler: (_args, ctx) =>
        Promise.resolve(ctx.state === undefined ? { resultType: "input_required" as const, state: { step: 1, tool: "ask_other" } } : text("other done")),
    },
    {
      name: "approve_target",
      capability: tag("approve_target"),
      description: "MRTR with arguments: asks once, then acts on `target`.",
      inputSchema: { type: "object", properties: { target: { type: "string" } }, required: ["target"] },
      handler: (args, ctx) =>
        Promise.resolve(ctx.state === undefined ? { resultType: "input_required" as const, state: { approved: args["target"] as string } } : text(`acting on ${String(args["target"])}`)),
    },
    {
      name: "ask_big",
      capability: tag("ask_big"),
      description: "MRTR with an oversized input request: on the legacy era the era refusal must win over the result cap.",
      inputSchema: { type: "object" },
      handler: () =>
        Promise.resolve({
          resultType: "input_required" as const,
          inputRequests: { big: { method: "elicitation/create", params: { mode: "form", message: "x".repeat(400_000), requestedSchema: { type: "object" } } } },
        }),
    },
    {
      name: "throws_refusal",
      capability: tag("throws_refusal"),
      description: "Throws a Refusal-shaped error with a long message; none of it may reach the client.",
      inputSchema: { type: "object" },
      handler: () => Promise.reject(new Refusal(200, 0, "x".repeat(300_000))),
    },
    {
      name: "costly_schema",
      capability: tag("costly_schema"),
      description: "uniqueItems over objects: validation cost grows with the square of the array.",
      inputSchema: { type: "object", properties: { tags: { type: "array", uniqueItems: true, items: { type: "object" } } } },
      handler: () => Promise.resolve(text("validated")),
    },
    {
      name: "needs_sampling",
      capability: tag("needs_sampling"),
      description: "MRTR: asks for a sampling round.",
      inputSchema: { type: "object" },
      handler: () =>
        Promise.resolve({ resultType: "input_required" as const, inputRequests: { s: { method: "sampling/createMessage", params: { messages: [], maxTokens: 1 } } } }),
    },
  ];
}


/** What the pin CLI reads. */
export const definitions: PinnableTool[] = fixtureTools();
