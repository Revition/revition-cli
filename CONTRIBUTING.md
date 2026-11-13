# Contributing to the Revition CLI

Thank you for helping. This guide covers setup, tests, sign-off, changesets and code style.

## Setup

1. Install Node.js 22 LTS and pnpm.
2. Fork the repository and clone your fork.
3. Run `pnpm install` at the repository root.

## Tests

- `pnpm test` runs the unit tests.
- `pnpm lint` runs the linter, and `pnpm typecheck` the type checker.

Every change needs tests, and every pull request must pass the required checks before review.

## Developer Certificate of Origin (DCO)

Every commit must be signed off. The sign-off certifies that you wrote the change, or have the right to submit it,
under the project's licence (the Developer Certificate of Origin, https://developercertificate.org).

```sh
git commit -s -m "fix(auth): explain the change"
```

A commit without a `Signed-off-by:` line fails the DCO check.

## Changesets

Every user-visible change needs a changeset that describes it for the release notes:

```sh
pnpm changeset
```

Documentation-only and test-only changes do not need one.

## Code style

- TypeScript in strict mode; no `any`.
- Formatting and lint rules are enforced by the configuration in this repository; run `pnpm lint --fix` before you
  push.
- No emojis in code, comments, commit messages or documentation.
- Conventional commit messages: `<type>(<scope>): <subject>`.

## Review

- One maintainer review is required.
- Changes to authentication, credentials or release workflows need two reviewers.
- Do not report security problems in issues or pull requests: see SECURITY.md.

## Code of conduct

Participation is governed by CODE_OF_CONDUCT.md.
