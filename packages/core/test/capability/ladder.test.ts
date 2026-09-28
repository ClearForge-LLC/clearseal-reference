// CSR-WO-2000: the capability obligation (capability/RULES.md). The obligation is a pure function of
// the frozen tag; the pinned registry refuses construction when a tool's tag does not meet it. Every
// refusal here goes through the real path a node uses: an in-memory approved manifest, PinGate.load,
// admit, then the PinnedRegistry constructor.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { basisProblem, DEFAULT_APPROVAL_BACKEND, MAX_BASIS, ObligationError, type Obligation, obligationOf, type RuleId, unmetObligations } from "../../src/capability/ladder.ts";
import { CAPABILITY_CLASSES } from "../../src/capability/fields.ts";
import type { CapabilityTag, PinnableTool } from "../../src/pinning/manifest.ts";
import { DEFAULT_LIMITS } from "../../src/transport/config.ts";
import { compileSchema } from "../../src/transport/schema.ts";
import { pinForTest } from "../fixtures/pin.ts";
import { tag } from "../fixtures/tools.ts";

const ROOT = "fs:/srv/clearseal/test";
const tool = (overrides: Partial<CapabilityTag>): PinnableTool => ({ name: "t", description: "", inputSchema: { type: "object" }, handler: () => Promise.resolve({ content: [] }), capability: tag("t", overrides) });
const build = (overrides: Partial<CapabilityTag>, execToolsForbidden = false) => pinForTest([tool(overrides)], compileSchema, DEFAULT_LIMITS, true, { execToolsForbidden });

/** The construction error, or undefined when the registry was built and serves the tool. */
function construct(overrides: Partial<CapabilityTag>, execToolsForbidden = false): unknown {
  try {
    const registry = build(overrides, execToolsForbidden);
    assert.equal(registry.get("t")?.definition.name, "t", "a registry that was built serves the tool");
    return undefined;
  } catch (err) {
    if (err instanceof assert.AssertionError) throw err;
    return err;
  }
}

/** Asserts construction is refused with an ObligationError under `rule`, and returns its message. */
function refused(label: string, overrides: Partial<CapabilityTag>, rule: RuleId, why: RegExp): string {
  const err = construct(overrides);
  assert.ok(err instanceof ObligationError, `${label}: expected an ObligationError, got ${String(err)}`);
  assert.ok(err.rules.includes(rule), `${label}: expected ${rule}, got ${err.rules.join(", ")}`);
  assert.match(err.message, why, label);
  assert.equal(err.tool, "t");
  console.log(`REFUSAL ${label} → ${err.message}`);
  return err.message;
}

/** "served", or the refusal's text: compared as a string, so a failure's diff carries no stack. */
const outcome = (err: unknown): string => (err === undefined ? "served" : err instanceof Error ? `${err.name}: ${err.message}` : "a throw that is not an Error");

function served(label: string, overrides: Partial<CapabilityTag>): void {
  assert.equal(outcome(construct(overrides)), "served", label);
}

const BOOLS = [false, true] as const;
/** Every combination of the four rungs and the three booleans: 32. */
const COMBINATIONS = CAPABILITY_CLASSES.flatMap((capability_class) =>
  BOOLS.flatMap((untrusted_input_facing) => BOOLS.flatMap((privacy_sensitive) => BOOLS.map((elevated) => ({ capability_class, untrusted_input_facing, privacy_sensitive, elevated })))),
);

/** RULES.md, written out independently of ladder.ts: the rules each combination must carry. */
function expected(c: (typeof COMBINATIONS)[number]): { requires: string[]; forbids: string[]; discharged: string[] } {
  const requires: string[] = [];
  const forbids: string[] = [];
  const discharged: string[] = [];
  if (c.elevated) requires.push("CAP-7 approval_backend");
  if (c.capability_class === "owned_state") requires.push("CAP-5 recoverability_basis");
  else forbids.push("CAP-6 recoverability_basis");
  if (c.capability_class === "arbitrary_exec") forbids.push("N7 containment");
  if (c.untrusted_input_facing && c.capability_class === "state_change") requires.push("CAP-2 containment|approval");
  if (c.untrusted_input_facing && c.capability_class === "arbitrary_exec") requires.push("CAP-3 approval");
  if (c.untrusted_input_facing && c.capability_class === "owned_state") discharged.push("CAP-4");
  return { requires, forbids, discharged };
}

