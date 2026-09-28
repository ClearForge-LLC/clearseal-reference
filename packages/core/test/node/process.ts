// Runs `clearseal-node` as a real process, the way an operator does (CSR-WO-1007c §1.1, §1.2): with a
// valid configuration for the teaching edition and the committed manifest, and nothing else of this test
// process's environment that could change what starts. It waits until the node says where it listens,
// or exits.

import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AUDIENCE, ISSUER } from "../auth/issuer.ts";

export const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
/** The entry's source, as the repository runs it. */
export const ENTRY_SOURCE = join(REPO, "packages", "core", "src", "node", "cli.ts");
export const COMMITTED_MANIFEST = join(REPO, "pins", "teaching.json");

/** A valid operator configuration: the teaching edition, by name, and the manifest that pins it. The
 *  issuer's keys are fetched on the first request, not at start, so none is needed to listen. */
export const TEACHING_CONFIG: Readonly<Record<string, string>> = Object.freeze({
  CLEARSEAL_EDITION: "@clearseal/teaching",
  CLEARSEAL_MANIFEST: COMMITTED_MANIFEST,
  AUDIT_STORE: "seam-only",
  TEACHING_RESOURCE_URL: AUDIENCE,
  TEACHING_HOST: "127.0.0.1",
  TEACHING_PORT: "0",
  AUTH_ISSUER: ISSUER,
  AUTH_JWKS_URL: `${ISSUER}/jwks`,
  AUTH_AUDIENCE: AUDIENCE,
});

/**
 * This process's environment without what would change the child: NODE_OPTIONS, npm's own variables,
 * the test runner's, and any node setting. `node` on PATH is this one (the installed command's `#!`
 * line finds node by PATH).
 */
export function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k === "NODE_OPTIONS" || k === "NODE_TEST_CONTEXT" || /^npm_/i.test(k) || /^(CLEARSEAL|AUDIT|AUTH|TEACHING)_/.test(k)) continue;
    env[k] = v;
  }
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = `${dirname(process.execPath)}${process.platform === "win32" ? ";" : ":"}${env[pathKey] ?? ""}`;
  return { ...env, ...extra };
}

export interface Started {
  /** The URL the node listens on, or undefined when it did not start. */
  url: string | undefined;
  /** Everything the process wrote until it listened or exited. */
  output: string;
  /** The exit code, when it exited before listening. */
  code: number | null;
  /** Stops it, and everything it started. */
  stop(): Promise<void>;
}

/**
 * Starts `command` with `args` and waits until it listens or exits (20 s at most). `shell` runs a
 * Windows command shim (npm's `.cmd`) through cmd.exe, which is how an operator's shell runs it.
 */
export function startProcess(command: string, args: readonly string[], env: Record<string, string>, options: { cwd?: string; shell?: boolean } = {}): Promise<Started> {
  const child = options.shell === true ? spawn(process.env["ComSpec"] ?? "cmd.exe", ["/d", "/s", "/c", `""${command}"${args.map((a) => ` "${a}"`).join("")}"`], { env, cwd: options.cwd, windowsVerbatimArguments: true, stdio: ["ignore", "pipe", "pipe"] }) : spawn(command, args, { env, cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise<void>((resolve) => child.on("close", () => resolve()));
  const stop = async (): Promise<void> => {
    if (child.exitCode === null && child.signalCode === null) {
      // A shim's node is cmd.exe's child: kill the tree, or it keeps the pipes open.
      if (process.platform === "win32" && child.pid !== undefined) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else child.kill();
    }
    await exited;
  };
  let output = "";
  return new Promise((resolve) => {
    let settled = false;
    const done = (url: string | undefined, code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ url, output, code, stop });
    };
    const timer = setTimeout(() => done(undefined, null), 20_000);
    const onData = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      const m = /listening on (https?:\/\/\S+)/.exec(output);
      if (m !== null) done(m[1], null);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (err) => {
      output += `spawn failed: ${err.message}\n`;
      done(undefined, null);
    });
    child.on("close", (code) => done(undefined, code));
  });
}

/** What the node answers an unauthenticated MCP request with: a live node refuses it with 401. */
export async function unauthenticatedStatus(url: string): Promise<number> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  await res.body?.cancel();
  return res.status;
}
