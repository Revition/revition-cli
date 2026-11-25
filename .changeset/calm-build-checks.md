---
"@revition/plugin-dev": minor
"@revition/cli-core": minor
---

New `revition build`: the platform's project layout rules run locally first (an oversized or broken project is
refused before anything is sent), then the platform's own checks; exit 6 when anything fails, `--strict` fails on
warnings, and `--json` lists every check with its schema id. Commands can now end with data and a non-zero exit.