const render = (o: Obligation) => ({
  requires: o.requires.map((r) => `${r.rule} ${r.anyOf.join("|")}`),
  forbids: o.forbids.map((p) => `${p.rule} ${p.control}`),
  discharged: o.discharged.map((d) => d.rule),
});

/** The controls that best meet a combination's obligation: a valid basis where allowed, a domain
 *  where allowed. What still fails with them cannot be served today. */
const best = (c: (typeof COMBINATIONS)[number]): Partial<CapabilityTag> => ({
  ...c,
  recoverability_basis: c.capability_class === "owned_state" ? "append-only + supersession" : null,
  containment_domain: c.capability_class === "arbitrary_exec" ? null : [ROOT],
});
/** Refused today whatever controls it carries: elevated (no approval backend), or untrusted exec. */
const unservable = (c: (typeof COMBINATIONS)[number]): boolean => c.elevated || (c.untrusted_input_facing && c.capability_class === "arbitrary_exec");

void describe("the obligation (CAP-1): pure and total over every rung and flag", () => {
  void it("the full table: every combination gets exactly RULES.md's obligation, frozen, and the same twice", () => {
    assert.equal(COMBINATIONS.length, 32);
    const lines = ["| capability_class | untrusted | privacy | elevated | requires | forbids | discharged | served today |", "|---|---|---|---|---|---|---|---|"];
    for (const c of COMBINATIONS) {
      const input = Object.freeze({ ...c });
      const o = obligationOf(input);
      assert.deepEqual(render(o), expected(c), JSON.stringify(c));
      assert.deepEqual(obligationOf(input), o, "pure: the same input gives the same obligation");
      assert.ok(Object.isFrozen(o) && Object.isFrozen(o.requires) && Object.isFrozen(o.forbids) && Object.isFrozen(o.discharged), "frozen");
      for (const r of o.requires) assert.ok(Object.isFrozen(r) && Object.isFrozen(r.anyOf) && r.reason.length > 0, "each requirement is frozen and has its reason");
      const e = expected(c);
      lines.push(`| ${c.capability_class} | ${String(c.untrusted_input_facing)} | ${String(c.privacy_sensitive)} | ${String(c.elevated)} | ${e.requires.join("; ") || "—"} | ${e.forbids.join("; ") || "—"} | ${e.discharged.join("; ") || "—"} | ${unservable(c) ? "no" : "yes"} |`);
    }
    console.log(`OBLIGATION TABLE\n${lines.join("\n")}`);
  });

  void it("anything outside the four rungs and three booleans is a TypeError, not an obligation", () => {
    assert.throws(() => obligationOf({ capability_class: "root", untrusted_input_facing: false, privacy_sensitive: false, elevated: false }), TypeError);
    assert.throws(() => obligationOf({ capability_class: "read_only", untrusted_input_facing: "yes" as unknown as boolean, privacy_sensitive: false, elevated: false }), TypeError);
  });

  void it("privacy_sensitive changes no obligation (§3 attaches no control to it)", () => {
    for (const c of COMBINATIONS) assert.deepEqual(obligationOf({ ...c, privacy_sensitive: true }), obligationOf({ ...c, privacy_sensitive: false }));
  });
});

