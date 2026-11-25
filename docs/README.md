# Revition CLI documentation

The Revition CLI (`@revition/cli`, command `revition`) is the terminal front door to the Revition platform. These
pages are published at developer.revition.com/cli.

## Install

Node.js 22 or later ([support policy](policy/support.md)).

```sh
npm install -g @revition/cli@next
revition --version
```

Channels: `next` (beta releases), `latest` (stable, from 1.0.0), `canary` (every change on `main`, for testing).

### Verify what you installed

Every release is published from this repository's release workflow with npm provenance. Check the registry
signatures and the provenance of what you installed:

```sh
npm audit signatures
```

On npmjs.com, the version page shows the provenance: the repository `Revition/revition-cli`, the commit and the
workflow run that built it. Install only `@revition/cli`; any other package name is not ours.

## Log in

```sh
revition login            # opens your browser (Authorization Code + PKCE)
revition login --device   # no browser on this machine: approve the code on another device
revition whoami           # who you are, the workspace the platform resolved, the host
revition auth status      # every profile, its session and when it needs a fresh sign-in
```

In CI, use a personal access token from the environment, never a flag: see [CI](ci.md). The browser login is the
default ([ADR 0003](adr/0003-auth-pkce-default.md)).

## Build an extension

[Quickstart: your first extension in 10 minutes](quickstart.md). The developer commands: `starters`, `init`,
`link`, `generate`, `build`, `dev`, `apps`, `secrets`, `eval`, `deploy`, `branches`, `submit`, `submissions`,
`versions`, `runs`, `logs`, `analytics`, `audit`, `wallet`, `docs`, `extension-points`, `changelog`, `open`
([command reference](reference/commands.md)). Questions: [FAQ](faq.md).

## Profiles and hosts

`--profile <name>` (or `REVITION_PROFILE`) selects a profile; each profile has its own host and credentials, and a
token is only ever sent to its own host. `revition profiles list | use | remove`.

## Configuration, output and exit codes

- [Configuration](config.md): files, precedence, `revition config get | set | unset | list | path | edit`.
- [Output](output.md): human output, `--json`, plain output off a terminal, colour, the pager and the exit codes.
- [Command reference](reference/commands.md): every command and flag, generated from the CLI itself.

## Telemetry

Off unless you opt in; `DO_NOT_TRACK=1` always wins. What is sent and how to inspect it: [Telemetry](telemetry.md).

## Troubleshooting

```sh
revition doctor           # CLI and Node versions, config, credential store, credential, host, TLS, proxy, clock
revition <command> --debug  # also writes a redacted debug log
```

Exit code 3 means sign in again (`revition login`); exit 10 means this version is too old (`revition upgrade`).

## Security

- [Credentials](security/credentials.md): where tokens are stored (the OS keychain), sessions, and revoking them.
- [Security policy](../SECURITY.md): how to report a vulnerability. [Advisories](security/advisories.md).
- Reviews: [Phase 1](security/review-phase1.md), [Phase 2](security/review-phase2.md).

## Changelog

[CHANGELOG.md](../CHANGELOG.md), and each package's own `CHANGELOG.md`.

## Uninstall

```sh
revition config path --json   # note the config, state and cache directories it lists
revition logout --all         # revokes every session on the platform and removes stored credentials
npm uninstall -g @revition/cli
```

Then delete the directories `revition config path --json` listed.

## Policies

- [Versioning](policy/versioning.md): what counts as a breaking change, including `--json`.
- [Support](policy/support.md): supported CLI and Node.js versions.
- [Deprecation](policy/deprecation.md): how and when things are removed.

## Architecture decisions

- [ADR 0001: The CLI is a standalone product with a thin client](adr/0001-standalone-product.md)
- [ADR 0002: TypeScript on Node.js with the oclif framework](adr/0002-oclif.md)
- [ADR 0003: Browser login with Authorization Code and PKCE by default](adr/0003-auth-pkce-default.md)
- [ADR 0004: The CLI source is public](adr/0004-public-source.md)
- [ADR 0005: The keychain binding](adr/0005-keychain-binding.md)
