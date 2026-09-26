// CSR-WO-1000 §1.6: property-based tests over the canonical form. Each property checks an
// invariant on the TypeScript canonicalizer, and then sends every input it generated through the
// Python oracle by subprocess, asserting byte equality (or that both refuse). The oracle is written
// from the specification independently, so an agreement here is two implementations agreeing, not
// one agreeing with itself.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import fc from "fast-check";

import { agreement, oracleAnswers, typescriptAnswer, type Request, type Result } from "./harness.ts";

const RUNS = 300;
const counts: string[] = [];

/** Sends every request through both implementations and asserts they agree on each. */
function crossCheck(label: string, requests: readonly Request[]): void {
  const oracle = oracleAnswers(requests);
  const mismatches: string[] = [];
  requests.forEach((r, i) => {
    const ts = typescriptAnswer(r);
    const py = oracle[i] as Result;
    if (agreement(ts) !== agreement(py)) mismatches.push(`${JSON.stringify(r).slice(0, 300)} → ts ${agreement(ts).slice(0, 80)} / oracle ${agreement(py).slice(0, 80)}`);
  });
  const refused = oracle.filter((o) => !o.ok).length;
  assert.deepEqual(mismatches.slice(0, 5), [], `${label}: ${String(mismatches.length)} disagreement(s) with the oracle`);
  counts.push(`${label}: ${String(requests.length)} inputs (${String(requests.length - refused)} canonical, ${String(refused)} refused), ${String(mismatches.length)} mismatches`);
}

const bytesOf = (r: Request): string => agreement(typescriptAnswer(r));

/** JSON text for a value with every object's members in a random order and random whitespace.
 *  Negative zero is written as "-0" so that the text carries it (JSON.stringify would write "0"). */
function toText(v: unknown, rand: () => number): string {
  const ws = (): string => [" ", "", "\n", "\t", ""][Math.floor(rand() * 5)] ?? "";
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : JSON.stringify(v);
  if (Array.isArray(v)) return `[${ws()}${v.map((x) => toText(x, rand)).join(`,${ws()}`)}${ws()}]`;
  if (v !== null && typeof v === "object") {
    const keys = Object.keys(v);
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [keys[i], keys[j]] = [keys[j] as string, keys[i] as string];
    }
    return `{${ws()}${keys.map((k) => `${JSON.stringify(k)}${ws()}:${ws()}${toText((v as Record<string, unknown>)[k], rand)}`).join(`,${ws()}`)}${ws()}}`;
  }
  return JSON.stringify(v);
}

/** A deterministic generator of [0, 1) from a fast-check seed, for shuffles inside a property. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A JSON value with no negative zero anywhere, for requests that travel as a JSON value (the
 *  harness's own transport would turn -0 into 0 for the oracle only). */
function withoutNegativeZero(v: unknown): unknown {
  if (typeof v === "number") return Object.is(v, -0) ? 0 : v;
  if (Array.isArray(v)) return v.map(withoutNegativeZero);
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withoutNegativeZero(x)]));
  return v;
}

const TRICKY = ["e", "́", "é", "Å", "Å", "ﬁ", "﻿", "😀", " ", " ", "\u0000", "\u001f", '"', "\\", "/", "\u007f", "\u0085", "a", "Z", "0"];
const trickyString = fc.string({ unit: fc.oneof(fc.constantFrom(...TRICKY), fc.string({ unit: "binary", minLength: 1, maxLength: 1 })), maxLength: 12 });
const json = fc.jsonValue({ maxDepth: 4, stringUnit: "binary" });
/** Values A2 and A3 accept, so the key-order property compares bytes rather than two refusals. */
const acceptedJson = json.filter((v) => typescriptAnswer({ kind: "json", input_json_text: toText(v, Math.random) }).ok);

