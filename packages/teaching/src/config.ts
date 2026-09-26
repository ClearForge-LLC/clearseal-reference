// The teaching edition's configuration (CSR-WO-1004 §1.1): environment variables, named and
// validated by this schema at start. The authorization settings (AUTH_*) and PIN_STRICT are the
// core's own and are read by the core. ClearSeal: configuration is data with a schema, never code
// (architecture §3.1); a value outside the schema refuses start (N4).

import { compileSchema } from "@clearseal/core";

export const configSchema = {
  title: "ClearSeal teaching edition configuration",
  type: "object",
  properties: {
    TEACHING_RESOURCE_URL: { type: "string", pattern: "^https?://[^\\s]+$", description: "The protected-resource URL named in every 401 and the metadata document. Required." },
    TEACHING_HOST: { type: "string", pattern: "^[A-Za-z0-9.:-]{1,253}$", description: "The address to bind. Default 127.0.0.1." },
    TEACHING_PORT: { type: "string", pattern: "^[0-9]{1,5}$", description: "The port to bind. Default 3030; 0 picks a free one." },
    TEACHING_NOTES_ROOT: { type: "string", pattern: "^/", description: "The notes store. Part of the pinned contract: changing it needs a re-approved manifest." },
    TEACHING_MANIFEST: { type: "string", description: "The approved manifest. Default: the edition's committed pins/teaching.json." },
  },
  required: ["TEACHING_RESOURCE_URL"],
  additionalProperties: false,
};

export interface TeachingConfig {
  resourceUrl: string;
  host: string;
  port: number;
  notesRoot: string | undefined;
  manifest: string | undefined;
}

const validate = compileSchema(configSchema);

/** The TEACHING_* variables, validated. Anything outside the schema, an unknown TEACHING_ name
 *  included, throws. */
export function readConfig(env: NodeJS.ProcessEnv): TeachingConfig {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (k.startsWith("TEACHING_") && v !== undefined && v !== "") vars[k] = v;
  if (!validate(vars)) throw new Error(`the teaching configuration does not match its schema: ${Object.keys(vars).join(", ") || "(none set)"}`);
  const port = Number(vars["TEACHING_PORT"] ?? "3030");
  if (port > 65535) throw new Error("TEACHING_PORT must be 0 to 65535");
  return {
    resourceUrl: vars["TEACHING_RESOURCE_URL"] ?? "",
    host: vars["TEACHING_HOST"] ?? "127.0.0.1",
    port,
    notesRoot: vars["TEACHING_NOTES_ROOT"],
    manifest: vars["TEACHING_MANIFEST"],
  };
}
