---
"@revition/cli": minor
---

New `revition mcp serve`: an MCP server over stdio (protocol 2025-06-18) for AI clients such as Claude Code and Cursor.
The platform operations become tools under your own session or token: read-only by default, `--allow-write` for
changes (never typed-confirm commands), paid tools only with a quote id from `revition_quote`. See `docs/mcp.md`.
