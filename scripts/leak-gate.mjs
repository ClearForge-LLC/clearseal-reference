// The leak gate (N6): refuse anything that identifies a deployment or carries a credential,
// in the tracked tree and in every line ever added to reachable history, commit messages included.
//
//   node scripts/leak-gate.mjs --tree       every file `git ls-files` reports
//   node scripts/leak-gate.mjs --history    every commit in `git rev-list HEAD`: added lines + message
//   node scripts/leak-gate.mjs --self-test  prove every rule fires, and that clean input passes
//
// Exits non-zero on any finding, on a malformed or stale allow entry, and on a failed self-test.
// No dependencies: a scanner's dependency tree is exactly the surface this repository closed.
//
// A finding prints the rule, the location, and a MASK of the match: its first four characters and
// its length. Never the match itself; a gate that echoes a secret into a public CI log is the leak.
//
// Planted examples in the self-test are synthetic and assembled at run time from fragments and
// random bytes (N8). None is stored in this file as a literal, so the file passes its own --tree.

import { execFileSync } from "node:child_process";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * @typedef {object} Rule
 * @property {string} name
 * @property {RegExp} pattern  global; every match on a line is reported
 * @property {string} reason
 * @property {((match: string, before: string) => boolean)=} exempt  true = not a finding
 * @property {string=} exemptReason
 */

/**
 * @typedef {object} Finding
 * @property {string} rule
 * @property {string} path     file path, or "(message)" for a commit message
 * @property {string} where    printable location
 * @property {string} mask
 */

// The organization's domains. Written as regex source, so this file never contains a hostname.
const ORG_DOMAINS = String.raw`(?:clearforge\.dev|clearuniverse\.net)`;

// Role identities that are already public across the organization's repositories (architect's
// ruling on CSR-WO-0001 §7). Exact addresses only: any other address at an org domain is a finding.
const ROLE_IDENTITIES = new Set(["claude@clearforge.dev", "architect@clearforge.dev"]);

