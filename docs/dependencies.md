# Runtime dependencies

Every direct runtime dependency of the shipped packages, reviewed. The budget is at most 15 (`scripts/check-size.mjs`
enforces it); a new one needs a review by `@revition/cli-security` (CODEOWNERS on `package.json`) and a row here.

| Package | Version | Used by | Purpose | Maintainer | npm provenance |
| --- | --- | --- | --- | --- | --- |
| `@oclif/core` | 4.11.14 | cli, core | the command framework: parsing, help, plugins, hooks | Salesforce (oclif team) | no |
| `undici` | 7.30.1 | cli, core | the HTTP client (TLS, proxies, timeouts) | Node.js project | yes |
| `zod` | 4.6.7 | core | schemas for config, telemetry events and flag caches | Colin McDonnell | yes |
| `@napi-rs/keyring` | 2.1.2 | core | the OS keychain binding; prebuilt per platform, no install script (ADR 0005) | napi-rs (Brooooooklyn) | yes |
| `yaml` | 2.8.1 | plugin-agents | reads and writes agent definition files (`*.agent.yaml`); no dependencies (ISC) | Eemeli Aro | no |
| `ajv` | 8.17.1 | plugin-agents | validates a definition against the platform's generated JSON Schema (draft 2020-12) (MIT) | Evgeny Poberezkin (ajv-validator) | no |

New in T3.1.1 (agents as code): pending the `@revition/cli-security` review on the pull request.

## Rules (CI-enforced, T1.5.3)

- No install lifecycle script in our packages or in any runtime dependency (`scripts/check-install-scripts.mjs`; the
  runtime allowlist is empty).
- Licences: MIT, Apache-2.0, BSD, ISC and BlueOak-1.0.0 only (`scripts/check-licenses.mjs`; BlueOak-1.0.0 by plan
  ruling O98, 2026-11-14).
- Each published package is at most 5 MB unpacked and ships only `dist`, `bin`, `oclif.manifest.json`, README and
  LICENSE (`scripts/check-size.mjs`).
- `pnpm audit --prod --audit-level high` and an OSV scan of the lockfile block a release.
- The lockfile is committed and installs use `--frozen-lockfile --ignore-scripts`; Dependabot groups updates.
- Each release carries a CycloneDX SBOM.

## Findings (resolved)

- `minimatch` 11.0.3 and `@isaacs/nonrecursive-glob-match` 1.1.0 (both through `@oclif/core`) are BlueOak-1.0.0.
  RESOLVED: the plan's ruling O98 adds BlueOak-1.0.0 to the allowlist; `check:licenses` passes.
- `picomatch` 4.0.7 (through `@oclif/core` > `tinyglobby`) had a high ReDoS advisory (GHSA-fc5q-39xc-vjpf).
  RESOLVED: GitHub withdrew the advisory on 2026-11-18; `pnpm audit --prod --audit-level high` passes (2 moderate
  advisories remain in `plugin-agents`: `ajv` 8.17.1 and `yaml` 2.8.1, both with patched versions; below the gate).
