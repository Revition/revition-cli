# Release process

Every release is built and published by one workflow, [`.github/workflows/release.yml`](../../.github/workflows/release.yml).
No npm token exists anywhere: npm [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) binds each
package to this repository, that workflow file and the `npm-release` environment, and npm adds the provenance
attestation automatically.

## Channels

| Channel (dist-tag) | Version | When | Approval |
| --- | --- | --- | --- |
| `canary` | `X.Y.Z-canary.<sha7>` | every push to `main` | none (environment `npm-release`, branch `main` only) |
| `next` | the version from the merged "Version Packages" PR | after that PR merges | `release-approval`: 2 maintainers + 10 min wait |
| `latest` | a non-prerelease version, by hand (`workflow_dispatch`, channel `latest`) | when promoted | `release-approval`: 2 maintainers + 10 min wait |

A canary is never tagged `latest`, and a prerelease is never tagged `latest` (`scripts/release.mjs channel`).

## Flow

1. Every PR that changes `packages/` adds a changeset (`pnpm changeset`); CI enforces it (`changeset-check.yml`).
2. On `main`, the workflow builds, tests, generates a CycloneDX SBOM, packs every public package and publishes the
   canary.
3. The same run opens or updates the "Version Packages" PR (`pnpm version-packages`: versions, each package's
   `CHANGELOG.md`, and the root `CHANGELOG.md`).
4. When that PR merges, the new version is a stable candidate. The `approve-stable` job waits in the
   `release-approval` environment until 2 maintainers approve; nothing is built or published before that.
5. `publish-stable` publishes to `next` (or `latest` when requested), verifies the result, creates a signed tag
   (sigstore, gitsign) and a GitHub Release with the notes, the SBOM and the tarballs.

## Repository settings this relies on

- Environment `npm-release`: deployment branch policy `main` only. It holds no secrets.
- Environment `release-approval`: required reviewers (2 maintainers), wait timer 10 minutes. It holds no secrets.
- On npmjs.com, each published package has ONE trusted publisher: repository `Revition/revition-cli`, workflow
  `release.yml`, environment `npm-release`. A package must exist on npm before a trusted publisher can be added, so a
  new public package (for example `@revition/cli-core` or a plugin) is first reserved by a maintainer and bound, then
  its `"private": true` is removed in a reviewed PR.

## Verify a release

```sh
npm view @revition/cli dist-tags
node scripts/verify-release.mjs @revition/cli latest
```

`verify-release.mjs` checks that the provenance attestation names this repository and `release.yml` (a publish from
a fork or any other workflow is rejected), that `latest` never points at a prerelease, and that `npm audit signatures`
passes for a fresh install. On npmjs.com the version page shows the provenance badge linking the commit and the run.

## Supply-chain level

npm provenance from GitHub-hosted runners is SLSA Build Level 2 provenance. The standalone binaries (Phase 4) target
Build Level 3 through the isolated reusable workflow (`slsa-github-generator`).

## When it goes wrong

An npm outage fails the job; a maintainer re-runs it. There is no token fallback. A partially failed multi-package
publish and a bad release follow the [incident runbook](incident-runbook.md).