/** @type {Rule[]} */
const RULES = [
  // Hostnames: owned and infrastructure.
  {
    name: "owned-host",
    pattern: new RegExp(String.raw`\b(?:[a-z0-9-]+\.)+${ORG_DOMAINS}\b`, "gi"),
    reason: "a subdomain of an organization domain names a deployment endpoint",
  },
  {
    name: "tunnel-host",
    pattern:
      /\b(?:[a-z0-9-]+\.)+(?:cfargotunnel\.com|trycloudflare\.com|ngrok(?:-free)?\.(?:app|dev|io)|loca\.lt)\b/gi,
    reason: "a tunnel provider hostname is a route into a specific machine",
  },
  {
    name: "auth-tenant",
    pattern: /\b(?:[a-z0-9-]+\.)+(?:authkit\.app|auth0\.com|okta\.com|oktapreview\.com)\b/gi,
    reason: "a hosted authorization-server tenant hostname identifies the deployment's issuer",
  },
  {
    name: "tailnet-host",
    pattern: /\b(?:[a-z0-9-]+\.)+ts\.net\b/gi,
    reason: "a tailnet name identifies a private network and its machines",
  },

  // Operator and device paths.
  {
    name: "home-path",
    pattern: /\/home\/[a-z_][a-z0-9._-]+/gi,
    reason: "a home directory path names an operator account",
  },
  {
    name: "android-terminal-path",
    pattern: /\/data\/(?:data|user\/\d+)\/com\.termux\b/g,
    reason: "the Android terminal app's data path identifies an operator device",
  },
  {
    name: "windows-user-path",
    pattern: /\b[a-z]:\\{1,2}users\\{1,2}[a-z0-9._-]+/gi,
    reason: "a Windows profile path names an operator account",
  },
  {
    name: "tilde-user",
    pattern: /(?<![\w~/\\])~[a-z_][a-z0-9_-]*(?=\/|\s|$|[`'")\]])/gi,
    reason: "a tilde followed by a username expands to that operator's home directory",
  },

  // Network addresses.
  {
    name: "private-ip",
    pattern:
      /(?<![\d.])(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168|169\.254)\.\d{1,3}\.\d{1,3}(?![\d]|\.\d)/g,
    reason: "a private or link-local address maps the deployment's internal network",
  },
  {
    name: "ipv4",
    pattern:
      /(?<![\d.])(?!(?:127|0|10)\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)(?:\d{1,3}\.){3}\d{1,3}(?![\d]|\.\d)/g,
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
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
    reason: "a GitHub token grants whatever its scope allows to whoever reads it",
  },
  {
    name: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    reason: "a JWT body is a bearer credential until it expires, and names its subject",
  },
  {
    name: "private-key",
    pattern: new RegExp(`${"-".repeat(5)}BEGIN [A-Z ]*PRIVATE KEY${"-".repeat(5)}`, "g"),
    reason: "a private key block is the key",
  },
  {
    name: "cloud-access-key",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    reason: "an access key id is half of a cloud credential and names the account",
  },
  {
    name: "secret-key",
    pattern: /\bsk_(?:test|live)_[A-Za-z0-9]{16,}/g,
    reason: "a payment-platform secret key shape",
  },
  {
    name: "slack-token",
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
    reason: "a chat-platform token shape",
  },
  {
    name: "npm-token",
    pattern: /\bnpm_[A-Za-z0-9]{36}\b/g,
    reason: "a registry publish token can ship code under this repository's name",
  },
  {
    name: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g,
    reason: "an Authorization header value pasted into prose is the credential itself",
  },
  {
    name: "url-token",
    pattern:
      /\b(?:https?|wss?):\/\/[^\s"'<>]*[?&](?:(?:access|refresh|id|auth)_)?(?:token|api_?key)=[^&\s"'<>]+/gi,
    reason: "a credential in a query string lands in every proxy, log and referrer on the path",
  },

  // People.
  {
    name: "email",
    pattern: /(?<![\w.+%-])[\w.+%-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi,
    reason: "an e-mail address is a contactable account identifier",
    exempt: (match) => {
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
      "and are already public (architect's ruling)",
  },
];

const ALLOW_FILE = ".leak-gate-allow";

const BINARY_EXTENSIONS = new Set(
  (
    "png jpg jpeg gif webp ico bmp tiff pdf zip gz tgz bz2 xz 7z jar war exe dll so dylib " +
    "wasm woff woff2 ttf otf eot mp3 mp4 mov avi webm ogg wav class o a"
  ).split(" "),
);

/** @param {string} match */
function mask(match) {
  return `"${match.slice(0, 4)}…" (len ${match.length})`;
}

/**
 * @param {string} line
 * @param {string} filePath
 * @param {string} where
 * @param {Finding[]} out
 */
function scanLine(line, filePath, where, out) {
  for (const rule of RULES) {
    for (const m of line.matchAll(rule.pattern)) {
      const before = line.slice(0, m.index);
      if (rule.exempt?.(m[0], before)) continue;
      out.push({ rule: rule.name, path: filePath, where, mask: mask(m[0]) });
    }
  }
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, args) {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// ---------------------------------------------------------------------------------------------
// Allowlist: `<path-glob> <rule-name> <justification...>`, one per line; `#` comments and blank
// lines ignored. Every entry must suppress at least one finding in the run that reads it, or it is
// stale and the gate fails: stale allows rot into blanket exceptions.
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {object} Allow
 * @property {string} text
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
        problems.push(`${ALLOW_FILE}:${i + 1} malformed: want <path-glob> <rule-name> <justification>`);
      } else if (!ruleNames.has(rule)) {
        problems.push(`${ALLOW_FILE}:${i + 1} names unknown rule "${rule}"`);
      } else {
        allows.push({ text, lineNo: i + 1, glob: globToRegExp(glob), rule, used: 0 });
      }
    });
  return allows;
}

/**
 * Drop allowed findings, then report every allow that suppressed nothing.
 * @param {Finding[]} findings
 * @param {Allow[]} allows
 * @param {string[]} problems
 */
function applyAllows(findings, allows, problems) {
  const kept = findings.filter((f) => {
    const allow = allows.find((a) => a.rule === f.rule && a.glob.test(f.path));
    if (allow === undefined) return true;
    allow.used++;
    return false;
  });
  for (const a of allows) {
    if (a.used === 0) {
      problems.push(`${ALLOW_FILE}:${a.lineNo} stale allow (matched no finding): ${a.text}`);
    }
  }
  return kept;
}

// ---------------------------------------------------------------------------------------------
// Modes.
// ---------------------------------------------------------------------------------------------

/**
 * @param {string} cwd
 * @returns {{ findings: Finding[], problems: string[], files: number, skipped: string[] }}
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
    const full = path.join(cwd, file);
    if (!existsSync(full)) continue;
    const bytes = readFileSync(full);
    const ext = path.extname(file).slice(1).toLowerCase();
    // Skip only what is binary by extension AND by content: a text file renamed to a binary
    // extension has no NUL byte and is still scanned; a NUL byte in a text file hides nothing.
    if (BINARY_EXTENSIONS.has(ext) && bytes.includes(0)) {
      skipped.push(file);
      continue;
    }
    bytes
      .toString("utf8")
      .replaceAll("\0", " ")
      .split(/\r?\n/)
      .forEach((line, i) => scanLine(line, file, `${file}:${i + 1}`, findings));
  }
  const allows = readAllows(cwd, problems);
  return { findings: applyAllows(findings, allows, problems), problems, files: files.length, skipped };
}

/**
 * @param {string} cwd
 * @returns {{ findings: Finding[], problems: string[], commits: number }}
 */
