# Phase 4 security review

T4.4.1: the full T01-T20 re-verification after Phase 4 (binaries, install paths, plugins, enterprise controls,
device-key-bound renewal). Status is VERIFIED (a test or evidence proves the mitigation), OPEN (proof still needed; the
reason is named) or DEFERRED (with the phase that owns it). The Phase 1 table is
[review-phase1.md](review-phase1.md); this page restates every threat with what Phase 4 changed.

Signing (T4.1.2 macOS notarization, T4.1.3 Windows signing, T4.1.4 the keychain binding of the signed binary) is not
started: the plan starts it only after the user approves its costs (REVITION-CLI-PLAN.md:487), and the user kept those
three tasks blocked (question Q8). Every item below that needs a signed binary says so.

## Threats

| T-id | Threat | Phase 4 change | Test / evidence | Status |
| --- | --- | --- | --- | --- |
| T01 | Phishing of the login (relayed device code) | org policy can forbid the device flow (T4.3.1) | `cli/src/login-e2e.test.ts` (policy deny exit 4); the live device code shape (BASE20, 8) read from the tenant | VERIFIED (client + tenant); OPEN: approval page reviewed on staging |
| T02 | Code interception on the loopback | unchanged | `core/src/auth/auth.test.ts`, `cli/src/login-e2e.test.ts` | VERIFIED |
| T03 | Local token theft | the device key signs every renewal (T4.3.2); a non-exportable key in the OS store needs the signed binary | `core/src/auth/auth.test.ts` (keychain round trip, renewal signed by this machine's key) | VERIFIED on macOS for the stored credential; OPEN: the non-exportable key needs T4.1.4 (signed binary, blocked by the user's signing-cost decision, Q8) |
| T04 | Leakage via argv, history, logs, telemetry, `--json`, CI logs | unchanged | leak suites in `cli/src/login-e2e.test.ts` and `e2e/phase1.e2e.ts` | VERIFIED |
| T05 | Replayed refresh token or session | device-key-bound renewal: a copied credential cannot renew without the key; a replayed signature is refused (platform replay cache) | `core/src/auth/auth.test.ts` (renewal signed by the device key, another key refused); platform `cli-sessions/store.test.ts`, `device-signature.test.ts` | VERIFIED (code); OPEN: the copy-to-another-machine check on staging |
| T06 | Supply-chain compromise | SHA256SUMS signed with Sigstore; build-provenance attestation over SHA256SUMS and both install scripts; the install scripts verify before they copy | `scripts/install.test.mjs` (tamper refused, bad signature refused, no verifier refused), `scripts/brew-formula.test.mjs`, `scripts/release.test.mjs` | VERIFIED (scripts and workflow); OPEN: the first release run (Sigstore checksums + attestations, approved) |
| T07 | Typo-squatted package | a Homebrew tap and install scripts served only from github.com release assets | `scripts/install.test.mjs` (HTTPS only; github.com default base) | VERIFIED |
| T08 | MITM / TLS downgrade | install scripts refuse a non-HTTPS base | `scripts/install.test.mjs`; `core` transport tests | VERIFIED |
| T09 | Malicious `--host` | unchanged | `core` config + transport tests | VERIFIED |
| T10 | Privilege escalation through the CLI | org CLI policy (allowed methods, PAT lifetime, session cap) enforced by the platform | platform `cli-sessions/wave2-review-fixes.test.ts`, `verify.test.ts`; web `cli-policy-panel.test.tsx` | VERIFIED (local platform); OPEN: staging probe |
| T11 | Destructive mistakes | unchanged | `core` pipeline tests | VERIFIED |
| T12 | Local harness / MCP abuse | covered in Phase 3 | `plugins/plugin-assist/src/red-team.test.ts`, `plugins/plugin-mcp/src/red-team.test.ts` | VERIFIED (local); OPEN: live red-team (T3.4.2) |
| T13 | Malicious third-party plugin | third-party plugins must verify (Sigstore provenance for the exact package and digest), install into a sandbox and declare permissions | `core/src/plugins/plugin-verify.test.ts`, `plugin-sandbox.test.ts`, `plugin-lifecycle.test.ts`, `cli/src/plugins-commands.test.ts`; platform `publisher-registry.test.ts` | VERIFIED |
| T14 | Update hijack | standalone binaries update only through their verified install path | `core/src/update/lifecycle.test.ts` | VERIFIED |
| T15 | Telemetry privacy leak | unchanged | Set 4 tests | VERIFIED |
| T16 | Denial of wallet | covered in Phases 2-3 (quotes, caps) | the quote guard and budget tests | VERIFIED (local) |
| T17 | Stale vulnerable CLIs | the incident drill (deprecate, raise / lower the minimum) rehearsed at $0 | `e2e/rehearsal/incident-drill.rehearsal.test.ts`; platform `cli-version-gate.test.ts` | VERIFIED (code + rehearsal); OPEN: the live drill on a canary and staging |
| T18 | Repository compromise | releases verified by provenance; the tap is updated only by the release workflow | `scripts/release.test.mjs`, `.github/workflows/release.yml` | VERIFIED (workflow); OPEN: branch protection and environments read back from GitHub |
| T19 | Cross-tenant exposure | the audit export is Owner / Admin of the current workspace only | platform `cli-sessions/audit-export.test.ts` | VERIFIED |
| T20 | Loopback session fixation / CSRF | unchanged | `cli/src/login-e2e.test.ts` | VERIFIED |

## Findings

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 1 | medium | The device key is an exportable file-backed key until the signed binary can create it non-exportable in the OS store (T4.1.4). A stolen machine image still carries it. | OPEN: T4.1.4 is blocked by the user's signing-cost decision (Q8); renewal from another machine without the key is refused meanwhile (T05) |

## The end-to-end run (AC1)

The Phase 4 E2E (install via Homebrew / script / npm on every target, the tamper test, the keychain ACL evidence, plugin
verification, org policy, device-key renewal) runs on real machines and staging after the release. The keychain ACL
evidence needs T4.1.4 (blocked, Q8); the other legs are rehearsed locally by the suites cited above.
