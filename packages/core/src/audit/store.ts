// The audit store (CSR-WO-2002 §1.1, §1.3; audit/RULES.md AU-1 to AU-12, AU-20, AU-24). It sits
// behind the transport's audit seam, `(event, fields)`, and adds what the caller does not have: the
// row's seq, time and prev, and its principal by the event table. Every row hashes its predecessor;
// every N rows or T milliseconds, whichever first, and on a clean close, a signed checkpoint goes to
// the anchor sink.
//
// The honest limit (AU-12). Rows written after the last checkpoint can be truncated undetectably; N
// and T bound that window. An attacker who can rewrite both the log and the anchor defeats the
// scheme: the anchor's value is different ownership (an operator-held file, a remote sink, the OS log
// in P3 and P4). The core ships the interfaces, a JSON-lines store, a file anchor and an in-memory
// anchor for tests; the OS-log stores land with their editions.

import { closeSync, fsyncSync, readFileSync, writeSync } from "node:fs";

import { type AuditRow, type Checkpoint, checkpointLine, checkpointPayload, GENESIS, lineHash, rowLine } from "./chain.ts";
import { canonicalJson, parseCanonicalJson } from "../pinning/canonical.ts";
import type { Digester } from "./digest.ts";
import { AuditConfigError, fileIdentity, openOperatorFile } from "./files.ts";
import { shapeRow } from "./policy.ts";
import { type Signer, verifyWith } from "./signer.ts";
import { decodeStrict } from "./verify.ts";

/** What the transport's audit seam calls. */
export type AuditFields = Record<string, string | number>;

export interface AuditStore {
  /** The digester whose key the store's rows use: the transport's tool-call row digests with it. */
  readonly digester: Digester;
  /** Appends one row. Throws if the row cannot be written; a node stops rather than serve unrecorded. */
  append(event: string, fields: AuditFields): void;
  /** fsyncs the log. */
  flush(): void;
  /** Writes a final checkpoint (if any row followed the last) and closes. */
  close(): Promise<void>;
}

export interface AnchorSink {
  /** Appends one checkpoint line. */
  append(line: string): void;
  close(): void;
}

/** An anchor for tests: checkpoint lines in memory. */
export class MemoryAnchor implements AnchorSink {
  readonly lines: string[] = [];
  append(line: string): void {
    this.lines.push(line);
  }
  close(): void {
    // Nothing to release.
  }
  text(): string {
    return this.lines.map((l) => `${l}\n`).join("");
  }
}

