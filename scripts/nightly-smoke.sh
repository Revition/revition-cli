#!/usr/bin/env bash
# REVITION-CLI-PLAN T1.2.6 (:1319-1321, AC3 :1334, edge :1337): the nightly read-only smoke against staging, run by
# .github/workflows/nightly-contract.yml and by its $0 rehearsal (e2e/rehearsal/nightly.rehearsal.test.ts).
# - Read-only: doctor, whoami, apps list, docs sdk (REVITION_TOKEN is a cli:read PAT); no write and no paid call.
# - Staging unreachable = exit 9 (network class): retried, then reported as "platform unavailable", never as a CLI
#   regression (exit 0 with unavailable=1). Any other non-zero exit is a failure (exit 1).
# Env: REVITION_CLI_BIN (default packages/cli/bin/run), NIGHTLY_RETRY_SECONDS (default 60), NIGHTLY_OUT_DIR (default .).
set -u
bin="${REVITION_CLI_BIN:-packages/cli/bin/run}"
pause="${NIGHTLY_RETRY_SECONDS:-60}"
out="${NIGHTLY_OUT_DIR:-.}"
fail=0
unavailable=0
for cmd in "doctor" "whoami" "apps list" "docs sdk"; do
  name="${cmd// /-}"
  code=9
  for attempt in 1 2 3; do
    # shellcheck disable=SC2086 # the command words are meant to split
    node "$bin" $cmd --json > "$out/out-$name.json" 2> "$out/err-$name.txt" && code=0 || code=$?
    [ "$code" != "9" ] && break
    [ "$attempt" != "3" ] && sleep "$pause"
  done
  echo "$cmd -> exit $code (attempts $attempt)"
  if [ "$code" = "9" ]; then unavailable=1; elif [ "$code" != "0" ]; then fail=1; fi
done
echo "unavailable=$unavailable"
echo "failed=$fail"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "unavailable=$unavailable" >> "$GITHUB_OUTPUT"
  echo "failed=$fail" >> "$GITHUB_OUTPUT"
fi
[ "$fail" = "0" ]
