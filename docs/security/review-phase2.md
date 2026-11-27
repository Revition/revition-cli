# Phase 2 security and UX review

T2.5.2: the threats the Phase 2 commands touch (T04, T10, T11, T16 of the threat model, REVITION-CLI-PLAN §4.2) are
re-checked against the new commands, and the UX against clig.dev and the accessibility rules. Status is VERIFIED (a
test or evidence proves it), OPEN (proof still needed; the reason is named) or a finding. A high finding blocks
1.0.0. Mutant ids are per set: the evidence lives under
`FINAL-3H/CLI/<set>/mutants.json` (p2s1c = build / dev, p2s2 = apps / keys / secrets, p2s3 = ship path, p2s4 =
observe and account).

## Threats

| T-id | Threat | Phase 2 commands | Mitigation | Test / evidence | Status |
| --- | --- | --- | --- | --- | --- |
| T04 | Leakage via output, logs, files, `--json` | `apps keys create / rotate`, `secrets set`, `logs` (incl. `--follow --json`), `dev` (upload) | a key is shown once on stdout only; secret values come from stdin or a hidden prompt, never a flag; every sink redacted; NDJSON values redacted before serialization; the upload excludes key files and refuses a file holding a secret | `plugin-dev/src/keys-secrets.test.ts` (no key in stderr, the debug log or any CLI file; the secret value in no sink), `runs-logs.test.ts` (NDJSON redaction), `dev.test.ts` (upload exclusion + secret scan before the sandbox opens); mutants p2s2 K1, X1, X2; p2s4 L2; p2s1c S1, S2, S4 RED | VERIFIED |
| T10 | Privilege escalation through the CLI | `deploy`, `branches`, `submit`, `submissions`, `versions` | approve / merge, publish and release writes are human-only (no CLI command or module references them; the server refuses a CLI or PAT principal with 403 `HUMAN_ACTION_REQUIRED`); the server's scope table gates every route | `branches.test.ts`, `submit.test.ts` (grep over every CLI module and the contract); platform `human-only-routes.test.ts`; local server: publish and a release write with a PAT -> 403; mutants p2s3 B3, P1, V1, PM3 RED | VERIFIED (local platform); OPEN: the staging probe (T2.5.1 step 15) |
| T11 | Destructive mistakes | `apps keys revoke`, `secrets unset`, `deploy`, `submit`, `eval run`, `branches eval`, `dev --pull` | every change is confirmed (typed id for revoke) or needs `--yes` off a terminal; a local suite or a project reload shows the diff first | `keys-secrets.test.ts` (revoke typed), `eval.test.ts` (diff before saving), `dev.test.ts` (reload confirmed); mutants p2s2 K2, A2; p2s3 E1 RED | VERIFIED |
| T16 | Denial of wallet | `eval run`, `branches eval`, `dev --sandbox` | quote first, then confirm (`paid: { quote: 'required' }`); `--dry-run` never runs; a 402 is exit 12 with the wallet hint; billed amounts come from the server | `eval.test.ts`, `deploy-eval-parity.test.mjs`; mutants p2s3 E1-E5, E7, PM1, PM2 RED; the server refuses a run without its quote (platform `dev-eval.test.ts` [CLI-T2.3.1-AC1]); a retried run is answered once (finding 3, resolved) | VERIFIED |

## Findings

