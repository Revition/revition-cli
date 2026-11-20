# npm: who owns what, recovery, owner rotation

REVITION-CLI-PLAN T0.1.2. The package namespace is ours, and no long-lived publish credential exists: the only publish
path is the `release.yml` workflow in the `npm-release` GitHub environment, authenticated by OIDC (trusted
publishing). A stolen npm token cannot publish the CLI.

## Ownership (read from the public registry, 2026-11-20)

| Name | State | Owners | Required |
| --- | --- | --- | --- |
| `@revition/cli` | `0.0.0-reserved` (deprecated placeholder) | 2 | org team only (AC4) |
| `revition` | deprecated placeholder pointing to `@revition/cli` | 2 | 2 owners |
| `revition-cli` | deprecated placeholder | 2 | 2 owners |
| `revition-sdk` | deprecated placeholder | 2 | 2 owners |
| `revitioncli` | NOT published: npm refuses the name to everyone (see below) | - | protected by npm |
| `corvito` (assistant name, D10) | reserved `0.0.1` | 2 | 2 owners |
| `maelo`, `cortivo`, `teyra` (backups) | reserved | 2 each | 2 owners |

The raw registry reads are kept with the release evidence (`t0.1.2-npm-registry-state.json`,
`t0.1.2-live/readback-after-done.json`).

`revitioncli`: the owner's interactive publish of the placeholder was refused by npm (2026-11-20, E403 "Package name
too similar to existing package revition-cli"). npm applies that rule to every account, so nobody can take the name;
the user accepted this as meeting AC5 for that name (user ruling 2026-11-20). The plan anticipated it: a name counts as
reserved only after a successful publish, and npm refuses names too similar to existing ones.

## Record (2026-11-20, owner revition-dev with 2FA; screenshots with the release evidence)

- AC1: org `revition` Members tab: 2 members, 2FA enabled 2, 2FA disabled 0, "Disable 2FA Enforcement" shown
  (enforcement on); ajayvarmaco and revition-dev both Owner.
- AC2 / AC3 on `@revition/e2e-fixture-plugin` (the plugin test fixture, the first package bound to this workflow):
  trusted publisher GitHub Actions `Revition/revition-cli`, `release.yml`, environment `npm-release`, allowed action
  `npm publish` only; publishing access "Require two-factor authentication and disallow bypass 2fa tokens". A publish
  with a granular token WITH bypass-2FA was refused: E403 "Two-factor authentication is required to publish this
  package but an automation token was specified" (`t0.1.2-live/ac3-token-publish-probe-bypass2fa.json`).
- GitHub environment `npm-release`: deployment branch rule `main` only, no secrets.
- AC5: second owner added to corvito, cortivo and teyra; `revitioncli` as above.

## Owner checklist (a user step: the npm web UI or `npm` CLI under an owner account, with its 2FA one-time code)

Each item is done once by an org owner and recorded here with the date and a screenshot.

1. Org `@revition`: Settings -> "Require two-factor authentication" = ON; at least 2 owners, each with 2FA set to
   "authorization and writes" (AC1).
2. `@revition/cli`: Settings -> Trusted Publisher -> GitHub Actions: repository `revition/revition-cli`, workflow
   `.github/workflows/release.yml`, environment `npm-release`. Exactly one trusted publisher (AC2).
3. `@revition/cli`: Settings -> Publishing access -> "Require two-factor authentication and disallow tokens"; trusted
   publishers keep working under this setting (AC3).
4. Tokens: the org holds no classic or automation token (Access Tokens page shows none) (AC3).
5. `npm access list collaborators @revition/cli` shows only the org team (AC4).
6. Publish the missing `revitioncli` placeholder (`0.0.0-reserved`, then `npm deprecate` pointing to
   `@revition/cli`), and `npm owner add <second owner> <name>` for every unscoped name above (AC5).

Then, from the real `release.yml` in `npm-release`, a dry-run publish authenticates by OIDC and a token-based publish
of the same package is refused (L4).

## Recovery

- An owner loses their 2FA device: they sign in with an npm recovery code; if none is left, the other owner removes
  them from the org and the package owners, and npm support restores the account. Two owners exist so this never
  blocks a release.
- A misconfigured trusted publisher: the release fails closed (no fallback token exists). An owner corrects the
  publisher settings and re-runs the release workflow.

## Rotating owners

1. The new owner creates an npm account with 2FA ("authorization and writes").
2. An existing owner adds them to the org as an owner and runs `npm owner add <user> <name>` on every name above.
3. The leaving owner is removed only after the new owner has published a deprecation update successfully (proof that
   their access works); then `npm owner rm` and the org removal follow.
4. This table is updated with the date.
