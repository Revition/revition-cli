---
"@revition/plugin-dev": patch
---

`revition dev` (local and sandbox loops) starts watching before the first run, so a save made while that run is still
going re-runs instead of being missed, and runs one change at a time in order.
