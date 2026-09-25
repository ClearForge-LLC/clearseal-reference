// Turns `npm audit --json` output into a job summary (CSR-WO-0002 §1.8). It REPORTS and never fails
// the build: a new advisory in a transitive dependency must not block an unrelated pull request.
// The summary says plainly when the audit could not run, so a silent summary is never a clean one.
//
// Usage: node .github/scripts/audit-summary.mjs <audit.json>   (appends to $GITHUB_STEP_SUMMARY)

import { appendFileSync, readFileSync } from "node:fs";

const file = process.argv[2] ?? "audit.json";
const out = process.env.GITHUB_STEP_SUMMARY;
const lines = ["## Dependency audit (npm audit, level high and above; reporting only)", ""];

/** @type {{ metadata?: { vulnerabilities?: Record<string, number>, dependencies?: { total?: number } }, vulnerabilities?: Record<string, { severity?: string, via?: unknown[], fixAvailable?: unknown }> } | undefined} */
let report;
try {
  const parsed = /** @type {unknown} */ (JSON.parse(readFileSync(file, "utf8")));
  report = typeof parsed === "object" && parsed !== null ? /** @type {typeof report} */ (parsed) : undefined;
} catch {
  report = undefined;
}

const counts = report?.metadata?.vulnerabilities;
if (report === undefined || counts === undefined) {
  lines.push("**The audit did not complete** (no readable report). This run has no audit result.");
} else {
  const high = (counts.high ?? 0) + (counts.critical ?? 0);
  lines.push(
    `Dependencies audited: ${String(report.metadata?.dependencies?.total ?? "unknown")}. ` +
      `Findings at high or critical: **${String(high)}** ` +
      `(critical ${String(counts.critical ?? 0)}, high ${String(counts.high ?? 0)}, ` +
      `moderate ${String(counts.moderate ?? 0)}, low ${String(counts.low ?? 0)}, info ${String(counts.info ?? 0)}).`,
  );
  const rows = Object.entries(report.vulnerabilities ?? {}).filter(([, v]) => v.severity === "high" || v.severity === "critical");
  if (rows.length > 0) {
    lines.push("", "| Package | Severity | Fix available |", "|---|---|---|");
    for (const [name, v] of rows) lines.push(`| \`${name}\` | ${v.severity ?? "?"} | ${v.fixAvailable ? "yes" : "no"} |`);
  }
}
lines.push("");
const text = lines.join("\n");
console.log(text);
if (out !== undefined) appendFileSync(out, `${text}\n`);
