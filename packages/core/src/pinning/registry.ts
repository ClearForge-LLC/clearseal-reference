// The pinned registry (CSR-WO-1001 §1.3), the transport's one ToolRegistry. Its constructor takes
// the pin gate's Admission and nothing else. It checks at runtime that PinGate.admit issued the
// value, and the Admission's private brand makes the same demand at compile time. So no raw
// definition can be registered: verify-before-register is structural, not a convention (N2).
//
// Each admitted tool passes the transport's static registration checks, and its input_schema is
// compiled by the core's validator at construction, as before.

import { readFileSync } from "node:fs";

import { type Admission, isIssuedAdmission, PinGate, type PinRefusal } from "./gate.ts";
import { type Cage, type Reach, recordingCageFactory } from "../containment/cage.ts";
import type { HarnessTool } from "../containment/harness.ts";
import { type Domain, DomainError, parseDomain } from "../containment/domain.ts";
import { ManifestError, type PinnableTool } from "./manifest.ts";
import type { Limits } from "../transport/config.ts";
import { prepareTool, type PinningStatus, type RegisteredTool, type SchemaCompiler, type ToolRegistry } from "../transport/registry.ts";

export interface PinnedRegistryOptions {
  compile: SchemaCompiler;
  limits: Pick<Limits, "maxSchemaDepth" | "maxSchemaNodes">;
  /** PIN_STRICT: true stops the node on any refusal; false serves the admitted tools and leaves the
   *  refused ones absent. Omitted, it is read from the environment, strict unless exactly "false".
   *  It never excuses a missing manifest: without a manifest there is no gate, and without an
   *  admission there is no registry. */
  strict?: boolean;
  /** EXEC_TOOLS_FORBIDDEN: true refuses every arbitrary_exec definition at construction (N7).
   *  Omitted, it is read from the environment, forbidden unless exactly "false". An edition that
   *  turns it off must say why in its own tree. */
  execToolsForbidden?: boolean;
  /** Builds each call's cage from a tool's pinned domain. Omitted: the core's RecordingCage.
   *  Editions pass their OS-level Cage here. */
  cageFor?: (domain: Domain) => (onRefused?: (reach: Reach) => void) => Cage;
}

/** A definition the registry refuses at construction: its containment domain is malformed or
 *  non-canonical, or it is arbitrary_exec (CSR-WO-1002 §1.1, §1.4). It names the tool. */
export class ContainmentConstructionError extends Error {
  override name = "ContainmentConstructionError";
  readonly tool: string;
  constructor(tool: string, message: string) {
    super(`tool "${tool}": ${message}`);
    this.tool = tool;
  }
}

/** EXEC_TOOLS_FORBIDDEN from the environment: forbidden unless the value is exactly "false". */
export function execToolsForbiddenFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["EXEC_TOOLS_FORBIDDEN"] !== "false";
}

export class PinnedRegistry implements ToolRegistry {
  readonly #tools: ReadonlyMap<string, RegisteredTool>;
  readonly #domains: ReadonlyMap<string, readonly string[] | null>;
  readonly pinning: PinningStatus;

