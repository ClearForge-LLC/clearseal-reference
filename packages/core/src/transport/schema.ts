// JSON Schema 2020-12 validation for tools/call arguments (TL-10, BI-14…BI-18), through the one
// pinned validator: z-schema 12.4.6. It was chosen by measurement (CSR-WO-1005 FEEDBACK): it
// passed 1252 of 1252 required draft 2020-12 tests (excluding the remote-document tests); it
// generates no code; it has no install script; and it has no loader unless one is installed.
//
// Two z-schema defaults are pinned here explicitly rather than trusted:
//   - `formatAssertions: false`: 2020-12 treats `format` as an annotation.
//   - `ignoreUnresolvableReferences: false`: an unresolved `$ref` fails, never passes.
// z-schema keeps a process-global schema reader and remote-reference table. This module never sets
// either, and it refuses to compile or validate if anything else has installed a reader, so a
// dependency cannot quietly turn remote dereferencing on (BI-16).

import ZSchema from "z-schema";

const validator = ZSchema.create({
  safe: true,
  version: "draft2020-12",
  formatAssertions: false,
  ignoreUnresolvableReferences: false,
  breakOnFirstError: true,
});

export class SchemaLoaderError extends Error {
  override name = "SchemaLoaderError";
}

function assertNoReader(): void {
  if (ZSchema.getSchemaReader() !== undefined) throw new SchemaLoaderError("a schema reader is installed in the validator; remote $ref dereferencing is refused");
}

/** Compiles a 2020-12 schema into a predicate. Throws if the schema is invalid or has an unresolved
 *  reference. The schema is deep-copied, so the validator's bookkeeping never touches the
 *  definition the server advertises. */
export function compileSchema(schema: Record<string, unknown>): (value: unknown) => boolean {
  assertNoReader();
  const copy = structuredClone(schema);
  const checked = validator.validateSchema(copy);
  if (!checked.valid) throw new Error(checked.err?.message ?? "invalid schema");
  return (value: unknown): boolean => {
    assertNoReader();
    return validator.validate(value, copy).valid;
  };
}
