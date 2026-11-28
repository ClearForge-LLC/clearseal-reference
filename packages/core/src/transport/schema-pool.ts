// Runtime argument validation under a deadline (WO §1.6 "validation time bounded"; CSR-WO-1005
// adversarial finding F2). A schema is checked on the main thread at registration (compileSchema
// throws on an invalid one), then compiled again in each worker. Every validation runs in a worker
// with a timer; a validation that overruns is abandoned by terminating its worker, which is
// replaced and re-primed with every registered schema. The event loop is never blocked by a
// validation, and no validation outlives `validationTimeoutMs`.
//
// A job is timed only against a ready worker (CSR-WO-1005c). A slot is ready once its worker is
// online and has acknowledged every schema it was sent; until then `#pump` passes it by, so a
// replacement's start-up never counts against the next call's deadline. Readiness has its own bound,
// READY_TIMEOUT_MS: a worker that does not become ready within it is replaced again, and a job that
// finds no ready worker for twice that (one replacement's whole window) is refused as a timeout is.
// So no call waits for a worker past twice the bound, then past its deadline, and none is ever
// answered without validation.

import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import type { SchemaCompiler } from "./registry.ts";
import { compileSchema } from "./schema.ts";

export class ValidationTimeout extends Error {
  override name = "ValidationTimeout";
}

/** How long a worker may take to come online and acknowledge its schemas (CSR-WO-1005c). Measured on
 *  Furnace with the fixture's 13 schemas: 71–85 ms idle, at most 453 ms on 2 cores under load. */
export const READY_TIMEOUT_MS = 5_000;

interface Job {
  id: number;
  key: string;
  value: unknown;
  resolve: (valid: boolean) => void;
  reject: (err: Error) => void;
  /** Bounds the wait for a ready worker; cleared once the job is assigned. */
  wait?: NodeJS.Timeout;
}

interface Slot {
  worker: Worker;
  job?: Job;
  timer?: NodeJS.Timeout;
  online: boolean;
  /** Ids of the compile messages this worker has not yet acknowledged. */
  priming: Set<number>;
  readyTimer?: NodeJS.Timeout;
}

type Reply = { id: number; ok: true; valid: boolean } | { id: number; ok: false; error: string };

export interface ValidationPoolOptions {
  workers: number;
  timeoutMs: number;
  /** Hears the pool's own events: `validation-worker-not-ready` when a worker is replaced for not
   *  becoming ready within READY_TIMEOUT_MS. */
  onEvent?: (event: string, fields: Record<string, string | number>) => void;
  /** Test seams: the readiness bound (default READY_TIMEOUT_MS) and the worker module for each
   *  spawn (default the schema worker beside this file). */
  readyTimeoutMs?: number;
  workerUrl?: () => URL;
}

const ready = (slot: Slot): boolean => slot.online && slot.priming.size === 0;

export class ValidationPool {
  readonly #options: ValidationPoolOptions;
  readonly #slots: Slot[] = [];
  readonly #queue: Job[] = [];
  readonly #schemas = new Map<string, Record<string, unknown>>();
  #nextId = 1;
  #nextKey = 1;
  /** Priming compiles carry negative ids, so a reply is told apart from a validation's. */
  #nextPrimeId = -1;
  #closed = false;
  readonly #readyMs: number;

  constructor(options: ValidationPoolOptions) {
    this.#options = options;
    this.#readyMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
    for (let i = 0; i < options.workers; i++) this.#slots.push(this.#spawn());
  }

  /** A SchemaCompiler whose validators run in the pool. */
  readonly compile: SchemaCompiler = (schema) => {
    compileSchema(schema); // throws here, at registration, on an invalid schema
    const key = String(this.#nextKey++);
    this.#schemas.set(key, schema);
    for (const slot of this.#slots) this.#prime(slot, key, schema);
    return (value: unknown) => this.#run(key, value);
  };

  async close(): Promise<void> {
    this.#closed = true;
    for (const job of this.#queue.splice(0)) {
      clearTimeout(job.wait);
      job.reject(new Error("validation pool closed"));
    }
    await Promise.all(
      this.#slots.map((slot) => {
        clearTimeout(slot.timer);
        clearTimeout(slot.readyTimer);
        slot.job?.reject(new Error("validation pool closed"));
        return slot.worker.terminate();
      }),
    );
  }

