# Command reference

Generated from the `revition` command metadata by `packages/cli/scripts/command-reference.mjs`. Do not edit by hand.

## `revition account link-workspace`

Link your developer account to a workspace you are a member of (your wallet stays yours).

Flags:

- `--org <value>` (required): The workspace (org id). The platform checks your membership.

Examples:

```sh
revition account link-workspace --org org_123
```

## `revition account register`

Create your developer account (free; idempotent).

Flags:

- `--accept-terms`: Accept the developer agreement without a prompt (required off a terminal).
- `--kind <independent|tenant_member>`: independent (no workspace) or tenant_member (an SSO member of a workspace).
- `--org <value>`: The workspace (org id) a tenant member signs in with.

Examples:

```sh
revition account register
revition account register --kind tenant_member --org org_123 --accept-terms --yes
```

## `revition account status`

Show your developer account: kind, linked workspace, verification and wallet.

Examples:

```sh
revition account status
revition account status --json
```

## `revition agents create`

Create an agent from a definition file (its draft = the file; nothing goes live).

Arguments:

- `file` (required): The definition file (agent.id: null).

Flags:

- `--template <value>`: The template to start from (default: blank; see `revition agents templates`).

Examples:

```sh
revition agents create agents/support.agent.yaml
revition agents create agents/support.agent.yaml --template blank --yes
```

## `revition agents diff`

Show what a definition file changes in the draft (by section), and the draft against live.

Arguments:

- `file` (required): The definition file.

Examples:

```sh
revition agents diff agents/support.agent.yaml
revition agents diff agents/support.agent.yaml --json
```

## `revition agents environments list`

An agent's environments, what each runs, and any promotion waiting for approval.

Arguments:

- `id` (required): The agent (deployment id).

Examples:

```sh
revition agents environments list dep_123
revition agents environments list dep_123 --json
```

## `revition agents list`

Your workspace's agents.

Examples:

```sh
revition agents list
revition agents list --json
```

## `revition agents open`

Open the agent's portal page, where a person publishes the draft or promotes an environment.

Arguments:

- `id` (required): The agent (deployment id).

Flags:

- `--action <publish|promote>`: The human step you will take there.

Examples:

```sh
revition agents open dep_123 --action publish
```

## `revition agents pull`

Write an agent's draft to a definition file (keeps your local edits unless --force).

Arguments:

- `id` (required): The agent (deployment id).

Flags:

- `--force`: Overwrite a file that has local edits.
- `-o, --output <value>`: The file to write (default: `agents/<name>.agent.yaml`).

Examples:

```sh
revition agents pull dep_123
revition agents pull dep_123 -o agents/support.agent.yaml --force
```

## `revition agents push`

Save a definition file to the agent's draft (never live; publishing is done in the portal).

Arguments:

- `file` (required): The definition file.

Examples:

```sh
revition agents push agents/support.agent.yaml
revition agents push agents/support.agent.yaml --yes --json
```

## `revition agents runs`

An agent's runs (scope and time range), with their billed cost.

Arguments:

- `id` (required): The agent (deployment id).

Flags:

- `--from <value>`: Runs started at or after this time (ISO 8601).
- `--limit <value>`: Page size the server returns (it pages to the end).
- `--scope <all|project|goal|task>`: all (default), or project / goal / task with --scope-id.
- `--scope-id <value>`: With --scope project / goal / task: its id.
- `--to <value>`: Runs started before this time (ISO 8601).

Examples:

```sh
revition agents runs dep_123
revition agents runs dep_123 --scope goal --scope-id goal_1 --from 2026-11-01T00:00:00Z --json
```

## `revition agents status`

An agent's draft vs live, its latest Tests report and its environments.

Arguments:

- `id` (required): The agent (deployment id).

Examples:

```sh
revition agents status dep_123
revition agents status dep_123 --json
```

## `revition agents templates`

The agent templates `agents create --template` can start from.

Examples:

```sh
revition agents templates
revition agents templates --json
```

## `revition agents test`

Run the agent draft's Tests: the quote first, then (confirmed) the run and the report.

Arguments:

- `id` (required): The agent (deployment id).

Examples:

