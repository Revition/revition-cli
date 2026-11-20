# Phase 1 security review

T1.6.2: every threat in the Phase 1 scope of the threat model (REVITION-CLI-PLAN §4.2) is checked against code and
evidence before the public beta. Status is VERIFIED (a test or evidence proves the mitigation), OPEN (proof still
needed; the reason is named) or DEFERRED (out of Phase 1, with the phase that owns it). Any open high or critical
finding blocks the beta release (T1.6.3).

## Threats

| T-id | Threat | Mitigation in Phase 1 | Test / evidence | Status |
| --- | --- | --- | --- | --- |
| T01 | Phishing of the login (relayed device code) | PKCE loopback is the default; `--device` is opt-in and prints a warning; the platform approval page shows client, org, scopes and location | `core/src/auth/auth.test.ts` (device warning snapshot), `cli/src/login-e2e.test.ts` (device warning; policy deny exit 4) | VERIFIED (client); OPEN: approval page reviewed on staging |
| T02 | Code interception on the loopback | PKCE S256; random `state` and `nonce`; 127.0.0.1 only; one-shot listener; exact redirect | `auth.test.ts` (S256 vs WebCrypto, bind), `login-e2e.test.ts` (wrong state, wrong Host, second request); mutants S1-S4 RED | VERIFIED |
| T03 | Local token theft | OS keychain, no plaintext and no silent fallback; rotation; server revoke | `auth.test.ts` (real macOS Keychain round trip, no-keychain refusal, encrypted file 0600, rotation order); mutants S6, S8 RED | VERIFIED on macOS; OPEN: Linux / Windows CI matrix; signed-binary keychain ACL DEFERRED to Phase 4 (T4.1.4) |
| T04 | Leakage via argv, history, logs, telemetry, `--json`, CI logs | no secret flags; redaction on every sink; telemetry keeps flag names only | `core` redaction tests, manifest scan (no secret flag), leak scans in `login-e2e.test.ts` and `e2e/phase1.e2e.ts`; mutants M3-M5, T3 RED | VERIFIED |
| T05 | Replayed refresh token or session | rotation + reuse detection; platform revoke; the Auth0 CLI token is refused except on the session routes | platform `developer-authorizer-lambda.test.ts` (session routes only), shared authorizer denies CLI bearers (batch S); mutant S7 RED | VERIFIED (code); OPEN: revoke-within-60 s on staging (T1.6.1 step 10) |
| T06 | Supply-chain compromise | trusted publishing (no token); provenance; release approval; no install scripts; dependency budget; audit; pinned actions | `scripts/release.test.mjs`, `scripts/supply-chain.test.mjs`, `check-pinned-actions`; mutants R5-R10 RED | VERIFIED (workflow and gates); OPEN: first real publish (T1.5.2) and the two dependency findings below |
| T07 | Typo-squatted package | the `@revition` scope; documented verification command | `docs/release/process.md`, `scripts/verify-release.mjs` | OPEN: npm org owning the name variants (T0.1.2) checked on npmjs.com |
| T08 | MITM / TLS downgrade | HTTPS only; `NODE_TLS_REJECT_UNAUTHORIZED=0` refused; extra CAs via `NODE_EXTRA_CA_CERTS` only | `core` transport tests; mutant M6 RED | VERIFIED |
| T09 | Malicious `--host` | host allowlist unless `--allow-custom-host`; tokens bound per host profile | `core` config + transport tests; mutants M2, M7, S12 RED | VERIFIED |
| T10 | Privilege escalation through the CLI | server-side scope + RBAC on every route; CLI / PAT credentials denied outside the Dev API | platform `cli-scopes` tests, batch S authorizer tests and local probes (Orbit / Mint denied) | VERIFIED (local platform); OPEN: staging probe |
| T11 | Destructive mistakes | `mutates` + confirmation; typed confirmation; idempotency keys | `core` pipeline tests; mutants M8, M10 RED | VERIFIED |
| T12 | Local harness / MCP abuse | - | - | DEFERRED to Phase 3 (T3.2.2, T3.3.2) |
| T13 | Malicious third-party plugin | first-party plugins only | `cli/src/plugin-guard.ts` tests; mutant M9 RED | VERIFIED for Phase 1; signed plugins DEFERRED to Phase 4 (T4.2.x) |
| T14 | Update hijack | registry only, over TLS; never auto-installs; `upgrade` runs the exact package manager command | `core/src/update/lifecycle.test.ts`; mutants U2, U4 RED | VERIFIED |
| T15 | Telemetry privacy leak | opt-in; strict schema; `DO_NOT_TRACK`; `show-last`; the platform keeps counters only | Set 4 tests (CLI + platform route); mutants T1-T7 RED | VERIFIED |
| T16 | Denial of wallet | - | - | DEFERRED to Phase 2 / 3 (T2.3.1, T3.3.1) |
| T17 | Stale vulnerable CLIs | platform minimum version (426); `npm deprecate`; advisories | platform `cli-version-gate.test.ts`; `lifecycle-e2e.test.ts` (exit 10); runbook test; mutant U5 RED | VERIFIED (code); OPEN: staging raise / lower drill (T1.5.4 AC3) |
| T18 | Repository compromise | CODEOWNERS; no `pull_request_target` checkout; least-privilege tokens; pinned actions; DCO; protected release environments | `check-pinned-actions`, `.github/CODEOWNERS`, `release.yml` environments | OPEN: branch protection and environment settings read back from GitHub |
| T19 | Cross-tenant exposure | the workspace comes from the server, never a client flag | `manifest-scans` (no workspace selector); platform flags route (org from the authorizer, mutant F4 RED) | VERIFIED |
| T20 | Loopback session fixation / CSRF | `state` check; one request on the exact path; Host check; closes at once | `login-e2e.test.ts`; mutant S1 RED | VERIFIED |

## Client checklist (ASVS-informed)

| Area | Check | Status |
| --- | --- | --- |
| Secure storage | secrets only in the OS keychain or an encrypted file the user chose; nothing in config | VERIFIED (T03) |
| Transport | TLS only, certificate validation never disabled, custom hosts opt-in | VERIFIED (T08, T09) |
| Authentication | PKCE S256, `state` + `nonce`, id_token signature checked, short-lived access | VERIFIED (T02, T20) |
| Session management | rotation, server-side revoke, logout revokes and deletes | VERIFIED (T03, T05) |
| Error handling and logging | no secrets in errors, logs or debug files | VERIFIED (T04) |
| Dependencies | install scripts none, licences, audit, SBOM | VERIFIED: findings 1 and 2 resolved (`check:licenses` and `pnpm audit --prod --audit-level high` pass; `scripts/supply-chain.test.mjs`) |

## Findings

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 1 | high | `picomatch` 4.0.7 (via `@oclif/core`) GHSA-fc5q-39xc-vjpf, no patched version; the audit gate failed | RESOLVED: GitHub withdrew the advisory on 2026-11-18; the audit gate passes (no high or critical) |
| 2 | low | `minimatch`, `@isaacs/nonrecursive-glob-match` are BlueOak-1.0.0, outside the licence allowlist | RESOLVED: plan ruling O98 (2026-11-14) adds BlueOak-1.0.0; `check:licenses` passes |

## Still to do before the close

- OpenSSF Scorecard on the public repository (target 7.0 or more), from the Scorecard workflow's published result.
- The manual attacks on each OS, recorded with their results: read the tokens from disk, logs, argv and the process
  list; reach the loopback listener from another interface; replay a refresh token.
