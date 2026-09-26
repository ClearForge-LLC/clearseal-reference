// CSR-WO-1002 §1.1, §1.4, §3.2: construction refusals. The domain is parsed from the gate's frozen
// snapshot; a malformed or non-canonical entry, and any arbitrary_exec definition under the default
// flag, stop the registry from being built, naming the tool and the entry.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DomainError, parseDomain } from "../../src/containment/domain.ts";
import type { CapabilityTag, PinnableTool } from "../../src/pinning/manifest.ts";
import { ContainmentConstructionError, execToolsForbiddenFromEnv } from "../../src/pinning/registry.ts";
import { DEFAULT_LIMITS } from "../../src/transport/config.ts";
import { compileSchema } from "../../src/transport/schema.ts";
import { pinForTest } from "../fixtures/pin.ts";
import { tag } from "../fixtures/tools.ts";

const rows: string[] = [];
const tool = (overrides: Partial<CapabilityTag>): PinnableTool => ({ name: "t", description: "", inputSchema: { type: "object" }, handler: () => Promise.resolve({ content: [] }), capability: tag("t", overrides) });
const build = (overrides: Partial<CapabilityTag>, extra: { execToolsForbidden?: boolean } = {}) => pinForTest([tool(overrides)], compileSchema, DEFAULT_LIMITS, true, extra);
const refusedAt = (label: string, overrides: Partial<CapabilityTag>, why: RegExp, extra: { execToolsForbidden?: boolean } = {}): void => {
  let caught: unknown;
  try {
    build(overrides, extra);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof ContainmentConstructionError, `${label}: ${String(caught)}`);
  assert.match(caught.message, why, label);
  rows.push(`| ${label} | \`${JSON.stringify(overrides.containment_domain ?? null)}\`${overrides.capability_class === undefined ? "" : ` (${overrides.capability_class})`} | ${caught.message} |`);
};

void describe("construction refusals (WO §3.2)", () => {
  void it("malformed entries are refused, naming the tool and the entry", () => {
    refusedAt("unknown scheme", { containment_domain: ["file:/tmp/x"] }, /tool "t": "file:\/tmp\/x": an unknown scheme/);
    refusedAt("relative path", { containment_domain: ["fs:data/notes"] }, /must be an absolute path/);
    refusedAt("path not normalized (..)", { containment_domain: ["fs:/tmp/a/../b"] }, /must be normalized/);
    refusedAt("path with a trailing slash", { containment_domain: ["fs:/tmp/a/"] }, /must be normalized/);
    refusedAt("the whole file system", { containment_domain: ["fs:/"] }, /whole file system/);
    refusedAt("host with a path", { containment_domain: ["host:example.invalid/api"] }, /lower-case name/);
    refusedAt("host with a scheme", { containment_domain: ["host:https://example.invalid"] }, /lower-case name|port/);
    refusedAt("host in upper case", { containment_domain: ["host:Example.invalid"] }, /lower-case name/);
    refusedAt("host as an address", { containment_domain: ["host:127.0.0.1"] }, /never an address/);
    refusedAt("port with a leading zero", { containment_domain: ["host:example.invalid:0443"] }, /leading zero/);
    refusedAt("service outside the name pattern", { containment_domain: ["svc:Mail Queue"] }, /service name/);
  });

  void it("arbitrary_exec is refused a domain, and refused outright under the default flag (N7)", () => {
    refusedAt("arbitrary_exec with a domain", { capability_class: "arbitrary_exec", containment_domain: ["fs:/tmp/x"] }, /refused a containment domain/, { execToolsForbidden: false });
    refusedAt("arbitrary_exec at all (default flag)", { capability_class: "arbitrary_exec" }, /EXEC_TOOLS_FORBIDDEN/);
    assert.equal(build({ capability_class: "arbitrary_exec" }, { execToolsForbidden: false }).get("t")?.definition.name, "t", "with the flag off and no domain it registers");
    assert.equal(execToolsForbiddenFromEnv({}), true);
    assert.equal(execToolsForbiddenFromEnv({ EXEC_TOOLS_FORBIDDEN: "0" }), true);
    assert.equal(execToolsForbiddenFromEnv({ EXEC_TOOLS_FORBIDDEN: "false" }), false);
  });

  void it("a non-canonical list (unsorted or duplicated) is refused by the parser; A7 canonicalizes a definition's list before the registry sees it", () => {
    assert.throws(() => parseDomain(["fs:/tmp/b", "fs:/tmp/a"]), (e: unknown) => e instanceof DomainError && /out of order/.test(e.message));
    assert.throws(() => parseDomain(["fs:/tmp/a", "fs:/tmp/a"]), (e: unknown) => e instanceof DomainError && /appears twice/.test(e.message));
    rows.push("| unsorted list (parser) | `[\"fs:/tmp/b\",\"fs:/tmp/a\"]` | \"fs:/tmp/a\" is out of order: the domain is not canonical (A7) |");
    rows.push("| duplicated list (parser) | `[\"fs:/tmp/a\",\"fs:/tmp/a\"]` | \"fs:/tmp/a\" appears twice: the domain is not canonical (A7) |");
    const registry = build({ containment_domain: ["fs:/tmp/b", "fs:/tmp/a", "fs:/tmp/a"] });
    assert.ok(registry.get("t") !== undefined, "through the gate, the frozen snapshot is already sorted and deduplicated by A7");
  });

  void it("well-formed domains of all three schemes register", () => {
    const r = build({ containment_domain: ["fs:/tmp/clearseal-reach/notes", "host:status.example.invalid:443", "host:api.example.invalid", "svc:mail-queue"] });
    assert.ok(r.get("t") !== undefined);
    console.log(`CONSTRUCTION-REFUSALS\n| Case | Domain | Refusal |\n|---|---|---|\n${rows.join("\n")}`);
  });
});
