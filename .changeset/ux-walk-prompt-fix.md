---
"@revition/cli-core": patch
"@revition/plugin-dev": patch
---

UX checklist fixes from the macOS walk (T2.5.2 AC3): a confirmation prompt (`init` and every command that asks before a
change) now stays on screen and waits for the answer; end of input answers No instead of exiting with an unsettled
await; a usage error names what is missing (`Missing 1 required arg: kind (sdk|ui)`); `build` prints a plain
apostrophe, and no command prints typographic quotes.
