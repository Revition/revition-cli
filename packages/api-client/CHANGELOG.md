# @revition/api-client

## 0.1.0

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
