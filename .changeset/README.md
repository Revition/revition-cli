# Changesets

Every pull request that changes anything under `packages/` adds one file here (`pnpm changeset`), naming each changed
package, its bump type and a user-facing note. CI fails a pull request without one (`changeset-check.yml`); a
docs-only pull request is exempt with the `docs-only` label.

- `patch`: a fix with no visible behaviour change beyond the fix.
- `minor`: an additive change (a new command, flag or `--json` field).
- `major`: a breaking change as defined in [docs/policy/versioning.md](../docs/policy/versioning.md). A major
  changeset must contain the versioning-policy checklist and a `## Migration` section.

On `main`, the release workflow opens a "Version Packages" pull request that applies the pending changesets: package
versions, each package's `CHANGELOG.md`, and the root release notes.
