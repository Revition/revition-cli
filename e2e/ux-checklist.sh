#!/usr/bin/env bash
# REVITION-CLI-PLAN T2.5.2 AC3 (UA10; auditor ruling #580 (a)): the UX checklist in HUMAN mode (no --json). Every rendered
# output is saved under $UX_OUT for the review (docs/security/review-phase2.md "UX checklist"). $0: no paid route.
# Needs: REVITION_HOST, UX_TOKEN (cli:read, cli:write), UX_APP (the test app `init` links to), UX_OUT, CLI_ROOT.
set -u
OUT="$UX_OUT"
mkdir -p "$OUT"
BIN="$CLI_ROOT/packages/cli/bin/run"
WORK="$(mktemp -d)"
cd "$WORK" || exit 1
fails=0
# One checklist item: a name, the exit it must end with, a pattern its output must hold ('' = none), then the command.
item() {
  local name="$1" want="$2" needle="$3"
  shift 3
  "$@" > "$OUT/$name.txt" 2>&1 < /dev/null
  local got=$?
  local hit=yes
  if [ -n "$needle" ] && ! grep -qiE "$needle" "$OUT/$name.txt"; then hit=no; fi
  local r=FAIL
  if [ "$got" = "$want" ] && [ "$hit" = yes ]; then r=PASS; else fails=$((fails + 1)); fi
  echo "UX_CHECK $r $name exit=$got want=$want needle=${needle:-none} found=$hit" | tee -a "$OUT/checklist.txt"
}
login_with_token() { printf '%s' "$UX_TOKEN" | node "$BIN" login --with-token; }
item 01-version 0 'revition/cli' node "$BIN" --version
item 02-help 0 'USAGE|COMMANDS' node "$BIN" --help
item 03-init-help-examples 0 'EXAMPLES' node "$BIN" init --help
item 04-build-help-examples 0 'EXAMPLES' node "$BIN" build --help
item 05-error-with-hint 3 'revition login' node "$BIN" whoami
item 06-login-with-token 0 '' login_with_token
export REVITION_TOKEN="$UX_TOKEN"
item 07-whoami 0 '' node "$BIN" whoami
item 08-init 0 '' node "$BIN" init ux-tool --starter hello-tool --app "$UX_APP" --project new --yes
cd ux-tool || exit 1
item 09-build 0 '' node "$BIN" build
item 10-accessible-build 0 '' env NO_COLOR=1 REVITION_ACCESSIBLE=1 node "$BIN" build
item 11-apps-table 0 'dapp_' node "$BIN" apps list
item 12-docs-missing-arg-hint 2 'docs --help' node "$BIN" docs
item 12b-docs-sdk 0 '' node "$BIN" docs sdk
item 13-changelog 0 '' node "$BIN" changelog
unset REVITION_TOKEN
item 14-logout 0 '' node "$BIN" logout
item 15-signed-out-hint 3 'revition login' node "$BIN" whoami
# The rendered outputs never carry the token, nor raw colour codes (the output is not a terminal).
if grep -rqF "$UX_TOKEN" "$OUT"; then echo "UX_CHECK FAIL token-leak" | tee -a "$OUT/checklist.txt"; fails=$((fails + 1)); fi
if grep -rq $'\x1b\[' "$OUT"; then echo "UX_CHECK FAIL colour-codes-off-terminal" | tee -a "$OUT/checklist.txt"; fails=$((fails + 1)); fi
echo "UX_CHECKLIST fails=$fails" | tee -a "$OUT/checklist.txt"
[ "$fails" = 0 ]
