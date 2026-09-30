// Addresses on the approval listener (CSR-WO-2001; approval/RULES.md APR-23, APR-25, APR-28): one
// canonical form, the address a request is attributed to behind trusted proxies, and the key its
// budget is kept under.

import { BlockList, isIP } from "node:net";

/** An address in one form (APR-23): lower case, IPv6 compressed, an IPv4-mapped IPv6 address as IPv4. */
export function canonicalAddress(address: string): string {
  const a = address.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (isIP(a) !== 6) return a;
  let compressed: string;
  try {
    compressed = new URL(`http://[${a}]`).hostname.slice(1, -1);
  } catch {
    // An address a URL cannot hold (a link-local one with a zone id) is compared as written.
    return a;
  }
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(compressed);
  if (mapped === null) return compressed;
  const hi = parseInt(mapped[1] ?? "0", 16);
  const lo = parseInt(mapped[2] ?? "0", 16);
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
}

/** The eight groups of an IPv6 address, as numbers; undefined if it is not one. */
function groupsOf(address: string): number[] | undefined {
  const a = (address.split("%")[0] ?? "").toLowerCase();
  if (isIP(a) !== 6 || a.includes(".")) return undefined;
  const halves = a.split("::");
  if (halves.length > 2) return undefined;
  const head = halves[0] === "" || halves[0] === undefined ? [] : halves[0].split(":");
  const tail = halves.length === 2 && halves[1] !== "" && halves[1] !== undefined ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const all = [...head, ...Array.from({ length: fill }, () => "0"), ...tail];
  return all.length === 8 ? all.map((g) => parseInt(g, 16)) : undefined;
}

/**
 * The key an address's budget is kept under (APR-28): an IPv6 address by its /64 prefix, so one network
 * cannot rotate through its own addresses to fill the table or escape its budget; an IPv4 address, and
 * an IPv4-mapped IPv6 one, by the whole address.
 */
export function addressKey(address: string): string {
  const a = canonicalAddress(address);
  const groups = groupsOf(a);
  if (groups === undefined) return a;
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}

/** A trusted-proxy setting that is not an address or a CIDR: the reason. */
export function trustedProxyProblem(entry: string): string | undefined {
  const [addr = "", len, extra] = entry.split("/");
  if (extra !== undefined) return "is not an address or a CIDR";
  const a = canonicalAddress(addr);
  const family = isIP(a);
  if (family === 0 || a.includes("%")) return "is not an address or a CIDR";
  if (len === undefined) return undefined;
  const max = family === 4 ? 32 : 128;
  if (!/^(0|[1-9][0-9]{0,2})$/.test(len) || Number(len) > max) return `has a prefix length outside 0…${String(max)}`;
  return undefined;
}

/** The operator's trusted proxies (APR-25): exact addresses and CIDRs, matched in canonical form. */
export class TrustedProxies {
  readonly #list = new BlockList();
  readonly size: number;

  constructor(entries: readonly string[]) {
    for (const entry of entries) {
      const problem = trustedProxyProblem(entry);
      if (problem !== undefined) throw new TypeError(`a trusted proxy ${problem}`);
      const [addr = "", len] = entry.split("/");
      const a = canonicalAddress(addr);
      const type = isIP(a) === 4 ? "ipv4" : "ipv6";
      if (len === undefined) this.#list.addAddress(a, type);
      else this.#list.addSubnet(a, Number(len), type);
    }
    this.size = entries.length;
    Object.freeze(this);
  }

  /** Whether `address` (any form) is one of the trusted proxies. */
  has(address: string): boolean {
    if (this.size === 0) return false;
    const a = canonicalAddress(address);
    const family = isIP(a);
    if (family === 0 || a.includes("%")) return false;
    return this.#list.check(a, family === 4 ? "ipv4" : "ipv6");
  }
}

/**
 * The address a request is attributed to (APR-25). The socket peer, unless the peer is a trusted proxy:
 * then the rightmost `X-Forwarded-For` entry that is not itself a trusted proxy. Anything that cannot be
 * read that way (no header, an entry that is not an address, a chain of proxies only) falls back to the
 * peer: toward the budget the proxy shares, never toward an address the client chose. A header from a
 * peer that is not trusted is never read.
 */
export function clientAddress(peer: string, forwardedFor: readonly string[] | undefined, trusted: TrustedProxies): string {
  const p = canonicalAddress(peer);
  if (forwardedFor === undefined || forwardedFor.length === 0 || !trusted.has(p)) return p;
  const entries = forwardedFor.join(",").split(",").map(canonicalAddress);
  if (entries.some((e) => isIP(e) === 0 || e.includes("%"))) return p;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] ?? "";
    if (!trusted.has(e)) return e;
  }
  return p;
}
