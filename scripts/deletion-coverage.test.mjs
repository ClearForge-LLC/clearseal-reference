// CSR-WO-2008c §1.5: the coverage detector (scripts/deletion-coverage.mjs). The planted inputs are
// permanent red-proofs: each plants one gap and requires the detector to name it. The last test runs
// it over the real repository and prints every gap. Run by `npm test`:
// `node scripts/test.mjs "scripts/deletion-coverage.test.mjs"`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { detect, detectRepo, parseCheckIds, parseSection8, titlesIn } from "./deletion-coverage.mjs";

const ARCH = [
  "## 8. Traceability",
  "",
  "| Control | ClearSeal | Core module | Red-proof | Status |",
  "|---|---|---|---|---|",
  "| Alpha control | §1 | `a` | x | **built** — P1 |",
  "| Beta `control` | §1 | `b` | x | built — P1 |",
  "| Gamma control | §1 | `c` | x | planned — P2 |",
  "| Delta control | §1 | `d` | x | deferred — trigger |",
  "| Exempt control | §1 | `e` | x | **built** — P0 |",
  "",
  "## 9. Open questions",
  "| Not | a | row | x | built |",
].join("\n");
const CHECKS = ["| # | Check | Source |", "|---|---|---|", "| H1 | one | RFC |", "| H3a | two | RFC |", "| K2 | three | RFC |"].join("\n");

/** @returns {Parameters<typeof detect>[0] & { rows: { id: string, section8?: string, tests: string[], mustFail: string[], checks: string[] }[], testFiles: string[], unlisted: { path: string, reason: string }[], exempt: { section8?: string, check?: string, control?: string, reason: string }[], titlesOf: (f: string) => { text: string, prefix: boolean }[] }} */
const good = () => ({
  rows: [
    { id: "r1", section8: "Alpha control", tests: ["packages/x/test/a.test.ts"], mustFail: ["a refuses"], checks: ["H1", "H3a"] },
    { id: "r2", section8: "Beta control", tests: ["packages/x/test/b.test.ts"], mustFail: ["refused: case one"], checks: ["K2"] },
  ],
  testFiles: ["packages/x/test/a.test.ts", "packages/x/test/b.test.ts", "packages/x/test/m.test.ts"],
  unlisted: [{ path: "packages/x/test/m.test.ts", reason: "a measurement" }],
  exempt: [{ section8: "Exempt control", reason: "proven elsewhere" }],
  architecture: ARCH,
  checksMd: CHECKS,
  exists: () => true,
  /** @param {string} f */
  titlesOf: (f) => (f.endsWith("a.test.ts") ? [{ text: "a refuses", prefix: false }] : [{ text: "refused: ", prefix: true }]),
});

void describe("deletion coverage detector: parsing", () => {
  void it("reads built rows by the leading word, bold or not, and ignores other tables", () => {
    const rows = parseSection8(ARCH);
    assert.deepEqual(
      rows.map((r) => [r.title, r.built]),
      [["Alpha control", true], ["Beta control", true], ["Gamma control", false], ["Delta control", false], ["Exempt control", true]],
    );
  });
  void it("reads check ids from the first cell", () => {
    assert.deepEqual(parseCheckIds(CHECKS), ["H1", "H3a", "K2"]);
  });
});

void describe("deletion coverage detector: planted inputs", () => {
  void it("a clean planted input is green", () => {
    assert.deepEqual(detect(good()).failures, []);
  });

  void it("(a) a planted unlisted test file is red, and names its path", () => {
    const input = good();
    input.testFiles.push("packages/x/test/planted-unlisted.test.ts");
    const f = detect(input).failures;
    assert.equal(f.length, 1);
    assert.match(f[0] ?? "", /packages\/x\/test\/planted-unlisted\.test\.ts/);
  });

  void it("(a) an unlisted entry for a missing file, a file a row lists, or with no reason is red", () => {
    const input = good();
    input.unlisted.push({ path: "packages/x/test/gone.test.ts", reason: "x" });
    input.unlisted.push({ path: "packages/x/test/a.test.ts", reason: "x" });
    input.unlisted.push({ path: "packages/x/test/m.test.ts", reason: "  " });
    input.exists = (p) => p !== "packages/x/test/gone.test.ts";
    const f = detect(input).failures;
    assert.equal(f.length, 3, f.join("\n"));
    assert.ok(f.some((m) => /gone\.test\.ts.*does not exist/.test(m)));
    assert.ok(f.some((m) => /a\.test\.ts.*a row also lists/.test(m)));
    assert.ok(f.some((m) => /m\.test\.ts.*empty reason/.test(m)));
  });

  void it("(b) a planted built §8 row with no deletion row is red, and names its title", () => {
    const input = good();
    input.architecture = ARCH.replace("| Gamma control | §1 | `c` | x | planned — P2 |", "| Planted built control | §1 | `p` | x | **built** — P9 |");
    const f = detect(input).failures;
    assert.equal(f.length, 1);
    assert.match(f[0] ?? "", /Planted built control/);
  });

  void it("(b) a row naming no §8 title, and a stale exemption, are red", () => {
    const input = good();
    input.rows.push({ id: "r3", section8: "No such title", tests: [], mustFail: [], checks: [] });
    input.exempt.push({ section8: "Gamma control", reason: "x" }); // not built
    input.exempt.push({ section8: "Alpha control", reason: "x" }); // has a row
    input.exempt.push({ section8: "Nowhere", reason: "x" });
    const f = detect(input).failures;
    assert.equal(f.length, 4, f.join("\n"));
    assert.ok(f.some((m) => /r3.*No such title/.test(m)));
    assert.ok(f.some((m) => /exempts "Gamma control"/.test(m)));
    assert.ok(f.some((m) => /exempts "Alpha control"/.test(m)));
    assert.ok(f.some((m) => /"Nowhere"/.test(m)));
  });

  void it("(c) a check id named twice is red, and names the id and both rows", () => {
    const input = good();
    input.rows[1]?.checks.push("H1");
    const f = detect(input).failures;
    assert.equal(f.length, 1);
    assert.match(f[0] ?? "", /H1.*r1, r2/);
  });

  void it("(c) a check id named by no row is red, and names the id", () => {
    const input = good();
    input.rows[1]?.checks.pop();
    const f = detect(input).failures;
    assert.equal(f.length, 1);
    assert.match(f[0] ?? "", /K2.*no row/);
  });

  void it("(c) a check id no row names is green when exempt with a reason, and the exemption goes stale when a row names it", () => {
    const input = good();
    input.rows[1]?.checks.pop();
    input.exempt.push({ check: "K2", reason: "an absence: no code to delete" });
    assert.deepEqual(detect(input).failures, []);
    input.rows[1]?.checks.push("K2");
    const f = detect(input).failures;
    assert.equal(f.length, 1);
    assert.match(f[0] ?? "", /exempts check K2, but a row names it/);
  });

  void it("(c) an exemption for an id not in CHECKS.md, or with no reason, is red", () => {
    const input = good();
    input.exempt.push({ check: "Z9", reason: "x" }, { check: "H1", reason: " " });
    const f = detect(input).failures;
    assert.ok(f.some((m) => /exempts check Z9, which is not in/.test(m)));
    assert.ok(f.some((m) => /check H1 has an empty reason/.test(m)));
  });

  void it("(c) a `checks` entry naming an id not in CHECKS.md is red", () => {
    const input = good();
    input.rows[0]?.checks.push("Z9");
    const f = detect(input).failures;
    assert.equal(f.length, 1);
    assert.match(f[0] ?? "", /Z9/);
  });
});

