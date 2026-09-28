# FEEDBACK: CSR-WO-1007c (the node entry, finished)

Branch `wo/CSR-WO-1007c`, cut from `main` at `f94b78c`, where the WO lives. Parked as one unmerged pull
request. Built on Node v24.21.0 and npm 11.19.0. None of the §7 flag-and-stop conditions arose; one
limit of §1.2 is stated below, because it is the question §7's first condition asks.

## Gates

- `npm run check` exits 0: 745 core and teaching tests (702 on `main`), spike 0102 69, spike 0101 8,
  `test:subset` 4.
- `control-deletion`: 145 rows, **all red by assertion**, on the final code (727 s); `--self-test`
  passes. Eight rows are new, and one is re-targeted.
- `node scripts/leak-gate.mjs --tree` and `--history` exit 0, run unpiped with the exit code checked
  directly, before every push.
- CI on both runners: the pull request's checks (recorded in the next commit, from the first run).
- Protected surfaces diff to empty against `f94b78c`; every changed file is on the working surface,
  plus this file and `CHANGELOG.md`. `packages/core/package.json` is unchanged.
- The minted token lived in a mode-0600 scratch file, was never written to git config or a remote
  URL, and was deleted after the pull request was opened.

## Read this first

- **Both reported defects in the installed command are reproduced before the fix, and both are
  gone.** On `f94b78c`, with the core and the teaching edition installed by npm into a prefix and a
  valid configuration, running `node_modules/.bin/clearseal-node` made the shell run the JavaScript
  (`1: bin/: not found`, `Syntax error: "(" unexpected`, exit 2), and `node node_modules/.bin/clearseal-node`
  exited 0 having started nothing. Running the real path listened. After the fix, both listen.
- **The review pass found a Medium, and it is fixed.** Two more flags run a module in the node's
  process before the entry: the test runner's `--test-reporter` and `--test-global-setup`. `-e` and
  `-p` can run code first and then import the entry. All are now refused by name, with tests.
- **A preload can be refused, not prevented.** A module named by `--import` (or any flag in §1.2) runs
  before the entry, so it has already run when the entry refuses. Every enumerated flag is visible to
  the entry, in `process.execArgv` or `NODE_OPTIONS`, so §7's first condition does not hold for any of
  them. But a preload that wants to hide can rewrite both before the entry reads them. So this refuses
  an operator's mistake, and it makes N2 true for every honest way of starting the process; it is not
  a defense against code the operator put in the process, which is §4's hostile-code-already-inside
  (the P2 hardening WO). The entry's header says so.
- **The teaching README did not already say to install with scripts disabled**, though §1.4 says it
  does. It says so now, with the new finding and the preload refusal beside it. Its first paragraph
  also still described the `bin/` that `-1007b` removed; that sentence is corrected.

## Choices the WO left to me, with reasons

**§1.1, the `#!` line: in the source, not added by the build.** `tsc` keeps a leading `#!` line in
its output, so one line in `src/node/cli.ts` puts it in `dist/node/cli.js` with no build step to
maintain, and the source is a command too. Node's type stripping accepts it. `packages/core/package.json`
is unchanged: npm marks a bin target executable when it links it (measured: `-rwxrwxr-x` in the
prefix), and on Windows npm's shim reads the `#!` line to choose the interpreter, so the same line
is what makes the `.cmd` shim run node.

**§1.1, the main-module check: real paths on both sides.** `realpathSync(process.argv[1]) ===
realpathSync(fileURLToPath(import.meta.url))`. Node loads the main module by its real path (the same
`realpathSync`), so this holds through npm's link, a Windows junction, and `--preserve-symlinks-main`
alike. `import.meta.main` would also hold, but Node 24's documentation marks it early development, and
moving the command to a file with no check at all would have moved the entry every existing row and
test names.

