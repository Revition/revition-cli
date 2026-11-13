# ADR 0002: TypeScript on Node.js with the oclif framework

- Status: Accepted
- Date: 2026-10-05
- Decision: D2 (language and framework)

## Context

The CLI must grow command by command without rewrites to its core. It needs help output, shell autocomplete,
plugins, hooks and update channels. The platform team writes TypeScript.

## Decision

1. TypeScript in strict mode, on Node.js 22 LTS or later.
2. The oclif v4 framework, which also runs the Heroku, Salesforce and Shopify CLIs. It provides command modules,
   plugins, hooks, help, autocomplete and update channels.
3. A new command is a new module that declares its scopes, mutation level, output schema and stability. The core
   enforces those declarations, so a feature ships without touching the core.

## Consequences

- The supported Node.js versions follow the [support policy](../policy/support.md).
- Commands, flags and `--json` output follow the [versioning policy](../policy/versioning.md).
- Third-party plugins are a later phase. The plugin host exists from the start, so that phase adds no core rewrite.
