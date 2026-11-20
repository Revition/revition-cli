# FAQ

**Which commands cost money?** Only the ones that run something billed: `build` (the platform's check, 0 credits),
`dev --sandbox` (the cloud sandbox), `eval run` and `branches eval`. The paid ones show a quote first and run only
after you confirm (or pass `--yes`); `--dry-run` shows the quote alone. Your balance: `revition wallet show`.

**Why can't the CLI publish my app, approve a branch or change a release?** Those are human decisions on the
platform, taken in the Developer Portal by a person with the right role. The CLI shows their status and opens the
right page (`revition submissions open`, `revition versions open`, `revition branches status`); the platform refuses
a CLI or token credential on those routes.

**Where are my credentials?** In your operating system's keychain, never in a config file. In CI, use a personal
access token from the `REVITION_TOKEN` environment variable. See [credentials](security/credentials.md).

**Does the CLI work offline?** `revition docs` and `generate --list` show the last copy they fetched; everything that
reads or changes the platform needs the network.

**How do I see what my extension did?** `revition runs list` and `revition logs <runId>`, or `revition logs --follow`
while it runs. You see execution metadata, never a customer's data: the logs say how many fields were withheld.

**A command says my version is too old (exit 10).** Run `revition upgrade`.

**How do I report a vulnerability?** See [SECURITY.md](../SECURITY.md).

**Where are the exit codes and `--json` documented?** [Output](output.md).
