# Revition CLI documentation

The Revition CLI (`@revition/cli`, command `revition`) is the terminal front door to the Revition platform.

> The CLI is not released yet. The sections below are filled in as the commands ship.

## Install

To be written with the first release.

## Log in

To be written with the login command. The default is a browser login (see
[ADR 0003](adr/0003-auth-pkce-default.md)).

## Your first project

To be written with the first project commands.

## Policies

- [Versioning](policy/versioning.md): what counts as a breaking change, including `--json`.
- [Support](policy/support.md): supported CLI and Node.js versions.
- [Deprecation](policy/deprecation.md): how and when things are removed.

## Architecture decisions

- [ADR 0001: The CLI is a standalone product with a thin client](adr/0001-standalone-product.md)
- [ADR 0002: TypeScript on Node.js with the oclif framework](adr/0002-oclif.md)
- [ADR 0003: Browser login with Authorization Code and PKCE by default](adr/0003-auth-pkce-default.md)
- [ADR 0004: The CLI source is public](adr/0004-public-source.md)
