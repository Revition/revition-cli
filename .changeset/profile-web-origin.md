---
"@revition/cli-core": patch
"@revition/cli": patch
"@revition/plugin-dev": patch
"@revition/plugin-agents": patch
---

Every web link the CLI prints or opens now follows the profile: a profile can set `webOrigin` (for example `https://staging.revition.com`), and its portal and platform links use it; without it, links stay on the production hosts. The update notice no longer offers an older canary build, and `revition doctor` reports and checks the channel the build came from.
