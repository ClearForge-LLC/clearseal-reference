// The suite refuses a runtime other than the pinned one (CSR-WO-0002a §1.3). `.npmrc`'s
// engine-strict guards the install; this guards the suite, including a run where no install
// happened. It exits non-zero, naming both versions, on a mismatch or a missing `.node-version`.

import { readFileSync } from "node:fs";

let pinned;
try {
  pinned = readFileSync(".node-version", "utf8").trim();
} catch {
  pinned = "";
}
const running = process.version.replace(/^v/, "");
if (pinned === "") {
  console.error(`check-node: FAIL — .node-version is missing or empty; running ${running}`);
  process.exitCode = 1;
} else if (running !== pinned) {
  console.error(`check-node: FAIL — .node-version pins ${pinned}; running ${running}`);
  process.exitCode = 1;
} else {
  console.log(`check-node: ${running} matches .node-version`);
}