void describe("property-based cross-checks: TypeScript canonicalizer × Python oracle", () => {
  void it("A1 key order and whitespace never change the bytes", () => {
    const requests: Request[] = [];
    fc.assert(
      fc.property(acceptedJson, fc.integer(), fc.integer(), (value, s1, s2) => {
        const a: Request = { kind: "json", input_json_text: toText(value, mulberry(s1)) };
        const b: Request = { kind: "json", input_json_text: toText(value, mulberry(s2)) };
        assert.equal(bytesOf(a), bytesOf(b));
        requests.push(a, b);
      }),
      { numRuns: RUNS },
    );
    crossCheck("A1 key order", requests);
  });

  void it("A2 every textual form of a number gives the same bytes; the refusals agree", () => {
    const requests: Request[] = [];
    const boundary = fc.constantFrom(9007199254740991, 9007199254740992, -9007199254740991, -9007199254740992, 1e21, 1e-7, 1e-6, 0.1 + 0.2, 5e-324, -0, 0);
    fc.assert(
      fc.property(fc.oneof(fc.double(), boundary), (n) => {
        if (!Number.isFinite(n)) {
          const special = Number.isNaN(n) ? "NaN" : n > 0 ? "Infinity" : "-Infinity";
          const r: Request = { kind: "json-special", input_special: special };
          assert.equal(bytesOf(r), "refused");
          requests.push(r);
          return;
        }
        const forms = Object.is(n, -0) ? ["-0", "-0.0", "-0e5", "-0E-2"] : [String(n), n.toExponential(), n.toPrecision(17), n.toExponential().toUpperCase()];
        const rs = forms.map((t): Request => ({ kind: "json", input_json_text: t }));
        const first = bytesOf(rs[0] as Request);
        for (const r of rs) assert.equal(bytesOf(r), first, JSON.stringify(r));
        requests.push(...rs);
      }),
      { numRuns: RUNS },
    );
    fc.assert(
      fc.property(fc.bigInt({ min: -(2n ** 60n), max: 2n ** 60n }), (b) => {
        requests.push({ kind: "json", input_json_text: b.toString() }, { kind: "json", input_json_text: `${b.toString()}.5` });
      }),
      { numRuns: RUNS },
    );
    crossCheck("A2 numbers", requests);
  });

  void it("A3 NFC, NFD, NFKC and NFKD forms: no normalization, so distinct text gives distinct bytes", () => {
    const requests: Request[] = [];
    fc.assert(
      fc.property(trickyString, (s) => {
        const forms = (["NFC", "NFD", "NFKC", "NFKD"] as const).map((f) => s.normalize(f));
        const rs = forms.map((f): Request => ({ kind: "json", input_json_text: JSON.stringify(f) }));
        rs.forEach((r, i) => {
          rs.forEach((q, j) => {
            if (bytesOf(r) !== "refused" && bytesOf(q) !== "refused") assert.equal(bytesOf(r) === bytesOf(q), forms[i] === forms[j]);
          });
        });
        requests.push(...rs);
      }),
      { numRuns: RUNS },
    );
    crossCheck("A3 normalization forms", requests);
  });

  void it("A3 a lone surrogate anywhere, or U+FEFF first, is refused by both; U+FEFF elsewhere is kept", () => {
    const requests: Request[] = [];
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 10 }), fc.nat(), fc.integer({ min: 0xd800, max: 0xdfff }), (s, at, unit) => {
        const cut = at % (s.length + 1);
        const esc = (x: string): string => JSON.stringify(x).slice(1, -1);
        // The halves are escaped separately, so a pair split by the cut becomes two escapes; the
        // decoded string decides whether the result is well formed.
        const lone = `"${esc(s.slice(0, cut))}\\u${unit.toString(16)}${esc(s.slice(cut))}"`;
        const decoded = s.slice(0, cut) + String.fromCharCode(unit) + s.slice(cut);
        const rs: Request[] = [
          { kind: "json", input_json_text: lone },
          { kind: "json", input_json_text: JSON.stringify(`\ufeff${s}`) },
          { kind: "json", input_json_text: JSON.stringify(`x\ufeff${s}`) },
          { kind: "json", input_json_text: `{${lone}:1}` },
        ];
        assert.equal(bytesOf(rs[0] as Request) === "refused", !decoded.isWellFormed() || decoded.startsWith("\ufeff"));
        assert.equal(bytesOf(rs[1] as Request), "refused");
        assert.notEqual(bytesOf(rs[2] as Request), "refused");
        requests.push(...rs);
      }),
      { numRuns: RUNS },
    );
    crossCheck("A3 surrogates and BOMs", requests);
  });

  void it("A4 description normalization: idempotent, no trailing [ \\t\\f\\v] on any line, no leading or trailing LF, no CR", () => {
    const requests: Request[] = [];
    const unit = fc.constantFrom("a", "b", " ", "\t", "\f", "\v", "\r", "\n", "\r\n", " ", " ", "　", "\u0085", "​", "é", " ");
    fc.assert(
      fc.property(fc.string({ unit, maxLength: 40 }), (d) => {
        const r: Request = { kind: "description", input: d };
        const out = typescriptAnswer(r);
        assert.ok(out.ok);
        const text = Buffer.from(out.hex, "hex").toString("utf8");
        assert.equal(bytesOf({ kind: "description", input: text }), bytesOf(r), "idempotent");
        assert.ok(!text.includes("\r"));
        assert.ok(!text.startsWith("\n") && !text.endsWith("\n"));
        for (const line of text.split("\n")) assert.ok(!/[ \t\f\v]$/.test(line), JSON.stringify(line));
        requests.push(r);
      }),
      { numRuns: RUNS },
    );
    crossCheck("A4 descriptions", requests);
  });

  void it("A5 names: both accept exactly the pattern, as a whole string", () => {
    const requests: Request[] = [];
    fc.assert(
      fc.property(
        fc.oneof(fc.stringMatching(/^[a-z0-9][a-z0-9._-]{0,70}$/), fc.string({ unit: "binary", maxLength: 8 }), fc.stringMatching(/^[a-z0-9]{1,5}$/).map((s) => `${s}\n`)),
        (name) => {
          requests.push({ kind: "name", input: name });
        },
      ),
      { numRuns: RUNS },
    );
    crossCheck("A5 names", requests);
  });

  const toolArb = fc.record({
    name: fc.stringMatching(/^[a-z0-9][a-z0-9._-]{0,20}$/),
    description: fc.string({ unit: fc.constantFrom("a", " ", "\t", "\n", "\r", " ", "é"), maxLength: 20 }),
    // Values a schema plausibly carries, all within A2's range; out-of-range numbers are A2's own property.
    input_schema: fc
      .dictionary(fc.string({ maxLength: 6 }), fc.oneof(fc.integer(), fc.double({ min: -1e6, max: 1e6, noNaN: true }), fc.boolean(), fc.constant(null), fc.string({ maxLength: 6 }), fc.array(fc.integer(), { maxLength: 3 })))
      .map((d) => withoutNegativeZero(d) as Record<string, unknown>),
    capability_class: fc.constantFrom("read_only", "owned_state", "state_change", "arbitrary_exec"),
    untrusted_input_facing: fc.boolean(),
    scope: fc.string({ maxLength: 8 }),
    privacy_sensitive: fc.boolean(),
    recoverability_basis: fc.option(fc.string({ maxLength: 8 }), { nil: null }),
    elevated: fc.boolean(),
    containment_domain: fc.option(fc.array(fc.constantFrom("a", "B", "b", "notes-file", "ﬁ", "😀"), { maxLength: 6 }), { nil: null }),
  });

  void it("A6–A9 tools: the order of a containment domain never changes the hash; the oracle agrees", () => {
    const requests: Request[] = [];
    fc.assert(
      fc.property(toolArb, fc.integer(), (tool, seed) => {
        const rand = mulberry(seed);
        const shuffled = tool.containment_domain === null ? null : [...tool.containment_domain].sort(() => rand() - 0.5);
        const a: Request = { kind: "tool", input: tool };
        const b: Request = { kind: "tool", input: { ...tool, containment_domain: shuffled } };
        assert.equal(bytesOf(a), bytesOf(b));
        requests.push(a, b);
      }),
      { numRuns: RUNS },
    );
    crossCheck("A6-A9 tools", requests);
  });

  void it("A8 absent, null, {} and [] are four different schemas; a missing top-level field is refused", () => {
    const requests: Request[] = [];
    fc.assert(
      fc.property(toolArb, fc.constantFrom(...(["name", "description", "input_schema", "capability_class", "untrusted_input_facing", "scope", "privacy_sensitive", "recoverability_basis", "elevated", "containment_domain"] as const)), (tool, dropped) => {
        const key = "zz_member";
        const base = { ...tool.input_schema };
        delete base[key];
        const variants = [base, { ...base, [key]: null }, { ...base, [key]: {} }, { ...base, [key]: [] }].map((s): Request => ({ kind: "tool", input: { ...tool, input_schema: s } }));
        if (bytesOf(variants[0] as Request) !== "refused") assert.equal(new Set(variants.map(bytesOf)).size, 4);
        const missing: Request = { kind: "tool", input: Object.fromEntries(Object.entries(tool).filter(([k]) => k !== dropped)) };
        assert.equal(bytesOf(missing), "refused");
        requests.push(...variants, missing);
      }),
      { numRuns: RUNS },
    );
    crossCheck("A8 absent/null/empty", requests);
  });

  void it("A9, A10 manifests: tool order never changes the manifest hash; the oracle agrees", () => {
    const requests: Request[] = [];
    fc.assert(
      fc.property(fc.uniqueArray(toolArb, { selector: (t) => t.name, maxLength: 5 }), fc.integer(), (tools, seed) => {
        const rand = mulberry(seed);
        const a: Request = { kind: "manifest", input: { canonical_form_version: 1, tools } };
        const b: Request = { kind: "manifest", input: { canonical_form_version: 1, tools: [...tools].sort(() => rand() - 0.5) } };
        assert.equal(bytesOf(a), bytesOf(b));
        requests.push(a, b, { kind: "manifest", input: { canonical_form_version: 2, tools } });
      }),
      { numRuns: RUNS },
    );
    crossCheck("A9-A10 manifests", requests);
    console.log(`PROPERTIES\n  ${counts.join("\n  ")}`);
  });
});