  constructor(admission: Admission, options: PinnedRegistryOptions) {
    // Not extensible by subclassing: a subclass could override get() and serve an unpinned tool.
    if (new.target !== PinnedRegistry) throw new TypeError("PinnedRegistry cannot be subclassed");
    if (!isIssuedAdmission(admission)) throw new TypeError("a pinned registry is built only from PinGate.admit's Admission");
    const tools = new Map<string, RegisteredTool>();
    const execForbidden = options.execToolsForbidden ?? execToolsForbiddenFromEnv();
    const cageFor = options.cageFor ?? ((domain: Domain) => recordingCageFactory(domain));
    const domains = new Map<string, readonly string[] | null>();
    for (const tool of admission.admitted) {
      // Everything here is read from the gate's frozen snapshot, the copy that was hashed.
      const { capability_class: capabilityClass, containment_domain: pinnedDomain } = tool.capability;
      // N7: a shell cannot be caged by a list, and the reference ships no exec tool at all.
      if (capabilityClass === "arbitrary_exec" && pinnedDomain !== null) throw new ContainmentConstructionError(tool.name, "arbitrary_exec is refused a containment domain (N7)");
      if (capabilityClass === "arbitrary_exec" && execForbidden) throw new ContainmentConstructionError(tool.name, "arbitrary_exec is refused while EXEC_TOOLS_FORBIDDEN is on (N7)");
      let domain: Domain;
      try {
        domain = parseDomain(pinnedDomain);
      } catch (err) {
        if (err instanceof DomainError) throw new ContainmentConstructionError(tool.name, err.message);
        throw err;
      }
      // Served exactly as hashed: the gate's frozen snapshot of name, description and schema.
      const prepared = prepareTool({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, handler: tool.handler }, options.compile, options.limits);
      tools.set(tool.name, { ...prepared, newCage: cageFor(domain) });
      domains.set(tool.name, tool.capability.containment_domain);
    }
    this.#tools = tools;
    this.#domains = domains;
    const refusedNames = new Set(admission.refused.map((r) => r.name));
    this.pinning = Object.freeze({
      strict: options.strict ?? pinStrictFromEnv(),
      admitted: tools.size,
      refused: admission.refused,
      isRefused: (name: string) => refusedNames.has(name),
    });
    Object.freeze(this);
  }

  /** The reach harness's targets, from the registry itself: every registered tool, with the domain
   *  parsed from the gate's frozen snapshot and the corpus given for it. A registered tool with no
   *  corpus is an error, so no tool escapes the harness by being left off a list. */
  reachTargets(corpora: Readonly<Record<string, readonly Record<string, unknown>[]>>): HarnessTool[] {
    return this.list().map((t) => {
      const corpus = corpora[t.definition.name];
      if (corpus === undefined || corpus.length === 0) throw new Error(`the registered tool ${t.definition.name} has no harness corpus`);
      return { name: t.definition.name, domain: this.#domains.get(t.definition.name) ?? null, handler: t.handler, corpus };
    });
  }

  /** True only for an instance this class constructed: the private field is the brand, and the
   *  prototype must be this class's own, frozen one. */
  static isGenuine(value: unknown): value is PinnedRegistry {
    return typeof value === "object" && value !== null && #tools in value && Object.getPrototypeOf(value) === PinnedRegistry.prototype;
  }

  list(): readonly RegisteredTool[] {
    return [...this.#tools.values()].sort((a, b) => (a.definition.name < b.definition.name ? -1 : a.definition.name > b.definition.name ? 1 : 0));
  }

  get(name: string): RegisteredTool | undefined {
    return this.#tools.get(name);
  }
}

// A patched prototype could serve an unpinned tool from every instance.
Object.freeze(PinnedRegistry.prototype);
Object.freeze(PinnedRegistry);

/** Under the strict default, any refusal stops the node before it binds. */
export class PinRefusedError extends Error {
  override name = "PinRefusedError";
  readonly refused: PinningStatus["refused"];
  constructor(refused: PinningStatus["refused"]) {
    super(`the pin gate refused ${String(refused.length)} tool(s): ${refused.map((r) => `${r.name} (${r.reason}${r.rule === undefined ? "" : ` ${r.rule}`})`).join(", ")}; PIN_STRICT is on, so the node does not start`);
    this.refused = refused;
  }
}

/** PIN_STRICT from the environment: strict unless the value is exactly "false". */
export function pinStrictFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["PIN_STRICT"] !== "false";
}

/** The node's start-up path: read the manifest file, load the gate, admit the definitions, build
 *  the registry. A missing or unparseable manifest throws ManifestError whatever `strict` says. */
export function loadPinnedRegistry(manifestPath: string | URL, definitions: readonly PinnableTool[], options: PinnedRegistryOptions): PinnedRegistry {
  let text: string;
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch (err) {
    throw new ManifestError(`the manifest cannot be read (${err instanceof Error && "code" in err ? String(err.code) : "error"}): a node without a manifest does not start`);
  }
  return new PinnedRegistry(PinGate.load(text).admit(definitions), options);
}

export type { PinRefusal };
