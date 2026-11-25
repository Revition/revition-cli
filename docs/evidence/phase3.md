# Phase 3 evidence: agents as code, MCP and Assist on a real platform

T3.4.1. Each run records the real outputs (tokens redacted by the CLI itself). A run is one CLI build and one platform
host. The automated part is `node --import tsx --test --test-timeout=3600000 e2e/phase3.e2e.ts`; publishing in the
portal, the Claude Code session and the interactive Assist session are human steps recorded below.

Rules: the dedicated E2E user, agent and starter project; every paid step is quoted and approved by the user before it
runs, and its billed amount is read back (AC2: spend <= quote); the agent draft edit is pushed back at the end; the
journey token is revoked last.

## Agents (automated, then one human step)

| Step | How | Expected |
| --- | --- | --- |
| 1 | `revition agents pull <agent>` | the definition file and its pull record |
| 2 | edit the instructions; `revition agents push <file> --yes` | the draft saved (a new version) |
| 3 | `revition agents test <agent>` -> the quote; the user approves it; `agents test --yes` | the report; billed = quoted |
| 4 | `revition agents status <agent>` | the draft vs live, the report, the environments |
| 5 | `revition agents open <agent> --action publish`; a person publishes in the portal | the publish page; the version live |
| 6 | a direct `POST /deployments/<agent>/draft/publish` with the CLI token | 403 (D9) |

## MCP (manual: a real client)

| Step | How | Expected |
| --- | --- | --- |
| 1 | `claude mcp add revition -- revition mcp serve` (a cli:read token in the server env, or a signed-in profile) | the server connects |
| 2 | in Claude Code: "list my Revition apps" | `revition_apps_list` called; the apps shown |
| 3 | in Claude Code: "show the logs of run `<id>` of `<app>`" | `revition_logs` called; the run's lines |
| 4 | the developer audit (`revition audit --since 1h`) | the calls, with `client=mcp` (question Q4 / Q6) |

The automated half (`e2e/phase3.e2e.ts`, "mcp") checks the same server over raw JSON-RPC: no destructive tool listed,
and list apps answered.

## Assist (manual: interactive)

| Step | How | Expected |
| --- | --- | --- |
| 1 | in a starter project with one failing test: `revition assist "make the failing test pass" --mode edit --budget 50` | the banner shows the 50-credit cap |
| 2 | approve the diffs it shows (`y`) and the test command | the change applied, the test passes |
| 3 | `/cost` | the session's spend, under 50 credits; the Mint ledger shows the same |
| 4 | `/undo`, then `/exit` | the last change reverted |
| 5 | a second session; Esc during a turn | that turn completes and its charge is shown; nothing further is billed |

## Spend against quotes

The journey prints `PHASE3 spend [...]`. Copy it here with the Mint ledger entries for the same run, and the Assist
session's final `/cost` line.

## Runs

| Date | CLI build | Host | Agents | MCP | Assist | Spend vs quote | Recorded by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |
