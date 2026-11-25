---
"@revition/plugin-dev": minor
"@revition/cli-core": minor
---

New `revition apps` (list, view, create, scopes set with the permission diff before confirming, listing),
`revition apps keys` (list, create and rotate print the key once, revoke needs the typed key id or --yes) and
`revition secrets` (names only; values from stdin or a hidden prompt, never an argument; the first app secret shows
its cost first). Commands can show a preview before the confirmation.
