# Quickstart: your first extension in 10 minutes

You need Node.js 22 or later and a Revition developer account (free to register; building is billed to your own
developer wallet).

## 1. Install and sign in (1 minute)

```sh
npm install -g @revition/cli
revition login
revition account register --accept-terms --yes   # once: the developer agreement
```

## 2. Start from a starter (1 minute)

```sh
revition starters list                 # the platform's starters, by extension point
revition init my-tool --starter hello-tool --app new --category tools --description "My first tool" --project new --yes
cd my-tool
```

`init` writes the starter's files, registers your app and links the directory to it and to a new cloud project
(`.revition/project.json`: ids only, safe to commit).

## 3. Add to it (2 minutes)

```sh
revition generate --list                                       # the extension points
revition generate capability order-sync --point scheduled_job --lang ts --yes
revition generate eval-suite smoke --capability order-sync --yes
```

## 4. Check it (1 minute)

```sh
revition build            # the local checks, then the platform's own (billed at 0 credits)
```

A problem is printed with its file and how to fix it; exit 6 means a check failed.

## 5. Run it in the cloud sandbox (2 minutes)

```sh
revition dev --sandbox --run order-sync --input "{}"
```

Every save uploads the project and runs the capability again; Ctrl-C deletes the sandbox. The sandbox is metered to
your developer wallet: `revition wallet show` shows your balance.

## 6. Prove it helps (2 minutes)

```sh
revition eval run --suite smoke --dry-run   # the quote: cases, model calls, your balance (free)
revition eval run --suite smoke             # confirm, then the uplift report and the billed credits
```

## 7. Ship it (1 minute)

```sh
revition submit --version 1.0.0 --yes
revition submissions view 1.0.0     # the automatic checks, then the review
revition submissions open 1.0.0     # once certified: you publish it in the Developer Portal
```

Publishing, release changes and approvals are human steps in the portal; the CLI shows their status.

## Next

- Every command: [command reference](reference/commands.md). Scripts and CI: [CI](ci.md).
- What happens after release: `revition runs list`, `revition logs --follow`, `revition analytics`.
- Questions: [FAQ](faq.md).
