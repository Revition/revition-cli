# Changelog

Release notes for every package in this repository, newest first. Each package also keeps its own
`CHANGELOG.md`.

## 2026-11-27

### @revition/api-client 0.1.0

### Minor Changes

- 2d97f09: New `revition dev --sandbox` (save, run, see the result on every change; Ctrl-C deletes the sandbox; a file that
  looks like a secret is never uploaded) and `revition generate` (a capability, a test, an eval suite or the UI
  surface from the platform's own starters and schema). The client now carries the contract's JSON Schemas.
- 2d97f09: New ship path: `revition eval run` (the free quote first, then the confirmed run and the portal's uplift report with
  the billed credits; `--dry-run` stops at the quote; a timed-out run shows the run that landed) and `eval list`;
  `revition deploy` (the legacy branch proposal with the server's impact summary and the review link) and
  `revition branches` (list, view, status, and `eval`: the legacy pipeline quote and run); `revition submit` and
  `revition submissions` (list, view, open: the portal publish page; the CLI never publishes); `revition versions`
  (list, channels, rollouts, open: the portal release page; read only). The contract adds the evaluation quote route.

### Patch Changes

- a06d97b: Every published package now names its source repository and directory, so npm can verify the release provenance.
- 8587c57: The CLI is published on npm: `@revition/cli` and the six packages it loads at runtime are public
  (`publishConfig.access: public`), each ships its LICENSE and NOTICE, and `@revition/test-kit` stays private.

### @revition/cli 0.2.0

### Minor Changes

- 2d97f09: New `@revition/plugin-agents` (agents as code): the definition file (`agents/<name>.agent.yaml`, the platform's draft
  body with the agent's identity, validated against the platform's generated JSON Schema), `revition agents validate`
  (schema + no inline secrets; `--server` for the platform's dry run), `list`, `templates`, `pull`, `diff`, `push` (the
  draft only, with the version it was pulled at: a concurrent save is refused), `create`, `test` (quote first),
  `status`, `environments list`, `open` (publishing and promotion are human steps in the portal), `runs` and
  `traces` (`--follow`).
- 2d97f09: New `revition assist ["goal"] [--mode ask|edit] [--budget <credits>] [--resume <session>]`, also installed as
  `corvito`: Revition Assist in the terminal (beta). Each turn's text and tool requests are shown as they return; every
  local change is shown as a diff and needs your `y`; Esc or Ctrl-C stops the session (the turn in flight completes and
  its charge is shown); `/diff`, `/undo`, `/cost`, `/permissions`, `/exit` inside a session. Without a terminal it is
  read-only analysis (`--mode ask --no-input --json`).
- 2d97f09: The permission system for Revition Assist's local tools (no command yet; `revition assist` follows): project-root
  confinement after realpath, a deny list that always wins (`.env*`, keys, `.git/config`, ...), writes shown as a diff
  and applied only after `y` in `ask` mode (with a backup for undo), commands only with approval or the allowlist, and no
  secret-bearing content in anything sent to the platform. Configured in `.revition/assist.json`.
- 2d97f09: New `revition commands` (every command with its machine contract: scopes, changes, confirmation, paid, stability and
  `--json` schema id). Every command's `--json` document now has a published JSON Schema (`schemas/cli/*.v1.json`,
  generated from the command's own type), checked in CI for drift and for breaking changes without a version bump.
  `llms.txt` and `docs/ai-agents.md` describe non-interactive use for AI agents and scripts.
- 2d97f09: New `revition mcp serve`: an MCP server over stdio (protocol 2025-06-18) for AI clients such as Claude Code and Cursor.
  The platform operations become tools under your own session or token: read-only by default, `--allow-write` for
  changes (never typed-confirm commands), paid tools only with a quote id from `revition_quote`. See `docs/mcp.md`.
- 2d97f09: New developer workflow commands: `account register | link-workspace | status`, `starters list | view`, `init`,
  `link` and `scaffold`. Command metadata is now cached in `oclif.manifest.json` for fast startup.

### Patch Changes

- 2d97f09: New `revition dev --sandbox` (save, run, see the result on every change; Ctrl-C deletes the sandbox; a file that
  looks like a secret is never uploaded) and `revition generate` (a capability, a test, an eval suite or the UI
  surface from the platform's own starters and schema). The client now carries the contract's JSON Schemas.
- 2d97f09: The command reference is generated from the CLI itself and checked against `--help` on every build; the user guide
  covers install, provenance verification, login, profiles, troubleshooting and uninstall.
- 85a95ba: `revition doctor` now checks the credential you are actually signed in with (your stored login, or `REVITION_TOKEN`), so it no longer reports "Not logged in" after a browser or device login.
- a06d97b: Every published package now names its source repository and directory, so npm can verify the release provenance.
- 2a173bc: Every web link the CLI prints or opens now follows the profile: a profile can set `webOrigin` (for example `https://staging.revition.com`), and its portal and platform links use it; without it, links stay on the production hosts. The update notice no longer offers an older canary build, and `revition doctor` reports and checks the channel the build came from.
- 8587c57: The CLI is published on npm: `@revition/cli` and the six packages it loads at runtime are public
  (`publishConfig.access: public`), each ships its LICENSE and NOTICE, and `@revition/test-kit` stays private.
- 2d97f09: Commands can be marked deprecated: they keep working and print a warning naming the replacement (listed in
  `warnings` under `--json`). The HTTP client and schema libraries are updated to versions without known high-severity
  advisories.
- 65bee37: Test harness only: the CLI test spawner no longer fails a test when a command exits before reading its stdin (an
  EPIPE on the stdin write). No change to the shipped CLI.
- Updated dependencies [2d97f09]
- Updated dependencies [3ad8715]
- Updated dependencies [2d97f09]
- Updated dependencies [2d97f09]
- Updated dependencies [2d97f09]
- Updated dependencies [895abe9]
- Updated dependencies [a06d97b]
- Updated dependencies [2a173bc]
- Updated dependencies [8587c57]
- Updated dependencies [2d97f09]
- Updated dependencies [2d97f09]
- Updated dependencies [2d97f09]
- Updated dependencies [2d97f09]
- Updated dependencies [5217e6c]
- Updated dependencies [2d97f09]
  - @revition/plugin-agents@0.1.0
  - @revition/plugin-assist@0.0.1
  - @revition/plugin-dev@0.1.0
  - @revition/cli-core@0.1.0
  - @revition/plugin-mcp@0.0.1

### @revition/cli-core 0.1.0

### Minor Changes

- 2d97f09: New `revition dev --sandbox` (save, run, see the result on every change; Ctrl-C deletes the sandbox; a file that
  looks like a secret is never uploaded) and `revition generate` (a capability, a test, an eval suite or the UI
  surface from the platform's own starters and schema). The client now carries the contract's JSON Schemas.
- 2d97f09: New `revition build`: the platform's project layout rules run locally first (an oversized or broken project is
  refused before anything is sent), then the platform's own checks; exit 6 when anything fails, `--strict` fails on
  warnings, and `--json` lists every check with its schema id. Commands can now end with data and a non-zero exit.
- 2d97f09: Commands can be marked deprecated: they keep working and print a warning naming the replacement (listed in
  `warnings` under `--json`). The HTTP client and schema libraries are updated to versions without known high-severity
  advisories.
- 2d97f09: New developer workflow commands: `account register | link-workspace | status`, `starters list | view`, `init`,
  `link` and `scaffold`. Command metadata is now cached in `oclif.manifest.json` for fast startup.
- 2d97f09: New `revition apps` (list, view, create, scopes set with the permission diff before confirming, listing),
  `revition apps keys` (list, create and rotate print the key once, revoke needs the typed key id or --yes) and
  `revition secrets` (names only; values from stdin or a hidden prompt, never an argument; the first app secret shows
  its cost first). Commands can show a preview before the confirmation.

### Patch Changes

- a06d97b: Every published package now names its source repository and directory, so npm can verify the release provenance.
- 2a173bc: Every web link the CLI prints or opens now follows the profile: a profile can set `webOrigin` (for example `https://staging.revition.com`), and its portal and platform links use it; without it, links stay on the production hosts. The update notice no longer offers an older canary build, and `revition doctor` reports and checks the channel the build came from.
- 8587c57: The CLI is published on npm: `@revition/cli` and the six packages it loads at runtime are public
  (`publishConfig.access: public`), each ships its LICENSE and NOTICE, and `@revition/test-kit` stays private.
- 5217e6c: UX checklist fixes from the macOS walk (T2.5.2 AC3): a confirmation prompt (`init`, every command that asks before a
  change, and Assist's approvals) now stays on screen and waits for the answer; end of input answers No instead of
  exiting with an unsettled await; a usage error names what is missing (`Missing 1 required arg: kind (sdk|ui)`). No new
  output uses typographic quotes (the `build` success line keeps the legacy CLI's exact text, T2.1.2 AC3 parity).
  Assist (T3.4.1): `run_tests` in a Revition project runs `revition test` (it ran `npm test`, which has no package.json to
  run), and a failed command says its exit code and last line instead of "not done".
- 2d97f09: Output over 64 KB is no longer cut short: redaction of stdout, stderr, the pager and `--json` covers the whole text
  (a large `--json` document was truncated and stopped parsing). Only debug-log bodies are still truncated before they
  are redacted.

### @revition/plugin-agents 0.1.0

### Minor Changes

- 2d97f09: New `@revition/plugin-agents` (agents as code): the definition file (`agents/<name>.agent.yaml`, the platform's draft
  body with the agent's identity, validated against the platform's generated JSON Schema), `revition agents validate`
  (schema + no inline secrets; `--server` for the platform's dry run), `list`, `templates`, `pull`, `diff`, `push` (the
  draft only, with the version it was pulled at: a concurrent save is refused), `create`, `test` (quote first),
  `status`, `environments list`, `open` (publishing and promotion are human steps in the portal), `runs` and
  `traces` (`--follow`).

### Patch Changes

- a06d97b: Every published package now names its source repository and directory, so npm can verify the release provenance.
- 2a173bc: Every web link the CLI prints or opens now follows the profile: a profile can set `webOrigin` (for example `https://staging.revition.com`), and its portal and platform links use it; without it, links stay on the production hosts. The update notice no longer offers an older canary build, and `revition doctor` reports and checks the channel the build came from.
- 8587c57: The CLI is published on npm: `@revition/cli` and the six packages it loads at runtime are public
  (`publishConfig.access: public`), each ships its LICENSE and NOTICE, and `@revition/test-kit` stays private.
- Updated dependencies [2d97f09]
- Updated dependencies [2d97f09]
- Updated dependencies [a06d97b]
- Updated dependencies [2a173bc]
- Updated dependencies [8587c57]
- Updated dependencies [2d97f09]
- Updated dependencies [2d97f09]
- Updated dependencies [2d97f09]
- Updated dependencies [5217e6c]
- Updated dependencies [2d97f09]
  - @revition/cli-core@0.1.0

### @revition/plugin-assist 0.0.1

### Patch Changes

- 3ad8715: Assist (T3.4.1): `apply_patch` places a hunk whose line numbers are off at the one place its old lines match (as
  `patch` and `git apply` do), and a refusal shows the file's line beside the patch's. After a failed change, a read the
  session already made is answered with that failure instead of being run again, so the assistant retries the change
  instead of re-reading the same files.
- a06d97b: Every published package now names its source repository and directory, so npm can verify the release provenance.
- 8587c57: The CLI is published on npm: `@revition/cli` and the six packages it loads at runtime are public
  (`publishConfig.access: public`), each ships its LICENSE and NOTICE, and `@revition/test-kit` stays private.
- 5217e6c: UX checklist fixes from the macOS walk (T2.5.2 AC3): a confirmation prompt (`init`, every command that asks before a
  change, and Assist's approvals) now stays on screen and waits for the answer; end of input answers No instead of
  exiting with an unsettled await; a usage error names what is missing (`Missing 1 required arg: kind (sdk|ui)`). No new
  output uses typographic quotes (the `build` success line keeps the legacy CLI's exact text, T2.1.2 AC3 parity).
  Assist (T3.4.1): `run_tests` in a Revition project runs `revition test` (it ran `npm test`, which has no package.json to
  run), and a failed command says its exit code and last line instead of "not done".
- Updated dependencies [2d97f09]
- Updated dependencies [2d97f09]
- Updated dependencies [a06d97b]
- Updated dependencies [2a173bc]
- Updated dependencies [8587c57]
- Updated dependencies [2d97f09]
- Updated dependencies [2d97f09]
- Updated dependencies [2d97f09]
- Updated dependencies [5217e6c]
- Updated dependencies [2d97f09]
  - @revition/cli-core@0.1.0

### @revition/plugin-dev 0.1.0

### Minor Changes

- 2d97f09: New `revition dev --sandbox` (save, run, see the result on every change; Ctrl-C deletes the sandbox; a file that
  looks like a secret is never uploaded) and `revition generate` (a capability, a test, an eval suite or the UI
  surface from the platform's own starters and schema). The client now carries the contract's JSON Schemas.
- 2d97f09: New `revition build`: the platform's project layout rules run locally first (an oversized or broken project is
  refused before anything is sent), then the platform's own checks; exit 6 when anything fails, `--strict` fails on
  warnings, and `--json` lists every check with its schema id. Commands can now end with data and a non-zero exit.
- 2d97f09: New observe-and-account commands: `revition runs list` (filters --ok / --failed / --since) and `revition logs` (one
  run as the portal shows it, `--grep`, and `--follow` printing each new run once, NDJSON with --json);
  `revition analytics` (a metric nobody records prints why, never a zero) and `revition audit`; `revition wallet show`
  and `wallet open` (the balance from Mint; no payment data); `revition docs sdk|ui` (offline from the last copy),
  `revition extension-points`, `revition changelog` and `revition open`. `eval run` and `branches eval` are marked as
  quote-first paid commands.
- 2d97f09: New developer workflow commands: `account register | link-workspace | status`, `starters list | view`, `init`,
  `link` and `scaffold`. Command metadata is now cached in `oclif.manifest.json` for fast startup.
- 2d97f09: New `revition apps` (list, view, create, scopes set with the permission diff before confirming, listing),
  `revition apps keys` (list, create and rotate print the key once, revoke needs the typed key id or --yes) and
  `revition secrets` (names only; values from stdin or a hidden prompt, never an argument; the first app secret shows
  its cost first). Commands can show a preview before the confirmation.
- 2d97f09: New ship path: `revition eval run` (the free quote first, then the confirmed run and the portal's uplift report with
  the billed credits; `--dry-run` stops at the quote; a timed-out run shows the run that landed) and `eval list`;
  `revition deploy` (the legacy branch proposal with the server's impact summary and the review link) and
  `revition branches` (list, view, status, and `eval`: the legacy pipeline quote and run); `revition submit` and
  `revition submissions` (list, view, open: the portal publish page; the CLI never publishes); `revition versions`
  (list, channels, rollouts, open: the portal release page; read only). The contract adds the evaluation quote route.

### Patch Changes

- 895abe9: `revition dev` (local and sandbox loops) starts watching before the first run, so a save made while that run is still
  going re-runs instead of being missed, and runs one change at a time in order.
- a06d97b: Every published package now names its source repository and directory, so npm can verify the release provenance.
- 2a173bc: Every web link the CLI prints or opens now follows the profile: a profile can set `webOrigin` (for example `https://staging.revition.com`), and its portal and platform links use it; without it, links stay on the production hosts. The update notice no longer offers an older canary build, and `revition doctor` reports and checks the channel the build came from.
- 8587c57: The CLI is published on npm: `@revition/cli` and the six packages it loads at runtime are public
  (`publishConfig.access: public`), each ships its LICENSE and NOTICE, and `@revition/test-kit` stays private.
- Updated dependencies [2d97f09]
- Updated dependencies [2d97f09]
- Updated dependencies [a06d97b]
- Updated dependencies [2a173bc]
- Updated dependencies [8587c57]
- Updated dependencies [2d97f09]
- Updated dependencies [2d97f09]
- Updated dependencies [2d97f09]
- Updated dependencies [2d97f09]
- Updated dependencies [5217e6c]
- Updated dependencies [2d97f09]
  - @revition/api-client@0.1.0
  - @revition/cli-core@0.1.0

### @revition/plugin-mcp 0.0.1

### Patch Changes

- a06d97b: Every published package now names its source repository and directory, so npm can verify the release provenance.
- 8587c57: The CLI is published on npm: `@revition/cli` and the six packages it loads at runtime are public
  (`publishConfig.access: public`), each ships its LICENSE and NOTICE, and `@revition/test-kit` stays private.
- Updated dependencies [2d97f09]
- Updated dependencies [2d97f09]
- Updated dependencies [a06d97b]
- Updated dependencies [2a173bc]
- Updated dependencies [8587c57]
- Updated dependencies [2d97f09]
- Updated dependencies [2d97f09]
- Updated dependencies [2d97f09]
- Updated dependencies [5217e6c]
- Updated dependencies [2d97f09]
  - @revition/cli-core@0.1.0
