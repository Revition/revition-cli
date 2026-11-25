# Phase 1 evidence: the auth and core journey on a real platform

T1.6.1. Each run records the real outputs (tokens and session ids redacted by the CLI itself). A run is one OS, one
CLI build, one platform host. The automated part is `pnpm e2e:phase1` (`e2e/phase1.e2e.ts`); the manual-assisted
steps need a human in a browser.

Rules: a dedicated test user and organisation; no paid calls; every token created is revoked at the end; Auth0 rate
limits are avoided by spacing runs.

## The journey

| Step | How | Expected |
| --- | --- | --- |
| 1 | `revition login` (browser, PKCE loopback) | exit 0; the portal lists the new CLI session |
| 2 | `revition whoami` | the test user, the workspace the platform resolved, the host |
| 3 | `revition auth status` | signed in, session fresh until a time |
| 4 | `revition doctor` | every check ok |
| 5 | `revition token create --name e2e --yes`, `token list`, `token revoke <id> --yes` | shown once; prefix only; revoked |
| 6 | `revition logout` | exit 0; the session is gone from the portal |
| 7 | `revition login --device` (approve in the browser) | the device warning shown; exit 0 |
| 8 | PAT-only CI run: `pnpm e2e:phase1` with `REVITION_E2E_TOKEN` (cli:read) | all automated checks green |
| 9 | 426 probe: the platform's `MIN_CLI_VERSION` raised above this build, `REVITION_E2E_EXPECT_426` set, then restored | exit 10, "no longer supported", `revition upgrade`; `--json` error code `CLI_UPGRADE_REQUIRED` |
| 10 | revoke from the portal while signed in | the next CLI call exits 3 within 60 s |
| 11 | leak suite over every captured output and the CLI directories | no token anywhere |

## Runs

Fill one block per run.

```text
date:
os / version:
node:
cli build (version + commit):
host:
steps 1-11: outputs pasted below, in order
```
