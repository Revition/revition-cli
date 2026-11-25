# Incident response and rollback runbook

Use this page when a bad or malicious version ships, a security issue is found, user credentials leak, or the
repository is compromised. Every step works without a stored token: npm actions are done by a maintainer signed in
with 2FA, and platform actions by the platform on-call through the platform's own change process.

Who decides: the maintainer on call (the `@revition/cli-maintainers` and `@revition/cli-security` teams in
`.github/CODEOWNERS`; at least 2 active people with npm 2FA). Anyone who
sees an incident opens a private GitHub Security Advisory draft and pages the on-call.

## 1. Bad release

Move users back to the last good version, then deprecate the bad one so every installed CLI warns (the update
notifier, T1.4.1, prints the deprecation on the next run).

```sh
npm dist-tag add @revition/cli@<good> latest
npm deprecate @revition/cli@<bad> "<reason>; upgrade to <good>"
npm view @revition/cli dist-tags
```

Unpublish only within npm's 72-hour window and only for malicious content: `npm unpublish @revition/cli@<bad>`.
Repeat for every package of the release (a partially failed multi-package publish: deprecate the published ones, then
re-release all of them under the next patch version).

To undo a drill or a mistaken deprecation: `npm deprecate @revition/cli@<version> ""`.

## 2. Security issue

1. Open a GitHub Security Advisory (GHSA) on `Revition/revition-cli`, request a CVE from it, and keep it private
   until the fix ships.
2. Ship a patch release through the normal release workflow (`docs/release/process.md`).
3. Force the upgrade: the platform raises `MIN_CLI_VERSION` on the Dev API to the patched version. Every older CLI
   then gets HTTP 426 and exits 10 with the platform's "no longer supported" message and `revition upgrade`. This
   is the security exception to the 30-day notice in `docs/policy/deprecation.md`.
4. Publish the advisory and a notice on developer.revition.com. Record it in [advisories](../security/advisories.md).

Check the 426 with an older CLI, signed in as usual (it must exit 10 with "no longer supported"):

```sh
npx --yes @revition/cli@<old> whoami; echo "exit $?"
revition whoami; echo "exit $?"   # the patched version: exit 0
```

Lower `MIN_CLI_VERSION` again (or unset it) only if the raise itself was the mistake.

## 3. Credential leak (user tokens)

1. The platform revokes the affected CLI sessions and personal access tokens (the admin session and token tools,
   T1.2.2 / T1.2.3). A revoked credential gets 401 at once; the CLI exits 3 and asks the user to sign in again.
2. If the leak came from a CLI defect, also do section 2 so no affected version keeps running.
3. Tell the affected users which credentials were revoked and when.

## 4. Repository compromise

1. Remove the attacker's access: revoke the maintainer's GitHub access and npm org membership.
2. Rotate the GitHub organisation credentials and disable the release environments (`npm-release`,
   `release-approval`, `release-approval-2`) so nothing can publish.
3. Audit every published version through its provenance: `node scripts/verify-release.mjs @revition/cli <tag>` for
   each dist-tag, and the npm provenance of each version since the suspected start. Any version without provenance
   from `Revition/revition-cli` + `.github/workflows/release.yml` is compromised: do section 1 for it.
4. Re-enable the environments only after a review by 2 maintainers.

## 5. Communication

Templates (fill the brackets, post on the advisory, the release notes and developer.revition.com):

- Bad release: "`@revition/cli` [bad] has a defect: [one line]. It is deprecated; `latest` is back on [good]. Run
  `revition upgrade` (or `npm install -g @revition/cli@[good]`)."
- Security: "A [severity] vulnerability in `@revition/cli` [range] ([GHSA id], [CVE]) is fixed in [version]. Older
  versions are now refused by the platform. Run `revition upgrade`."
- Credential leak: "We revoked [n] CLI sessions / tokens created between [start] and [end] as a precaution. Sign in
  again with `revition login`."

## Drills

A tabletop drill of sections 3 and 4 before `1.0.0` and every 6 months; a live drill of sections 1 and 2 on a canary
version (move the dist-tag, deprecate it, check the warning, restore; raise and lower the staging `MIN_CLI_VERSION`).
Record each drill (date, people, commands run, outputs) in `docs/evidence/`.
