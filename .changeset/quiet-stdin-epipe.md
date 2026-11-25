---
"@revition/cli": patch
---

Test harness only: the CLI test spawner no longer fails a test when a command exits before reading its stdin (an
EPIPE on the stdin write). No change to the shipped CLI.
