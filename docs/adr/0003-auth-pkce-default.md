# ADR 0003: Browser login with Authorization Code and PKCE by default

- Status: Accepted
- Date: 2026-10-05
- Decision: D3 (login)

## Context

A CLI is an OAuth public client: it cannot keep a client secret. The device authorization grant is open to phishing,
because a victim can be talked into entering an attacker's code. CI systems cannot complete an interactive login.

## Decision

1. The default login is OAuth 2.0 Authorization Code with PKCE over a loopback redirect (RFC 8252, RFC 7636).
2. The Device Authorization Grant (RFC 8628) is available only behind `--device`, with phishing mitigations.
3. CI uses scoped, expiring, revocable personal access tokens, never an interactive login.

## Consequences

- No client secret ships in the CLI.
- A token is never accepted on the command line, so it cannot leak through argv, shell history or process listings.
- Every token the CLI holds is scoped, expires, and can be revoked from the platform.