**§1.1, the proof's install: offline and hermetic, from tarballs the test packs.** The test packs
the core, the teaching edition and every package of the core's dependency closure (from the
repository's own installed copies, located by the repository's lockfile), writes the prefix a lockfile
naming those tarballs, and runs `npm ci --offline` with a private, empty cache. It needs no network
and nothing from the runner's npm cache. It got there in two steps, and the first was mine to get
wrong:
- measured locally, `npm install <tarball> --offline` fails with `ENOTCACHED` on a cache that only
  `npm ci` filled, because npm needs registry metadata that `npm ci` never fetches. So the first
  version wrote a lockfile of the repository's registry entries and relied on the cached tarballs.
- **the pull request's first Windows run failed that way**: `ENOTCACHED` for `validator-13.15.35.tgz`,
  a tarball the Windows runner's npm cache did not hold. Linux passed. Packing every package from the
  repository removes the dependency on the cache entirely, and the private cache proves it.

**§1.1, `node <symlink>` on Windows.** npm writes shims, not links, on Windows, so the test makes the
link: a file link where the runner allows one, and otherwise a junction to the entry's directory,
which needs no privilege. Either way the path typed is not the real one, which is the defect.

**§1.2, the check is step 0 of `runNode`**, and `runNode` takes the flags as a parameter defaulting to
`process.execArgv`, beside the environment it already took. The refusal is a `SettingsError`, like
every other refusal before the edition loads.

