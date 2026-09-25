// Runtime argument validation under a deadline (WO §1.6 "validation time bounded"; CSR-WO-1005
// adversarial finding F2). A schema is checked on the main thread at registration (compileSchema
// throws on an invalid one), then compiled again in each worker. Every validation runs in a worker
// with a timer; a validation that overruns is abandoned by terminating its worker, which is
// replaced and re-primed with every registered schema. The event loop is never blocked by a
// validation, and no validation outlives `validationTimeoutMs`.

import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import type { SchemaCompiler } from "./registry.ts";
import { compileSchema } from "./schema.ts";

export class ValidationTimeout extends Error {
  override name = "ValidationTimeout";
}

interface Job {
  id: number;
  key: string;
  value: unknown;
  resolve: (valid: boolean) => void;
  reject: (err: Error) => void;
}

interface Slot {
  worker: Worker;
  job?: Job;
  timer?: NodeJS.Timeout;
}

type Reply = { id: number; ok: true; valid: boolean } | { id: number; ok: false; error: string };

export interface ValidationPoolOptions {
  workers: number;
  timeoutMs: number;
}

export class ValidationPool {
  readonly #options: ValidationPoolOptions;
  readonly #slots: Slot[] = [];
  readonly #queue: Job[] = [];
  readonly #schemas = new Map<string, Record<string, unknown>>();
  #nextId = 1;
  #nextKey = 1;
  #closed = false;

  constructor(options: ValidationPoolOptions) {
    this.#options = options;
    for (let i = 0; i < options.workers; i++) this.#slots.push(this.#spawn());
  }

  /** A SchemaCompiler whose validators run in the pool. */
  readonly compile: SchemaCompiler = (schema) => {
    compileSchema(schema); // throws here, at registration, on an invalid schema
    const key = String(this.#nextKey++);
    this.#schemas.set(key, schema);
    for (const slot of this.#slots) slot.worker.postMessage({ id: 0, op: "compile", key, schema });
    return (value: unknown) => this.#run(key, value);
  };

  async close(): Promise<void> {
    this.#closed = true;
    for (const job of this.#queue.splice(0)) job.reject(new Error("validation pool closed"));
    await Promise.all(
      this.#slots.map((slot) => {
        clearTimeout(slot.timer);
        slot.job?.reject(new Error("validation pool closed"));
        return slot.worker.terminate();
      }),
    );
  }

  #spawn(): Slot {
    // The worker module sits beside this one, with the same extension (.ts in tests, .js built).
    const url = new URL(`./schema-worker${extname(fileURLToPath(import.meta.url))}`, import.meta.url);
    const worker = new Worker(url);
    worker.unref();
    const slot: Slot = { worker };
    worker.on("message", (reply: Reply) => {
      this.#settle(slot, reply);
    });
    worker.on("error", () => {
      this.#replace(slot, new Error("validation worker failed"));
    });
    for (const [key, schema] of this.#schemas) worker.postMessage({ id: 0, op: "compile", key, schema });
    return slot;
  }

  #run(key: string, value: unknown): Promise<boolean> {
    if (this.#closed) return Promise.reject(new Error("validation pool closed"));
    return new Promise((resolve, reject) => {
      this.#queue.push({ id: this.#nextId++, key, value, resolve, reject });
      this.#pump();
    });
  }

  #pump(): void {
    for (const slot of this.#slots) {
      if (slot.job !== undefined) continue;
      const job = this.#queue.shift();
      if (job === undefined) return;
      slot.job = job;
      slot.timer = setTimeout(() => {
        this.#replace(slot, new ValidationTimeout(`validation exceeded ${String(this.#options.timeoutMs)} ms`));
      }, this.#options.timeoutMs);
      slot.worker.postMessage({ id: job.id, op: "validate", key: job.key, value: job.value });
    }
  }

  #settle(slot: Slot, reply: Reply): void {
    if (reply.id === 0 || slot.job?.id !== reply.id) return;
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
    const job = slot.job;
    slot.job = undefined;
    void slot.worker.terminate();
    const i = this.#slots.indexOf(slot);
    if (!this.#closed && i !== -1) this.#slots[i] = this.#spawn();
    job?.reject(err);
    this.#pump();
  }
}
