// The row and checkpoint formats (audit/RULES.md AU-1, AU-10).
//
// The serialization, and why. A row is the core's canonical JSON (pinning/canonical.ts, JCS: sorted
// keys, no whitespace, one spelling for every string and number), one row per line, and the hash
// covers exactly that line's UTF-8 bytes. The canonical form is already pinned and cross-language
// tested for the manifest, so two implementations agree on a row's bytes without a new spec, and
// `audit verify` can prove a line on disk is the one serialization of its own content: it parses the
// line (refusing duplicate keys) and re-serializes it, and any difference is a finding. A row cannot be
// written two ways, and two rows with different content cannot share a line.

import { createHash } from "node:crypto";

import { canonicalJson } from "../pinning/canonical.ts";

/** The first row's prev: sixty-four zeros. */
export const GENESIS = "0".repeat(64);

/** The domain label a checkpoint signature covers, so no other signed object can pass for one. */
export const CHECKPOINT_CONTEXT = "clearseal-audit-checkpoint-v1\n";

export interface AuditRow {
  readonly seq: number;
  readonly time: string;
  readonly event: string;
  readonly principal: string;
  readonly fields: Readonly<Record<string, string | number>>;
  readonly prev: string;
}

export interface Checkpoint {
  readonly kid: string;
  readonly seq: number;
  readonly head: string;
  readonly count: number;
  readonly time: string;
  readonly sig: string;
}

/** A row's line: its canonical JSON, without the newline. */
export function rowLine(row: AuditRow): string {
  return canonicalJson({ seq: row.seq, time: row.time, event: row.event, principal: row.principal, fields: row.fields, prev: row.prev });
}

/** The SHA-256 of a line's exact UTF-8 bytes, lower-case hex. */
export function lineHash(line: string): string {
  return createHash("sha256").update(line, "utf8").digest("hex");
}

/** The bytes a checkpoint's signature covers. */
export function checkpointPayload(c: Omit<Checkpoint, "sig">): Buffer {
  return Buffer.concat([Buffer.from(CHECKPOINT_CONTEXT, "utf8"), Buffer.from(canonicalJson({ kid: c.kid, seq: c.seq, head: c.head, count: c.count, time: c.time }), "utf8")]);
}

/** A checkpoint's line. */
export function checkpointLine(c: Checkpoint): string {
  return canonicalJson({ kid: c.kid, seq: c.seq, head: c.head, count: c.count, time: c.time, sig: c.sig });
}
