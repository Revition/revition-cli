# ADR 0007 - Third-party plugins: verified, permissioned, org-controlled

Status: accepted (Phase 4 Sets 2 and 3; REVITION-CLI-PLAN.md T4.2.1-T4.2.3). Supersedes the interim "first-party
`@revition/` plugins only" rule of ADR 0002 / T1.1.1.

## Policy

A third-party plugin installs and runs only when ALL of these hold:

1. **Listed.** The Revition plugin registry (Developer Portal, `GET /dev/plugins`) lists it: its listing passed review
   and its publisher is registered. Anything else is refused (`PLUGIN_NOT_LISTED`, exit 4).
2. **Allowed by the workspace.** The workspace's "Command-line access" setting (`allowedPlugins`) allows it, or sets no
   list (any verified plugin). Org policy wins over user choice: checked at install AND at every run
   (`PLUGIN_NOT_ALLOWED`, exit 4).
3. **Signed.** The `npm audit signatures` checks, done through the registry API: the tarball matches `dist.integrity`;
   npm's registry signature verifies with a key valid at publish time; the SLSA provenance and npm's publish
   attestation verify with Sigstore (`@sigstore/verify`, a pinned Sigstore trusted root:
   `packages/core/src/plugins/sigstore-trusted-root.json`, refreshed with each CLI release); the in-toto subject is
   exactly this package and digest.
4. **From its registered publisher.** The publisher identity is the source repository in the provenance CERTIFICATE
   (GitHub or GitLab CI); it must equal the listing's publisher and be registered. A revoked publisher disables its
   plugins on their next run, with a message.

There is no flag, environment variable or setting that skips a check (a test enforces it).

## Packages

A plugin is an npm package with a `revition-plugin.json` (schemaVersion 1: commands and permissions). It ships BUNDLED:
no install script runs and nothing is downloaded at install, so every runtime dependency must be inside the package
(`bundleDependencies`). Links, devices, absolute paths and `..` in the tarball refuse the whole package.

## Permissions and the sandbox

Permissions are declared and shown before the install is confirmed:
`api:<resource>:read|write`, `fs:project:read|write`, `exec:none|exec:<program>`, `network:none`.

Every plugin command runs OUT OF PROCESS: a child Node process under the Node permission model, with a context object
instead of credentials.

- Files: read only the plugin's own folder, plus the project folder with `fs:project:*`; write only the project with
  `fs:project:write`. The credential store, the config folder and the keychain database are unreadable.
- No native addons (the OS keychain binding cannot load), no worker threads, no WASI.
- Starting a process needs a declared `exec:` permission; without one, `child_process` is denied by Node.
- The environment is rebuilt from nothing: no token, no `HOME`, no Revition settings.
- API calls go to core over IPC; core checks the declared `api:` permission and makes the call with the user's
  credential. The token never enters the plugin process.

### Known limits (documented, not hidden)

- **Exec scoping.** Node's permission model allows or denies child processes as a whole. With `exec:<program>` declared,
  the context refuses other programs, but plugin code that calls `child_process` directly can start any program. Only
  grant `exec:` to plugins you trust to that degree; the install prompt names it.
- **Network.** Node 22's permission model has no network permission. `network:none` is enforced for the API (it goes
  through core) but not for raw sockets. A plugin that must be isolated from the network needs OS-level isolation.
- Out-of-process execution is the boundary for every third-party plugin; first-party `@revition/` plugins are part of
  the CLI and run in process.

## Rejected

- Running third-party plugins in process with a capability object only: any plugin could import the keychain binding
  or read the credential file. Rejected for T03 / T13.
- Allowing any npm package with provenance: provenance proves where a package was built, not that Revition or the
  workspace trusts it. The registry listing and the org allowlist are the trust decision.
