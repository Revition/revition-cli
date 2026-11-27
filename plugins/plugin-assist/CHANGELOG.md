# @revition/plugin-assist

## 0.0.1

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
