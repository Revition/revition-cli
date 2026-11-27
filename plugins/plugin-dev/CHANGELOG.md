# @revition/plugin-dev

## 0.1.0

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
