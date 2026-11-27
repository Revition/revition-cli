# @revition/plugin-agents

## 0.1.0

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