**§1.2, how NODE_OPTIONS is read.** As Node splits it: on a space outside double quotes, with `\`
escaping inside them (this splits on any whitespace, which only ever finds more tokens). A long
option's name is read with `_` as `-`, as Node does (measured: `--experimental_loader` loads its
module). Any token that reads as a module-loading flag counts, even in a value's position: a false
refusal costs a restart, and a missed one costs N2.

**§1.3, extensionless files parse as JavaScript.** Node loads a file with no extension as JavaScript,
so TypeScript now parses it as JavaScript too; before, it parsed it as TypeScript. The diagnostics come
from the public `Program.getSyntacticDiagnostics` over a one-file program with nothing resolved,
which also reports TypeScript-only syntax in a `.js` file (Node would refuse that file too).

**§1.4, the finding is static and names `binding.gyp` too.** It reads `package.json`'s `scripts` for
every name in the list below, and a `binding.gyp` at the package root, which npm turns into an
install script (`node-gyp rebuild`) when none is declared.

## §1.2 The flag enumeration, with citations

Against Node 24.21.0's own documentation: `node --help`, the manual page shipped with it
(`share/man/man1/node.1`), and nodejs.org/docs/latest-v24.x/api/cli.html.

Refused, by the name Node matches (`_` read as `-` in a long option), from `NODE_OPTIONS` or the
command line:

| Flag | What runs before the entry | How I know |
|---|---|---|
| `--import` | an ES module, preloaded | `--help`: "ES module to preload"; measured |
| `--require`, `-r` | a CommonJS module, preloaded | `--help`: "CommonJS module to preload"; measured |
| `--loader`, `--experimental-loader` | a customization-hooks module | `--help`: "use the specified module as a custom loader"; measured |
| `--experimental-config-file`, `--experimental-default-config-file` | a `node.config.json` whose `nodeOptions` carry `import`/`require` | node.1 shows `"import"` in `nodeOptions`; measured: its import runs and is **not** in `execArgv` (so the flag itself is refused). Node refuses both in `NODE_OPTIONS` |
| `--snapshot-blob` | a startup snapshot's state, and its deserialize-main function in place of the entry | `--help`: "the blob that is used to restore the application state"; the deserialize-main claim is from the documentation, not measured |
| `--experimental-package-map` | whatever file the map names for any bare specifier, including the entry's own static imports | `--help`: "package map resolution"; Node's resolver uses the map exclusively for bare specifiers when it is set (read from the binary's embedded source, not measured end to end) |
| `-e`/`--eval`, `-p`/`--print`, `-pe` | a script that runs first and can then import the entry, which is then the main module | **added from the review pass (R2)**; measured for `-e` |
| `--test`, `--test-reporter`, `--test-global-setup` | with `--test-isolation=none`, the reporter, the global setup and other test files, in the node's own process | **added from the review pass (R1)**; measured: a reporter module runs, then the entry starts a node |

Not refused, and why:

- `--env-file`, `--env-file-if-exists`: a `NODE_OPTIONS` in the file is applied (measured), but it
  also lands in `process.env.NODE_OPTIONS`, so it is refused by what it carries. A test proves it.
- `--inspect-brk`, `--inspect-wait`, `--inspect`: a debugger the operator attaches can run code before
  line 1, but it can run code at any time, not only before the snapshot, and it runs no module. That
  is the operator's own access, not an ordering hole. **For you:** refusing the two that stop before
  user code would be one line each.
- `-C`/`--conditions`: it chooses which file of a dependency's own shipped exports loads, a milder
  form of the package map. An edition's own conditional exports are already a checker finding.
- `--openssl-config` (and `OPENSSL_CONF`): can load OpenSSL providers, which are native code. This
  is inferred, not tested, and it is an environment of the process rather than a Node module.
- Everything else, including memory limits, `--enable-source-maps`, `--no-warnings`, `--title` and
  `--watch` (which runs the entry in a child, with no preload).

## §1.4 The lifecycle list, with its citation

From npm 11.19.0's own documentation, `docs/content/using-npm/scripts.md`, *Life Cycle Operation
Order*:

| Script | When npm runs it |
|---|---|
| `preinstall`, `install`, `postinstall` | `npm install`, `npm ci`, `npm install -g`, `npm rebuild` |
| `prepublish`, `preprepare`, `prepare`, `postprepare` | `npm install`, `npm ci`, `npm install -g`; `prepare` also on `npm rebuild` of a linked package and when a git dependency is packed |
| `dependencies` | after any command that changes `node_modules` |
| `binding.gyp` (a file, not a script) | npm runs `node-gyp rebuild` as `install` when neither `install` nor `preinstall` is declared |

The WO names five; the other three and `binding.gyp` run on install by the same document, so they
are in the list. `prepack` and `postpack` are left out: npm runs them when it packs, and it packs a
git dependency before installing it, but the document does not list them under install.

## §3.2 The installed command, both runners

The core and the teaching edition, packed and installed with `npm ci --offline` into a temporary
prefix, started with a valid operator configuration; each must listen and refuse an unauthenticated
`tools/list` with 401.

Linux (this machine, and the CI `test (ubuntu-latest)` job):

```
INSTALLED linux by its npm bin path (node_modules/.bin/clearseal-node, a symbolic link): clearseal-node listening on http://127.0.0.1:<port>/mcp; an unauthenticated tools/list → 401
INSTALLED linux as node node_modules/.bin/clearseal-node: clearseal-node listening on http://127.0.0.1:<port>/mcp; an unauthenticated tools/list → 401
```

Windows (the CI `test (windows-latest)` job):

(recorded in the next commit, from the pull request's first CI run.)

## §3.3 Each documented case, with its message

### §1.2 Preloads

Each run is `clearseal-node` as a process (the source entry, as the repository runs it) with the
teaching edition and the committed manifest. A refusal also requires the preload's marker file.

```
PRELOAD NODE_OPTIONS=--import <file>:
  PRELOAD RAN
  clearseal-node: SettingsError: the process was started with --import (from NODE_OPTIONS): a module-loading flag runs code before the node reads its settings; start clearseal-node without it
  exit 1
PRELOAD NODE_OPTIONS=-r <file>:
  PRELOAD RAN
  clearseal-node: SettingsError: the process was started with -r (from NODE_OPTIONS): a module-loading flag runs code before the node reads its settings; start clearseal-node without it
  exit 1
PRELOAD node --import <file> clearseal-node:
  PRELOAD RAN
  clearseal-node: SettingsError: the process was started with --import (from the command line): a module-loading flag runs code before the node reads its settings; start clearseal-node without it
  exit 1