  #spawn(): Slot {
    // The worker module sits beside this one, with the same extension (.ts in tests, .js built).
    const url = this.#options.workerUrl?.() ?? new URL(`./schema-worker${extname(fileURLToPath(import.meta.url))}`, import.meta.url);
    const worker = new Worker(url);
    worker.unref();
    const slot: Slot = { worker, online: false, priming: new Set() };
    worker.on("online", () => {
      slot.online = true;
      this.#readied(slot);
    });
    worker.on("message", (reply: Reply) => {
      if (reply.id < 0) this.#primed(slot, reply);
      else this.#settle(slot, reply);
    });
    worker.on("error", () => {
      this.#replace(slot, new Error("validation worker failed"));
    });
    slot.readyTimer = setTimeout(() => {
      if (ready(slot) || this.#closed) return;
      this.#options.onEvent?.("validation-worker-not-ready", { limitMs: this.#readyMs });
      this.#replace(slot, new Error("validation worker did not become ready"));
    }, this.#readyMs);
    slot.readyTimer.unref();
    for (const [key, schema] of this.#schemas) this.#prime(slot, key, schema);
    return slot;
  }

  #prime(slot: Slot, key: string, schema: Record<string, unknown>): void {
    const id = this.#nextPrimeId--;
    slot.priming.add(id);
    slot.worker.postMessage({ id, op: "compile", key, schema });
  }

  #primed(slot: Slot, reply: Reply): void {
    if (!slot.priming.delete(reply.id)) return;
    // A schema the main thread compiled but this worker could not: the worker is not fit to serve.
    if (!reply.ok) {
      this.#replace(slot, new Error("validation worker failed"));
      return;
    }
    this.#readied(slot);
  }

  #readied(slot: Slot): void {
    if (!ready(slot)) return;
    clearTimeout(slot.readyTimer);
    this.#pump();
  }

  #run(key: string, value: unknown): Promise<boolean> {
    if (this.#closed) return Promise.reject(new Error("validation pool closed"));
    return new Promise((resolve, reject) => {
      const job: Job = { id: this.#nextId++, key, value, resolve, reject };
      // Refused only when no worker has been ready for twice the bound, so a replacement for a worker
      // that never became ready gets its whole window; a job queued behind ready workers that are
      // busy waits for them, as it always has.
      const arm = (): void => {
        job.wait = setTimeout(() => {
          const i = this.#queue.indexOf(job);
          if (i === -1) return;
          if (this.#slots.some(ready)) {
            arm();
            return;
          }
          this.#queue.splice(i, 1);
          reject(new ValidationTimeout(`no validation worker became ready within ${String(2 * this.#readyMs)} ms`));
        }, 2 * this.#readyMs);
      };
      arm();
      this.#queue.push(job);
      this.#pump();
    });
  }

  #pump(): void {
    for (const slot of this.#slots) {
      if (slot.job !== undefined || !ready(slot)) continue;
      const job = this.#queue.shift();
      if (job === undefined) return;
      clearTimeout(job.wait);
      slot.job = job;
      slot.timer = setTimeout(() => {
        this.#replace(slot, new ValidationTimeout(`validation exceeded ${String(this.#options.timeoutMs)} ms`));
      }, this.#options.timeoutMs);
      slot.worker.postMessage({ id: job.id, op: "validate", key: job.key, value: job.value });
    }
  }

  #settle(slot: Slot, reply: Reply): void {
    if (slot.job?.id !== reply.id) return;
    clearTimeout(slot.timer);
    const job = slot.job;
    slot.job = undefined;
    if (reply.ok) job.resolve(reply.valid);
    else job.reject(new Error(`validation failed in the worker: ${reply.error}`));
    this.#pump();
  }

  /** Abandons the slot's job (terminating its worker) and puts a fresh worker in its place. */
  #replace(slot: Slot, err: Error): void {
    clearTimeout(slot.timer);
    clearTimeout(slot.readyTimer);
    const job = slot.job;
    slot.job = undefined;
    void slot.worker.terminate();
    const i = this.#slots.indexOf(slot);
    if (!this.#closed && i !== -1) this.#slots[i] = this.#spawn();
    job?.reject(err);
    this.#pump();
  }
}