| # | Severity | Finding | Owner |
| --- | --- | --- | --- |
| 3 | high | The core transport retries every mutation on 429 / 502 / 503 / 504 because it carries an Idempotency-Key, but the Dev API did not honour Idempotency-Key: a 504 on the paid `POST /dev/apps/{appId}/evals` could run and bill more than once. | RESOLVED (plan T2.3.1 AC7): the platform claims the key per developer and app and answers a repeat with the first outcome (`dev-eval.ts` claimEvalRun; platform `dev-eval.test.ts` [CLI-T2.3.1-AC7]: Arena ran once, Mint billed once); the CLI re-sends the same key on every retry (`eval.test.ts` [CLI-T2.3.1-AC7] finding 3) |
| 4 | medium | Audit records carried no `client` field, so the CLI's actions could not be told apart in `revition audit` (T1.2.4 artifact). | RESOLVED: every developer audit record carries `client` = web / cli / pat, and mcp for calls from `revition mcp serve` (platform `dev-audit-client.test.ts` [CLI-T2.4.2-AC2], [CLI-T3.2.2-AC5]) |
| 5 | low | `login` and the reauth hint named `https://app.revition.com/settings/cli`, a page that does not exist. | RESOLVED: both name `https://developer.revition.com/cli-sessions` (core `SESSIONS_PAGE_URL`; `auth.test.ts` [CLI-T2.5.2-AC1]) |
| 6 | low | The plugin's tables always draw Unicode rules (`ascii: false`); a legacy Windows console may show them garbled. Off a terminal the output is plain. | RESOLVED: every table takes `terminalTable()` (core `output/table.ts`), whose `ascii` comes from the terminal's capability (`unicodeSupported`: a legacy Windows console and `TERM=linux` / `dumb` get `-` rules and `...`); `output.test.ts` [CLI-T2.5.2-AC3] |
| 1, 2 | high / low | The Phase 1 dependency findings (`picomatch` advisory, BlueOak licences) | RESOLVED (review-phase1.md): the advisory was withdrawn on 2026-11-18; BlueOak-1.0.0 is allowed by plan ruling O98 |

## The incident drill

The T1.5.4 drill (deprecate a bad release, raise the platform minimum, roll back) is executed live on staging and
recorded in `docs/release/incident-runbook.md`'s drill log. Rehearsed at $0 and recorded
(`e2e/rehearsal/incident-drill.rehearsal.test.ts`: the runbook's own npm commands against a local registry, the
CLI's deprecation warning, the restore; the platform minimum raised and lowered). OPEN: the live drill for Phase 2.

## UX checklist (clig.dev, accessibility)

| Check | How it is held | Status |
| --- | --- | --- |
| Help with examples on every command | `CommandMeta.examples` is required (core `metaProblems`); the generated reference shows them | VERIFIED |
| Errors with a hint | every refusal carries `code`, `message` and a `hint` where one helps (402 wallet, 403 edit access, 409 higher version, offline docs) | VERIFIED (tests per command) |
| `--json` everywhere | every command declares a `jsonSchemaId` and renders one envelope; `logs --follow` streams NDJSON | VERIFIED |
| Non-interactive safety | off a terminal a change needs `--yes`; CI implies `--no-input` | VERIFIED |
| Accessibility mode | `REVITION_ACCESSIBLE=1` / `TERM=dumb`: no spinner frames; `NO_COLOR` honoured | VERIFIED (core output tests) |
| Windows output | finding 6 resolved: the table charset follows the terminal (`terminalTable()`; no command hard-codes it); no command prints typographic quotes except `build`'s legacy-parity line (T2.1.2 AC3) | VERIFIED: `output.test.ts` [CLI-T2.5.2-AC3]; the human-mode UX run on windows-latest (`ux-human-mode.yml`, run 46022333088): 16/16, the apps table in plain columns with no non-ASCII bytes |
| A first-time user's walkthrough on each OS | L5: macOS by a person; Linux and Windows by the human-mode CI leg (UA10 "Windows / Linux by the matrix") | VERIFIED: Linux + Windows run 46022333088, 16/16 each; macOS walk 2026-11-27 (canary 0.1.0-canary.2a173bc). The walk's three findings are fixed in #26: a confirm prompt that was erased and never settled (`readlineTerminal`, `settledLine`), a usage error that did not name the missing argument (`usageMessageOf`), and Assist's `run_tests` default (`revition test` in a Revition project) |
| Interactive prompts | a confirm prompt stays on screen and waits; end of input answers No; Ctrl-C cancels | VERIFIED: `base-command.test.ts` [CLI-T2.5.2-AC3] + a PTY run of `init` without `--yes` |
