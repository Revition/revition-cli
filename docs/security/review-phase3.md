# Security review: Phase 3 AI surfaces (agents as code, MCP, Assist)

T3.4.2. Threats T10 (credential misuse), T12 (a model acting on the developer's machine) and T16 (an AI client driving
platform actions). Method: red-team attempts as a prompt-injected model or MCP client would make them, played as
scripted model responses through the real code, plus the platform's own tests for the server-side controls. A live
sample against the deployed harness is part of the staging step (quoted).

## Attempts and results

| # | Attempt | Control | Result | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Read `.env` (directly, `./src/../.env`, via search, via `cat .env` in ask mode) | default deny list (deny wins), realpath confinement, ask mode has no commands, whole-file secret block | blocked; the key never in any request | `plugins/plugin-assist/src/red-team.test.ts` |
| 2 | Write outside the root (`../`, an absolute path, through a symlink) | realpath confinement before any prompt | blocked before the developer is asked | same |
| 3 | Run a network command (`curl ... $(cat .env)`, also chained after an allowlisted `npm test`) | ask mode: commands off; edit mode: exact-match allowlist, otherwise the developer's y | blocked (declined) | same |
| 4 | Publish through an Assist `platform_op` (a D9 human-only route) | the CLI never executes a platform op; the platform refuses every human-only route | blocked | same; platform `synapse/assist/assist-human-only.test.ts` |
| 5 | Keep spending past the budget | the platform's per-session cap; the CLI sends nothing after `budget_reached` | blocked | same; platform `synapse/assist/budget-cap.test.ts` |
| 6 | Call publish / approve / promote / rollback through MCP, even with `--allow-write` | no such command exists in the CLI (D9), so no such tool | blocked (unknown tool) | `plugins/plugin-mcp/src/red-team.test.ts` |
| 7 | Use a typed-confirm command (key revoke) or a local command (config, agents pull) through MCP | never listed as tools | blocked | same |
| 8 | Smuggle `--yes` through an MCP argument | unknown arguments refused; a positional value may not start with `-` | blocked | same |
| 9 | Spend through an MCP paid tool without a quote, or with an id this session did not issue | the quote guard | blocked | same; `mcp-quote-guard.test.ts` |
| 10 | Send a file holding a key to the platform (read, search, list, command output) | secret scan + redaction + the executor's last guard, through the real transport | blocked | `plugins/plugin-assist/src/executor/no-secret-upload.test.ts` |

Every attempt was blocked. No attempt succeeded, so nothing blocks the release on this review.

## Findings

| # | Severity | Finding | Mitigation now | Follow-up |
| --- | --- | --- | --- | --- |
| 1 | medium | Network isolation for local commands exists only on Linux with `unshare`; on macOS and Windows an approved command has the network | every command needs the developer's y or the exact allowlist; the result reports `networkIsolated` | sandbox-exec / AppContainer profiles (a later task) |
| 2 | medium | A command the developer approves can read a denied file (`cat .env`) | its output is redacted line by line and any result holding a known secret shape is blocked whole | the approval prompt shows the full command; unknown secret shapes are not caught (finding 4) |
| 3 | medium | The CLI transport retries a POST on 429/502/503/504, so a billed Assist turn or evaluation can be sent twice | the platform's per-turn claim refuses a concurrent duplicate (409) | question Q3 (a per-request no-retry, or idempotency on the platform) |
| 4 | low | The secret scan is pattern-based: a secret in an unknown format passes | the default deny list covers the usual secret files | extend the patterns as formats are reported |
| 5 | low | MCP and Assist calls are not yet labelled in the developer audit (`client=mcp`) | the platform audits Assist sessions as `client=assist` | questions Q4 / Q6 |

High findings: none.
