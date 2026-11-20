# Driving the CLI from an AI agent or a script

The `revition` CLI is built to be driven by programs: AI coding agents (Claude Code, Cursor) and CI scripts. This page
is the contract they rely on. A short form for language models is in [`llms.txt`](../llms.txt).

## 1. Discover the commands

```sh
revition commands --json
```

Every command, with its machine contract: the CLI scopes it needs (`requiredScopes`), whether it changes anything
(`mutates`), its confirmation (`confirm`: `none`, `prompt` or `typed`), whether it is paid (`paid`), its stability and
the id of its `--json` schema (`jsonSchemaId`).

## 2. Read machine output

Add `--json` to any command. Stdout then holds exactly one JSON document (the envelope), and nothing else:

```json
{ "schemaVersion": 1, "command": "apps:list", "ok": true, "data": { "apps": [] }, "error": null, "warnings": [], "meta": { "cliVersion": "1.0.0", "traceId": null } }
```

- `data` is the command's result (null on an error); `error` is `{ code, message, hint, httpStatus, traceId, docsUrl }`.
- Each command's document has a published JSON Schema, generated from the command's own type:
  `schemas/cli/<command id with dots>.v1.json` in this repository (for example `schemas/cli/apps.list.v1.json`), and
  as assets of each GitHub release.
- Within a major version a schema only grows (new fields); consumers must ignore fields they do not know
  ([versioning policy](policy/versioning.md)).
- Streams (`logs --follow`, `agents traces --follow`) print NDJSON: one JSON object per line.

## 3. Never hang on a prompt

- Pass `--no-input` (or set `CI=true`, or run without a terminal on stdin): a command that would ask a question fails
  instead, with exit 2 and a hint.
- A command that changes something needs `--yes` when it cannot prompt. That includes a typed confirmation (for
  example `apps keys revoke`): `--yes` confirms it non-interactively, so pass it only for the exact resource you mean.
- Paid commands (`eval run`, `branches eval`, `agents test`) show a quote first; run them with `--dry-run` (where
  offered) to read the quote without spending, and add `--yes` only when the spend is approved.

## 4. Authenticate without a browser

Use a personal access token from the environment, never a flag:

```sh
export REVITION_TOKEN=rvt_...   # created in the portal or with `revition token create`
revition whoami --json
```

## 5. Exit codes

| Code | Meaning |
| --- | --- |
| 0 | success |
| 1 | general failure (for example a test run where not every case passed) |
| 2 | usage: a bad flag, a missing argument, or a needed confirmation under `--no-input` |
| 3 | sign in again (`revition login`) |
| 4 | not permitted (scope, role, or another account's resource) |
| 5 | not found |
| 6 | conflict (409 / 412), or a check that failed |
| 7 | rate limited (429): wait and retry |
| 8 | server error (5xx) |
| 9 | network or TLS failure |
| 10 | this CLI is too old: `revition upgrade` |
| 11 | cancelled (Ctrl-C or a declined prompt) |
| 12 | payment needed: the developer wallet has too few credits |

## 6. Safety notes

- Approvals, publishing, go-live, promotion and release changes are human steps in the web portal; the CLI has no
  command for them and the platform refuses a CLI or token credential on them (`HUMAN_ACTION_REQUIRED`). Use the
  `open` commands to hand a person the right page.
- Secrets are never arguments: `secrets set` reads the value from stdin; app keys are printed once and never stored.
- Output is redacted: tokens, keys and bearer headers are replaced by `[REDACTED]` in every output.
