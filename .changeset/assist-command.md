---
"@revition/cli": minor
---

New `revition assist ["goal"] [--mode ask|edit] [--budget <credits>] [--resume <session>]`, also installed as
`corvito`: Revition Assist in the terminal (beta). Each turn's text and tool requests are shown as they return; every
local change is shown as a diff and needs your `y`; Esc or Ctrl-C stops the session (the turn in flight completes and
its charge is shown); `/diff`, `/undo`, `/cost`, `/permissions`, `/exit` inside a session. Without a terminal it is
read-only analysis (`--mode ask --no-input --json`).