void describe("enforced at construction, through the real gate and registry", () => {
  void it("every combination the table refuses is refused at construction, and every other is served", () => {
    let refusedCount = 0;
    for (const c of COMBINATIONS) {
      const label = JSON.stringify(c);
      // With the best controls: served unless no control can meet the obligation today.
      const withBest = construct(best(c));
      if (unservable(c)) {
        assert.ok(withBest instanceof ObligationError, `${label} with its best controls must be refused, got ${String(withBest)}`);
        refusedCount++;
      } else {
        assert.equal(outcome(withBest), "served", `${label} with its best controls`);
      }
      // With no controls at all: refused exactly when the obligation requires something.
      const bare = construct({ ...c, recoverability_basis: null, containment_domain: null });
      if (obligationOf(c).requires.length > 0) {
        assert.ok(bare instanceof ObligationError, `${label} with no controls must be refused, got ${String(bare)}`);
      } else {
        assert.equal(outcome(bare), "served", `${label} with no controls`);
      }
    }
    assert.equal(refusedCount, 18, "the 16 elevated combinations, and the 2 untrusted arbitrary_exec ones that are not elevated");
  });

  void it("Rule-of-Two refuses an untrusted state_change tool with no containment", () => {
    refused("untrusted state_change, containment null", { capability_class: "state_change", untrusted_input_facing: true }, "CAP-2", /Rule-of-Two: an untrusted-input-facing state_change tool needs containment .* or approval .*; it has neither/);
    served("untrusted state_change with a domain", { capability_class: "state_change", untrusted_input_facing: true, containment_domain: [ROOT] });
    served("trusted state_change, no domain", { capability_class: "state_change" });
  });

  void it("an empty containment set does not discharge Rule-of-Two", () => {
    refused("untrusted state_change, containment []", { capability_class: "state_change", untrusted_input_facing: true, containment_domain: [] }, "CAP-2", /Rule-of-Two/);
  });

  void it("Rule-of-Two refuses an untrusted arbitrary_exec tool, flag off, no approval", () => {
    refused("untrusted arbitrary_exec, EXEC_TOOLS_FORBIDDEN off", { capability_class: "arbitrary_exec", untrusted_input_facing: true }, "CAP-3", /Rule-of-Two: an untrusted-input-facing arbitrary_exec tool needs approval .*; containment cannot discharge it \(N7\)/);
    served("trusted arbitrary_exec, EXEC_TOOLS_FORBIDDEN off (-1002, unchanged)", { capability_class: "arbitrary_exec" });
    // -1002's own checks still run first, with their own error.
    const first = construct({ capability_class: "arbitrary_exec", untrusted_input_facing: true }, true);
    assert.ok(first instanceof Error && !(first instanceof ObligationError) && /EXEC_TOOLS_FORBIDDEN/.test(first.message), String(first));
  });

  void it("owned_state auto-discharges Rule-of-Two: untrusted, no containment, admitted", () => {
    served("untrusted owned_state, containment null", { capability_class: "owned_state", untrusted_input_facing: true, recoverability_basis: "append-only + supersession" });
  });

  void it("owned_state refuses a missing, empty, whitespace or over-long basis", () => {
    const os = (recoverability_basis: string | null): Partial<CapabilityTag> => ({ capability_class: "owned_state", recoverability_basis });
    refused("owned_state, basis null", os(null), "CAP-5", /owned_state must pin a one-line recoverability_basis \(§3\): it is missing/);
    refused("owned_state, basis \"\"", os(""), "CAP-5", /it is empty or whitespace/);
    refused("owned_state, basis \"   \"", os("   "), "CAP-5", /it is empty or whitespace/);
    refused("owned_state, basis U+3000 only", os("　"), "CAP-5", /it is empty or whitespace/);
    refused(`owned_state, basis ${String(MAX_BASIS + 1)} characters`, os("a".repeat(MAX_BASIS + 1)), "CAP-5", /longer than 120 characters/);
    refused(`owned_state, basis ${String(MAX_BASIS + 1)} astral characters`, os("\u{1D400}".repeat(MAX_BASIS + 1)), "CAP-5", /longer than 120 characters/);
    served(`owned_state, basis of exactly ${String(MAX_BASIS)} characters`, os("a".repeat(MAX_BASIS)));
    served(`owned_state, basis of ${String(MAX_BASIS)} astral characters (counted in code points)`, os("\u{1D400}".repeat(MAX_BASIS)));
  });

  void it("owned_state refuses a basis broken by any line terminator or control", () => {
    const breaks: [string, string][] = [
      ["LF", "\n"],
      ["CR", "\r"],
      ["CRLF", "\r\n"],
      ["U+2028 line separator", " "],
      ["U+2029 paragraph separator", " "],
      ["U+0085 next line", "\u0085"],
      ["vertical tab", "\u000b"],
      ["form feed", "\u000c"],
      ["tab", "\t"],
      ["NUL", "\u0000"],
      ["DEL", "\u007f"],
      ["U+202E right-to-left override", "‮"],
      ["U+200B zero-width space", "​"],
    ];
    for (const [name, ch] of breaks) {
      refused(`owned_state, basis with ${name}`, { capability_class: "owned_state", recoverability_basis: `append-only${ch}rm -rf` }, "CAP-5", /it is not one line/);
    }
    // A lone surrogate never reaches the registry: the canonical form refuses it first (A3).
    assert.equal(basisProblem("append-only\ud800"), "it is not one line (a line break, control, format, invisible or unassigned character)");
    // What renders as nothing, or as no agreed glyph (the adversarial pass, §5.2).
    const invisible: [string, string][] = [
      ["U+3164 Hangul filler", "\u3164"],
      ["U+115F Hangul choseong filler", "\u115f"],
      ["U+FFA0 halfwidth Hangul filler", "\uffa0"],
      ["U+034F grapheme joiner", "\u034f"],
      ["U+17B4 Khmer vowel inherent", "\u17b4"],
      ["U+FE0F variation selector", "\ufe0f"],
      ["U+E000 private use", "\ue000"],
      ["U+FFFF noncharacter", "\uffff"],
      ["U+0378 unassigned", "\u0378"],
    ];
    for (const [name, ch] of invisible) {
      refused(`owned_state, basis with ${name}`, { capability_class: "owned_state", recoverability_basis: `append-only${ch}` }, "CAP-5", /it is not one line/);
    }
  });

  void it("owned_state refuses a basis with no letter or digit", () => {
    for (const [name, basis] of [["U+2800 Braille blank", "\u2800"], ["a lone combining acute", "\u0301"], ["punctuation only", "+ / -"], ["Braille blanks", "\u2800".repeat(40)]] as const) {
      refused(`owned_state, basis ${name}`, { capability_class: "owned_state", recoverability_basis: basis }, "CAP-5", /it has no letter or digit/);
    }
    served("owned_state, a basis in another script", { capability_class: "owned_state", recoverability_basis: "仅追加 + 版本化" });
  });

  void it("a basis on any other rung is refused", () => {
    for (const cls of ["read_only", "state_change", "arbitrary_exec"] as const) {
      for (const basis of ["append-only + supersession", ""]) {
        refused(`${cls}, basis ${JSON.stringify(basis)}`, { capability_class: cls, recoverability_basis: basis }, "CAP-6", new RegExp(`recoverability_basis is null unless owned_state \\(§3\\); this tool is ${cls}`));
      }
    }
  });

  void it("any elevated tool is refused while no approval backend exists", () => {
    assert.equal(DEFAULT_APPROVAL_BACKEND, "none");
    for (const c of COMBINATIONS.filter((x) => x.elevated)) {
      refused(`elevated ${c.capability_class}${c.untrusted_input_facing ? ", untrusted" : ""}${c.privacy_sensitive ? ", privacy" : ""}`, best(c), "CAP-7", /elevated requires an approval backend; none is configured/);
    }
  });
});

void describe("the approval path CSR-WO-2001 will open (pure function only; the registry passes the constant)", () => {
  void it("with a backend configured, elevated would discharge Rule-of-Two; with none, nothing elevated is served", () => {
    const t = tag("t", { capability_class: "state_change", untrusted_input_facing: true, elevated: true });
    assert.deepEqual(unmetObligations(t, obligationOf(t), "configured"), []);
    assert.deepEqual(unmetObligations(t, obligationOf(t), "none").map((u) => u.rule), ["CAP-7", "CAP-2"]);
  });
});
