// The leak gate (N6): refuse anything that identifies a deployment or carries a credential,
// in the tracked tree and in every line ever added to reachable history, commit messages included.
//
//   node scripts/leak-gate.mjs --tree       every file `git ls-files` reports: its path and contents
//   node scripts/leak-gate.mjs --history    every commit in `git rev-list HEAD`: added lines, the
//                                           paths it touches, its full message with trailers, and
//                                           its author and committer name and e-mail
//   node scripts/leak-gate.mjs --self-test  prove every rule fires and every scan mechanism holds
//
// Exits non-zero on any finding, on a malformed or stale allow entry, on a shallow history, and on
// a failed self-test. No dependencies: a scanner's dependency tree is exactly the surface this
// repository closed.
//
// A finding prints the rule, the location, and a MASK of the match: at most its first four
// characters (never more than half of it) and its length. Never the match itself; a gate that
// echoes a secret into a public CI log is the leak. A path that itself matches a rule is masked
// wherever it would be printed.
//
// Planted examples in the self-test are synthetic and assembled at run time from fragments and
// random bytes (N8). None is stored in this file as a literal, so the file passes its own --tree.

import { execFileSync } from "node:child_process";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { devNull, homedir, tmpdir } from "node:os";
import path from "node:path";

/**
 * @typedef {object} Rule
 * @property {string} name
 * @property {RegExp} pattern  global; every match on a line is reported
 * @property {string} reason
 * @property {((match: string, before: string) => boolean)=} exempt  true = not a finding
 * @property {string=} exemptReason
 * @property {number=} maskChars  how many leading characters a mask may show (default up to 4)
 */

/**
 * @typedef {object} Finding
 * @property {string} rule
 * @property {string} path     file path, or "(message)" for a commit message
 * @property {string} where    printable location, already masked
 * @property {string} mask
 */

// The organization's domains. Written as regex source, so this file never contains a hostname.
const ORG_DOMAINS = String.raw`(?:clearforge\.dev|clearuniverse\.net)`;

// Role identities that are already public across the organization's repositories (architect's
// ruling on CSR-WO-0001 §7). Exact addresses only: any other address at an org domain is a finding.
const ROLE_IDENTITIES = new Set(["claude@clearforge.dev", "architect@clearforge.dev"]);

