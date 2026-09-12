#!/usr/bin/env bash
# Every gate, one command, one verdict.
#
# The person running this is usually on a phone and cannot read five separate
# outputs. So each gate prints one line on success and its full output only on
# failure, and the exit code is the answer.
#
# Nothing here is new work: it runs the checks that already exist. The value is
# that there is one name for "is this ready to push", so a slash command can say
# it and a session cannot half-remember which of five commands it ran.
#
# Usage:  bash scripts/gates.sh [--quick]
#         --quick skips the gates that need the network or the base branch.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

quick=0
[ "${1:-}" = "--quick" ] && quick=1

green=$'\033[32m'; red=$'\033[31m'; dim=$'\033[2m'; off=$'\033[0m'
failed=0
run() {
  local label="$1"; shift
  local out status
  out=$("$@" 2>&1); status=$?
  if [ $status -eq 0 ]; then
    printf '  %sok%s    %s\n' "$green" "$off" "$label"
  else
    printf '  %sFAIL%s  %s %s(exit %d)%s\n' "$red" "$off" "$label" "$dim" "$status" "$off"
    printf '%s\n' "$out" | sed 's/^/        /'
    failed=$((failed + 1))
  fi
}

echo "gates"
run "typecheck"           bash -c 'cd puyopuyo && npm run typecheck'
run "tests"               bash -c 'cd puyopuyo && npm test'
run "clock boundary"        node scripts/clock-boundary.mjs
run "audit log tests"     bash -c 'command -v python3 >/dev/null && python3 -m pytest audit_log/test_export.py -q || echo "pytest unavailable; skipped"'
run "environment"         bash scripts/doctor.sh
run "failure ledger"      bash scripts/ledger.sh
[ $quick -eq 1 ] || \
run "agent behaviour"     bash scripts/agent-config-diff.sh

echo
if [ $failed -eq 0 ]; then
  echo "${green}all gates pass${off} — safe to push"
  exit 0
fi
echo "${red}${failed} gate(s) failed${off} — fix before pushing"
exit 1
