// The operator's audit command (CSR-WO-2002 §1.4), beside `pin` and the same shape:
//
//   npm run audit -- verify --log <file> --anchor <file> --keys <allowlist.json>
//
// Checks every prev link, every checkpoint's signature against the allowlist (kid known, checkpoint
// time inside that key's window), and that each checkpoint's head and count match the log. Prints the
// first failure first, then every failure, one per line. Exits 0 on a clean log, 1 on any tampering,
// 2 on a usage error, and 3 when the only finding is a torn final line (a crash mid-write).

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { parseAllowlist } from "./signer.ts";
import { verifyAudit } from "./verify.ts";

const USAGE = "usage: npm run audit -- verify --log <file> --anchor <file> --keys <allowlist.json>";

export function runAudit(argv: readonly string[], out: (line: string) => void = console.log, err: (line: string) => void = console.error): number {
  const [command, ...rest] = argv;
  const opts = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (flag === undefined || !["--log", "--anchor", "--keys"].includes(flag) || value === undefined || opts.has(flag)) {
      err(USAGE);
      return 2;
    }
    opts.set(flag, value);
  }
  const log = opts.get("--log");
  const anchor = opts.get("--anchor");
  const keys = opts.get("--keys");
  if (command !== "verify" || log === undefined || anchor === undefined || keys === undefined) {
    err(USAGE);
    return 2;
  }
  let report: ReturnType<typeof verifyAudit>;
  try {
    report = verifyAudit(readFileSync(log), readFileSync(anchor), parseAllowlist(readFileSync(keys, "utf8")));
  } catch (e) {
    err(`audit verify: ${e instanceof Error ? e.message : "cannot read its inputs"}`);
    return 2;
  }
  const first = report.findings[0];
  const summary = `${String(report.rows)} rows, ${String(report.checkpoints)} checkpoints, ${String(report.unanchored)} row(s) after the last checkpoint (truncatable unseen)`;
  if (first === undefined) out(`audit verify: ok — ${summary}`);
  else out(`audit verify: ${report.exitCode === 3 ? "TORN" : "FAILED"} — first: ${first.kind} at ${first.where}: ${first.detail} (${summary})`);
  for (const f of report.findings) out(`  ${f.kind}  ${f.where}  ${f.detail}`);
  return report.exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = runAudit(process.argv.slice(2));
}