// A hostname label may not continue leftwards into this match: `\b` would let `_` through.
const HOST_START = String.raw`(?<![A-Za-z0-9-])`;
// A token may not be the tail of a longer alphanumeric run, but may follow `_`, `=`, `:` or `/`.
const TOKEN_START = String.raw`(?<![A-Za-z0-9])`;
const OCTET = String.raw`(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;

/**
 * @param {string} suffixes  regex alternation of domain suffixes
 * @returns {RegExp}
 */
// Labels are bounded (at most 63 characters, at most 10 before the suffix) so a crafted run of
// "a.a.a…" costs linear time, not quadratic. A longer name still matches from a later label.
const hostRule = (suffixes) =>
  new RegExp(String.raw`${HOST_START}(?:[a-z0-9-]{1,63}\.){1,10}(?:${suffixes})\b`, "gi");

/** @type {Rule[]} */
const RULES = [
  // Hostnames: owned and infrastructure.
  {
    name: "owned-host",
    pattern: hostRule(ORG_DOMAINS),
    reason: "a subdomain of an organization domain names a deployment endpoint",
  },
  {
    name: "tunnel-host",
    pattern: hostRule(String.raw`cfargotunnel\.com|trycloudflare\.com|ngrok(?:-free)?\.(?:app|dev|io)|loca\.lt`),
    reason: "a tunnel provider hostname is a route into a specific machine",
  },
  {
    name: "auth-tenant",
    pattern: hostRule(
      String.raw`authkit\.app|auth0\.com|okta\.com|oktapreview\.com|cloudflareaccess\.com|clerk\.accounts\.dev|amazoncognito\.com`,
    ),
    reason: "a hosted authorization-server tenant hostname identifies the deployment's issuer",
  },
  {
    name: "tailnet-host",
    pattern: hostRule(String.raw`ts\.net`),
    reason: "a tailnet name identifies a private network and its machines",
  },
  {
    name: "platform-host",
    pattern: hostRule(
      String.raw`supabase\.co|workers\.dev|pages\.dev|vercel\.app|fly\.dev|netlify\.app|onrender\.com|herokuapp\.com|railway\.app`,
    ),
    reason: "a hosting-platform subdomain names one account's deployed service",
  },
  {
    name: "user-at-host",
    pattern: /(?<![\w./@-])[a-z_][a-z0-9_-]*@[a-z][a-z0-9-]*(?=:|\s|$)/gi,
    reason: "an ssh-style user and single-label host names both an operator and a machine",
    maskChars: 0,
  },

  // Operator and device paths.
  {
    name: "home-path",
    pattern: /\/home\/[a-z_][a-z0-9._-]*/gi,
    reason: "a home directory path names an operator account",
  },
  {
    name: "users-path",
    pattern: /(?<![a-z]:)\/Users\/[a-z0-9_][a-z0-9._-]*/gi,
    reason: "a /Users profile path (macOS, or a Windows drive under WSL) names an operator account",
  },
  {
    name: "android-terminal-path",
    pattern: /\/data\/(?:data|user\/\d+)\/com\.termux\b/g,
    reason: "the Android terminal app's data path identifies an operator device",
  },
  {
    name: "windows-user-path",
    pattern: /\b[a-z]:(?:\\{1,2}|\/)users(?:\\{1,2}|\/)[a-z0-9._-]+/gi,
    reason: "a Windows profile path names an operator account",
  },
  {
    name: "tilde-user",
    pattern: /(?<![\w~/\\])~[a-z_][a-z0-9_-]*(?=\/)/gi,
    reason: "a tilde followed by a username and a slash expands to that operator's home directory",
  },

  // Network addresses.
  {
    name: "private-ip",
    pattern: new RegExp(
      String.raw`(?<![\d.])(?:10\.${OCTET}|172\.(?:1[6-9]|2\d|3[01])|192\.168|169\.254)\.${OCTET}\.${OCTET}(?![\d]|\.\d)`,
      "g",
    ),
    reason: "a private or link-local address maps the deployment's internal network",
  },
  {
    name: "private-ipv6",
    pattern: /(?<![\w:])(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):(?:[0-9a-f]{0,4}:){1,6}[0-9a-f]{0,4}(?![\w:])/gi,
    reason: "a unique-local or link-local IPv6 address maps the deployment's internal network",
  },
  {
    name: "ipv4",
    pattern: new RegExp(
      String.raw`(?<![\d.])(?!(?:127|0|10)\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)(?:${OCTET}\.){3}${OCTET}(?![\d]|\.\d)`,
      "g",
    ),
    reason: "a routable address locates a host (loopback and private space have their own rules)",
  },
  {
    name: "mac-address",
    pattern: /\b[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}\b/gi,
    reason: "a hardware address identifies a physical device",
  },

  // Identifiers.
  {
    name: "uuid",
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    reason: "a UUID is typically a tunnel, account, tenant or client id",
  },
  {
    name: "long-hex",
    pattern: /\b[0-9a-f]{40,}\b/gi,
    reason: "forty or more hex characters is a key, a secret, or a hash that pins something private",
    exempt: (match, before) => match.length === 40 && /(?:^|[^\w./-])[\w.-]+\/[\w.-]+@$/.test(before),
    exemptReason:
      "an action pin (owner/repo@<40-hex>) is a public reference by construction (architect's ruling)",
  },

  // Credential shapes.
  {
    name: "github-token",
    pattern: new RegExp(String.raw`${TOKEN_START}(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})`, "g"),
    reason: "a GitHub token grants whatever its scope allows to whoever reads it",
  },
  {
    name: "vendor-api-key",
    pattern: new RegExp(
      TOKEN_START +
        String.raw`(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|hf_[A-Za-z0-9]{30,}` +
        String.raw`|glpat-[A-Za-z0-9_-]{20,}|pypi-AgE[A-Za-z0-9_-]{20,}|rk_(?:test|live)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{24,})`,
      "g",
    ),
    reason: "an AI, cloud, code-host, package-index or payment vendor key shape",
  },
  {
    name: "jwt",
    pattern: new RegExp(String.raw`${TOKEN_START}eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`, "g"),
    reason: "a JWT body is a bearer credential until it expires, and names its subject",
  },
  {
    name: "private-key",
    pattern: new RegExp(`${"-".repeat(5)}BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?${"-".repeat(5)}`, "g"),
    reason: "a private key block is the key",
  },
  {
    name: "cloud-access-key",
    pattern: new RegExp(String.raw`${TOKEN_START}(?:AKIA|ASIA)[0-9A-Z]{16}\b`, "g"),
    reason: "an access key id is half of a cloud credential and names the account",
  },
  {
    name: "secret-key",
    pattern: new RegExp(String.raw`${TOKEN_START}sk_(?:test|live)_[A-Za-z0-9]{16,}`, "g"),
    reason: "a payment-platform secret key shape",
  },
  {
    name: "slack-token",
    pattern: new RegExp(
      String.raw`${TOKEN_START}xox[abprs]-[A-Za-z0-9-]{10,}|hooks\.slack\.com\/services\/[A-Za-z0-9/]{16,}`,
      "g",
    ),
    reason: "a chat-platform token or incoming-webhook URL",
  },
  {
    name: "npm-token",
    pattern: new RegExp(String.raw`${TOKEN_START}npm_[A-Za-z0-9]{36}\b`, "g"),
    reason: "a registry publish token can ship code under this repository's name",
  },
  {
    name: "auth-header-value",
    pattern: /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]{20,}=*/gi,
    reason: "an Authorization header value pasted into prose is the credential itself",
  },
  {
    name: "url-token",
    pattern:
      /(?:\b[a-z][\w+.-]{0,31}:\/\/|(?<![\w"'`?&=])\/)[^\s"'<>]{0,2048}[?&](?:(?:access|refresh|id|auth|client)[_-]?)?(?:token|secret|api[_-]?key|key|sig|signature|password|passwd|pwd)=[^&\s"'<>]+/gi,
    reason: "a credential in a query string lands in every proxy, log and referrer on the path",
  },
  {
    name: "url-userinfo",
    pattern: /\b[a-z][\w+.-]{0,31}:\/\/[^\s/@:"'<>]{1,256}:[^\s/@"'<>]{1,256}@/gi,
    reason: "a user:password in a URL is a credential wherever the URL is logged",
  },

  // People.
  {
    name: "email",
    pattern: /(?<![\w.+%-])[\w.+%-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi,
    reason: "an e-mail address is a contactable account identifier",
    maskChars: 0,
    exempt: (match, before) => {
      // A URL whose authority carries a user and password is url-userinfo's finding; reporting it
      // here too would mask the password's first characters as if they were an address.
      if (/\b[a-z][\w+.-]{0,31}:\/\/[^\s/@:"'<>]{1,256}:$/i.test(before)) return true;
      const address = match.toLowerCase();
      const at = address.lastIndexOf("@");
      const local = address.slice(0, at);
      const domain = address.slice(at + 1);
      return (
        /^example\.(?:com|net|org|invalid)$/.test(domain) ||
        /^(?:users\.)?noreply\.github\.com$/.test(domain) ||
        local === "noreply" ||
        local === "no-reply" ||
        ROLE_IDENTITIES.has(address)
      );
    },
    exemptReason:
      "example.* reserved domains, the platform no-reply domain and noreply@/no-reply@ local parts " +
      "are not contactable; the two listed role identities are neither a person nor a deployment " +
      "and are already public (architect's ruling); credentials in a URL's authority are url-userinfo's finding",
  },
];

const ALLOW_FILE = ".leak-gate-allow";

const BINARY_EXTENSIONS = new Set(
  (
    "png jpg jpeg gif webp ico bmp tiff pdf zip gz tgz bz2 xz 7z jar war exe dll so dylib " +
    "wasm woff woff2 ttf otf eot mp3 mp4 mov avi webm ogg wav class o a"
  ).split(" "),
);

/**
 * At most four leading characters, never more than half the match, and the length.
 * @param {string} match
 * @param {number=} limit  a rule may lower it: for a person's address the prefix is the name
 */
function mask(match, limit = 4) {
  const shown = Math.min(limit, Math.floor(match.length / 2));
  return `"${match.slice(0, shown)}…" (len ${String(match.length)})`;
}

/**
 * Every non-exempt match of every rule on one line.
 * @param {string} line
 * @returns {{ rule: Rule, match: string }[]}
 */
function matchLine(line) {
  /** @type {{ rule: Rule, match: string }[]} */
  const out = [];
  for (const rule of RULES) {
    for (const m of line.matchAll(rule.pattern)) {
      // The exemptions look at most 512 characters back: enough for any real prefix, and a
      // crafted long line cannot make the look-back quadratic.
      if (rule.exempt?.(m[0], line.slice(Math.max(0, m.index - 512), m.index))) continue;
      out.push({ rule, match: m[0] });
    }
  }
  return out;
}

/**
 * Replace every rule match in free text with its mask, for text the gate prints that is not a
 * finding: allow globs, error messages.
 * @param {string} text
 */
function redact(text) {
  let out = text;
  for (const { rule, match } of matchLine(text)) out = out.split(match).join(mask(match, rule.maskChars));
  return out;
}

/**
 * A path as it may be printed: itself if clean, else masked whole, so a finding's location can
 * never carry the identifier the path contains.
 * @param {string} p
 */
function printablePath(p) {
  return matchLine(p).length === 0 && !p.includes("\0") ? p : `(path ${mask(p)})`;
}

/**
 * Scan one line. A line holding NUL bytes is also scanned with them removed: that rejoins the
 * ASCII of UTF-16 and UTF-32 text wherever in a file it sits, in either mode.
 * @param {string} line
 * @param {string} filePath
 * @param {string} where
 * @param {Finding[]} out
 */
function scanLine(line, filePath, where, out) {
  /** @type {Set<string>} */
  const seen = new Set();
  const variants = line.includes("\0") ? [line, line.replaceAll("\0", "")] : [line];
  for (const variant of variants) {
    for (const { rule, match } of matchLine(variant)) {
      const key = `${rule.name}\0${match}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ rule: rule.name, path: filePath, where, mask: mask(match, rule.maskChars) });
    }
  }
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {string=} input  stdin
 */
function git(cwd, args, input = "") {
  // Only what is committed may decide what the gate sees: no system or global config, no replace
  // refs or grafts, and repository-local settings that would hide a root commit, strip path
  // prefixes, narrow a diff or re-render content are pinned back.
  return execFileSync(
    "git",
    [
      "-c", "core.quotePath=false",
      "-c", "log.showRoot=true",
      "-c", "log.showSignature=false",
      "-c", "diff.noprefix=false",
      "-c", "diff.mnemonicPrefix=false",
      "-c", "diff.relative=false",
      "-c", "color.ui=false",
      ...args,
    ],
    {
      cwd,
      encoding: "utf8",
      maxBuffer: 1 << 30,
      input,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: devNull,
        GIT_NO_REPLACE_OBJECTS: "1",
        GIT_GRAFT_FILE: devNull,
      },
    },
  );
}

/**
 * Decode file bytes as text. UTF-16 (by BOM, or by the alternating-NUL pattern of mostly-ASCII
 * UTF-16) is decoded as such, so a NUL between every character hides nothing.
 * @param {Buffer} bytes
 */
function decode(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return Buffer.from(bytes.subarray(2, bytes.length - (bytes.length % 2))).swap16().toString("utf16le");
  }
  const sample = bytes.subarray(0, 4096);
  let oddNul = 0;
  let evenNul = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) {
      if (i % 2 === 1) oddNul++;
      else evenNul++;
    }
  }
  const half = sample.length / 2;
  if (half >= 4 && oddNul > half * 0.6 && evenNul < half * 0.1) return bytes.toString("utf16le");
  if (half >= 4 && evenNul > half * 0.6 && oddNul < half * 0.1) {
    return Buffer.from(bytes.subarray(0, bytes.length - (bytes.length % 2))).swap16().toString("utf16le");
  }
  return bytes.toString("utf8").replaceAll("\0", " ");
}

// ---------------------------------------------------------------------------------------------
// Allowlist: `<path-glob> <rule-name> <justification...>`, one per line; `#` comments and blank
// lines ignored. Every entry must suppress at least one finding in the run that reads it, or it is
// stale and the gate fails: stale allows rot into blanket exceptions. Every applied allow is
// printed with its count, so a broad one is visible in the log, not only in review.
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {object} Allow
 * @property {string} text    printable form: rule and masked glob, never the justification
 * @property {number} lineNo
 * @property {RegExp} glob
 * @property {string} rule
 * @property {number} used
 */

/** @param {string} glob */
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
      if (glob[i + 1] === "/") i++;
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * @param {string} cwd
 * @param {string[]} problems
 * @returns {Allow[]}
 */
function readAllows(cwd, problems) {
  const file = path.join(cwd, ALLOW_FILE);
  if (!existsSync(file)) return [];
  /** @type {Allow[]} */
  const allows = [];
  const ruleNames = new Set(RULES.map((r) => r.name));
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const text = raw.trim();
      if (text === "" || text.startsWith("#")) return;
      const [glob, rule, ...why] = text.split(/\s+/);
      if (glob === undefined || rule === undefined || why.length === 0) {
        problems.push(`${ALLOW_FILE}:${String(i + 1)} malformed: want <path-glob> <rule-name> <justification>`);
      } else if (!ruleNames.has(rule)) {
        problems.push(`${ALLOW_FILE}:${String(i + 1)} names an unknown rule`);
      } else {
        allows.push({ text: `${rule} ${redact(glob)}`, lineNo: i + 1, glob: globToRegExp(glob), rule, used: 0 });
      }
    });
  return allows;
}

/**
 * Drop allowed findings, then report every allow that suppressed nothing.
 * @param {Finding[]} findings
 * @param {Allow[]} allows
 * @param {string[]} problems
 * @param {string[]} applied  receives one line per allow that suppressed something
 */
function applyAllows(findings, allows, problems, applied) {
  const kept = findings.filter((f) => {
    // The allowlist can never excuse itself: an entry carrying an identifier is a finding.
    if (f.path === ALLOW_FILE) return true;
    const allow = allows.find((a) => a.rule === f.rule && a.glob.test(f.path));
    if (allow === undefined) return true;
    allow.used++;
    return false;
  });
  for (const a of allows) {
    if (a.used === 0) {
      problems.push(`${ALLOW_FILE}:${String(a.lineNo)} stale allow (matched no finding): ${a.text}`);
    } else {
      applied.push(`${ALLOW_FILE}:${String(a.lineNo)} suppressed ${String(a.used)} finding(s): ${a.text}`);
    }
  }
  return kept;
}

/**
 * @typedef {object} ScanResult
 * @property {Finding[]} findings
 * @property {string[]} problems
 * @property {string[]} applied
 * @property {string} summary
 */

// ---------------------------------------------------------------------------------------------
// Modes.
// ---------------------------------------------------------------------------------------------

/**
 * @param {string} cwd
 * @returns {ScanResult}
 */
function scanTree(cwd) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const skipped = [];
  const files = git(cwd, ["ls-files", "-z"]).split("\0").filter(Boolean);
  for (const file of files) {
    const shown = printablePath(file);
    // The path is content too: a file can be named after a host.
    scanLine(file, file, `${shown}:(path)`, findings);
    const full = path.join(cwd, file);
    let stat;
    try {
      stat = lstatSync(full);
    } catch {
      continue; // listed in the index but deleted in the working tree
    }
    if (stat.isSymbolicLink()) {
      // A link's content, as git stores it, is its target: scan that, never follow it.
      scanLine(readlinkSync(full), file, `${shown}:(link target)`, findings);
      continue;
    }
    if (!stat.isFile()) continue;
    const bytes = readFileSync(full);
    const ext = path.extname(file).slice(1).toLowerCase();
    // Skip only what is binary by extension AND by content: a text file renamed to a binary
    // extension has no NUL byte and is still scanned; a NUL byte in a text file hides nothing.
    if (BINARY_EXTENSIONS.has(ext) && bytes.includes(0)) {
      skipped.push(shown);
      continue;
    }
    // The decoded text, and (when there are NUL bytes) the raw text too, whose NUL-stripped
    // variant catches UTF-16 or UTF-32 that the decoder's sample did not recognize.
    const texts = bytes.includes(0) ? [decode(bytes), bytes.toString("utf8")] : [decode(bytes)];
    /** @type {Finding[]} */
    const inFile = [];
    for (const text of texts) {
      text.split(/\r?\n/).forEach((line, i) => scanLine(line, file, `${shown}:${String(i + 1)}`, inFile));
    }
    /** @type {Set<string>} */
    const seen = new Set();
    for (const f of inFile) {
      const key = `${f.rule}\0${f.mask}`;
      if (!seen.has(key)) findings.push(f);
      seen.add(key);
    }
  }
  /** @type {string[]} */
  const applied = [];
  const allows = readAllows(cwd, problems);
  const kept = applyAllows(findings, allows, problems, applied);
  const skippedNote = skipped.length > 0 ? `; skipped as binary: ${skipped.join(", ")}` : "";
  return { findings: kept, problems, applied, summary: `${String(files.length)} file(s)${skippedNote}` };
}

/**
 * Parse a path from a `rename to`, `copy to` or `+++` header. Git quotes a path with unusual
 * characters; `+++` appends a TAB when a path contains a space.
 * @param {string} raw
 */
function headerPath(raw) {
  const s = raw.replace(/\t$/, "");
  if (s.startsWith('"')) {
    try {
      const v = /** @type {unknown} */ (JSON.parse(s));
      return typeof v === "string" ? v : s;
    } catch {
      return s;
    }
  }
  return s;
}

/** @param {string} line  a `diff --git a/X b/Y` line; returns Y when unambiguous, else "" */
function diffGitPath(line) {
  const rest = line.slice("diff --git ".length);
  const quoted = /^"a\/(?:[^"\\]|\\.)*" ("b\/(?:[^"\\]|\\.)*")$/.exec(rest);
  if (quoted?.[1] !== undefined) return headerPath(quoted[1]).slice(2);
  // Unquoted "a/P b/P". For a rename the two differ and `rename to` supplies the new path.
  const n = (rest.length - 5) / 2;
  if (Number.isInteger(n) && rest.startsWith("a/") && rest.slice(n + 2, n + 5) === " b/") return rest.slice(n + 5);
  return "";
}

/**
 * @param {string} cwd
 * @returns {ScanResult}
 */
function scanHistory(cwd) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {string[]} */
  const problems = [];
  if (git(cwd, ["rev-parse", "--is-shallow-repository"]).trim() === "true") {
    problems.push("history is shallow: refusing to call a partial history clean (fetch with full depth)");
    return { findings, problems, applied: [], summary: "0 commit(s): shallow" };
  }
  const commits = git(cwd, ["rev-list", "--reverse", "HEAD"]).split("\n").filter(Boolean);
  /** @type {Set<string>} */
  const pathsSeen = new Set();
  /**
   * @param {string} p
   * @param {string} short
   */
  const notePath = (p, short) => {
    if (p === "" || p === "/dev/null" || pathsSeen.has(p)) return;
    pathsSeen.add(p);
    scanLine(p, p, `${short}:${printablePath(p)}:(path)`, findings);
  };
  for (const sha of commits) {
    const short = sha.slice(0, 7);
    // The full message, trailers included: a tooling-added trailer never appears in the diff.
    // Read from the raw commit object, not `--format=%B`, which stops at a NUL byte.
    const raw = git(cwd, ["cat-file", "commit", sha]);
    const split = raw.indexOf("\n\n");
    const body = split === -1 ? "" : raw.slice(split + 2);
    body.split(/\r?\n/).forEach((line, i) => scanLine(line, "(message)", `${short}:(message):${String(i + 1)}`, findings));
    // Author and committer identity, name and e-mail, under the same rules (architect's ruling on
    // the CSR-WO-0001 review): an identity is an account identifier whether it sits in a trailer or
    // a header. The timestamp and zone are not scanned; the role-identity exemption applies.
    for (const header of (split === -1 ? raw : raw.slice(0, split)).split("\n")) {
      const identity = /^(author|committer) (.*) \d+ [+-]\d{4}$/.exec(header);
      if (identity?.[1] !== undefined && identity[2] !== undefined) {
        scanLine(identity[2], `(${identity[1]})`, `${short}:(${identity[1]})`, findings);
      }
    }
    // --text: an attribute (`-diff`, `binary`) or a NUL byte must not turn added lines into
    // "Binary files differ". --no-textconv / --no-ext-diff: scan what git stores, not a rendering.
    const diff = git(cwd, [
      "show", "--format=", "--unified=0", "--text", "--no-textconv", "--no-ext-diff", "--no-color",
      // A merge is diffed against its first parent, so an evil merge's own lines arrive with
      // ordinary headers, paths and line numbers.
      "--diff-merges=first-parent", sha,
    ]);
    let file = "";
    let inHeader = false;
    let lineNo = 0;
    for (const line of diff.split("\n")) {
      if (line.startsWith("diff --git ")) {
        inHeader = true;
        file = diffGitPath(line);
        notePath(file, short);
      } else if (inHeader && (line.startsWith("rename to ") || line.startsWith("copy to "))) {
        file = headerPath(line.slice(line.indexOf(" to ") + 4));
        notePath(file, short);
      } else if (inHeader && line.startsWith("+++ ")) {
        const p = headerPath(line.slice(4));
        if (p !== "/dev/null") file = p.replace(/^b\//, "");
        notePath(file, short);
      } else if (line.startsWith("@@")) {
        // Only a hunk header ends the file header: an added line whose content begins "++ "
        // arrives as "+++ " inside a hunk and must be scanned, not taken for a new file.
        inHeader = false;
        lineNo = Number(/\+(\d+)/.exec(line)?.[1] ?? 0);
      } else if (!inHeader && line.startsWith("+")) {
        scanLine(line.slice(1), file, `${short}:${printablePath(file)}:${String(lineNo)}`, findings);
        lineNo++;
      }
    }
  }
  /** @type {string[]} */
  const applied = [];
  const allows = readAllows(cwd, problems);
  const kept = applyAllows(findings, allows, problems, applied);
  return { findings: kept, problems, applied, summary: `${String(commits.length)} commit(s)` };
}

// ---------------------------------------------------------------------------------------------
// Self-test: every rule fires on every planted example; clean input passes; and each scan
// mechanism that could silently pass is made to go red: history behind a revert, a message-only
// trailer, an author or committer identity, a NUL-truncated message, a `-diff` attribute, a NUL byte, a `++` content line, an evil
// merge, a path, a symlink, UTF-16 and UTF-32, local config and replace refs, a shallow clone,
// masking, output escaping, crafted long lines, and stale, malformed or self-excusing allows.
// ---------------------------------------------------------------------------------------------

/** @param {number} n */
const alnum = (n) =>
  Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[randomInt(62)]).join("");
/** @param {number} n */
const lower = (n) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz"[randomInt(26)]).join("");
/** @param {number} n */
const hex = (n) => randomBytes(Math.ceil(n / 2)).toString("hex").slice(0, n);
const octet = () => String(randomInt(1, 255));
const orgDomain = () => ["clearforge", "dev"].join(".");
/** @param {string[]} parts */
const dot = (...parts) => parts.join(".");

/**
 * Synthetic examples per rule, assembled at run time. A rule with several alternatives plants one
 * example per alternative, so each alternative is proven to fire, not just the rule.
 * @type {Record<string, () => string[]>}
 */
const PLANTED = {
  "owned-host": () => [dot(lower(8), orgDomain()), `db_${dot(lower(5), "clearuniverse", "net")}`],
  "tunnel-host": () => [
    dot(lower(12), "cfargotunnel", "com"),
    dot(lower(4), lower(4), "trycloudflare", "com"),
    dot(lower(8), "ngrok-free", "app"),
    dot(lower(8), "loca", "lt"),
  ],
  "auth-tenant": () => [
    dot(lower(10), "authkit", "app"),
    dot(lower(8), "us", "auth0", "com"),
    dot(lower(8), "okta", "com"),
    dot(lower(8), "cloudflareaccess", "com"),
    dot(lower(8), "clerk", "accounts", "dev"),
    dot(lower(8), "auth", "us-east-1", "amazoncognito", "com"),
  ],
  "tailnet-host": () => [dot(lower(6), `tail${hex(6)}`, "ts", "net")],
  "platform-host": () => [
    dot(lower(20), "supabase", "co"),
    dot(lower(6), lower(6), "workers", "dev"),
    dot(lower(8), "pages", "dev"),
    dot(lower(8), "vercel", "app"),
    dot(lower(8), "fly", "dev"),
    dot(lower(8), "netlify", "app"),
    dot(lower(8), "onrender", "com"),
    dot(lower(8), "herokuapp", "com"),
    dot(lower(8), "railway", "app"),
  ],
  "user-at-host": () => [`ssh ${lower(5)}@${lower(7)}`, `scp f ${lower(4)}@${lower(6)}:/srv`],
  "home-path": () => [`/${"home"}/${lower(7)}/project`, `/${"home"}/${lower(1)}/x`],
  "users-path": () => [`/${"Users"}/${lower(7)}/project`, `/mnt/c/${"Users"}/${lower(6)}/x`],
  "android-terminal-path": () => [`/data/data/${dot("com", "termux")}/files/home`, `/data/user/0/${dot("com", "termux")}/x`],
  "windows-user-path": () => [`C:\\${"Users"}\\${lower(7)}\\project`, `D:/${"Users"}/${lower(6)}/x`],
  "tilde-user": () => [`~${lower(7)}/project`],
  "private-ip": () => [
    dot("10", octet(), octet(), octet()),
    dot("172", String(randomInt(16, 32)), octet(), octet()),
    dot("192", "168", octet(), octet()),
    dot("169", "254", octet(), octet()),
  ],
  "private-ipv6": () => [`fd${hex(2)}:${hex(4)}:${hex(4)}::${hex(2)}`, `${"fe"}80::${hex(4)}:${hex(4)}`],
  ipv4: () => [dot("203", "0", "113", octet())],
  "mac-address": () => [Array.from({ length: 6 }, () => hex(2)).join(":"), Array.from({ length: 6 }, () => hex(2)).join("-")],
  uuid: () => [randomUUID()],
  "long-hex": () => [hex(48), `not a pin ${hex(40)}`],
  "github-token": () => [
    `${"gh"}${"p_"}${alnum(36)}`,
    `${"gh"}${"s_"}${alnum(36)}`,
    `${"github"}_pat_${alnum(40)}`,
    `X_${"gh"}${"o_"}${alnum(30)}`,
  ],
  "vendor-api-key": () => [
    `${"sk-"}${"ant-"}${alnum(40)}`,
    `${"sk-"}${"proj-"}${alnum(40)}`,
    `${"AI"}${"za"}${alnum(35)}`,
    `${"hf"}_${alnum(34)}`,
    `${"gl"}pat-${alnum(20)}`,
    `${"py"}pi-AgE${alnum(40)}`,
    `${"rk"}_live_${alnum(24)}`,
    `${"wh"}sec_${alnum(32)}`,
  ],
  jwt: () => [
    [
      Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
      Buffer.from(JSON.stringify({ sub: lower(12) })).toString("base64url"),
      "",
    ].join("."),
  ],
  "private-key": () => [
    `${"-".repeat(5)}BEGIN ${"EC"} PRIVATE ${"KEY"}${"-".repeat(5)}`,
    `${"-".repeat(5)}BEGIN ${"PGP"} PRIVATE ${"KEY"} BLOCK${"-".repeat(5)}`,
  ],
  "cloud-access-key": () => [`${"AK"}${"IA"}${alnum(16).toUpperCase()}`, `key_${"AS"}${"IA"}${alnum(16).toUpperCase()}`],
  "secret-key": () => [`${"sk"}_${"test"}_${alnum(24)}`],
  "slack-token": () => [
    `${"xo"}xb-${String(randomInt(1e9, 9e9))}-${alnum(24)}`,
    `https://${dot("hooks", "slack", "com")}/services/T${alnum(8)}/B${alnum(8)}/${alnum(24)}`,
  ],
  "npm-token": () => [`${"np"}m_${alnum(36)}`],
  "auth-header-value": () => [
    `Authorization: ${"Bear"}er ${alnum(32)}`,
    `authorization: ${"BEAR"}ER ${alnum(32)}`,
    `Authorization: ${"Bas"}ic ${Buffer.from(`${lower(6)}:${alnum(16)}`).toString("base64")}`,
  ],
  "url-token": () => [
    `https://api.example.net/v1/items?${"access_"}${"token"}=${alnum(24)}`,
    `https://api.example.net/v1?${"access"}${"Token"}=${alnum(24)}`,
    `wss://example.net/socket?${"to"}ken=${alnum(24)}`,
    `see /api/v1/items?${"ke"}y=${alnum(24)}`,
    `https://example.net/blob?sv=1&${"si"}g=${alnum(24)}`,
  ],
  "url-userinfo": () => [`${"https"}://${lower(6)}:${alnum(20)}@api.example.net/v1`],
  email: () => [`${lower(6)}@${dot(lower(8), "test")}`],
};

/** Near-misses that must NOT fire: the exemptions and ordinary prose. */
const CLEAN = () =>
  [
    "# A clean synthetic file",
    "Contact: someone@example.com, or a noreply@ address such as noreply@anthropic.com.",
    "Co-Authored-By: A Tool <noreply@anthropic.com>",
    "Co-authored-by: Bot <12345+some-bot[bot]@users.noreply.github.com>",
    "Co-authored-by: Claude (builder) <claude@clearforge.dev>",
    "Architect: architect@clearforge.dev",
    `      - uses: actions/checkout@${hex(40)} # v7.0.1`,
    `pinned at some-org/some-action@${hex(40)}`,
    "    uses: actions/checkout@main",
    "Bind to 127.0.0.1 or 0.0.0.0; see localhost and ~/ for the current user.",
    "Node 24.21.0, npm 11.19.0, TypeScript 6.0.3; a short sha like 1e3c7b0.",
    "A Bearer token is sent in the Authorization header; Basic authentication is not used.",
    "The organization's own site is clearforge.dev; /home/ alone names nobody.",
    "~~struck through~~, ~ approximately ~5 items, and ~ten minutes.",
    "The test job runs on ubuntu-latest; see https://github.com/ClearForge-LLC/clearseal-reference.",
    "An invalid address like 192.168.1.300 is not an address.",
    `A grep for "?${"to"}ken=" in prose is not a URL.`,
    "typescript-eslint@8.70.1 and @types/node@24.13.6 are dependencies.",
  ].join("\n");

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {string=} input
 */
function gitIn(cwd, args, input = "") {
  return git(cwd, [
    "-c", "user.name=Self Test",
    "-c", "user.email=selftest@example.com",
    "-c", "commit.gpgsign=false",
    "-c", "core.hooksPath=/dev/null",
    "-c", "init.defaultBranch=main",
    ...args,
  ], input);
}

/**
 * @param {string} root
 * @param {string} name
 */
function newRepo(root, name) {
  const dir = path.join(root, name);
  gitIn(root, ["init", "-q", dir]);
  return dir;
}

/**
 * @param {string} dir
 * @param {string} message
 */
function commitAll(dir, message) {
  gitIn(dir, ["add", "-A"]);
  gitIn(dir, ["commit", "-q", "--allow-empty", "-m", message]);
  return gitIn(dir, ["rev-parse", "--short=7", "HEAD"]).trim();
}

/** @param {Finding} f */
function formatFinding(f) {
  return `${f.rule} ${f.where} ${f.mask}`;
}

/** @returns {number} exit code */
function selfTest() {
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const lines = [];
  /**
   * @param {boolean} ok
   * @param {string} pass  printed on success
   * @param {string} fail  recorded on failure
   */
  const check = (ok, pass, fail) => {
    if (ok) lines.push(`self-test: ${pass}`);
    else failures.push(fail);
  };
  const privateIp = () => dot("10", octet(), octet(), octet());
  const root = mkdtempSync(path.join(tmpdir(), "leak-gate-selftest-"));
  try {
    // 1. Every rule fires on every planted example, by name, and nothing fires cross-rule.
    const planted = newRepo(root, "planted");
    /** @type {string[]} */
    const samples = [];
    /** @type {Record<string, string[]>} */
    const filesByRule = {};
    for (const rule of RULES) {
      const make = PLANTED[rule.name];
      if (make === undefined) {
        failures.push(`rule "${rule.name}" has no planted example: a rule with no red-proof is not a rule`);
        continue;
      }
      filesByRule[rule.name] = make().map((sample, i) => {
        samples.push(sample);
        const file = `${rule.name}-${String(i)}.md`;
        writeFileSync(path.join(planted, file), `planted: ${sample}\n`);
        return file;
      });
    }
    for (const name of Object.keys(PLANTED)) {
      if (!RULES.some((r) => r.name === name)) failures.push(`planted example "${name}" names no rule`);
    }
    gitIn(planted, ["add", "-A"]);
    const tree = scanTree(planted);
    for (const rule of RULES) {
      const files = filesByRule[rule.name] ?? [];
      const missed = files.filter((f) => !tree.findings.some((x) => x.rule === rule.name && x.path === f));
      const first = tree.findings.find((x) => x.rule === rule.name);
      check(
        files.length > 0 && missed.length === 0 && first !== undefined,
        `fired  ${rule.name.padEnd(22)} ${String(files.length)} example(s), e.g. ${first?.where ?? ""} ${first?.mask ?? ""}`,
        `rule "${rule.name}" did NOT fire on: ${missed.join(", ") || "(no example)"}`,
      );
    }
    for (const f of tree.findings) {
      if (!f.path.startsWith(`${f.rule}-`)) failures.push(`cross-fire: ${f.rule} on ${f.where} (each file plants one rule)`);
    }

    // 2. Masking: no finding line carries the value it found; short matches show at most half.
    const printed = tree.findings.map(formatFinding).join("\n");
    const tokenHit = tree.findings.find((f) => f.rule === "github-token");
    check(
      tokenHit !== undefined && !samples.some((s) => s.length > 4 && printed.includes(s)),
      `masked ${tokenHit === undefined ? "" : formatFinding(tokenHit)}  (no finding line carries its planted value)`,
      "a finding line printed a full planted value",
    );
    check(mask("~abc") === `"~a…" (len 4)`, `masked a 4-character match shows 2: ${mask("~abc")}`, "short match not masked to half");

    // 3. Exemption boundary: another address at the org domain is still a finding.
    /** @type {Finding[]} */
    const boundary = [];
    scanLine(`ops@${orgDomain()}`, "x", "x:1", boundary);
    check(
      boundary.some((f) => f.rule === "email"),
      "fired  email on a non-role address at the org domain (the role exemption is exact)",
      "a non-role address at the org domain was exempted",
    );

    // 4. Clean synthetic tree of near-misses and exemptions: zero findings.
    const clean = newRepo(root, "clean");
    writeFileSync(path.join(clean, "README.md"), `${CLEAN()}\n`);
    gitIn(clean, ["add", "-A"]);
    const cleanTree = scanTree(clean);
    for (const f of cleanTree.findings) failures.push(`clean tree flagged: ${formatFinding(f)}`);
    check(cleanTree.findings.length === 0, "clean  synthetic tree of near-misses and exemptions: 0 findings", "clean tree not clean");

    // 5. Paths, symlinks and UTF-16 in --tree.
    const odd = newRepo(root, "odd");
    const hostName = dot(lower(6), orgDomain());
    writeFileSync(path.join(odd, `${hostName}.md`), "clean\n");
    mkdirSync(path.join(odd, "dir"));
    writeFileSync(path.join(odd, "dir", "f.md"), "clean\n");
    const posix = process.platform !== "win32";
    if (posix) {
      symlinkSync("dir", path.join(odd, "dir-link"));
      symlinkSync(`/${"home"}/${lower(6)}/secret`, path.join(odd, "dangling"));
    }
    writeFileSync(path.join(odd, "wide.txt"), Buffer.from(`\ufeffreached ${privateIp()}\n`, "utf16le"));
    writeFileSync(path.join(odd, "wide-nobom.txt"), Buffer.from(`reached ${privateIp()}\n`, "utf16le"));
    /** @param {string} text */
    const utf32 = (text) => Buffer.concat([...text].map((c) => { const b = Buffer.alloc(4); b.writeUInt32LE(c.codePointAt(0) ?? 0); return b; }));
    writeFileSync(path.join(odd, "wide32.txt"), Buffer.concat([Buffer.from([0xff, 0xfe, 0, 0]), utf32(`reached ${privateIp()}\n`)]));
    writeFileSync(path.join(odd, "wide-late.txt"), Buffer.concat([Buffer.from(`${"x".repeat(80)}\n`.repeat(64)), Buffer.from(`reached ${privateIp()}\n`, "utf16le")]));
    writeFileSync(path.join(odd, "odd-be.txt"), Buffer.from([0xfe, 0xff, 0x00, 0x41, 0x42]));
    gitIn(odd, ["add", "-A"]);
    const oddTree = scanTree(odd);
    const oddOut = oddTree.findings.map(formatFinding).join("\n");
    check(
      oddTree.findings.some((f) => f.rule === "owned-host" && f.where.endsWith(":(path)")) && !oddOut.includes(hostName),
      "fired  owned-host on a tracked file's NAME, and the name is masked in the output",
      "--tree missed an identifier in a file name, or printed it",
    );
    if (posix) {
      check(
        oddTree.findings.some((f) => f.rule === "home-path" && f.where.includes("(link target)")),
        "fired  home-path on a symlink's target; a link to a directory does not crash the scan",
        "--tree missed a symlink target",
      );
    } else {
      lines.push("self-test: skip   symlink cases (not creatable here without privileges)");
    }
    const wide = new Set(oddTree.findings.filter((f) => f.rule === "private-ip").map((f) => f.path));
    check(
      ["wide.txt", "wide-nobom.txt", "wide32.txt", "wide-late.txt"].every((f) => wide.has(f)),
      "fired  private-ip in UTF-16 (with and without a byte-order mark), UTF-32, and UTF-16 after 5 KB of ASCII; an odd-length big-endian file does not crash",
      `--tree missed wide text: found only ${[...wide].join(", ")}`,
    );

    // 6. History: each way an added line could slip past `git show`.
    const hist = newRepo(root, "history");
    writeFileSync(path.join(hist, "notes.md"), "clean\n");
    commitAll(hist, "clean start");
    writeFileSync(path.join(hist, "notes.md"), `clean\nreached ${privateIp()}\n`);
    const reverted = commitAll(hist, "add a note");
    gitIn(hist, ["revert", "--no-edit", "HEAD"]);
    const trailer = commitAll(hist, `tidy\n\nReported-by: A Person <${PLANTED.email?.()[0] ?? ""}>`);
    writeFileSync(path.join(hist, "plus.md"), `++ ${privateIp()}\n`);
    const plusplus = commitAll(hist, "a line that starts with two plus signs");
    writeFileSync(path.join(hist, "nul.md"), Buffer.concat([Buffer.from(`reached ${privateIp()}\n`), Buffer.from([0])]));
    const nul = commitAll(hist, "a text file with a NUL byte");
    writeFileSync(path.join(hist, "blind.md"), `reached ${privateIp()}\n`);
    const blinded = commitAll(hist, "content later hidden by an attribute");
    writeFileSync(path.join(hist, `${hostName}.txt`), "");
    const named = commitAll(hist, "an empty file whose name is the identifier");
    writeFileSync(path.join(hist, "wide.txt"), Buffer.from(`\ufeffreached ${privateIp()}\n`, "utf16le"));
    const wideCommit = commitAll(hist, "UTF-16 text, deleted again below");
    // An evil merge: lines that exist in neither parent, added by the merge commit itself.
    gitIn(hist, ["checkout", "-q", "-b", "side"]);
    writeFileSync(path.join(hist, "side.md"), "side\n");
    commitAll(hist, "side work");
    gitIn(hist, ["checkout", "-q", "main"]);
    writeFileSync(path.join(hist, "main.md"), "main\n");
    commitAll(hist, "main work");
    gitIn(hist, ["merge", "-q", "--no-ff", "--no-commit", "side"]);
    writeFileSync(path.join(hist, "merged.md"), `reached ${privateIp()}\n`);
    const merge = commitAll(hist, "merge side");
    for (const f of ["plus.md", "nul.md", "blind.md", `${hostName}.txt`, "wide.txt", "merged.md"]) rmSync(path.join(hist, f));
    writeFileSync(path.join(hist, ".gitattributes"), "* -diff\n");
    commitAll(hist, "remove everything; mark all files as not diffable");
    check(scanTree(hist).findings.length === 0, "clean  history fixture's final tree is clean", "history fixture's final tree is not clean");
    const history = scanHistory(hist);
    /**
     * @param {string} rule
     * @param {string} prefix
     */
    const found = (rule, prefix) => history.findings.some((f) => f.rule === rule && f.where.startsWith(prefix));
    check(found("private-ip", reverted), `fired  private-ip behind a revert (${reverted})`, "--history missed a shape a later revert removed");
    check(found("email", `${trailer}:(message)`), `fired  email in a commit-message trailer only (${trailer})`, "--history missed a message-only trailer");
    check(found("private-ip", plusplus), `fired  private-ip on an added line starting with "++" (${plusplus})`, "--history misread a ++ line as a header");
    check(found("private-ip", nul), `fired  private-ip in a text file with a NUL byte (${nul})`, "--history treated a NUL-byte text file as binary");
    check(found("private-ip", blinded), `fired  private-ip despite a later "* -diff" attribute (${blinded})`, "--history was blinded by .gitattributes");
    check(
      found("owned-host", named) && !history.findings.map(formatFinding).join("\n").includes(hostName),
      `fired  owned-host on a file NAME in history, masked (${named})`,
      "--history missed or printed an identifier in a file name",
    );
    check(found("private-ip", wideCommit), `fired  private-ip in UTF-16 text committed then deleted (${wideCommit})`, "--history missed UTF-16 text");
    check(
      history.findings.some((f) => f.rule === "private-ip" && f.where.startsWith(`${merge}:merged.md:`)),
      `fired  private-ip added by an evil merge, with its path (${merge})`,
      "--history missed or mislocated an evil merge's own line",
    );

    // 6a. Author and committer identity: one planted shape per field (name, e-mail, for each of
    // author and committer); a role identity in either field passes.
    const ident = newRepo(root, "identity");
    const cleanAuthor = "Self Test <selftest@example.com>";
    /**
     * @param {string} author
     * @param {string} committerName
     * @param {string} committerEmail
     * @param {string} message
     */
    const commitAs = (author, committerName, committerEmail, message) => {
      writeFileSync(path.join(ident, "log.md"), `${message}\n`);
      gitIn(ident, ["add", "-A"]);
      gitIn(ident, ["-c", `user.name=${committerName}`, "-c", `user.email=${committerEmail}`, "commit", "-q", "--author", author, "-m", message]);
      return gitIn(ident, ["rev-parse", "--short=7", "HEAD"]).trim();
    };
    const authorName = commitAs(`Build on ${dot(lower(6), orgDomain())} <selftest@example.com>`, "Self Test", "selftest@example.com", "author name");
    const authorEmail = commitAs(`A Person <${PLANTED.email?.()[0] ?? ""}>`, "Self Test", "selftest@example.com", "author email");
    const committerName = commitAs(cleanAuthor, `Runner ${privateIp()}`, "selftest@example.com", "committer name");
    const committerEmail = commitAs(cleanAuthor, "Self Test", PLANTED.email?.()[0] ?? "", "committer email");
    const role = commitAs(`Claude (builder) <claude@${orgDomain()}>`, "Claude (architect)", `architect@${orgDomain()}`, "role identities");
    const identity = scanHistory(ident);
    /**
     * @param {string} rule
     * @param {string} where
     */
    const fired = (rule, where) => identity.findings.some((f) => f.rule === rule && f.where === where);
    check(
      fired("owned-host", `${authorName}:(author)`) &&
        fired("email", `${authorEmail}:(author)`) &&
        fired("private-ip", `${committerName}:(committer)`) &&
        fired("email", `${committerEmail}:(committer)`),
      `fired  on each identity field: author name (${authorName}), author e-mail (${authorEmail}), committer name (${committerName}), committer e-mail (${committerEmail})`,
      "--history missed a shape in an author or committer name or e-mail",
    );
    check(
      !identity.findings.some((f) => f.where.startsWith(role)) && identity.findings.length === 4,
      `clean  role identities as author and committer pass (${role}); only the four planted fields fired`,
      `role identities were flagged, or identity scanning over-fired (${String(identity.findings.length)} findings)`,
    );

    // 6b. A message hidden behind a NUL byte, in a commit object git itself would not write.
    const nulMsg = newRepo(root, "nulmsg");
    writeFileSync(path.join(nulMsg, "k.md"), "clean\n");
    commitAll(nulMsg, "clean start");
    const parent = gitIn(nulMsg, ["rev-parse", "HEAD"]).trim();
    const treeId = gitIn(nulMsg, ["rev-parse", "HEAD^{tree}"]).trim();
    const who = "Self Test <selftest@example.com> 1700000000 +0000";
    const crafted = gitIn(
      nulMsg,
      ["hash-object", "-t", "commit", "-w", "--literally", "--stdin"],
      `tree ${treeId}\nparent ${parent}\nauthor ${who}\ncommitter ${who}\n\nsubject\0hidden ${privateIp()}\n`,
    ).trim();
    gitIn(nulMsg, ["update-ref", "HEAD", crafted]);
    check(
      scanHistory(nulMsg).findings.some((f) => f.rule === "private-ip" && f.where.includes("(message)")),
      "fired  private-ip after a NUL byte in a commit message",
      "--history stopped reading a message at a NUL byte",
    );

    // 6c. Repository-local config and replace refs must not hide history.
    const hidden = newRepo(root, "hidden");
    writeFileSync(path.join(hidden, "root.md"), `reached ${privateIp()}\n`);
    commitAll(hidden, "root commit carries the shape");
    writeFileSync(path.join(hidden, "root.md"), "clean\n");
    commitAll(hidden, "clean");
    writeFileSync(path.join(hidden, "more.md"), "clean\n");
    const tip = commitAll(hidden, "tip");
    gitIn(hidden, ["config", "log.showRoot", "false"]);
    gitIn(hidden, ["config", "diff.noprefix", "true"]);
    gitIn(hidden, ["replace", "--graft", tip]);
    check(
      scanHistory(hidden).findings.some((f) => f.rule === "private-ip" && f.where.includes("root.md")),
      "fired  private-ip in a root commit hidden by local log.showRoot=false, diff.noprefix and a replace graft",
      "--history was blinded by local config or replace refs",
    );

    // 7. A shallow clone is refused, not called clean.
    const shallow = path.join(root, "shallow");
    gitIn(root, ["clone", "-q", "--depth", "1", `file://${hist}`, shallow]);
    check(
      scanHistory(shallow).problems.some((p) => p.includes("shallow")),
      "fired  a shallow history is refused, not called clean",
      "--history passed a shallow clone",
    );

    // 8. Allowlist: a used allow suppresses and is reported; stale and malformed allows fail.
    writeFileSync(path.join(planted, ALLOW_FILE), "uuid-*.md uuid synthetic fixture\n");
    const allowed = scanTree(planted);
    check(
      !allowed.findings.some((f) => f.rule === "uuid") && allowed.problems.length === 0 && allowed.applied.length === 1,
      "fired  a used allow suppresses its findings and is printed as applied",
      "a matching allow entry did not suppress cleanly, or was not reported",
    );
    writeFileSync(path.join(planted, ALLOW_FILE), "nothing/** uuid matches no finding\n");
    check(
      scanTree(planted).problems.some((p) => p.includes("stale allow")),
      "fired  a stale allow entry fails the gate",
      "a stale allow entry did not fail",
    );
    writeFileSync(path.join(planted, ALLOW_FILE), "uuid-0.md no-such-rule because\njust-a-glob\n");
    check(scanTree(planted).problems.length === 2, "fired  malformed and unknown-rule allow entries fail", "malformed allow entries did not both fail");
    const excuse = newRepo(root, "excuse");
    const excused = privateIp();
    writeFileSync(path.join(excuse, ALLOW_FILE), `** private-ip because ${excused}\n${excused} uuid glob is itself the shape\n`);
    gitIn(excuse, ["add", "-A"]);
    const excuseTree = scanTree(excuse);
    const excuseOut = [...excuseTree.findings.map(formatFinding), ...excuseTree.problems, ...excuseTree.applied].join("\n");
    check(
      excuseTree.findings.some((f) => f.path === ALLOW_FILE && f.rule === "private-ip") && !excuseOut.includes(excused),
      "fired  an allow entry cannot excuse its own identifier, and no output line echoes it",
      "an allow entry excused itself, or an allow line was echoed raw",
    );

    // 9. Output: control characters in a path cannot start a new log line.
    check(
      !printable("a\n::warning::b\r").includes("\n") && printable("a\n").includes("\\x0a"),
      "fired  control characters in printed text are escaped (no injected log lines)",
      "a control character survived into printed output",
    );

    // 10. Crafted long lines stay linear: a hung gate is no gate.
    const started = performance.now();
    for (const unit of ["a.", "1.", "/", "x@a.", "-", "a:"]) matchLine(unit.repeat(100_000));
    const took = (performance.now() - started) / 1000;
    check(took < 10, `fired  crafted 100k-character lines scanned in ${took.toFixed(1)}s`, `crafted long lines took ${took.toFixed(1)}s`);

    lines.push(`self-test: ${String(RULES.length)} rules, ${String(samples.length)} planted examples`);
  } catch (err) {
    failures.push(`self-test crashed: ${describeError(err)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  for (const l of lines) console.log(printable(l));
  if (failures.length > 0) {
    for (const f of failures) console.error(printable(`self-test: FAIL — ${f}`));
    return 1;
  }
  console.log("self-test: PASS — every rule fired on every planted example; every scan mechanism went red; clean input passed");
  return 0;
}

/**
 * An error's first line without local absolute paths: a crash log is published too.
 * @param {unknown} err
 */
function describeError(err) {
  const text = err instanceof Error ? err.message : String(err);
  const first = text.split(process.cwd()).join(".").split(tmpdir()).join("<tmp>").split(homedir()).join("<home>").split("\n")[0];
  return redact(first ?? "");
}

/**
 * Every line the gate prints goes through here: a control character in a path (a newline followed
 * by "::", say) must not become a line the CI runner reads as a workflow command.
 * @param {string} text
 */
function printable(text) {
  let out = "";
  for (const c of text) {
    const code = c.charCodeAt(0);
    out += code < 0x20 || code === 0x7f ? `\\x${code.toString(16).padStart(2, "0")}` : c;
  }
  return out;
}

/**
 * @param {string} label
 * @param {ScanResult} r
 * @param {string} elapsed
 */
function report(label, r, elapsed) {
  for (const f of r.findings) console.error(printable(`leak-gate: ${formatFinding(f)}`));
  for (const p of r.problems) console.error(printable(`leak-gate: ${p}`));
  for (const a of r.applied) console.log(printable(`leak-gate: allow applied — ${a}`));
  if (r.findings.length + r.problems.length > 0) {
    console.error(
      printable(
        `leak-gate ${label}: REFUSED — ${String(r.findings.length)} finding(s), ${String(r.problems.length)} problem(s); ${r.summary} in ${elapsed}`,
      ),
    );
    return 1;
  }
  console.log(printable(`leak-gate ${label}: clean — ${r.summary} in ${elapsed}`));
  return 0;
}

function main() {
  const [mode, ...extra] = process.argv.slice(2);
  const started = performance.now();
  const elapsed = () => `${((performance.now() - started) / 1000).toFixed(2)}s`;
  const cwd = process.cwd();
  try {
    if (extra.length === 0 && mode === "--self-test") return selfTest();
    if (extra.length === 0 && mode === "--tree") return report("--tree", scanTree(cwd), elapsed());
    if (extra.length === 0 && mode === "--history") return report("--history", scanHistory(cwd), elapsed());
  } catch (err) {
    console.error(printable(`leak-gate: error — ${describeError(err)}`));
    return 1;
  }
  console.error("usage: node scripts/leak-gate.mjs --tree | --history | --self-test");
  return 2;
}

process.exitCode = main();
