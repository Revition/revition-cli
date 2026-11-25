# Where the CLI keeps credentials

`revition login` stores three things, under service `revition-cli`, account `<profile>@<host>`:

- the platform session credential (`rvs_...`);
- the identity provider's refresh token (rotating: each use returns a new one, and reusing an old one ends the session);
- the device key, which signs session renewals.

They live only in the operating system's credential store, in this order:

| Backend | When |
| --- | --- |
| OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service) | the default |
| Encrypted file `<state>/credentials.enc` (AES-256-GCM, key from a passphrase you enter each session, mode 0600) | only after `revition login --insecure-storage`, remembered per profile |
| Memory (this process only) | CI: a token in `REVITION_TOKEN` |

Without a keychain, and without `--insecure-storage`, login refuses and writes nothing. There is never a plaintext
token file, and config files never hold a credential.

`revition auth status` and `revition doctor` show which backend is used without reading the secret. `revition logout`
revokes the session on the identity provider and the platform, then deletes the stored entry. Offline, the local part
is done at once and the revocation is retried at the next run.

Personal access tokens (CI) are never stored by the CLI. See `docs/ci.md`.

Known limitation: see ADR 0005 (macOS Keychain items of an npm-installed CLI are not bound to a code signature).

On WSL and on headless Linux servers there is usually no Secret Service: the CLI refuses and explains the options.
