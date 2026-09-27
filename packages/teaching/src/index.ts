// The teaching edition's public entry (CSR-WO-1004 §1.1, CSR-WO-1007 §1.2). By the supply boundary
// (N1; architecture §5 *Where OS primitives live*) an edition exports its tool definitions, its
// manifest and its configuration schema, and assembles nothing: the core's startNode builds the gate,
// the registry and the transport from these three. The deploy scaffold is bin/ and its
// configuration, not an export. package.json's "clearseal.exports" declares each export's kind, and
// the core's supply-boundary test holds this file to that list.

import type { PinnableTool } from "@clearseal/core";

import { DEFAULT_NOTES_ROOT, toolsFor } from "./notes.ts";

/** The edition's tools, as pinned in pins/teaching.json. */
export const definitions: readonly PinnableTool[] = Object.freeze(toolsFor(DEFAULT_NOTES_ROOT));

/** The committed, approved manifest (pins/teaching.json at the repository root). */
export const manifestPath: URL = new URL("../../../pins/teaching.json", import.meta.url);

export { configSchema } from "./config.ts";
