# Versioning policy

The Revition CLI (`@revition/cli`, command `revition`) follows [Semantic Versioning 2.0.0](https://semver.org/). This
page defines exactly what counts as a breaking change. Every release note and every changeset is checked against it.

## The public surface

The public surface is everything a user or a script can depend on:

- command names and their aliases;
- flag names, their short forms, their value types and their defaults;
- positional arguments;
- exit codes;
- the `--json` output of every command;
- environment variables the CLI reads.

Human-readable output (tables, colours, wording, progress messages) is NOT part of the public surface. Scripts must
use `--json`.

## MAJOR: breaking changes

A release is MAJOR when it does any of the following:

1. Removes or renames a command or an alias.
2. Removes or renames a flag or its short form, or a positional argument.
3. Changes a flag's value type, or changes its default in a way that changes behaviour.
4. Makes an optional flag or argument required.
5. Changes the meaning of an exit code, or the exit code of an existing outcome.
6. In `--json` output: removes a field, renames a field, changes a field's type, or makes a field nullable that was
   never null.
7. Removes support for a Node.js version that the [support policy](support.md) still lists as supported.
8. Removes an environment variable the CLI reads, or changes its meaning.

## MINOR: additive changes

A release is MINOR when it only adds:

- a new command, alias, flag, argument or environment variable;
- a new optional field in `--json` output;
- a new value in an output field that is documented as open (for example, a new status);
- a deprecation warning (see the [deprecation policy](deprecation.md)).

## PATCH: fixes

A release is PATCH when it only fixes bugs, improves performance or changes human-readable output, with no change to
the public surface.

## `--json` schema versions

1. Every `--json` document carries `schemaVersion`, an integer.
2. Within one CLI major version, a command's `--json` schema changes only additively (rule 6 above). Additive changes
   do not raise `schemaVersion`.
3. A breaking change to a `--json` schema raises that schema's `schemaVersion` and needs a CLI MAJOR release.
4. Consumers must ignore fields they do not know.

## Pre-1.0 releases

Versions below 1.0.0 are previews. A breaking change there raises the MINOR number, and the release notes mark it
**Breaking**.