void describe("deletion coverage detector: the real repository", () => {
  void it("every test file, built §8 row and CHECKS.md check is covered", () => {
    const { failures, section8, checkIds } = detectRepo();
    const built = section8.filter((s) => s.built).map((s) => s.title);
    const header = [
      `parsed ${String(section8.length)} §8 rows, ${String(built.length)} built:`,
      ...built.map((t) => `  - ${t}`),
      `parsed ${String(checkIds.length)} CHECKS.md ids: ${checkIds.join(" ")}`,
    ].join("\n");
    assert.ok(failures.length === 0, `\n${header}\n${String(failures.length)} gap(s):\n${failures.map((m) => `  * ${m}`).join("\n")}\n`);
  });
});

void describe("deletion coverage detector: what it must not skip (CSR-WO-2008c adversarial pass)", () => {
  void it("(a) a listed file none of whose tests any row names is red", () => {
    const input = good();
    if (input.rows[0] !== undefined) input.rows[0].mustFail = ["something else"];
    const f = detect(input).failures;
    assert.equal(f.length, 1);
    assert.match(f[0] ?? "", /a\.test\.ts: a row lists it, but no row names any of its tests/);
  });

  void it("(a) a template title is matched by its literal prefix", () => {
    assert.deepEqual(titlesIn("void it(`refused: ${label}`, () => {}); void it('plain', () => {});"), [{ text: "refused: ", prefix: true }, { text: "plain", prefix: false }]);
  });

  void it("(a) an empty glob is red, not a pass over nothing", () => {
    const input = good();
    input.testFiles = [];
    input.unlisted = [];
    assert.ok(detect(input).failures.some((m) => /no test files were found/.test(m)));
  });

  void it("(b) a built row written with a leading space is still read", () => {
    const input = good();
    input.architecture = input.architecture.replace("| Exempt control |", "  | Exempt control |");
    input.exempt = [];
    assert.ok(detect(input).failures.some((m) => /"Exempt control" is marked built and has no deletion row/.test(m)));
  });

  void it("(b) a status that mentions built without leading with it is red", () => {
    for (const status of ["partly built", "✅ built"]) {
      const input = good();
      input.architecture = input.architecture.replace("| x | planned — P2 |", `| x | ${status} — P2 |`);
      assert.ok(detect(input).failures.some((m) => /mentions built but does not lead with it/.test(m)), status);
    }
  });

  void it("(c) a check id in a form the parser does not read is red", () => {
    for (const line of ["| **G6** | six | RFC |", "| G7 (layer) | seven | RFC |"]) {
      const input = good();
      input.checksMd = `${input.checksMd}\n${line}`;
      assert.ok(detect(input).failures.some((m) => /looks like a check but its id is not in the form/.test(m)), line);
    }
  });

  void it("(b) an exemption must name one thing, and a control exemption needs its reason", () => {
    const input = good();
    input.exempt.push({ control: "An absence", reason: "no code to delete" });
    assert.deepEqual(detect(input).failures, []);
    input.exempt.push({ control: "Another", reason: "" }, { reason: "names nothing" });
    const f = detect(input).failures;
    assert.ok(f.some((m) => /"Another" has an empty reason/.test(m)));
    assert.ok(f.some((m) => /must name exactly one of section8, check or control/.test(m)));
  });
});
