// Test harness: a real teaching node, started by the core's startNode exactly as the edition's bin/
// starts it (CSR-WO-1007 §1.2), against the core's in-process test issuer over loopback HTTPS. The one
// difference is the definitions and the manifest: the committed ones pin /srv/clearseal/teaching/notes,
// so a test builds the edition's definitions for a temporary root (toolsFor, the list the exported
// definitions come from) and writes an approved manifest for them (the pinForTest pattern), because
// the root is part of the pinned contract. On Windows a POSIX-style path names a directory on the
// current drive (CSR-WO-1004 §1.3).

import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";

import { buildManifest, type PinnableTool, type RunningTransport, serializeManifest, startNode as coreStartNode } from "@clearseal/core";

import { AUDIENCE, ISSUER, TestIssuer } from "../../core/test/auth/issuer.ts";
import { configSchema } from "../src/index.ts";
import { toolsFor } from "../src/notes.ts";

export { AUDIENCE, ISSUER, TestIssuer };

/** A fresh notes root, as a POSIX path (the `fs:` grammar is POSIX-only). */
export function notesRoot(): string {
  const root = `/tmp/clearseal-teaching-${randomBytes(6).toString("hex")}`;
  mkdirSync(`${root}/notes`, { recursive: true });
  return `${root}/notes`;
}

/** Writes an approved manifest pinning these definitions beside the notes root, and returns its path. */
export function pin(definitions: PinnableTool[], root: string, name = "teaching-test-manifest"): string {
  const file = `${root}/../${name}.json`;
  writeFileSync(file, serializeManifest(buildManifest(definitions)));
  return file;
}

export interface Node {
  t: RunningTransport;
  lines: string[];
  close(): Promise<void>;
}

const saved = new Map<string, string | undefined>();
function setEnv(vars: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(vars)) {
    if (!saved.has(k)) saved.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
/** Restores every variable a test set. */
export function restoreEnv(): void {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  saved.clear();
}

/** Starts a teaching node through the core's startNode, configured only by the environment, as a
 *  deployment is: the edition's definitions for this root, and the manifest pinned for them. */
export async function startNode(issuer: TestIssuer, root: string, manifest: string, extra: Record<string, string | undefined> = {}): Promise<Node> {
  const caFile = join(mkdtempSync(join(tmpdir(), "clearseal-teaching-ca-")), "issuer-ca.pem");
  writeFileSync(caFile, issuer.ca);
  setEnv({
    TEACHING_RESOURCE_URL: AUDIENCE,
    TEACHING_HOST: "127.0.0.1",
    TEACHING_PORT: "0",
    AUTH_ISSUER: ISSUER,
    AUTH_JWKS_URL: issuer.jwksUrl,
    AUTH_AUDIENCE: AUDIENCE,
    AUTH_JWKS_CA_FILE: caFile,
    CLEARSEAL_MANIFEST: manifest,
    PIN_STRICT: undefined,
    ...extra,
  });
  const lines: string[] = [];
  const t = await coreStartNode({ definitions: toolsFor(root), configSchema }, { audit: (e, f) => lines.push(`${e} ${JSON.stringify(f)}`) });
  return { t, lines, close: () => t.close() };
}

export function cleanup(root: string): void {
  rmSync(dirname(root), { recursive: true, force: true });
}

export interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  json: unknown;
}

let id = 1;
/** A modern-era MCP request to the node, as a conforming client sends it. */
export function mcp(t: RunningTransport, method: string, params: Record<string, unknown>, opts: { token?: string; headers?: Record<string, string>; name?: string } = {}): Promise<Reply> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: id++, method, params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } } });
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
    ...(opts.name === undefined ? {} : { "mcp-name": opts.name }),
    ...(opts.token === undefined ? {} : { authorization: `Bearer ${opts.token}` }),
    ...opts.headers,
  };
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port: t.port, method: "POST", path: "/mcp", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json: unknown;
        try {
          json = JSON.parse(text) as unknown;
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

/** The definitions a test pins: notes.read for its own root. */
export const definitionsFor = (root: string): PinnableTool[] => toolsFor(root);