PRELOAD node --experimental-loader <file> clearseal-node:
  clearseal-node: SettingsError: the process was started with --experimental-loader (from the command line): a module-loading flag runs code before the node reads its settings; start clearseal-node without it
  PRELOAD RAN
  exit 1
PRELOAD node -e <run something, then import the entry> clearseal-node:
  PRELOAD RAN
  clearseal-node: SettingsError: the process was started with -e (from the command line): a module-loading flag runs code before the node reads its settings; start clearseal-node without it
  exit 1
PRELOAD NODE_OPTIONS=--max-old-space-size=256, node --enable-source-maps clearseal-node:
  clearseal-node listening on http://127.0.0.1:<port>/mcp
  an unauthenticated tools/list → 401
PRELOAD node --env-file=<a file setting NODE_OPTIONS=--import> clearseal-node:
  PRELOAD RAN
  clearseal-node: SettingsError: the process was started with --import (from NODE_OPTIONS): a module-loading flag runs code before the node reads its settings; start clearseal-node without it
  exit 1
PRELOAD node --experimental-config-file=<nodeOptions.import> clearseal-node:
  PRELOAD RAN
  clearseal-node: SettingsError: the process was started with --experimental-config-file (from the command line): a module-loading flag runs code before the node reads its settings; start clearseal-node without it
  exit 1
```

### §1.3 Parse errors

```
PARSE M-1: import source m from "./m.wasm"
dist/index.js: parse-error: line 1: 'import ... =' can only be used in TypeScript files.: a statement these rules cannot parse can hide an import from every one of them
dist/index.js: parse-error: line 1: '=' expected.: a statement these rules cannot parse can hide an import from every one of them
dist/index.js: parse-error: line 1: ';' expected.: a statement these rules cannot parse can hide an import from every one of them
PARSE M-1 in a file with no extension, parsed as the JavaScript Node loads it as
src/helper: parse-error: line 1: 'import ... =' can only be used in TypeScript files.: a statement these rules cannot parse can hide an import from every one of them
src/helper: parse-error: line 1: '=' expected.: a statement these rules cannot parse can hide an import from every one of them
src/helper: parse-error: line 1: ';' expected.: a statement these rules cannot parse can hide an import from every one of them
PARSE TypeScript syntax in a file with no extension, which Node loads as JavaScript and would refuse
src/helper: parse-error: line 1: Type annotations can only be used in TypeScript files.: a statement these rules cannot parse can hide an import from every one of them
PARSE an unterminated string
src/index.ts: parse-error: line 2: Unterminated string literal.: a statement these rules cannot parse can hide an import from every one of them
PARSE a file that parses cleanly: no finding
```

### §1.4 Install hooks

```
INSTALL scripts.preinstall: package.json: install-script: scripts.preinstall: npm runs it when the edition is installed, before any node exists; an edition ships no install-time code
INSTALL scripts.install: package.json: install-script: scripts.install: npm runs it when the edition is installed, before any node exists; an edition ships no install-time code
INSTALL scripts.postinstall: package.json: install-script: scripts.postinstall: npm runs it when the edition is installed, before any node exists; an edition ships no install-time code
INSTALL scripts.prepublish: package.json: install-script: scripts.prepublish: npm runs it when the edition is installed, before any node exists; an edition ships no install-time code
INSTALL scripts.preprepare: package.json: install-script: scripts.preprepare: npm runs it when the edition is installed, before any node exists; an edition ships no install-time code
INSTALL scripts.prepare: package.json: install-script: scripts.prepare: npm runs it when the edition is installed, before any node exists; an edition ships no install-time code
INSTALL scripts.postprepare: package.json: install-script: scripts.postprepare: npm runs it when the edition is installed, before any node exists; an edition ships no install-time code
INSTALL scripts.dependencies: package.json: install-script: scripts.dependencies: npm runs it when the edition is installed, before any node exists; an edition ships no install-time code
INSTALL binding.gyp: binding.gyp: install-script: npm runs node-gyp rebuild on install when a package ships binding.gyp and declares neither install nor preinstall; an edition ships no install-time code
INSTALL the teaching edition: no install-script or parse-error finding
```

## Control-deletion rows (§1.5)

Eight new rows and one re-targeted; 145 in all. Each stub deletes exactly its control, and each
named test goes red by its own assertion.

| Row | Control | What its stub does |
|---|---|---|
| `entry-shebang` | §1.1 the `#!` line | removes it |
| `entry-main-real-path` | §1.1 the real-path main check | adds the old comparison of the typed path |
| `entry-refuses-preloads` | §1.2 the refusal | makes the throw unreachable |
| `entry-preloads-from-node-options` | §1.2 `NODE_OPTIONS` is read, not only the command line | reads an empty `NODE_OPTIONS` |
| `boundary-parse-error` | §1.3 a syntactic diagnostic is a finding | reports none |
| `boundary-extensionless-as-js` | §1.3 an extensionless file parses as JavaScript | parses it as TypeScript (review R3) |
| `boundary-install-scripts` | §1.4 an install-time script is a finding | reports none |
| `boundary-binding-gyp` | §1.4 a `binding.gyp` is a finding | reports none |

