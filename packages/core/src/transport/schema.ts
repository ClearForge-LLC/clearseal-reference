// JSON Schema 2020-12 validation for tools/call arguments (TL-10, BI-14…BI-18), through the one
// pinned validator: z-schema 12.8.0. It was chosen, at 12.4.6, by measurement (CSR-WO-1005 FEEDBACK): it
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
  const check = compileSchemaReporting(schema);
  return (value: unknown): boolean => check(value) === true;
}

/** One way a value fails its schema, as the caller may be told it (CSR-WO-2011 §1.2): where, as a JSON
 *  pointer whose every segment the schema itself declares under `properties` (any other segment is
 *  `*`, array indices included: a digit-only key under `additionalProperties` would read the same as
 *  an index, CSR-WO-2011 adversarial pass), and the failing keyword. Never z-schema's `message` or `params`, nor a
 *  segment the caller chose: measured on z-schema 12.8.0, those carry the arguments (the failing
 *  string for `pattern`, the value for `enum`, `const` and `maximum`, the extra property's name for
 *  `unevaluatedProperties`). */
export interface SchemaFailure {
  readonly pointer: string;
  readonly keyword: string;
}

/** A value's verdict with its failures, at most MAX_FAILURES of them (the validator breaks on its first
 *  error, so usually one). */
export type SchemaVerdict = true | { readonly failures: readonly SchemaFailure[] };

/** The caps, applied in the worker before its reply is posted (architect ruling on CSR-WO-2011's fence,
 *  condition (d)): at most three failures, each pointer segment at most 64 characters and each pointer
 *  at most 200 (a longer one ends in `/…`), each keyword at most 40. */
const MAX_FAILURES = 3;
const MAX_SEGMENT = 64;
const MAX_POINTER = 200;

/** compileSchema, with the failures of a value that does not validate. Run in the validation worker. */
export function compileSchemaReporting(schema: Record<string, unknown>): (value: unknown) => SchemaVerdict {
  assertNoReader();
  const copy = structuredClone(schema);
  const checked = validator.validateSchema(copy);
  if (!checked.valid) throw new Error(checked.err?.message ?? "invalid schema");
  return (value: unknown): SchemaVerdict => {
    assertNoReader();
    const result = validator.validate(value, copy);
    return result.valid ? true : { failures: failuresOf(result.err) };
  };
}

function failuresOf(err: unknown): SchemaFailure[] {
  const details = (err as { details?: unknown } | undefined)?.details;
  if (!Array.isArray(details)) return [];
  return details.slice(0, MAX_FAILURES).map((d: unknown) => {
    const { path, schemaPath, keyword, code } = (d ?? {}) as { path?: unknown; schemaPath?: unknown; keyword?: unknown; code?: unknown };
    const declared = new Set<string>();
    if (Array.isArray(schemaPath)) for (let i = 0; i + 1 < schemaPath.length; i++) if (schemaPath[i] === "properties" && typeof schemaPath[i + 1] === "string") declared.add(schemaPath[i + 1] as string);
    const segments = typeof path === "string" ? path.replace(/^#\/?/, "").split("/").filter((seg) => seg !== "") : [];
    const pointer = segments.map((seg) => (seg.length <= MAX_SEGMENT && declared.has(seg) ? seg : "*")).join("/");
    const word = typeof keyword === "string" && /^[A-Za-z$]{1,32}$/.test(keyword) ? keyword : typeof code === "string" && /^[A-Z_]{1,40}$/.test(code) ? code.toLowerCase() : "schema";
    const full = pointer === "" ? "" : `/${pointer}`;
    return { pointer: full.length <= MAX_POINTER ? full : `${full.slice(0, MAX_POINTER).replace(/\/[^/]*$/, "")}/…`, keyword: word };
  });
}
