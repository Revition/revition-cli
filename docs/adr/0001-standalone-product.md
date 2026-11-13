# ADR 0001: The CLI is a standalone product with a thin client

- Status: Accepted
- Date: 2026-10-05
- Decisions: D1 (product isolation), D7 (architecture principle)

## Context

The Revition CLI is the terminal front door to the Revition platform. It serves developers who build extensions on
the Developer Portal and customer teams who manage their Foundry agents as code. An earlier CLI lived inside the
platform monorepo. That coupled its releases to platform deploys and let it read platform source.

## Decision

1. The CLI lives in its own public repository, `Revition/revition-cli`. It has its own CI, its own releases, its own
   access control and its own npm package, `@revition/cli`.
2. The only coupling to the platform is the versioned, authenticated public API contract. The CLI never imports
   platform source, and the platform never imports CLI code.
3. "Thin CLI, smart platform." Every authorization, governance, billing and intelligence decision runs server-side,
   behind authenticated APIs. The CLI requests, renders, and runs only local actions under a permission system.
4. The CLI holds no platform secret, embeds no client secret (it is an OAuth public client), and never calls a model
   provider directly. Model calls go through the platform and are billed by the platform.

## Consequences

- A CLI release never requires a platform deploy, and a platform deploy never requires a CLI release. API versioning
  carries compatibility, and the platform can refuse a CLI below a minimum version (see
  [deprecation](../policy/deprecation.md)).
- Nothing proprietary and nothing security-critical runs in, or is decided by, the CLI. A modified CLI cannot grant
  itself access the platform would refuse.
- The existing monorepo copy is migrated with its history and then retired.
