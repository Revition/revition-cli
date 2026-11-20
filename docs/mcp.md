# Revition as an MCP server

`revition mcp serve` runs a Model Context Protocol server over stdio. An MCP client (Claude Code, Cursor, an IDE) can
then use Revition platform operations as tools, under **your own** Revition session or personal access token. The
platform checks every call exactly as it does for the CLI: your scopes, your role, and its governance.

- Protocol: MCP revision `2025-06-18`, stdio transport.
- Each tool is a CLI command. Its input is the command's arguments and flags; its result is the command's `--json`
  envelope (see [Driving the CLI from an AI agent](ai-agents.md)).

## What is exposed

| Mode | Tools |
| --- | --- |
| default (read-only) | commands that change nothing, for example `revition_apps_list`, `revition_logs`, `revition_docs`, `revition_agents_list`, `revition_build` |
| `--allow-write` | also the commands that change data on the platform, for example `revition_apps_create`, `revition_secrets_set` |
| never | commands with a typed confirmation (for example `apps keys revoke`); local commands (project files, CLI config, sign-in, a local dev server); streams (`--follow`) |

- Publishing, approving, going live, promoting and release changes do not exist in the CLI, so no tool can do them.
  They are human steps in the web portal.
- `--tools "<glob>,<glob>"` narrows the list further, for example `--tools "revition_apps_*,revition_logs"`.

## Paid tools

`revition_eval_run`, `revition_branches_eval` and `revition_agents_test` spend credits. Each needs a quote first:

1. Call `revition_quote` with `{ "tool": "revition_agents_test", "arguments": { "id": "dep_123" } }`. It is free and
   returns the quote and its `quoteId`.
2. Call the paid tool with the same arguments plus that `quoteId`.

A paid call without a quote id, with an id from another call, or after the quote changed, is refused and nothing runs.
Each quote is used once.

## Client configuration

Sign in first (`revition login`), or create a token for the server (`revition token create`).

Claude Code:

```sh
claude mcp add revition -- revition mcp serve
# a specific profile, read and write:
claude mcp add revition-work -- revition mcp serve --profile work --allow-write
```

Cursor (`.cursor/mcp.json`) and other clients that use the same format:

```json
{
  "mcpServers": {
    "revition": {
      "command": "revition",
      "args": ["mcp", "serve"]
    }
  }
}
```

With a personal access token instead of a session, set it in the server's environment; never put it in `args`:

```json
{
  "mcpServers": {
    "revition": {
      "command": "revition",
      "args": ["mcp", "serve"],
      "env": { "REVITION_TOKEN": "rvt_..." }
    }
  }
}
```

## Errors

- A tool that fails returns `isError: true` with the command's error envelope (`code`, `message`, `hint`).
- An expired session is refreshed by the CLI; a revoked one fails the tool with the re-sign-in hint, and the server
  keeps running.
- Status messages go to stderr; stdout carries only the protocol.
