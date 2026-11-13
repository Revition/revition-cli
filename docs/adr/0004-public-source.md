# ADR 0004: The CLI source is public

- Status: Accepted
- Date: 2026-10-05
- Decision: D6 (public source)

## Context

Users install the CLI on their own machines and give it their credentials, so they need to be able to verify what it
does. npm provenance, which links a published package to the exact source and build that produced it, requires a
public source repository. Public repositories also get unlimited GitHub Actions minutes.

## Decision

1. The CLI repository, `Revition/revition-cli`, is public and open source under the Apache License 2.0.
2. Unreleased features stay behind feature flags, not in private branches.
3. Releases publish to npm with provenance, through npm trusted publishing (OIDC), with no long-lived publish token.

## Consequences

- Anyone can audit the CLI and match a published version to its source and build.
- Because the CLI is a thin client ([ADR 0001](0001-standalone-product.md)), public source exposes no proprietary
  logic and no security decision.
- Security reports follow `SECURITY.md` (private vulnerability reporting), not public issues.
