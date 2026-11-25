# Configuration

Precedence, highest first: flags, environment (`REVITION_*`), the project link file (`.revition/project.json`), the
user config, defaults.

Config files never hold a credential. A key or value that looks like a secret is refused. Credentials live in the
credential store (`revition login`), or in `REVITION_TOKEN` for CI.

## Where the files are

| OS | Config | State (logs) | Cache |
| --- | --- | --- | --- |
| Linux | `$XDG_CONFIG_HOME/revition` (`~/.config/revition`) | `$XDG_STATE_HOME/revition` (`~/.local/state/revition`) | `$XDG_CACHE_HOME/revition` (`~/.cache/revition`) |
| macOS | `~/Library/Application Support/revition` (the XDG variables are honoured when set) | `~/Library/Application Support/revition/state` | `~/Library/Caches/revition` |
| Windows | `%APPDATA%\revition` | `%LOCALAPPDATA%\revition\state` | `%LOCALAPPDATA%\revition\cache` |

`revition config path` prints them. Writes are atomic (temp file, then rename), mode 0600 on POSIX.

## Keys

| Key | Values | Default | Env |
| --- | --- | --- | --- |
| `defaultProfile` | a profile name | `default` | `REVITION_PROFILE` |
| `profiles.<name>.host` | a Revition host (`*.revition.com`) | `api.revition.com` | `REVITION_HOST` |
| `profiles.<name>.org` | the last selected org (the server re-validates it) | none | `REVITION_ORG` |
| `profiles.<name>.authMethod` | `browser`, `device`, `token` | `browser` | `REVITION_AUTH_METHOD` |
| `telemetry` | `unset`, `on`, `off` | `unset` | `REVITION_TELEMETRY` |
| `updateCheck` | `true`, `false` | `true` | `REVITION_UPDATE_CHECK` |
| `color` | `auto`, `always`, `never` | `auto` | `REVITION_COLOR` |

The project link file carries `appId`, `projectId` and optionally `profile` (`REVITION_APP_ID`, `REVITION_PROJECT_ID`).
It is safe to commit and is never uploaded to a cloud project.

A host that is not a Revition host needs `--allow-custom-host`, prints a warning, and gets its own credentials: a
token is stored per profile and host, so it is never sent to a different host.

Commands: `revition config get|set|unset|list|path|edit`.

A corrupt config file is reported with its path; a copy is kept next to it as `config.json.corrupt-<time>`.