function scanHistory(cwd) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {string[]} */
  const problems = [];
  const commits = git(cwd, ["rev-list", "HEAD"]).split("\n").filter(Boolean);
  for (const sha of commits) {
    const short = sha.slice(0, 7);
    // The full message, trailers included: a tooling-added trailer never appears in the diff.
    git(cwd, ["log", "-1", "--format=%B", sha])
      .split(/\r?\n/)
      .forEach((line, i) => scanLine(line, "(message)", `${short}:(message):${i + 1}`, findings));
    let file = "";
    let lineNo = 0;
    const diff = git(cwd, ["show", "--format=", "--unified=0", "--no-color", "--no-ext-diff", sha]);
    for (const line of diff.split("\n")) {
      if (line.startsWith("+++ ")) {
        file = line.slice(4).replace(/^b\//, "");
      } else if (line.startsWith("@@")) {
        lineNo = Number(/\+(\d+)/.exec(line)?.[1] ?? 0);
      } else if (line.startsWith("+")) {
        scanLine(line.slice(1), file, `${short}:${file}:${lineNo}`, findings);
        lineNo++;
      }
    }
  }
  const allows = readAllows(cwd, problems);
  return { findings: applyAllows(findings, allows, problems), problems, commits: commits.length };
}

// ---------------------------------------------------------------------------------------------
// Self-test: every rule fires on a planted example, clean input passes, history behind a revert
// and a message-only trailer are both caught, masking holds, and a stale allow fails.
// ---------------------------------------------------------------------------------------------

/** @param {number} n */
const alnum = (n) =>
  Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[randomInt(62)]).join("");
/** @param {number} n */
const lower = (n) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz"[randomInt(26)]).join("");
const octet = () => String(randomInt(1, 255));
const orgDomain = () => ["clearforge", "dev"].join(".");

/** One synthetic example per rule, assembled at run time. @type {Record<string, () => string>} */
const PLANTED = {
  "owned-host": () => `${lower(8)}.${orgDomain()}`,
  "tunnel-host": () => `${lower(12)}.${["cfargotunnel", "com"].join(".")}`,
  "auth-tenant": () => `${lower(10)}.${["authkit", "app"].join(".")}`,
  "tailnet-host": () => `${lower(6)}.tail${randomBytes(3).toString("hex")}.${["ts", "net"].join(".")}`,
  "home-path": () => `/${"home"}/${lower(7)}/project`,
  "android-terminal-path": () => `/data/data/${["com", "termux"].join(".")}/files/home`,
  "windows-user-path": () => `C:\\${"Users"}\\${lower(7)}\\project`,
  "tilde-user": () => `~${lower(7)}/project`,
  "private-ip": () => ["10", octet(), octet(), octet()].join("."),
  ipv4: () => ["203", "0", "113", octet()].join("."),
  "mac-address": () => Array.from({ length: 6 }, () => randomBytes(1).toString("hex")).join(":"),
  uuid: () => randomUUID(),
  "long-hex": () => randomBytes(24).toString("hex"),
  "github-token": () => `${"gh"}${"p_"}${alnum(36)}`,
  jwt: () =>
    [
      Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
      Buffer.from(JSON.stringify({ sub: lower(12) })).toString("base64url"),
      "",
    ].join("."),
  "private-key": () => `${"-".repeat(5)}BEGIN ${"EC"} PRIVATE ${"KEY"}${"-".repeat(5)}`,
  "cloud-access-key": () => `${"AK"}${"IA"}${alnum(16).toUpperCase()}`,
  "secret-key": () => `${"sk"}_${"test"}_${alnum(24)}`,
  "slack-token": () => `${"xo"}xb-${String(randomInt(1e9, 9e9))}-${alnum(24)}`,
  "npm-token": () => `${"np"}m_${alnum(36)}`,
  "bearer-token": () => `Authorization: ${"Bear"}er ${alnum(32)}`,
  "url-token": () => `https://api.example.net/v1/items?${"access_"}${"token"}=${alnum(24)}`,
  email: () => `${lower(6)}@${lower(8)}.${"test"}`,
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
    `      - uses: actions/checkout@${randomBytes(20).toString("hex")} # v7.0.1`,
    `pinned at some-org/some-action@${randomBytes(20).toString("hex")}`,
    "Bind to 127.0.0.1 or 0.0.0.0; see localhost and ~/ for the current user.",
    "Node 24.21.0, npm 11.19.0, TypeScript 6.0.3; a short sha like 1e3c7b0.",
    "A Bearer token is sent in the Authorization header.",
    "The organization's own site is clearforge.dev; /home/ alone names nobody.",
    "~~struck through~~ and ~ approximately ~5 items.",
  ].join("\n");

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function gitIn(cwd, args) {
  return git(cwd, [
    "-c", "user.name=Self Test",
    "-c", "user.email=selftest@example.com",
    "-c", "commit.gpgsign=false",
    "-c", "core.hooksPath=/dev/null",
    ...args,
  ]);
}

