# ADR 0006 - The standalone binary is a Node Single Executable Application

Status: accepted (T4.1.1, REVITION-CLI-PLAN.md:2962-2987).

## Decision

`revition` also ships as one native executable per target (darwin-arm64, darwin-x64, linux-x64, linux-arm64,
win32-x64), built with Node's Single Executable Application support (Node 22; `node --experimental-sea-config`, then
`postject` into an OFFICIAL nodejs.org Node binary - distro builds may lack the SEA fuse).

- **Same commit, same lockfile.** `scripts/build-sea.mjs` packs the production deploy of `@revition/cli`
  (`pnpm deploy --prod`: the CLI, its first-party plugins and their dependencies, including the keychain native addon)
  from the same build the npm package is published from.
- **The embedded application.** That deploy is the binary's one SEA asset, a gzipped tar. The SEA's `main` is a small
  CommonJS bootstrap (builtins only) that carries the asset's sha256, fixed at build time.
- **First run.** The bootstrap checks the asset against that sha256, unpacks it into a per-user 0700 cache directory named
  by the sha256 (`<cache>/revition/sea/<sha256>`; written atomically, a marker file last), and starts the CLI from there
  with the binary's own Node runtime. The keychain binding (the embedded native addon) loads from that directory;
  `doctor` says so. Later runs only check the marker: start-up is the npm CLI's minus the package-manager shim
  (measured: `scripts/sea-smoke.mjs`, AC2).
- **Checksums.** `SHA256SUMS` lists every binary; the release workflow publishes it with the binaries and attests both.
- **Signing.** The macOS binary gets an ad-hoc signature (Apple silicon runs only signed code). Developer ID signing,
  notarization (T4.1.2) and Windows signing (T4.1.3) follow the signing-cost decision (REMEDIATION-ROUND-PLAN.md:44).

## Rejected

- `bun build --compile`: a second runtime beside the npm package's Node; behaviour and native addons would differ.
- Bundling every command into the SEA main: oclif discovers commands and plugins from their packages; a single bundle
  would fork the command loading the npm package uses.
- Loading the native addon straight from the SEA blob: Node has no in-memory `dlopen`; the addon must be a file. It is
  written once, into the 0700 cache with the rest of the application, after the sha256 check.

## Consequences

- The first run unpacks the application (seconds); every later run starts from the cache.
- Deleting the cache directory is safe: the next run unpacks again.
- A different binary version uses a different directory (the sha256), so two versions never share files.