```sh
revition agents test dep_123
revition agents test dep_123 --yes --json
```

## `revition agents traces`

An agent's execution traces for a range, or --follow new ones as they happen.

Arguments:

- `id` (required): The agent (deployment id).

Flags:

- `--follow`: Print each new trace once as it happens, until Ctrl-C.
- `--from <value>`: The first day (YYYY-MM-DD); with --to. Default: the last 7 days.
- `--scope <all|project|goal|task>`: all (default), or project / goal / task with --scope-id.
- `--scope-id <value>`: With --scope project / goal / task: its id.
- `--to <value>`: The last day (YYYY-MM-DD).

Examples:

```sh
revition agents traces dep_123
revition agents traces dep_123 --from 2026-11-01 --to 2026-11-18
revition agents traces dep_123 --follow --json
```

## `revition agents validate`

Check agent definition files: the schema and no inline secrets (and, with --server, the platform).

Arguments:

- `files`: Definition files (default: agents/*.agent.yaml).

Flags:

- `--server`: Also run the platform's dry-run validation (needs the agent id in the file).

Examples:

```sh
revition agents validate
revition agents validate agents/support.agent.yaml --server
```

## `revition analytics`

An app's publisher analytics (installs, revenue, rating, errors, eval uplift).

Flags:

- `--app <value>`: The app id (default: the linked app).
- `--days <7|30|90>`: The period in days (default 30).
- `--dir <value>`: The project directory (default: the current directory).

Examples:

```sh
revition analytics --app dapp_123
revition analytics --days 7 --json
```

## `revition apps create`

Register an app: its plugin manifest and the scopes it declares (the platform validates both).

Flags:

- `--manifest <value>` (required): A JSON file: pluginId, brand, category, description, version, dataClasses.
- `--scopes <value>`: Comma-separated scopes the app declares (platform permissions).

Examples:

```sh
revition apps create --manifest app-manifest.json --scopes source:orders --yes
```

## `revition apps keys create`

Create an app key: printed once, never stored by the CLI.

Arguments:

- `app` (required): The app id.

Flags:

- `--scopes <value>`: Comma-separated scopes (default: the app's declared scopes).

Examples:

```sh
revition apps keys create dapp_123 --yes
revition apps keys create dapp_123 --scopes source:orders --json --yes
```

## `revition apps keys list`

List an app's keys (ids and state; never a secret).

Arguments:

- `app` (required): The app id.

Examples:

```sh
revition apps keys list dapp_123
```

## `revition apps keys revoke`

Revoke an app key: it stops working at once (type the key id to confirm, or --yes).

Arguments:

- `app` (required): The app id.
- `keyId` (required): The key id.

Examples:

```sh
revition apps keys revoke dapp_123 0123abcd4567ef89
revition apps keys revoke dapp_123 0123abcd4567ef89 --yes
```

## `revition apps keys rotate`

Rotate an app key: a new key (printed once); the old one keeps working for the 7-day grace.

Arguments:

- `app` (required): The app id.
- `keyId` (required): The key id (from `apps keys list`).

Examples:

```sh
revition apps keys rotate dapp_123 0123abcd4567ef89 --yes
```

## `revition apps list`

List your registered apps.

Examples:

```sh
revition apps list
revition apps list --json
```

## `revition apps listing`

Show an app's marketplace listing (GET /dev/apps/{appId}/listing).

Arguments:

- `id` (required): The app id.

Examples:

```sh
revition apps listing dapp_123 --json
```

## `revition apps scopes set`

Change an app's declared scopes: the permission diff is shown before you confirm.

Arguments:

- `id` (required): The app id.

Flags:

- `--scopes <value>` (required): The complete new scope list (comma-separated).

Examples:

```sh
revition apps scopes set dapp_123 --scopes source:orders,data.read:orders
revition apps scopes set dapp_123 --scopes source:orders --yes
```

## `revition apps view`

Show one of your apps.

Arguments:

- `id` (required): The app id.

Examples:

```sh
revition apps view dapp_123
revition apps view dapp_123 --json
```

## `revition assist`

Corvito: a terminal assistant for building on Revition.

Arguments:

- `goal`: What to work on (asked for when omitted on a terminal).

Flags:

- `--budget <value>`: The session budget cap in credits (enforced by the platform). Needed for a new session.
- `--mode <ask|edit>`: ask: read-only analysis; edit: changes, each shown and confirmed.
- `--resume <value>`: Continue an earlier session by its id.

Examples:

```sh
revition assist "make the order-sync tests pass" --mode edit --budget 50
revition assist "why does my build fail?" --budget 10
revition assist "summarise this project" --mode ask --budget 5 --no-input --json
corvito "add a retry to the webhook handler" --mode edit --budget 30
```

## `revition audit`

Your developer audit trail: what was done, when, and from which client.

Flags:

- `--action <value>`: Only events with this name.
- `--since <value>`: Only events newer than this (90s, 30m, 6h, 7d).

Examples:

```sh
revition audit
revition audit --since 1d --action app_registered
revition audit --json
```

## `revition auth status`

Show every profile: host, user, credential store, session and freshness (never a token).

Examples:

```sh
revition auth status
revition auth status --json
```

## `revition autocomplete`

Print the completion script for bash, zsh, fish or PowerShell.

Arguments:

- `shell`: The shell (default: from $SHELL).

Examples:

```sh
revition autocomplete zsh
revition autocomplete bash > ~/.revition-completion.bash
```

## `revition branches eval`

Run the pipeline on an approved code branch: the quote first, then (confirmed) the run.

Arguments:

- `branch` (required): The branch id.

Flags:

- `--agent <value>` (required): The agent (deployment id).

Examples:

```sh
revition branches eval br_1 --agent dep_123
revition branches eval br_1 --agent dep_123 --yes
```

## `revition branches list`

List an agent's code branches and their review status.

Flags:

- `--agent <value>` (required): The agent (deployment id).

Examples:

```sh
revition branches list --agent dep_123
revition branches list --agent dep_123 --json
```

## `revition branches status`

A code branch's review status and pipeline (approve and merge happen in the portal).

Arguments:

- `branch` (required): The branch id.

Flags:

- `--agent <value>` (required): The agent (deployment id).

Examples:

```sh
revition branches status br_1 --agent dep_123
revition branches status br_1 --agent dep_123 --json
```

## `revition branches view`

Show one code branch: its files, permissions, impact, pipeline and history.

Arguments:

- `branch` (required): The branch id.

Flags:

- `--agent <value>` (required): The agent (deployment id).

Examples:

```sh
revition branches view br_1 --agent dep_123
```

## `revition build`

Check the project: the platform's layout rules locally, then the platform's own checks.

Flags:

- `--dir <value>`: The project directory (default: the current directory).
- `--strict`: Fail on warnings too.

Examples:

```sh
revition build
revition build --dir ./my-tool --json
revition build --strict
```

## `revition changelog`

The platform SDK's changelog, or this CLI's release notes (--cli).

Flags:

- `--cli`: This CLI's version and its release notes.
- `--platform`: The platform SDK's changelog (the default).

Examples:

```sh
revition changelog
revition changelog --cli
revition changelog --json
```

## `revition commands`

Every command with its machine contract (scopes, changes, confirmation, JSON schema).

Examples:

```sh
revition commands
revition commands --json
```

## `revition config edit`

Open the config file in $VISUAL / $EDITOR, then validate it.

Examples:

```sh
revition config edit
```

## `revition config get`

Print one config value.

Arguments:

- `key` (required): The config key.

Examples:

```sh
revition config get telemetry
revition config get profiles.default.host
```

## `revition config list`

List every config value.

Examples:

```sh
revition config list
revition config list --json
```

## `revition config path`

Print where the CLI keeps its config, state and cache.

Examples:

```sh
revition config path
```

## `revition config set`

Set a config value (never a secret).

Arguments:

- `key` (required): The config key.
- `value` (required): The new value.

Flags:

- `--allow-custom-host`: Allow a host that is not a Revition host.

Examples:

```sh
revition config set telemetry off
revition config set profiles.work.host api.revition.com
```

## `revition config unset`

Remove a config value (its default applies again).

Arguments:

- `key` (required): The config key.

Examples:

```sh
revition config unset telemetry
```

## `revition deploy`

Propose this project onto an agent as a code branch for review (never a live change).

Flags:

- `--agent <value>` (required): The agent (deployment id) to propose the branch on.
- `--dir <value>`: The project directory (default: the current directory).

Examples:

```sh
revition deploy --agent dep_123 --yes
revition deploy --agent dep_123 --dir ./my-ext --json --yes
```

## `revition dev`

The inner loop in the cloud sandbox: save, run, see the result; on every change until Ctrl-C.

Flags:

- `--dir <value>`: The project directory (default: the current directory).
- `--exec <value>`: After each save: run this command in the sandbox.
- `--input <value>`: With --run: the input, as JSON.
- `--keep`: Leave the sandbox running on exit (it still stops after 5 idle minutes).
- `--local`: The free local loop: the project's tests on every save, stubbed SDK, no network.
- `--once`: One save + action, then stop (scripts and CI).
- `--pull`: Reload: replace the local files with the cloud project's saved version.
- `--run <value>`: After each save: run this capability.
- `--sandbox`: Use the project's cloud sandbox (metered to your developer wallet).
- `--test <value>`: After each save: run this capability's tests.

Examples:

```sh
revition dev --sandbox --run hello --input "{\"name\":\"x\"}"
revition dev --sandbox --test hello --once --yes
revition dev --sandbox --pull
```

## `revition docs`

The platform SDK or UI reference in the terminal (offline: the last copy).

Arguments:

- `kind` (required): sdk or ui.

Flags:

- `--search <value>`: Only the entries containing this text.

Examples:

```sh
revition docs sdk
revition docs sdk --search knowledge
revition docs ui --json
```

## `revition doctor`

Diagnose this machine: version, Node, config, credential store, host, TLS, proxy, clock.

Examples:

```sh
revition doctor
revition doctor --json
```

## `revition eval list`

List an app's evaluation runs, newest first.

Flags:

- `--app <value>`: The app id (default: the linked app).
- `--dir <value>`: The project directory (default: the current directory).

Examples:

```sh
revition eval list
revition eval list --app dapp_123 --json
```

## `revition eval run`

Evaluate a suite: the quote first, then (confirmed) the run and the portal's uplift report.

Flags:

- `--app <value>`: The app id (default: the linked app).
- `--dir <value>`: The project directory (default: the current directory).
- `--dry-run`: Print the quote only: free, nothing runs.
- `--suite <value>`: The suite: `evals/<suite>.json` (default: the only one).

Examples:

```sh
revition eval run --suite smoke --dry-run
revition eval run --app dapp_123 --suite smoke --yes
```

## `revition extension-points`

The platform's extension points: where an extension can plug in.

Examples:

```sh
revition extension-points
revition extension-points --json
```

## `revition generate`

Add a piece to the project from the platform's own templates: a capability, a test, an eval suite or the UI surface.

Arguments:

- `kind`: What to add: capability, test, eval-suite, ui-surface.
- `name`: The new capability / eval suite name, or the capability a test belongs to.
- `caseName`: For `test`: the test case name.

Flags:

- `--capability <value>`: For `eval-suite`: the capability it evaluates.
- `--dir <value>`: The project directory (default: the current directory).
- `--lang <ts|python>`: For `capability`: the language.
- `--list`: List the platform's extension points and their starters.
- `--point <value>`: For `capability`: the extension point (see --list).

Examples:

```sh
revition generate --list
revition generate capability order-sync --point scheduled_job --lang ts --yes
revition generate test order-sync "handles an empty batch" --yes
revition generate eval-suite smoke --capability order-sync --yes
revition generate ui-surface --yes
```

## `revition init`

Create a project from a platform starter, and optionally link it to an app and a cloud project.

Arguments:

- `dir`: The new project directory (default: the starter id).

Flags:

- `--app <value>`: Link an app: `new` registers one (needs --category and --description), or an app id you own.
- `--category <value>`: With --app new: the app category.
- `--description <value>`: With --app new: what the app does.
- `--force`: Write into a non-empty directory (existing files are still never overwritten).
- `--name <value>`: The project name (default: the directory name).
- `--project <value>`: Link a cloud project (sandbox / IDE): `new` creates one from the starter, or a project id you own.
- `--starter <value>` (required): The starter id (see `revition starters list`).

Examples:

```sh
revition init my-tool --starter hello-tool
revition init my-tool --starter hello-tool --app dapp_123 --project new --yes
revition init my-tool --starter hello-tool --app new --category tools --description "Looks up orders" --yes
```

## `revition link`

Link this directory to an app and / or a cloud project you own (local only; nothing changes on the server).

Flags:

- `--app <value>`: An app id you own (see `revition apps list`).
- `--project <value>`: A cloud project id you own.

Examples:

```sh
revition link --app dapp_123
revition link --project dproj_abc --yes
```

## `revition login`

Sign in (browser by default; --device for remote shells; --with-token to check a CI token).

Flags:

- `--device`: Use the device-code flow (opt-in; for machines without a browser).
- `--force`: Ask the identity provider to sign in again (prompt=login).
- `--insecure-storage`: Without an OS keychain: keep an encrypted file (passphrase each session).
- `--scopes <value>`: Comma-separated CLI scopes for the session (default: all).
- `--with-token`: Read a token from stdin and check it (tokens are never stored).

Examples:

```sh
revition login
revition login --device
revition login --with-token < token.txt
```

## `revition logout`

Sign out: revoke the session on Auth0 and the platform, and delete the local credential.

Flags:

- `--all`: Sign out of every profile.

Examples:

```sh
revition logout
revition logout --all
```

## `revition logs`

One run's logs (as the portal shows them), or --follow new runs as they happen.

Arguments:

- `runId`: The run id (from `revition runs list`).

Flags:

- `--app <value>`: The app id (default: the linked app).
- `--dir <value>`: The project directory (default: the current directory).
- `--follow`: Print each new run once as it happens, until Ctrl-C.
- `--grep <value>`: Only the lines containing this text (local).

Examples:

```sh
revition logs build:1.2.0 --app dapp_123
revition logs --app dapp_123 --follow
revition logs --follow --json | jq .runId
```

## `revition mcp serve`

Run an MCP server over stdio: the platform operations as tools for AI clients.

Flags:

- `--allow-write`: Also expose tools that change data (never typed-confirm ones).
- `--tools <value>`: Only these tools: comma-separated globs over tool names or command ids.

Examples:

```sh
revition mcp serve
revition mcp serve --profile work --tools "revition_apps_*,revition_logs"
revition mcp serve --allow-write
```

## `revition open`

Open a Developer Portal page (prints the URL when no browser is available).

Arguments:

- `target`: What to open (default: app).

Flags:

- `--dir <value>`: The project directory (default: the current directory).

Examples:

```sh
revition open
revition open project
revition open sessions
```

## `revition plugins install`

Install a verified plugin (its signature, publisher and permissions are checked first).

Arguments:

- `plugin` (required): The npm package name, optionally `@<exact version>`.

Examples:

```sh
revition plugins install @acme/revition-plugin-tickets
revition plugins install @acme/revition-plugin-tickets@1.2.0 --yes
```

## `revition plugins list`

List the plugins installed on this machine.

Examples:

```sh
revition plugins list
revition plugins list --json
```

## `revition plugins remove`

Remove an installed plugin.

Arguments:

- `plugin` (required): The installed plugin name.

Examples:

```sh
revition plugins remove @acme/revition-plugin-tickets --yes
```

## `revition plugins run`

Run an installed plugin's command (sandboxed, with only its declared permissions).

Arguments:

- `plugin` (required): The installed plugin.
- `command` (required): The plugin's command.

Examples:

```sh
revition plugins run @acme/revition-plugin-tickets list --project WEB
```

## `revition plugins search`

Search the registry of verified plugins.

Arguments:

- `query`: Words to match in the name or summary.

Examples:

```sh
revition plugins search tickets
revition plugins search --json
```

## `revition plugins update`

Update an installed plugin to its latest verified version.

Arguments:

- `plugin` (required): The installed plugin name.

Examples:

```sh
revition plugins update @acme/revition-plugin-tickets
```

## `revition profiles list`

List the configured profiles (each is one account on one host).

Examples:

```sh
revition profiles list
```

## `revition profiles remove`

Remove a profile: sign it out (revoking its session) and delete its settings.

Arguments:

- `name` (required): The profile.

Examples:

```sh
revition profiles remove old-account --yes
```

## `revition profiles use`

Make a profile the default (its account and host are used when --profile is not given).

Arguments:

- `name` (required): The profile.

Examples:

```sh
revition profiles use work
```

## `revition runs list`

An app's runs (builds, runs in agents, evaluations), newest first.

Flags:

- `--app <value>`: The app id (default: the linked app).
- `--dir <value>`: The project directory (default: the current directory).
- `--failed`: Only the runs that failed.
- `--ok`: Only the runs that succeeded.
- `--since <value>`: Only the runs newer than this (90s, 30m, 6h, 7d).

Examples:

```sh
revition runs list --app dapp_123
revition runs list --failed --since 7d
revition runs list --json
```

## `revition scaffold`

Write a starter project into a new directory (the legacy form of `revition init`).

Arguments:

- `starter` (required): The starter id.
- `dir`: The new directory (default: the starter id).

Examples:

```sh
revition scaffold hello-tool
revition scaffold hello-tool my-tool
```

## `revition secrets list`

List runtime secret NAMES (the workspace's, or an app's with --app); values are never shown.

Flags:

- `--app <value>`: An app's secrets (an independent developer's apps) instead of the workspace's.

Examples:

```sh
revition secrets list
revition secrets list --app dapp_123 --json
```

## `revition secrets set`

Set a runtime secret. The value comes from stdin or a hidden prompt, never from an argument.

Arguments:

- `name` (required): The secret name.

Flags:

- `--app <value>`: An app's secret instead of the workspace's.

Examples:

```sh
revition secrets set API_KEY
revition secrets set API_KEY --yes < key.txt
cat cert.pem | revition secrets set TLS_CERT --app dapp_123 --yes
```

## `revition secrets unset`

Remove a runtime secret.

Arguments:

- `name` (required): The secret name.

Flags:

- `--app <value>`: An app's secret instead of the workspace's.

Examples:

```sh
revition secrets unset API_KEY
revition secrets unset API_KEY --app dapp_123 --yes
```

## `revition starters list`

List the platform's project starters.

Flags:

- `--point <value>`: Only the starters of this extension point.

Examples:

```sh
revition starters list
revition starters list --point scheduled_job --json
```

## `revition starters view`

Show one starter and the files it creates.

Arguments:

- `id` (required): The starter id (from `starters list`).

Examples:

```sh
revition starters view hello-tool
```

## `revition submissions list`

List an app's submitted versions and where each stands.

Flags:

- `--app <value>`: The app id (default: the linked app).
- `--dir <value>`: The project directory (default: the current directory).

Examples:

```sh
revition submissions list
revition submissions list --app dapp_123 --json
```

## `revition submissions open`

Open the portal page where a person publishes a certified version (the CLI never publishes).

Arguments:

- `version` (required): The submitted version (x.y.z).

Flags:

- `--app <value>`: The app id (default: the linked app).
- `--dir <value>`: The project directory (default: the current directory).

Examples:

```sh
revition submissions open 1.2.0
revition submissions open 1.2.0 --app dapp_123
```

## `revition submissions view`

Show one submitted version: every check result and reason, and the review decision.

Arguments:

- `version` (required): The submitted version (x.y.z).

Flags:

- `--app <value>`: The app id (default: the linked app).
- `--dir <value>`: The project directory (default: the current directory).

Examples:

```sh
revition submissions view 1.2.0
revition submissions view 1.2.0 --app dapp_123 --json
```

## `revition submit`

Submit a version of the saved cloud project for review and certification.

Flags:

- `--app <value>`: The app id (default: the linked app).
- `--dir <value>`: The project directory (default: the current directory).
- `--project <value>`: The cloud project id (default: the linked project).
- `--version <value>` (required): The version to submit (x.y.z).

Examples:

```sh
revition submit --version 1.2.0 --yes
revition submit --app dapp_123 --project dproj_1 --version 1.2.0 --yes
```

## `revition telemetry disable`

Opt out of telemetry: nothing more is sent, and the install id is reset.

Examples:

```sh
revition telemetry disable
```

## `revition telemetry enable`

Opt in to anonymous usage telemetry (DO_NOT_TRACK still wins).

Examples:

```sh
revition telemetry enable
```

## `revition telemetry show-last`

Print the last 20 telemetry events exactly as they were sent.

Examples:

```sh
revition telemetry show-last --json
```

## `revition telemetry status`

Show whether anonymous usage telemetry is on, and why.

Examples:

```sh
revition telemetry status
```

## `revition test`

Run the project's tests here: the stubbed SDK from fixtures.json, no network, no sign-in.

Flags:

- `--dir <value>`: The project directory (default: the current directory).
- `--filter <value>`: Run only the tests whose name contains this text.
- `--watch`: Re-run on every change until Ctrl-C.

Examples:

```sh
revition test
revition test --filter refund --json
revition test --watch
```

## `revition token create`

Create a personal access token for CI (shown once; never stored by the CLI).

Flags:

- `--expires <value>`: Lifetime in days, at most 90 (e.g. 30d).
- `--name <value>` (required): A label for the token (up to 60 characters).
- `--scopes <value>`: Comma-separated scopes (cli:read, cli:write, cli:submit, cli:agents, cli:assist).

Examples:

```sh
revition token create --name ci-deploy --scopes cli:read,cli:write --expires 30d --yes
```

## `revition token list`

List your personal access tokens (prefix only, never the token).

Examples:

```sh
revition token list
revition token list --json
```

## `revition token revoke`

Revoke a personal access token (it stops working at once).

Arguments:

- `id` (required): The token id (from `token list`).

Examples:

```sh
revition token revoke tok_123 --yes
```

## `revition upgrade`

Upgrade the CLI with the package manager that installed it (prints the command first).

Flags:

- `--channel <latest|next|canary>`: The release channel (default: the installed one).

Examples:

```sh
revition upgrade
revition upgrade --channel next
```

## `revition versions channels`

An app's release channels: the version each offers, and every cut.

Flags:

- `--app <value>`: The app id (default: the linked app).
- `--dir <value>`: The project directory (default: the current directory).

Examples:

```sh
revition versions channels --app dapp_123
revition versions channels --app dapp_123 --json
```

## `revition versions list`

List every submitted version of an app and its status.

Flags:

- `--app <value>`: The app id (default: the linked app).
- `--dir <value>`: The project directory (default: the current directory).

Examples:

```sh
revition versions list
revition versions list --app dapp_123 --json
```

## `revition versions open`

Open the portal release page (promote, rollback, advisories are human steps there).

Flags:

- `--action <promote|rollback|advisory>`: The release step you will take there.
- `--app <value>`: The app id (default: the linked app).
- `--dir <value>`: The project directory (default: the current directory).

Examples:

```sh
revition versions open --app dapp_123
revition versions open --app dapp_123 --action rollback
```

## `revition versions rollouts`

An app's staged rollouts: the version, its current stage and status on each channel.

Flags:

- `--app <value>`: The app id (default: the linked app).
- `--dir <value>`: The project directory (default: the current directory).

Examples:

```sh
revition versions rollouts --app dapp_123
revition versions rollouts --app dapp_123 --json
```

## `revition wallet open`

Open the Developer Portal wallet (top-up happens there).

Examples:

```sh
revition wallet open
```

## `revition wallet show`

Your developer wallet balance (build credits), from Mint.

Examples:

```sh
revition wallet show
revition wallet show --json
```

## `revition whoami`

Show who you are signed in as, the workspace the platform resolved, and the host.

Examples:

```sh
revition whoami
revition whoami --json
```

## Global flags

- `--color <auto|always|never>`:
- `--debug`: Write a debug log.
- `--json`: Print one JSON document to stdout.
- `--no-input`: Never prompt; fail instead.
- `--profile <value>`: The config profile to use.
- `-y, --yes`: Confirm a command that makes changes.
