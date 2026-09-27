// `audit verify` (CSR-WO-2002 §1.4; audit/RULES.md AU-13 to AU-20). Checks every prev link, every
// checkpoint's signature against a key allowlist (kid known, time inside that key's window), and that
// each checkpoint's head and count match the log. Every failure is named, the first one first.
//
// A torn final line, and why it is its own kind. The store writes each row as one write of the line
// and its newline, so a crash mid-write leaves exactly one shape: a last line with no newline. An edit
// anywhere before the end leaves every earlier line newline-terminated and shows as a chain or
// checkpoint break instead. So a missing final newline is reported as `torn-final-line`, never as
// tampering, and `audit verify` exits 3 when it is the only finding (1 for any tamper, 0 clean). The
// store refuses to start on a torn log, so the operator decides before the log grows. A checkpoint
// never covers a torn line (the log is fsync-ed before each one), so a torn row a checkpoint counts
// is reported as a truncation, which is tampering.

import { canonicalJson, parseCanonicalJson } from "../pinning/canonical.ts";
import { type Checkpoint, checkpointPayload, GENESIS, lineHash } from "./chain.ts";
import { type KeyEntry, SIGNATURE_FORM, verifyWith } from "./signer.ts";

export type FindingKind =
  | "torn-final-line"
  | "malformed-row"
  | "non-canonical-row"
  | "edited-row"
  | "removed-rows"
  | "reordered-rows"
  | "inserted-rows"
  | "malformed-checkpoint"
  | "unknown-kid"
  | "key-out-of-window"
  | "bad-signature"
  | "checkpoint-replayed"
  | "truncated-behind-checkpoint"
  | "head-mismatch";

export interface Finding {
  readonly kind: FindingKind;
  /** "log line N" or "anchor line N", 1-based. */
  readonly where: string;
  readonly detail: string;
}

export interface VerifyReport {
  readonly ok: boolean;
  readonly findings: readonly Finding[];
  readonly rows: number;
  readonly checkpoints: number;
  /** Rows after the last checkpoint: the window truncation can remove undetected (AU-12). */
  readonly unanchored: number;
  /** 0 clean, 1 tampering, 3 only a torn final line. */
  readonly exitCode: 0 | 1 | 3;
}

interface ParsedRow {
  seq: number;
  prev: string;
}

/** Decodes a file's bytes as UTF-8, strictly: an invalid sequence is a finding, never a replacement
 *  character, so the text hashed is the bytes on disk and no row has two byte spellings (AU-1, AU-16). */
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
export function decodeStrict(input: string | Uint8Array): string | undefined {
  if (typeof input === "string") return input;
  try {
    return UTF8.decode(input);
  } catch {
    return undefined;
  }
}

/**
 * Splits text into complete lines and a torn tail. A tail that parses as a complete canonical line
 * (a newline removed, not a crash) is checked like any other line and still reported as torn: removing
 * a final newline never hides the line from the checks (AU-20).
 */
function lines(text: string): { complete: string[]; torn: string | undefined } {
  if (text === "") return { complete: [], torn: undefined };
  const parts = text.split("\n");
  const last = parts.pop() as string;
  if (last === "") return { complete: parts, torn: undefined };
  const whole = canonical(last);
  return { complete: "value" in whole ? [...parts, last] : parts, torn: last };
}

