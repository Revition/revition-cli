---
"@revition/cli-core": patch
"@revition/plugin-assist": patch
---

UX checklist fixes from the macOS walk (T2.5.2 AC3): a confirmation prompt (`init`, every command that asks before a
change, and Assist's approvals) now stays on screen and waits for the answer; end of input answers No instead of
exiting with an unsettled await; a usage error names what is missing (`Missing 1 required arg: kind (sdk|ui)`). No new
output uses typographic quotes (the `build` success line keeps the legacy CLI's exact text, T2.1.2 AC3 parity).
Assist (T3.4.1): `run_tests` in a Revition project runs `revition test` (it ran `npm test`, which has no package.json to
run), and a failed command says its exit code and last line instead of "not done".
