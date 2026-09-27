// The teaching edition's configuration schema (CSR-WO-1004 §1.1, CSR-WO-1007 §1.1). Environment
// variables, named here and read and validated by the core's startNode: an edition reads nothing
// from the environment itself (CSR-WO-1007 §1.3). The annotations tell the core the variables'
// prefix and which of them carries each transport setting; a value outside the schema, an unknown
// TEACHING_ variable included, refuses start (N4). The authorization settings (AUTH_*) and
// PIN_STRICT are the core's own. ClearSeal: configuration is data with a schema, never code
// (architecture §3.1).
//
// The notes root and the manifest are not configuration: the root is part of the pinned contract,
// fixed in the definitions (pins/teaching.json pins it), and the manifest is the committed file the
// edition names. Moving either is a code change and a re-approved manifest, never a variable.

export const configSchema = {
  title: "ClearSeal teaching edition configuration",
  type: "object",
  "x-clearseal-env-prefix": "TEACHING_",
  properties: {
    TEACHING_RESOURCE_URL: { type: "string", pattern: "^https?://[^\\s]+$", "x-clearseal-setting": "resource-url", description: "The protected-resource URL named in every 401 and the metadata document. Required." },
    TEACHING_HOST: { type: "string", pattern: "^[A-Za-z0-9.:-]{1,253}$", "x-clearseal-setting": "host", default: "127.0.0.1", description: "The address to bind." },
    TEACHING_PORT: { type: "string", pattern: "^[0-9]{1,5}$", "x-clearseal-setting": "port", default: "3030", description: "The port to bind; 0 picks a free one." },
  },
  required: ["TEACHING_RESOURCE_URL"],
  additionalProperties: false,
};