/** A file anchor: a separate operator-named file, opened append-only (AU-11). */
export class FileAnchor implements AnchorSink {
  readonly #fd: number;
  /** The anchor's bytes when it was opened, for the start-time check (AU-24). */
  readonly existing: Buffer;
  constructor(path: string, setting = "AUDIT_ANCHOR") {
    this.#fd = openOperatorFile(setting, path, true);
    this.existing = readFileSync(this.#fd);
  }
  get fd(): number {
    return this.#fd;
  }
  append(line: string): void {
    writeSync(this.#fd, `${line}\n`);
    fsyncSync(this.#fd);
  }
  close(): void {
    closeSync(this.#fd);
  }
}

export interface JsonLinesStoreOptions {
  /** The log's path (AUDIT_LOG). */
  log: string;
  anchor: AnchorSink;
  /** The anchor's existing content, for the start-time check; empty for a fresh or in-memory anchor. */
  anchorText?: string | Uint8Array;
  /** Files the log and the anchor must never be (the key files, the manifest), by identity, with the
   *  setting that names each (AU-21). */
  forbidden?: readonly { readonly setting: string; readonly identity: string }[];
  digester: Digester;
  signer: Signer;
  /** Checkpoint every this many rows (AUDIT_CHECKPOINT_ROWS). */
  checkpointRows: number;
  /** Checkpoint every this many milliseconds (AUDIT_CHECKPOINT_SECONDS × 1000). */
  checkpointMs: number;
  now?: () => number;
}

/** The last complete row of a log's text, and whether a torn final line follows it. */
function tail(text: string): { rows: string[]; torn: boolean } {
  if (text === "") return { rows: [], torn: false };
  const parts = text.split("\n");
  const last = parts.pop() as string;
  return { rows: parts, torn: last !== "" };
}

/** The JSON-lines store: the teaching and development backend (architecture §5). */
export class JsonLinesStore implements AuditStore {
  readonly digester: Digester;
  readonly #fd: number;
  readonly #anchor: AnchorSink;
  readonly #signer: Signer;
  readonly #rowsEvery: number;
  readonly #now: () => number;
  readonly #timer: NodeJS.Timeout;
  #seq: number;
  #prev: string;
  #checkpointSeq: number;
  #checkpointedCount: number;
  #closed = false;
  #resumed: { fromSeq: number; unanchored: number } | undefined;

  constructor(options: JsonLinesStoreOptions) {
    this.digester = options.digester;
    this.#anchor = options.anchor;
    this.#signer = options.signer;
    this.#rowsEvery = options.checkpointRows;
    this.#now = options.now ?? Date.now;
    this.#fd = openOperatorFile("AUDIT_LOG", options.log, true);
    try {
      if (options.anchor instanceof FileAnchor && fileIdentity(options.anchor.fd) === fileIdentity(this.#fd)) throw new AuditConfigError("AUDIT_LOG and AUDIT_ANCHOR name the same file: the anchor is a separate file");
      for (const f of options.forbidden ?? []) {
        if (fileIdentity(this.#fd) === f.identity) throw new AuditConfigError(`AUDIT_LOG is the same file as ${f.setting}: the log is its own file`);
        if (options.anchor instanceof FileAnchor && fileIdentity(options.anchor.fd) === f.identity) throw new AuditConfigError(`AUDIT_ANCHOR is the same file as ${f.setting}: the anchor is its own file`);
      }
      // Resume from what is there (AU-2), refusing a log that is not valid UTF-8 or not an audit log,
      // a torn tail (AU-20), and a log behind its anchor (AU-24).
      const logText = decodeStrict(readFileSync(this.#fd));
      if (logText === undefined) throw new AuditConfigError("AUDIT_LOG is not valid UTF-8: run `npm run audit -- verify` and decide before the node writes more");
      const { rows, torn } = tail(logText);
      if (torn) throw new AuditConfigError("the audit log's final line is torn (a crash mid-write, or an edit): run `npm run audit -- verify` and decide before the node writes more");
      const lastRow = rows[rows.length - 1];
      if (lastRow !== undefined) {
        let parsed: unknown;
        try {
          parsed = parseCanonicalJson(lastRow);
        } catch {
          parsed = undefined;
        }
        if (typeof parsed !== "object" || parsed === null || (parsed as { seq?: unknown }).seq !== rows.length - 1 || canonicalJson(parsed) !== lastRow) throw new AuditConfigError("AUDIT_LOG is not an audit log (its last line is not the row its position requires): run `npm run audit -- verify`");
      }
      this.#seq = rows.length;
      this.#prev = rows.length === 0 ? GENESIS : lineHash(rows[rows.length - 1] as string);
      const anchorText = decodeStrict(options.anchorText ?? "");
      if (anchorText === undefined) throw new AuditConfigError("AUDIT_ANCHOR is not valid UTF-8");
      const anchored = tail(anchorText);
      if (anchored.torn) throw new AuditConfigError("the audit anchor's final line is torn: run `npm run audit -- verify` and decide before the node writes more");
      const lastLine = anchored.rows[anchored.rows.length - 1];
      if (lastLine === undefined) {
        this.#checkpointSeq = 0;
        this.#checkpointedCount = 0;
      } else {
        let last: Partial<Checkpoint>;
        try {
          last = parseCanonicalJson(lastLine) as Partial<Checkpoint>;
        } catch {
          // Never quoted: a misnamed anchor could be a key file.
          throw new AuditConfigError("AUDIT_ANCHOR's last line is not a checkpoint");
        }
        if (typeof last !== "object" || last === null || typeof last.seq !== "number" || typeof last.count !== "number" || typeof last.head !== "string" || typeof last.kid !== "string" || typeof last.time !== "string" || typeof last.sig !== "string") throw new AuditConfigError("AUDIT_ANCHOR's last line is not a checkpoint");
        // The store's own key checks its own last checkpoint; a checkpoint under another kid (a key
        // since rotated) is left to `audit verify` and its allowlist.
        if (last.kid === options.signer.kid && options.signer.publicKey !== undefined) {
          const entry = { kid: last.kid, key: options.signer.publicKey, notBefore: "", notAfter: "" };
          if (!verifyWith(entry, checkpointPayload({ kid: last.kid, seq: last.seq, head: last.head, count: last.count, time: last.time }), Buffer.from(last.sig, "base64url"))) throw new AuditConfigError("AUDIT_ANCHOR's last checkpoint does not verify under the signing key: run `npm run audit -- verify`");
        }
        if (last.count > rows.length) throw new AuditConfigError(`the audit log has ${String(rows.length)} rows but its last checkpoint covers ${String(last.count)}: it was truncated behind the checkpoint`);
        if (last.count > 0 && lineHash(rows[last.count - 1] as string) !== last.head) throw new AuditConfigError(`the audit log's row ${String(last.count - 1)} does not match its last checkpoint's head: it was edited or re-chained`);
        this.#checkpointSeq = last.seq + 1;
        this.#checkpointedCount = last.count;
      }
    } catch (err) {
      closeSync(this.#fd);
      throw err;
    }
    // A resumed log: the first row of this run says how many rows it adopted after the last checkpoint.
    // Rows there could have been rewritten while the node was down (the unkeyed chain cannot tell), and
    // this run's next checkpoint will cover them, so the adoption is recorded where verify's reader sees it.
    this.#resumed = this.#seq > 0 ? { fromSeq: this.#seq, unanchored: this.#seq - this.#checkpointedCount } : undefined;
    this.#timer = setInterval(() => {
      this.#checkpointIfPending();
    }, options.checkpointMs);
    this.#timer.unref();
  }

  append(event: string, fields: AuditFields): void {
    if (this.#closed) throw new Error("the audit store is closed");
    if (this.#resumed !== undefined) {
      const r = this.#resumed;
      this.#resumed = undefined;
      this.append("audit-resumed", r);
    }
    const shaped = shapeRow(event, fields, this.digester);
    const row: AuditRow = { seq: this.#seq, time: new Date(this.#now()).toISOString(), event: shaped.event, principal: shaped.principal, fields: shaped.fields, prev: this.#prev };
    const line = rowLine(row);
    // One write of the line and its newline (AU-3).
    writeSync(this.#fd, `${line}\n`);
    this.#seq += 1;
    this.#prev = lineHash(line);
    if (this.#seq - this.#checkpointedCount >= this.#rowsEvery) this.#checkpoint();
  }

  flush(): void {
    fsyncSync(this.#fd);
  }

  #checkpointIfPending(): void {
    if (!this.#closed && this.#seq > this.#checkpointedCount) this.#checkpoint();
  }

  /** Signs and anchors the head (AU-9, AU-10). The log is fsync-ed first, so a checkpoint never
   *  covers a row that is not on disk. */
  #checkpoint(): void {
    fsyncSync(this.#fd);
    const unsigned = { kid: this.#signer.kid, seq: this.#checkpointSeq, head: this.#prev, count: this.#seq, time: new Date(this.#now()).toISOString() };
    const sig = Buffer.from(this.#signer.sign(checkpointPayload(unsigned))).toString("base64url");
    this.#anchor.append(checkpointLine({ ...unsigned, sig }));
    this.#checkpointSeq += 1;
    this.#checkpointedCount = this.#seq;
  }

  close(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    clearInterval(this.#timer);
    try {
      this.#checkpointIfPending();
    } finally {
      this.#closed = true;
      closeSync(this.#fd);
      this.#anchor.close();
    }
    return Promise.resolve();
  }
}
