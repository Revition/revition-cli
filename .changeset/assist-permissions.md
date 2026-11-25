---
"@revition/cli": minor
---

The permission system for Revition Assist's local tools (no command yet; `revition assist` follows): project-root
confinement after realpath, a deny list that always wins (`.env*`, keys, `.git/config`, ...), writes shown as a diff
and applied only after `y` in `ask` mode (with a backup for undo), commands only with approval or the allowlist, and no
secret-bearing content in anything sent to the platform. Configured in `.revition/assist.json`.
