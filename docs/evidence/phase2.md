# Phase 2 evidence: the developer journey on a real platform

T2.5.1. Each run records the real outputs (tokens, keys and secrets redacted by the CLI itself). A run is one OS, one
CLI build, one platform host. The automated part is
`node --import tsx --test --test-timeout=3600000 e2e/phase2.e2e.ts`; the reviewer's approval
and the publish are human steps in the Developer Portal.

Rules: a dedicated test developer and test app; every paid step (the sandbox, the evaluation) is quoted and approved
by the user before it runs, and its billed amount is read back; keys are revoked, the secret removed, the sandbox
deleted; the journey token is revoked last.

## The journey

| Step | How | Expected |
| --- | --- | --- |
| 1 | `revition account status` | the test developer, registered |
| 2 | `revition init <dir> --starter <id> --project new --yes` | the project and its link written |
| 3 | `revition generate eval-suite journey --yes` | `evals/journey.json` |
| 4 | `revition build` | the local and server checks; exit 0 (or 12 with the wallet hint when empty) |
| 5 | `revition test` | blocked: question Q1 (the offline SDK reference) |
| 6 | `revition dev --sandbox --once --yes` (paid: approved first) | one run; `disposed: true` |
| 7 | `revition apps keys create / rotate / revoke` on the test app | shown once; revoked |
| 8 | `revition secrets set / list / unset` (value on stdin) | names only; removed |
| 9 | `revition eval run --dry-run`, the user approves that quote, then `eval run --yes` | the portal's report; `billedCredits` = the Mint ledger entry; spend <= quote |
| 10 | `revition submit --version x.y.z --yes`, `submissions view` | the automatic checks, then `in_review` |
| 11 | a reviewer approves in the portal; `submissions view` | `certified - ready to publish` |
| 12 | `revition submissions open x.y.z`; a human publishes in the portal | the publish page; the listing visible |
| 13 | `revition versions list / channels`, `runs list`, `logs`, `analytics` | the portal's values |
| 14 | `revition audit --since 1d` | this run's CLI actions with `client=cli` (question Q4) |
| 15 | a direct call to the publish route with the CLI token | 403 `HUMAN_ACTION_REQUIRED` |
| 16 | `revition logout`; the leak suite over every output and the CLI directories | no token or secret anywhere |

## Spend against quotes

The journey prints `PHASE2_SPEND [...]`: each paid step's quote id and the credits billed for it. Copy it here with
the Mint ledger entry for the same run.

## Runs

Fill one block per run (macOS, Linux, Windows).

```text
date:
os / version:
node:
cli build (version + commit):
host:
test app:
approved quote ids:
steps 1-16: outputs pasted below, in order
PHASE2_SPEND:
Mint ledger entries:
```
