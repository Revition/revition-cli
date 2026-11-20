---
"@revition/plugin-dev": minor
---

New observe-and-account commands: `revition runs list` (filters --ok / --failed / --since) and `revition logs` (one
run as the portal shows it, `--grep`, and `--follow` printing each new run once, NDJSON with --json);
`revition analytics` (a metric nobody records prints why, never a zero) and `revition audit`; `revition wallet show`
and `wallet open` (the balance from Mint; no payment data); `revition docs sdk|ui` (offline from the last copy),
`revition extension-points`, `revition changelog` and `revition open`. `eval run` and `branches eval` are marked as
quote-first paid commands.
