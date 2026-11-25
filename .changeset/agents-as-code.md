---
"@revition/plugin-agents": minor
"@revition/cli": minor
---

New `@revition/plugin-agents` (agents as code): the definition file (`agents/<name>.agent.yaml`, the platform's draft
body with the agent's identity, validated against the platform's generated JSON Schema), `revition agents validate`
(schema + no inline secrets; `--server` for the platform's dry run), `list`, `templates`, `pull`, `diff`, `push` (the
draft only, with the version it was pulled at: a concurrent save is refused), `create`, `test` (quote first),
`status`, `environments list`, `open` (publishing and promotion are human steps in the portal), `runs` and
`traces` (`--follow`).
