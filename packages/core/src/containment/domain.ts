// The containment domain model (CSR-WO-1002 §1.1, architecture §3.1). A tool's containment_domain
// is a pinned, hashed set of the sinks it may reach, or null for "nothing outside the process".
// Each entry has one of three schemes:
//   fs:<absolute path>    a root: that path and everything under it
//   host:<name>[:port]    a network peer, by name (never an address); without a port, any port
//   svc:<name>            a named service the edition binds at deploy
// An entry that is malformed or not in its canonical spelling is refused, never fixed: fixing it
// would make the served domain differ from the hashed one. The set itself arrives sorted and
// deduplicated by the canonical form (A7); a list that is not is refused here too.

export class DomainError extends Error {
  override name = "DomainError";
}

export interface HostSink {
  host: string;
  /** Undefined: any port. */
  port: number | undefined;
}

export interface Domain {
  /** The entries exactly as pinned. */
  readonly entries: readonly string[];
  readonly fs: readonly string[];
  readonly hosts: readonly HostSink[];
  readonly services: readonly string[];
}

export const EMPTY_DOMAIN: Domain = Object.freeze({ entries: [], fs: [], hosts: [], services: [] });

const SERVICE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PORT = /^[1-9][0-9]{0,4}$/;

/** A canonical absolute path: rooted, no empty, "." or ".." segment, no trailing slash, no NUL or
 *  backslash. The root "/" itself is refused: the whole file system is not a bound. */
function parseFs(entry: string, path: string): string {
  if (!path.startsWith("/")) throw new DomainError(`"${entry}": an fs: root must be an absolute path`);
  if (path === "/") throw new DomainError(`"${entry}": the whole file system is not a containment domain`);
  if (path.includes("\u0000") || path.includes("\\")) throw new DomainError(`"${entry}": an fs: root may not contain NUL or a backslash`);
  for (const segment of path.slice(1).split("/")) {
    if (segment === "" || segment === "." || segment === "..") throw new DomainError(`"${entry}": an fs: root must be normalized (no empty, "." or ".." segment, no trailing slash)`);
  }
  return path;
}

/** A host by name: lower-case LDH labels, no trailing dot, no scheme, path or userinfo, and not an
 *  address literal (the cage matches names, never addresses). An optional port, 1–65535, with no
 *  leading zero. */
function parseHost(entry: string, rest: string): HostSink {
  const colon = rest.lastIndexOf(":");
  const name = colon < 0 ? rest : rest.slice(0, colon);
  const portText = colon < 0 ? undefined : rest.slice(colon + 1);
  if (name.length === 0 || name.length > 253) throw new DomainError(`"${entry}": a host name is 1 to 253 characters`);
  const labels = name.split(".");
  if (!labels.every((l) => LABEL.test(l))) throw new DomainError(`"${entry}": a host is a lower-case name of letters, digits and hyphens, with no scheme, path, port syntax error or trailing dot`);
  // Names, never addresses: no hex label (0x7f000001 resolves as an address), and the last label
  // begins with a letter, so no dotted, decimal or hex address form can pass as a name.
  if (labels.some((l) => /^0x[0-9a-f]+$/.test(l)) || !/^[a-z]/.test(labels[labels.length - 1] ?? "")) throw new DomainError(`"${entry}": a host is a name, never an address literal`);
  if (portText === undefined) return { host: name, port: undefined };
  if (!PORT.test(portText) || Number(portText) > 65535) throw new DomainError(`"${entry}": a port is 1 to 65535, written without a leading zero`);
  return { host: name, port: Number(portText) };
}

/** Parses a pinned containment_domain. Null is the empty domain. Throws DomainError naming the
 *  first entry that is malformed or non-canonical. */
export function parseDomain(value: readonly string[] | null): Domain {
  if (value === null) return EMPTY_DOMAIN;
  for (let i = 1; i < value.length; i++) {
    const a = value[i - 1] as string;
    const b = value[i] as string;
    if (a === b) throw new DomainError(`"${b}" appears twice: the domain is not canonical (A7)`);
    if (a > b) throw new DomainError(`"${b}" is out of order: the domain is not canonical (A7)`);
  }
  const fs: string[] = [];
  const hosts: HostSink[] = [];
  const services: string[] = [];
  for (const entry of value) {
    if (entry.startsWith("fs:")) fs.push(parseFs(entry, entry.slice(3)));
    else if (entry.startsWith("host:")) hosts.push(parseHost(entry, entry.slice(5)));
    else if (entry.startsWith("svc:")) {
      const name = entry.slice(4);
      if (!SERVICE.test(name)) throw new DomainError(`"${entry}": a service name must match [a-z0-9][a-z0-9._-]{0,63}`);
      services.push(name);
    } else throw new DomainError(`"${entry}": an unknown scheme (fs:, host: and svc: are the three)`);
  }
  return Object.freeze({ entries: Object.freeze([...value]), fs: Object.freeze(fs), hosts: Object.freeze(hosts), services: Object.freeze(services) });
}
