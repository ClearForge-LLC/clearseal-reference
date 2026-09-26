// The cross-repo enumeration detector (CSR-WO-1001 §1.6, architecture §3.2). The standard says its
// §3 list and the executable form "MUST list the same set; if they diverge, the executable form is
// authoritative and this list is the bug". Until now nothing checked that sentence. This test reads
// the list from a verbatim copy of the standard at its pinned public commit (the fixture records
// the path, lines and commit) and compares it with canonicalFieldSet().
//
// A known divergence would be named in KNOWN_DIVERGENCE, dated and cited, and the test would assert
// the difference is exactly that set, so any other difference in either direction is red. At the
// pinned commit there is none; the entry is empty and the assertion is plain equality.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { canonicalFieldSet } from "../../src/pinning/canonical.ts";

interface Fixture {
  source: { commit_short: string; path: string; lines: string };
  text: string;
}

const fixture = JSON.parse(readFileSync(new URL("../fixtures/clearseal-section3.json", import.meta.url), "utf8")) as Fixture;

/** The divergence this repository knows about and records (docs/upstream.md entry 1). Measured on
 *  2026-09-26 at the pinned commit: none. The standard's v0.8 amendment brought its list to the ten
 *  fields; the "nine" in capability/fields.ts's header is the history before it. */
const KNOWN_DIVERGENCE = {
  recorded: "2026-09-26",
  cites: "docs/upstream.md entry 1",
  onlyInStandard: [] as string[],
  onlyInCore: [] as string[],
};

const START = "**THE PINNED TOOL OBJECT (canonical, hashed into the manifest).**";
const COUNT = /\*\*(\w+) fields\./;
const WORDS: Readonly<Record<string, number>> = { eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

/** The standard's field list: the backticked names between the heading and its count sentence. */
function standardList(text: string): { fields: string[]; stated: number | undefined } {
  const start = text.indexOf(START);
  const count = COUNT.exec(text);
  if (start < 0 || count === null) throw new Error("the §3 pinned-object sentence is not where the fixture says: refresh the copy");
  // A parenthetical is an aside about a field, not a field: "`recoverability_basis` (null unless
  // `owned_state`)" names a capability class, and a naive reading counts it as an eleventh field.
  // The standard's wording can be read two ways here (FEEDBACK, decision-needed).
  const between = text.slice(start + START.length, count.index).replace(/\([^()]*\)/g, "");
  const fields = [...between.matchAll(/`([a-z_]+)`/g)].map((m) => m[1] as string);
  return { fields, stated: WORDS[(count[1] ?? "").toLowerCase()] };
}

/** Every way the standard's list and the core's set differ beyond the known divergence. */
function unexpectedDifferences(standard: readonly string[], core: ReadonlySet<string>): string[] {
  const s = new Set(standard);
  const onlyInStandard = [...s].filter((f) => !core.has(f)).sort();
  const onlyInCore = [...core].filter((f) => !s.has(f)).sort();
  const problems: string[] = [];
  if (JSON.stringify(onlyInStandard) !== JSON.stringify([...KNOWN_DIVERGENCE.onlyInStandard].sort())) problems.push(`only in the standard: ${JSON.stringify(onlyInStandard)}`);
  if (JSON.stringify(onlyInCore) !== JSON.stringify([...KNOWN_DIVERGENCE.onlyInCore].sort())) problems.push(`only in the core: ${JSON.stringify(onlyInCore)}`);
  if (s.size !== standard.length) problems.push("the standard's list names a field twice");
  return problems;
}

void describe("the cross-repo enumeration detector: the standard's §3 list against canonicalFieldSet()", () => {
  void it(`the list at ${fixture.source.commit_short}:${fixture.source.path}:${fixture.source.lines} differs from the core by exactly the known divergence`, () => {
    const { fields, stated } = standardList(fixture.text);
    const core = canonicalFieldSet();
    const known = KNOWN_DIVERGENCE.onlyInStandard.length + KNOWN_DIVERGENCE.onlyInCore.length === 0 ? "none" : JSON.stringify(KNOWN_DIVERGENCE);
    console.log(
      `DETECTOR standard ${fixture.source.commit_short} ${fixture.source.path}:${fixture.source.lines} lists ${String(fields.length)} fields (states ${String(stated)}); core hashes ${String(core.size)}; known divergence: ${known}; unexpected: ${JSON.stringify(unexpectedDifferences(fields, core))}`,
    );
    assert.equal(stated, fields.length, "the standard's own count word agrees with its list");
    assert.deepEqual(unexpectedDifferences(fields, core), []);
  });

  void it("it goes red in both directions: a field added to the copy, and a field removed from it", () => {
    const { fields } = standardList(fixture.text);
    const core = canonicalFieldSet();
    assert.deepEqual(unexpectedDifferences([...fields, "rate_limit_tier"], core), ['only in the standard: ["rate_limit_tier"]']);
    assert.deepEqual(unexpectedDifferences(fields.filter((f) => f !== "elevated"), core), ['only in the core: ["elevated"]']);
    assert.deepEqual(unexpectedDifferences([...fields, "elevated"], core), ["the standard's list names a field twice"]);
  });
});
