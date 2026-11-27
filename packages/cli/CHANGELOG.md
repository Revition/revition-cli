# @revition/cli

## 0.2.0

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