`entry-captures-before-edition` (`-1007b`) was re-targeted: the same edit, with new context, because
`runNode`'s signature line changed. Five of the new stubs were regenerated after the review pass
corrected comments near them. Every stub was written by a generator that refuses a dirty tree and
never edits a source file.

## Review pass (WO §5)

A fresh subagent read the diff against §1 and §2, ran only the three test files that use private
temporary directories, and measured Node's behaviour outside the repository. It found every documented
case present and red-proven, every file inside the working surface, and the protected surfaces empty.
I reproduced R1 and R2 myself before acting.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| R1 | Medium | `--test-reporter` and `--test-global-setup` run a module in the node's process before the entry (under `--test --test-isolation=none`), and were not refused | **fixed**: refused, with `--test` itself |
| R2 | Low | `-e`/`-p` can run code and then import the entry, which starts | **fixed**: refused, with a process test |
| R3 | Low | parsing an extensionless file as JavaScript was not red-proven (M-1 fails to parse either way) | **fixed**: a type annotation in an extensionless file is the case that tells them apart; a row |
| R4 | Info | the tokenizer comment said Node splits on whitespace; it splits on a space | **fixed**: the comment says so, and why splitting on more is safe |
| R5 | Info | the shipped node.1 has no entry for `--import`, `--snapshot-blob`, `--env-file` | **fixed**: the citation names `--help` as the list |
| R6 | Info | "`import.meta.url` never equals the typed path" is false under `--preserve-symlinks-main` | **fixed**: the comment says so; the check holds there too (measured by the reviewer) |
| R7 | Info | `binding.gyp` becomes `install` only when neither `install` nor `preinstall` is declared | **fixed**: the wording; the finding fires regardless |
| R8 | Info | inspector flags, `-C`, `--openssl-config` are not refused | recorded above under *Not refused*, for you |
| R9 | Info | on Windows the `.cmd` shim passes the real path, so only the link case exercises the real-path check there; control-deletion runs on Linux only | recorded; the Windows link case is the faithful equivalent |
| R10 | Info | a loader's `PRELOAD RAN` line comes after the refusal, forwarded asynchronously; a theoretical flake | **fixed**: each preload writes a marker file synchronously, and the test asserts the marker |
| R11 | Info | the README's stale `bin/` sentence was rewritten, which the WO did not ask for | kept: it contradicted the paragraph after it |
| R12 | Info | CHANGELOG and FEEDBACK were uncommitted at review time | both committed |

## What was not built

- Anything in the P2 hardening WO: built-ins patched at load, C7, H7, `Function` via `.constructor`,
  SIGINT shutdown. A preload that hides itself is that class too (above).
- No change to what the gate, registry, transport, auth or audit decide.
- The control-deletion job is not split (its own WO).
- The inspector flags are not refused; see the enumeration.
