// The core transport (CSR-WO-1005). SPEC-MAP.md beside this file maps it to the specification.

export { DEFAULT_CONFIG, DEFAULT_LIMITS, LEGACY_PATH_REVIEW_BY, LEGACY_VERSION, MODERN_VERSION, resolveConfig, SUPPORTED_VERSIONS } from "./config.ts";
export type { Limits, TransportConfig } from "./config.ts";
export { prepareTool, RegistrationError } from "./registry.ts";
export type { CallContext, PinningStatus, RegisteredTool, SchemaCompiler, Tool, ToolDefinition, ToolRegistry, ToolResult } from "./registry.ts";
export { REQUEST_STATE_KEY_ENV, requestStateKeyFromEnv } from "./request-state.ts";
export { compileSchema } from "./schema.ts";
export { ValidationPool, ValidationTimeout } from "./schema-pool.ts";
export type { ValidationPoolOptions } from "./schema-pool.ts";
export { startTransport } from "./server.ts";
export type { RunningTransport, TransportOptions } from "./server.ts";
export { RefuseAllVerifier } from "./verifier.ts";
export type { Principal, Verdict, Verifier } from "./verifier.ts";
