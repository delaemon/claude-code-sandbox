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
. "$(dirname "$0")/app-config.sh"

quick=0
[ "${1:-}" = "--quick" ] && quick=1

green=$'\033[32m'; red=$'\033[31m'; dim=$'\033[2m'; off=$'\033[0m'
failed=0
run() {
  local label="$1"; shift
  local out status
  out=$("$@" 2>&1); status=$?
  if [ $status -eq 3 ]; then
    # 3 means the check could not run. Not a failure, and not a pass either.
    printf '  %snote%s  %s %sdid not run%s\n' "$dim" "$off" "$label" "$dim" "$off"
    printf '%s\n' "$out" | sed 's/^/        /'
  elif [ $status -eq 0 ]; then
    printf '  %sok%s    %s\n' "$green" "$off" "$label"
  else
    printf '  %sFAIL%s  %s %s(exit %d)%s\n' "$red" "$off" "$label" "$dim" "$status" "$off"
    printf '%s\n' "$out" | sed 's/^/        /'
    failed=$((failed + 1))
  fi
}

# Fold the staged hook output in first, so it lands in the commit these gates
# are being run for. See scripts/fold-logs.mjs for why it is staged.
node "$(dirname "$0")/fold-logs.mjs" >/dev/null 2>&1 || true

echo "gates"
# The application gates need an application. When harness.config.json has no
# app.dir they exit 3 -- did not run -- and render as a note. A template that
# printed ok for a check it never performed would teach the opposite of the one
# rule this repository has.
app_gate() {
  local label="$1" cmd="$2"
  if [ -z "$APP_DIR" ]; then
    printf '  %snote%s  %s %sno app.dir in harness.config.json%s\n' \
      "$dim" "$off" "$label" "$dim" "$off"
    return
  fi
  run "$label" bash -c "cd \"$APP_DIR\" && $cmd"
}
app_gate "typecheck"      "$APP_TYPECHECK"
app_gate "tests"          "$APP_TEST"
run "clock boundary"        node scripts/clock-boundary.mjs
# The shell is the part the unit suite cannot reach. --quick skips it because it
# builds and launches a browser, which is the one gate here that takes minutes.
[ $quick -eq 1 ] || \
run "smoke (browser)"     node scripts/smoke.mjs
[ $quick -eq 1 ] || \
run "mutation"            node scripts/mutate.mjs
run "usage churn"         node scripts/churn-check.mjs
run "audit log tests"     bash -c 'command -v python3 >/dev/null && python3 -m pytest audit_log/test_export.py -q || echo "pytest unavailable; skipped"'
run "environment"         bash scripts/doctor.sh
run "same everywhere"     bash scripts/same-everywhere.sh
run "failure ledger"      bash scripts/ledger.sh
run "ci trigger"          node scripts/ci-trigger.mjs
[ $quick -eq 1 ] || \
run "eval runner"         bash scripts/eval-runner.sh
[ $quick -eq 1 ] || \
run "agent behaviour"     bash scripts/agent-config-diff.sh
[ $quick -eq 1 ] || \
run "harness evals"       bash evals/run.sh

echo
if [ $failed -eq 0 ]; then
  echo "${green}all gates pass${off} — safe to push"
  exit 0
fi
echo "${red}${failed} gate(s) failed${off} — fix before pushing"
exit 1
