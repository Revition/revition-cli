---
"@revition/cli": minor
---

New `revition commands` (every command with its machine contract: scopes, changes, confirmation, paid, stability and
`--json` schema id). Every command's `--json` document now has a published JSON Schema (`schemas/cli/*.v1.json`,
generated from the command's own type), checked in CI for drift and for breaking changes without a version bump.
`llms.txt` and `docs/ai-agents.md` describe non-interactive use for AI agents and scripts.
