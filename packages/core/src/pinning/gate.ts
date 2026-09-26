// The pin gate (CSR-WO-1001 §1.2, northstar N2). It loads an approved manifest, then admits only
// the definitions whose tool_hash matches their entry:
// - a definition with no entry is unpinned;
// - a definition whose hash differs is drifted;
// - a definition the canonical form refuses is invalid;
// - two definitions with one name are both refused, since ambiguity is never first-wins;
// - an entry with no definition is removed.
// Every refusal names the tool and the reason. The comparison is constant-time on the hex digests.
//
// The gate's output is an Admission. Only this module can create one, and the pinned registry's
// constructor accepts nothing else, so there is no path from a raw definition to a registered
// tool that does not pass through admit: verify-before-register is structural.

import { timingSafeEqual } from "node:crypto";

import { CanonicalRefusal, toolHash } from "./canonical.ts";
import { canonicalInput, type ManifestEntry, parseManifest, type PinnableTool } from "./manifest.ts";

export type RefusalReason = "unpinned" | "drifted" | "invalid" | "duplicate" | "removed";

export interface PinRefusal {
  name: string;
  reason: RefusalReason;
  /** For `invalid`: the canonical-form rule that refused the definition. */
  rule?: string;
}

/** Never exported: without it no code outside this module can construct an Admission. */
const ISSUE = Symbol("PinGate.admit");
/** Every Admission PinGate.admit issued; the registry checks membership at construction. */
const issued = new WeakSet<object>();

/** The gate's decision. Only PinGate.admit can construct one: the constructor demands a token that
 *  this module never exports, and the private brand makes the type nominal, so an object that only
 *  looks like an Admission does not type-check either. */
export class Admission {
  readonly #brand = "admission";
  readonly admitted: readonly PinnableTool[];
  readonly refused: readonly PinRefusal[];
  constructor(token: symbol, admitted: readonly PinnableTool[], refused: readonly PinRefusal[]) {
    if (token !== ISSUE) throw new TypeError("an Admission is issued only by PinGate.admit");
    this.admitted = Object.freeze([...admitted]);
    this.refused = Object.freeze([...refused]);
    issued.add(this);
    Object.freeze(this);
  }

  /** The brand, for diagnostics only. */
  get kind(): string {
    return this.#brand;
  }
}

/** True only for an Admission that PinGate.admit issued. */
export function isIssuedAdmission(value: unknown): value is Admission {
  return typeof value === "object" && value !== null && issued.has(value);
}

const sameHash = (a: string, b: string): boolean => {
  // Both are 64 lower-case hex digits: the manifest schema requires it and toolHash produces it.
  const x = Buffer.from(a, "ascii");
  const y = Buffer.from(b, "ascii");
  return x.length === y.length && timingSafeEqual(x, y);
};

export class PinGate {
  readonly #entries: ReadonlyMap<string, string>;

  private constructor(entries: readonly ManifestEntry[]) {
    this.#entries = new Map(entries.map((e) => [e.name, e.tool_hash]));
  }

  /** Loads a manifest from its text. The gate keeps its own copy, so editing the file afterwards
   *  changes nothing. Throws ManifestError on any defect. */
  static load(manifestText: string): PinGate {
    return new PinGate(parseManifest(manifestText).tools);
  }

  /** The names the manifest pins, in manifest order. */
  pinnedNames(): string[] {
    return [...this.#entries.keys()];
  }

  admit(definitions: readonly PinnableTool[]): Admission {
    const refused: PinRefusal[] = [];
    const admitted: PinnableTool[] = [];
    const counts = new Map<string, number>();
    for (const d of definitions) counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
    const seen = new Set<string>();
    for (const d of definitions) {
      seen.add(d.name);
      if ((counts.get(d.name) ?? 0) > 1) {
        refused.push({ name: d.name, reason: "duplicate" });
        continue;
      }
      let hash: string;
      try {
        hash = toolHash(canonicalInput(d));
      } catch (err) {
        if (!(err instanceof CanonicalRefusal)) throw err;
        refused.push({ name: d.name, reason: "invalid", rule: err.rule });
        continue;
      }
      const pinned = this.#entries.get(d.name);
      if (pinned === undefined) refused.push({ name: d.name, reason: "unpinned" });
      else if (!sameHash(hash, pinned)) refused.push({ name: d.name, reason: "drifted" });
      else admitted.push(d);
    }
    for (const name of this.#entries.keys()) {
      if (!seen.has(name)) refused.push({ name, reason: "removed" });
    }
    return new Admission(ISSUE, admitted, refused);
  }
}
