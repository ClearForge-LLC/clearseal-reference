// CSR-WO-2008a §1.2: the control-deletion runner's shards partition its manifest. For every n from 1 to
// 8, over the real manifest and over synthetic ones of 1, 7 and 200 rows, every row lands in exactly one
// shard, the union of the n shards is the manifest, and each shard keeps manifest order. The refused
// arguments are each a test, through the command line as CI calls it. Run by CI's control-deletion
// self-test job: `node scripts/test.mjs "scripts/control-deletion.test.mjs"`.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

import { loadManifest, parseShard, shardOf } from "./control-deletion.mjs";

const RUNNER = path.join(import.meta.dirname, "control-deletion.mjs");
const MANIFEST = path.join(import.meta.dirname, "..", "test", "deletion", "controls.json");

/** @param {string[]} args */
function runner(args) {
  const r = spawnSync(process.execPath, [RUNNER, ...args], { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

/** @param {number} count */
const synthetic = (count) => Array.from({ length: count }, (_, k) => ({ id: `row-${String(k)}` }));

/**
 * Asserts shards 1..n of `rows` are a partition of it, in manifest order.
 * @param {string} label
 * @param {readonly { id: string }[]} rows
 * @param {number} n
 */
function assertPartition(label, rows, n) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  let total = 0;
  for (let i = 1; i <= n; i++) {
    const shard = shardOf(rows, i, n);
    // Deterministic: the same manifest gives the same shard.
    assert.deepEqual(shardOf(rows, i, n), shard, `${label}: shard ${String(i)}/${String(n)} changed between calls`);
    // In manifest order.
    const order = shard.map((r) => rows.indexOf(r));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `${label}: shard ${String(i)}/${String(n)} is out of manifest order`);
    for (const row of shard) seen.set(row.id, (seen.get(row.id) ?? 0) + 1);
    total += shard.length;
  }
  const twice = [...seen].filter(([, c]) => c !== 1).map(([id]) => id);
  assert.deepEqual(twice, [], `${label}, n=${String(n)}: rows in more than one shard`);
  assert.equal(total, rows.length, `${label}, n=${String(n)}: the shards hold ${String(total)} rows, the manifest ${String(rows.length)}`);
  assert.deepEqual([...seen.keys()].sort(), rows.map((r) => r.id).sort(), `${label}, n=${String(n)}: the union is not the manifest`);
}

void describe("CSR-WO-2008a §1.2: the shards partition the manifest", () => {
  const { rows: real, problems } = loadManifest(MANIFEST);
  const manifests = /** @type {const} */ ([
    ["the real manifest", real],
    ["a synthetic manifest of 1 row", synthetic(1)],
    ["a synthetic manifest of 7 rows", synthetic(7)],
    ["a synthetic manifest of 200 rows", synthetic(200)],
  ]);

  void it("the real manifest loads", () => {
    assert.deepEqual(problems, []);
    assert.ok(real.length > 0);
  });

  for (const [label, rows] of manifests) {
    void it(`${label}: for every n from 1 to 8, every row is in exactly one shard and the union is the manifest`, () => {
      for (let n = 1; n <= 8; n++) assertPartition(label, rows, n);
      console.log(`PARTITION ${label} (${String(rows.length)} rows): n=1..8 total and disjoint; shard sizes at n=4: ${[1, 2, 3, 4].map((i) => shardOf(rows, i, 4).length).join(", ")}`);
    });
  }

  void it("one shard of one is the whole manifest, in order", () => {
    assert.deepEqual(shardOf(real, 1, 1), real);
  });

  void it("--list --shard prints exactly the shard's rows, in order, and together the shards list the manifest", () => {
    /** @type {string[]} */
    const listed = [];
    for (let i = 1; i <= 4; i++) {
      const r = runner(["--shard", `${String(i)}/4`, "--list"]);
      assert.equal(r.status, 0, r.out);
      const ids = r.out.split("\n").filter((l) => /^[a-z0-9-]+ \| /.test(l)).map((l) => l.split(" | ")[0] ?? "");
      assert.deepEqual(ids, shardOf(real, i, 4).map((row) => row.id));
      assert.match(r.out, new RegExp(`shard ${String(i)}/4: ${String(ids.length)} of the manifest's ${String(real.length)} row\\(s\\)`));
      listed.push(...ids);
    }
    assert.deepEqual(listed.sort(), real.map((row) => row.id).sort());
  });

  void it("a shard with no rows exits 0 and says so, with --list and without", () => {
    const n = real.length + 1;
    for (const extra of [["--list"], []]) {
      const r = runner(["--shard", `${String(n)}/${String(n)}`, ...extra]);
      assert.equal(r.status, 0, r.out);
      assert.match(r.out, new RegExp(`shard ${String(n)}/${String(n)}: no rows \\(the manifest has ${String(real.length)}\\); nothing to run`));
    }
  });
});

void describe("CSR-WO-2008a §1.2: refused shard arguments", () => {
  /** @type {[string, RegExp][]} */
  const refused = [
    ["0/4", /--shard 0\/4: shards are numbered from 1/],
    ["5/4", /--shard 5\/4: there is no shard 5 of 4/],
    ["2/0", /--shard 2\/0: n must be at least 1/],
    ["a/b", /--shard a\/b: expected <i>\/<n>, shard i of n, as 2\/4/],
    ["2", /--shard 2: expected <i>\/<n>, shard i of n, as 2\/4/],
    // The review pass's I1 and I2: a leading zero, and no value at all.
    ["01/4", /--shard 01\/4: write the numbers without a leading zero/],
    ["", /--shard needs a value, <i>\/<n>/],
  ];
  for (const [arg, message] of refused) {
    void it(`--shard ${arg} is refused with exit 2, and no row is listed`, () => {
      if (arg !== "") assert.equal(typeof parseShard(arg), "string");
      const r = runner(arg === "" ? ["--shard"] : ["--shard", arg, "--list"]);
      assert.equal(r.status, 2, r.out);
      assert.match(r.out, message);
      assert.doesNotMatch(r.out, /^[a-z0-9-]+ \| /m, "a row was listed");
      console.log(`REFUSED --shard ${arg}: exit ${String(r.status)}: ${r.out.split("\n")[0] ?? ""}`);
    });
  }

  void it("--shard with --row, --shard twice, and --self-test with anything else are refused with exit 2", () => {
    /** @type {[string[], RegExp][]} */
    const cases = [
      [["--shard", "1/2", "--row", "pin-gate-drift", "--list"], /--shard and --row choose rows two ways; give one/],
      [["--row", "pin-gate-drift", "--shard", "1/2", "--list"], /--shard and --row choose rows two ways; give one/],
      [["--shard", "1/2", "--shard", "2/2", "--list"], /--shard given twice/],
      // The review pass's L1: --self-test used to run and ignore the rest of the line.
      [["--shard", "1/4", "--self-test", "--list"], /--self-test runs alone/],
      [["--self-test", "--shard", "0/4"], /--self-test runs alone/],
    ];
    for (const [args, message] of cases) {
      const r = runner(args);
      assert.equal(r.status, 2, `${args.join(" ")}: ${r.out}`);
      assert.match(r.out, message);
    }
  });

  void it("well-formed shards parse", () => {
    assert.deepEqual(parseShard("1/1"), { i: 1, n: 1 });
    assert.deepEqual(parseShard("4/4"), { i: 4, n: 4 });
    assert.deepEqual(parseShard("3/8"), { i: 3, n: 8 });
  });
});
