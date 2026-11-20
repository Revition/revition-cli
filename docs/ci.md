# Using the CLI in CI

CI authenticates with a personal access token (PAT), never with a browser login, and never with a secret in argv.

1. Create a token (shown once): `revition token create --name ci-deploy --scopes cli:read,cli:write --expires 30d`.
2. Store it in your CI system's secret store.
3. Give it to the CLI through the environment variable `REVITION_TOKEN`.

There is no `--token` flag. `revition login --with-token < token.txt` reads a token from stdin and checks it; it does
not store it.

With `REVITION_TOKEN` set, the CLI keeps the token in memory only: nothing is written to the keychain or to disk, and
no session is registered. If a stored login also exists, the token wins and the CLI prints a one-line notice.

In CI (`CI=true`, or no terminal on stdin) nothing is interactive: `--no-input` is implied, so a command that needs a
confirmation exits 2 with guidance instead of waiting. Pass `--yes` to confirm on purpose.

## GitHub Actions

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - run: npm install -g @revition/cli
      - run: revition whoami
        env:
          REVITION_TOKEN: ${{ secrets.REVITION_TOKEN }}
```

GitHub masks the secret in logs. Use an environment secret so only approved jobs can read it.

## GitLab CI

```yaml
deploy:
  script:
    - npm install -g @revition/cli
    - revition whoami
  variables:
    REVITION_TOKEN: $REVITION_TOKEN
```

Mark the variable as Masked and Protected in the project settings.

## CircleCI

Add `REVITION_TOKEN` to a context, attach the context to the job, and run the CLI as usual.

An expired token exits 3 and names the token prefix, never the token.