/** Parses a line as canonical JSON and checks it is the one serialization of its content (AU-16). */
function canonical(line: string): { value: Record<string, unknown> } | { error: string; nonCanonical: boolean } {
  let value: unknown;
  try {
    value = parseCanonicalJson(line);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "not JSON", nonCanonical: false };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { error: "not an object", nonCanonical: false };
  let again: string;
  try {
    again = canonicalJson(value);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "not canonical", nonCanonical: true };
  }
  if (again !== line) return { error: "the line is not the canonical serialization of its own content", nonCanonical: true };
  return { value: value as Record<string, unknown> };
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Verifies a log and its anchor against a key allowlist. */
export function verifyAudit(logInput: string | Uint8Array, anchorInput: string | Uint8Array, allowlist: readonly KeyEntry[]): VerifyReport {
  const findings: Finding[] = [];
  const add = (kind: FindingKind, where: string, detail: string): void => {
    findings.push({ kind, where, detail });
  };
  const logText = decodeStrict(logInput);
  const anchorText = decodeStrict(anchorInput);
  if (logText === undefined) add("malformed-row", "log line 1", "the log is not valid UTF-8: a byte sequence was altered, and no row may be read two ways");
  if (anchorText === undefined) add("malformed-checkpoint", "anchor line 1", "the anchor is not valid UTF-8");
  if (logText === undefined || anchorText === undefined) return { ok: false, findings, rows: 0, checkpoints: 0, unanchored: 0, exitCode: 1 };

  // The log: each line canonical, then seq order, then the prev links.
  const log = lines(logText);
  const rows: (ParsedRow | undefined)[] = log.complete.map((line, i) => {
    const r = canonical(line);
    if ("error" in r) {
      add(r.nonCanonical ? "non-canonical-row" : "malformed-row", `log line ${String(i + 1)}`, r.error);
      return undefined;
    }
    const { seq, prev } = r.value;
    if (typeof seq !== "number" || !Number.isSafeInteger(seq) || typeof prev !== "string" || !HEX64.test(prev) || typeof r.value["event"] !== "string" || typeof r.value["principal"] !== "string" || typeof r.value["time"] !== "string" || typeof r.value["fields"] !== "object") {
      add("malformed-row", `log line ${String(i + 1)}`, "not a row { seq, time, event, principal, fields, prev }");
      return undefined;
    }
    return { seq, prev };
  });
  if (log.torn !== undefined) {
    const checked = log.complete[log.complete.length - 1] === log.torn;
    add("torn-final-line", `log line ${String(checked ? log.complete.length : log.complete.length + 1)}`, checked ? "the log does not end with a newline, though its last line is a complete row: it is checked like the rest" : "the log does not end with a newline: its last line is incomplete (a crash mid-write), and is not part of the chain");
  }

  // Seq: 0, 1, 2, … with no gap, no repeat and no reversal (AU-14, AU-15).
  const seqs = rows.map((r) => r?.seq);
  const known = seqs.filter((s): s is number => s !== undefined);
  const sorted = [...known].sort((a, b) => a - b);
  const isPermutation = sorted.every((s, i) => s === i) && known.length === rows.length;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r === undefined) continue;
    const before = i === 0 ? -1 : seqs[i - 1];
    if (before === undefined) continue;
    if (r.seq === before + 1) continue;
    const repeated = known.indexOf(r.seq) !== known.lastIndexOf(r.seq);
    // Every seq present exactly once, in the wrong order: reordered, and nothing is missing.
    if (isPermutation) {
      if (r.seq !== i) add("reordered-rows", `log line ${String(i + 1)}`, `seq ${String(r.seq)} at position ${String(i)}, after seq ${String(before)}: rows were reordered`);
    } else if (repeated) add("inserted-rows", `log line ${String(i + 1)}`, `seq ${String(r.seq)} follows seq ${String(before)} and appears twice: rows were inserted or spliced`);
    else if (r.seq <= before) add("reordered-rows", `log line ${String(i + 1)}`, `seq ${String(r.seq)} follows seq ${String(before)}: rows were reordered`);
    else add("removed-rows", `log line ${String(i + 1)}`, `seq ${String(r.seq)} follows seq ${String(before)}: ${String(r.seq - before - 1)} row(s) removed`);
  }
  if (rows[0] !== undefined && rows[0].seq !== 0 && !findings.some((f) => f.where === "log line 1")) add("removed-rows", "log line 1", `the log starts at seq ${String(rows[0].seq)}: ${String(rows[0].seq)} row(s) removed from its start`);

  // Prev links, where seq is in order (AU-13): a mismatch means the row before was edited.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r === undefined) continue;
    if (i === 0) {
      if (r.seq === 0 && r.prev !== GENESIS) add("edited-row", "log line 1", "the first row's prev is not the genesis value: the row, or the rows before it, were edited or removed");
      continue;
    }
    const p = rows[i - 1];
    if (p === undefined || r.seq !== p.seq + 1) continue;
    if (r.prev !== lineHash(log.complete[i - 1] as string)) add("edited-row", `log line ${String(i)}`, `the row at seq ${String(p.seq)} was edited: seq ${String(r.seq)}'s prev does not match its bytes`);
  }

  // The anchor (AU-17 to AU-19).
  const anchor = lines(anchorText);
  let expectedSeq = 0;
  let lastCount = 0;
  let lastCovered = 0;
  const keys = new Map(allowlist.map((k) => [k.kid, k]));
  anchor.complete.forEach((line, i) => {
    const where = `anchor line ${String(i + 1)}`;
    const r = canonical(line);
    if ("error" in r) {
      add("malformed-checkpoint", where, r.error);
      return;
    }
    const c = r.value as Partial<Checkpoint>;
    if (typeof c.kid !== "string" || typeof c.seq !== "number" || typeof c.head !== "string" || !HEX64.test(c.head) || typeof c.count !== "number" || !Number.isSafeInteger(c.count) || c.count < 1 || typeof c.time !== "string" || typeof c.sig !== "string" || !SIGNATURE_FORM.test(c.sig) || Object.keys(c).length !== 6) {
      add("malformed-checkpoint", where, "not a checkpoint { kid, seq, head, count ≥ 1, time, sig } with a signature in its one base64url spelling");
      return;
    }
    const key = keys.get(c.kid);
    if (key === undefined) add("unknown-kid", where, `kid ${c.kid} is not in the key allowlist`);
    else {
      const t = Date.parse(c.time);
      if (Number.isNaN(t) || t < Date.parse(key.notBefore) || t > Date.parse(key.notAfter)) add("key-out-of-window", where, `checkpoint time ${c.time} is outside kid ${c.kid}'s window ${key.notBefore} to ${key.notAfter}`);
      if (!verifyWith(key, checkpointPayload({ kid: c.kid, seq: c.seq, head: c.head, count: c.count, time: c.time }), Buffer.from(c.sig, "base64url"))) add("bad-signature", where, `the signature does not verify under kid ${c.kid}`);
    }
    if (c.seq !== expectedSeq || c.count < lastCount) add("checkpoint-replayed", where, `checkpoint seq ${String(c.seq)} (count ${String(c.count)}) where seq ${String(expectedSeq)} (count at least ${String(lastCount)}) was expected: a checkpoint was replayed, removed or reordered`);
    expectedSeq = Math.max(expectedSeq, c.seq + 1);
    lastCount = Math.max(lastCount, c.count);
    if (c.count > log.complete.length) add("truncated-behind-checkpoint", where, `checkpoint ${String(c.seq)} covers ${String(c.count)} rows; the log has ${String(log.complete.length)}: the log was truncated behind it`);
    else if (c.count > 0 && lineHash(log.complete[c.count - 1] as string) !== c.head) add("head-mismatch", where, `checkpoint ${String(c.seq)}'s head is not the hash of row ${String(c.count - 1)}: the log was edited or re-chained behind it`);
    lastCovered = Math.max(lastCovered, c.count);
  });
  if (anchor.torn !== undefined) {
    const checked = anchor.complete[anchor.complete.length - 1] === anchor.torn;
    add("torn-final-line", `anchor line ${String(checked ? anchor.complete.length : anchor.complete.length + 1)}`, checked ? "the anchor does not end with a newline, though its last line is a complete checkpoint: it is checked like the rest" : "the anchor does not end with a newline: its last checkpoint is incomplete");
  }

  // The first failure first: the log before the anchor, then by line.
  const position = (f: Finding): number => (f.where.startsWith("log") ? 0 : 1e12) + Number(/\d+$/.exec(f.where)?.[0] ?? 0);
  findings.sort((a, b) => position(a) - position(b));
  const tamper = findings.some((f) => f.kind !== "torn-final-line");
  return {
    ok: findings.length === 0,
    findings,
    rows: log.complete.length,
    checkpoints: anchor.complete.length,
    unanchored: Math.max(0, log.complete.length - lastCovered),
    exitCode: tamper ? 1 : findings.length > 0 ? 3 : 0,
  };
}
