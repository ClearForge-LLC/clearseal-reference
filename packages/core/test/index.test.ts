import assert from "node:assert/strict";
import { test } from "node:test";

import { PACKAGE_NAME } from "../src/index.ts";

void test("PACKAGE_NAME is the published package name", () => {
  assert.equal(PACKAGE_NAME, "deliberately-wrong");
});
