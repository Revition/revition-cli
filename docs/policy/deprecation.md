# Deprecation policy

## Timeline

Anything on the public surface (see the [versioning policy](versioning.md)) is removed in three steps:

1. **Deprecate.** A MINOR release marks it deprecated. The CLI prints a warning to stderr each time it is used, naming
   the replacement. With `--json`, the warning goes in the document's `warnings` array; stdout stays parseable.
2. **Warn.** The warning stays for at least **1 MINOR release** and at least **90 days**, whichever is longer.
3. **Remove.** It is removed only in the next MAJOR release after both conditions are met. The release notes list it
   under **Breaking** with a migration note.

## Minimum CLI version on the platform

The platform can require a minimum CLI version. A CLI below it gets a clear error naming the minimum version and the
upgrade command.

- The minimum is raised only with at least **30 days** notice, announced in the release notes and printed as a
  warning by every affected CLI version.
- **Security exception:** to fix a security vulnerability, the minimum can be raised with less notice, including
  immediately. The security advisory explains why and how to upgrade.

## Announcements

Every deprecation and every minimum-version change is listed in the release notes (`CHANGELOG.md`) of the release that
introduces it.
