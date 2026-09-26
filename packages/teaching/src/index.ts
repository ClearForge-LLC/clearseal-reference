// The teaching edition's public entry (CSR-WO-1004 §1.1). By the supply boundary (N1; architecture
// §5 *Where OS primitives live*) an edition exports only tool definitions, a manifest, a
// configuration schema and a deploy scaffold. package.json's "clearseal.exports" declares each
// export's kind, and the core's supply-boundary test holds this file to that list.

import type { PinnableTool } from "@clearseal/core";

import { DEFAULT_NOTES_ROOT, toolsFor } from "./notes.ts";
import { MANIFEST_URL } from "./start.ts";

/** The edition's tools, as pinned in pins/teaching.json. */
export const definitions: readonly PinnableTool[] = Object.freeze(toolsFor(DEFAULT_NOTES_ROOT));

/** The approved manifest the scaffold loads by default. */
export const manifestPath: URL = MANIFEST_URL;

export { configSchema } from "./config.ts";
export { start } from "./start.ts";
