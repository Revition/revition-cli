# @revition/cli-core

## 0.1.0

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
