# ADR 0005: the keychain binding

Status: accepted (T1.3.3).

## Context

The CLI keeps its session credential, the identity provider's refresh token and the device key in the operating
system's credential store: macOS Keychain, Windows Credential Manager, Linux Secret Service. Node.js has no built-in
binding, so the CLI depends on a native module. A native module is supply-chain risk: install scripts run code at
install time, and a module built on the user's machine needs a compiler.

## Decision

`@napi-rs/keyring` 2.1.2, pinned exactly.

| Check | Evidence |
| --- | --- |
| Licence | MIT |
| Install scripts | none (no `preinstall`, `install` or `postinstall`; checked by `auth.test.ts`) |
| Prebuilt binaries | darwin x64 / arm64, linux x64 / arm64 (gnu and musl), win32 x64 / arm64, as per-platform optional packages |
| Provenance | SLSA provenance attestation on the npm package (`npm view @napi-rs/keyring@2.1.2 dist.attestations`) |
| Published | 2026-10-19 |

## Consequences

- No compiler is needed and nothing runs at install time.
- The store is keyed by service `revition-cli` and account `<profile>@<host>`.
- Honest limitation: on macOS an npm-installed CLI runs as `node`, so a Keychain item cannot be bound to a Revition code
  signature; any process running as the user can request it. Mitigated by a short access lifetime, refresh-token
  rotation with reuse detection, and session revoke. The signed standalone binary (T4.1.4) closes this gap.
- Without a credential store the CLI refuses to store a sign-in (no silent fallback). See `docs/security/credentials.md`.
