// CSR-WO-1004 §1.1: the teaching node's configuration is validated by its schema at start, and a
// value outside it refuses start (N4). Each case starts a real node through start().

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { cleanup, definitionsFor, notesRoot, pin, restoreEnv, startNode, TestIssuer } from "./node.ts";

let issuer: TestIssuer;
let root: string;
let manifest: string;

before(async () => {
  issuer = await TestIssuer.start();
  root = notesRoot();
  manifest = pin(definitionsFor(root), root);
});
after(async () => {
  await issuer.close();
  restoreEnv();
  cleanup(root);
});

void describe("the teaching configuration", () => {
  const cases: [string, Record<string, string | undefined>, RegExp][] = [
    ["no resource URL", { TEACHING_RESOURCE_URL: undefined }, /does not match its schema/],
    ["a port that is not a number", { TEACHING_PORT: "http" }, /does not match its schema/],
    ["a port over 65535", { TEACHING_PORT: "70000" }, /0 to 65535/],
    ["an unknown TEACHING_ variable", { TEACHING_COLOUR: "blue" }, /does not match its schema: .*TEACHING_COLOUR/],
    ["a relative notes root", { TEACHING_NOTES_ROOT: "notes" }, /does not match its schema/],
  ];
  for (const [label, env, message] of cases) {
    void it(`refuses start: ${label}`, async () => {
      let err: unknown;
      try {
        const n = await startNode(issuer, root, manifest, env);
        await n.close();
      } catch (e) {
        err = e;
      }
      restoreEnv();
      assert.match(String(err), message, label);
    });
  }

  void it("the valid configuration starts", async () => {
    const n = await startNode(issuer, root, manifest);
    await n.close();
    restoreEnv();
  });
});
