---
"@revition/cli-core": patch
---

Output over 64 KB is no longer cut short: redaction of stdout, stderr, the pager and `--json` covers the whole text
(a large `--json` document was truncated and stopped parsing). Only debug-log bodies are still truncated before they
are redacted.