/** @returns {number} exit code */
function selfTest() {
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const lines = [];
  const root = mkdtempSync(path.join(tmpdir(), "leak-gate-selftest-"));
  try {
    // 1. Every rule fires on its own planted example, by name.
    const planted = path.join(root, "planted");
    gitIn(root, ["init", "-q", planted]);
    /** @type {Record<string, string>} */
    const samples = {};
    for (const rule of RULES) {
      const make = PLANTED[rule.name];
      if (make === undefined) {
        failures.push(`rule "${rule.name}" has no planted example: a rule with no red-proof is not a rule`);
        continue;
      }
      samples[rule.name] = make();
      writeFileSync(path.join(planted, `${rule.name}.md`), `planted: ${samples[rule.name]}\n`);
    }
    for (const name of Object.keys(PLANTED)) {
      if (!RULES.some((r) => r.name === name)) failures.push(`planted example "${name}" names no rule`);
    }
    gitIn(planted, ["add", "-A"]);
    const tree = scanTree(planted);
    for (const rule of RULES) {
      const hit = tree.findings.find((f) => f.rule === rule.name && f.path === `${rule.name}.md`);
      if (hit === undefined) {
        failures.push(`rule "${rule.name}" did NOT fire on its planted example`);
      } else {
        lines.push(`self-test: fired  ${rule.name.padEnd(22)} ${hit.where}  ${hit.mask}`);
      }
    }
    const stray = tree.findings.filter((f) => f.path !== `${f.rule}.md`);
    for (const f of stray) failures.push(`cross-fire: ${f.rule} on ${f.where} (each file plants one rule)`);

    // 2. Masking: no finding line carries the planted value it found.
    for (const f of tree.findings) {
      const sample = samples[f.rule] ?? "";
      if (sample.length > 4 && formatFinding(f).includes(sample)) {
        failures.push(`mask leaked the full value for ${f.rule}`);
      }
    }
    const tokenHit = tree.findings.find((f) => f.rule === "github-token");
    if (tokenHit !== undefined) lines.push(`self-test: masked ${formatFinding(tokenHit)}`);

    // 3. Exemption boundaries: another address at the org domain is still a finding.
    /** @type {Finding[]} */
    const boundary = [];
    scanLine(`ops@${orgDomain()}`, "x", "x:1", boundary);
    if (!boundary.some((f) => f.rule === "email")) {
      failures.push("a non-role address at the org domain was exempted");
    } else {
      lines.push("self-test: fired  email on a non-role address at the org domain (role exemption is exact)");
    }
    /** @type {Finding[]} */
    const pinLike = [];
    scanLine(`not a pin: ${randomBytes(20).toString("hex")}`, "x", "x:1", pinLike);
    if (!pinLike.some((f) => f.rule === "long-hex")) failures.push("a bare 40-hex value was exempted");

    // 4. Clean synthetic tree: zero findings.
    const clean = path.join(root, "clean");
    gitIn(root, ["init", "-q", clean]);
    writeFileSync(path.join(clean, "README.md"), `${CLEAN()}\n`);
    gitIn(clean, ["add", "-A"]);
    const cleanTree = scanTree(clean);
    for (const f of cleanTree.findings) failures.push(`clean tree flagged: ${formatFinding(f)}`);
    if (cleanTree.findings.length === 0) lines.push("self-test: clean  synthetic tree of near-misses and exemptions: 0 findings");

    // 5. History: a shape committed then reverted is still found; a message-only trailer is found.
    const hist = path.join(root, "history");
    gitIn(root, ["init", "-q", hist]);
    writeFileSync(path.join(hist, "notes.md"), "clean\n");
    gitIn(hist, ["add", "-A"]);
    gitIn(hist, ["commit", "-q", "-m", "clean start"]);
    writeFileSync(path.join(hist, "notes.md"), `clean\nreached ${PLANTED["private-ip"]?.() ?? ""}\n`);
    gitIn(hist, ["commit", "-q", "-am", "add a note"]);
    const leaky = gitIn(hist, ["rev-parse", "--short=7", "HEAD"]).trim();
    gitIn(hist, ["revert", "--no-edit", "HEAD"]);
    gitIn(hist, ["commit", "-q", "--allow-empty", "-m", `tidy\n\nReported-by: A Person <${PLANTED.email?.() ?? ""}>`]);
    const trailerCommit = gitIn(hist, ["rev-parse", "--short=7", "HEAD"]).trim();
    const history = scanHistory(hist);
    if (scanTree(hist).findings.length !== 0) failures.push("history fixture's final tree is not clean");
    const behindRevert = history.findings.find((f) => f.rule === "private-ip" && f.where.startsWith(leaky));
    if (behindRevert === undefined) {
      failures.push("--history missed a shape that a later revert removed from the tree");
    } else {
      lines.push(`self-test: fired  private-ip behind a revert, tree clean: ${behindRevert.where}`);
    }
    const inTrailer = history.findings.find((f) => f.rule === "email" && f.where.startsWith(`${trailerCommit}:(message)`));
    if (inTrailer === undefined) {
      failures.push("--history missed a shape present only in a commit-message trailer");
    } else {
      lines.push(`self-test: fired  email in a commit-message trailer only: ${inTrailer.where}`);
    }

    // 6. Allowlist: a used allow suppresses; a stale allow fails; a malformed allow fails.
    writeFileSync(path.join(planted, ALLOW_FILE), "uuid.md uuid synthetic fixture\n");
    const allowed = scanTree(planted);
    if (allowed.findings.some((f) => f.rule === "uuid") || allowed.problems.length !== 0) {
      failures.push("a matching allow entry did not suppress its finding cleanly");
    }
    writeFileSync(path.join(planted, ALLOW_FILE), "nothing/** uuid matches no finding\n");
    if (!scanTree(planted).problems.some((p) => p.includes("stale allow"))) {
      failures.push("a stale allow entry did not fail");
    } else {
      lines.push("self-test: fired  stale allow entry fails the gate");
    }
    writeFileSync(path.join(planted, ALLOW_FILE), "uuid.md no-such-rule because\njust-a-glob\n");
    if (scanTree(planted).problems.length !== 2) failures.push("malformed allow entries did not both fail");
  } catch (err) {
    failures.push(`self-test crashed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  for (const l of lines) console.log(l);
  if (failures.length > 0) {
    for (const f of failures) console.error(`self-test: FAIL — ${f}`);
    return 1;
  }
  console.log(`self-test: PASS — ${RULES.length} rules each fired on a planted example; clean input passed`);
  return 0;
}

/** @param {Finding} f */
function formatFinding(f) {
  return `${f.rule} ${f.where} ${f.mask}`;
}

/**
 * @param {string} label
 * @param {Finding[]} findings
 * @param {string[]} problems
 * @param {string} summary
 */
function report(label, findings, problems, summary) {
  for (const f of findings) console.error(`leak-gate: ${formatFinding(f)}`);
  for (const p of problems) console.error(`leak-gate: ${p}`);
  if (findings.length + problems.length > 0) {
    console.error(`leak-gate ${label}: REFUSED — ${findings.length} finding(s), ${problems.length} allowlist problem(s); ${summary}`);
    return 1;
  }
  console.log(`leak-gate ${label}: clean — ${summary}`);
  return 0;
}

function main() {
  const mode = process.argv[2];
  const started = performance.now();
  const secs = () => `${((performance.now() - started) / 1000).toFixed(2)}s`;
  const cwd = process.cwd();
  if (mode === "--self-test" && process.argv.length === 3) return selfTest();
  if (mode === "--tree" && process.argv.length === 3) {
    const r = scanTree(cwd);
    const skipped = r.skipped.length > 0 ? `; skipped as binary: ${r.skipped.join(", ")}` : "";
    return report("--tree", r.findings, r.problems, `${r.files} file(s) in ${secs()}${skipped}`);
  }
  if (mode === "--history" && process.argv.length === 3) {
    const r = scanHistory(cwd);
    return report("--history", r.findings, r.problems, `${r.commits} commit(s) in ${secs()}`);
  }
  console.error("usage: node scripts/leak-gate.mjs --tree | --history | --self-test");
  return 2;
}

process.exitCode = main();
