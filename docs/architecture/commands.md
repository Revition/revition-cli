# Commands: the module contract

Every command is a module that extends `RevitionCommand` (`packages/core/src/command/base-command.ts`) and
declares a `static meta: CommandMeta` (`packages/core/src/command/contract.ts`):

| Field | Meaning |
| --- | --- |
| `id` | `topic:verb`, colon-separated (`apps:keys:rotate`); typed with spaces (`revition apps keys rotate`) |
| `summary`, `examples` | Help text; at least one example per command |
| `requiredScopes` | `cli:read`, `cli:write`, `cli:submit`, `cli:agents`, `cli:assist`; the client checks early, the server re-checks |
| `mutates`, `confirm` | A mutating command confirms (`prompt` or `typed`), or needs `--yes` when prompts are off |
| `jsonSchemaId` | The `--json` data schema id, or `null` |
| `stability` | `stable`, `beta` (prints a notice) or `experimental` (needs `--experimental` or `REVITION_EXPERIMENTAL=1`, hidden from help otherwise) |
| `featureFlag` | Optional server-delivered gate; off by default |
| `paid` | Paid actions quote, then confirm |

A command implements `run2(ctx)` (returns its data) and optionally `human(data)` (its terminal rendering). It never
does its own auth, confirmation or rendering. The core runs, in order: load config and profile, resolve auth, check
scopes, the feature and stability gates, confirmation, `run2`, render, error mapping, exit code.

Adding a command needs no change in `packages/core` (proven by the fixture plugin in
`packages/cli/src/test-fixtures/fixture-plugin`).

Enforcement:

- `command-contract.test.ts` loads every command from the oclif manifest and checks that it extends
  `RevitionCommand` and has a complete `meta`. A lint rule refuses a command class that extends anything else.
- `prerun` refuses a command with an incomplete contract at runtime.

Plugins: only first-party `@revition/` plugins may be installed until signed plugins ship (ADR 0002). A plugin that
redefines a core command is refused.

Signals: Ctrl-C exits with code 11 at once; a second Ctrl-C skips cleanup. Work is crash-only.

Startup budget: `revition --version` and `--help` start in 300 ms or less.
