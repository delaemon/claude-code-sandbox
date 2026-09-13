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
# Usage:  bash scripts/gates.sh [--quick|--fast] [--json] [--no-fold]
#
#   --fast     only the gates that answer in about two seconds. This is the
#              tier a Stop hook can afford on every turn. It is NOT a pass:
#              the gates it skipped are listed by name, because a subset that
#              printed "all gates pass" would be the exact failure this
#              repository exists to refuse.
#   --quick    skips the gates that need the network, a browser, or minutes.
#   --json     machine-readable results on stdout, for scripts/autopilot.mjs
#              and the Stop hook. Implies --no-fold.
#   --no-fold  do not fold staged hook output into the tracked logs.
#
# **--json exists because the alternative is parsing this file's own output**,
# and that output is coloured when a terminal is watching and plain when it is
# piped. Ledger row 23 is a check that read a runner's summary text and so
# killed every mutant on one machine and reported BROKEN on another. A caller
# that needs the results should be handed the results.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. "$(dirname "$0")/app-config.sh"

quick=0; fast=0; json=0; fold=1
for arg in "$@"; do
  case "$arg" in
    --quick)   quick=1 ;;
    --fast)    fast=1; quick=1 ;;
    --json)    json=1; fold=0 ;;
    --no-fold) fold=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

green=$'\033[32m'; red=$'\033[31m'; dim=$'\033[2m'; off=$'\033[0m'
failed=0
skipped=()

# Results are collected on disk rather than formatted as they go, so the same
# run can be rendered for a person or handed to a program without either being
# a re-implementation of the other.
outdir=$(mktemp -d)
trap 'rm -rf "$outdir"' EXIT
seq=0

record() {
  seq=$((seq + 1))
  local n; n=$(printf '%03d' "$seq")
  printf '%s\t%s\t%s\n' "$n" "$2" "$1" >> "$outdir/index"
  printf '%s' "$3" > "$outdir/$n.out"
}

say() { [ "$json" -eq 1 ] || printf '%b' "$1"; }

run() {
  local label="$1"; shift
  local out status
  out=$("$@" 2>&1); status=$?
  record "$label" "$status" "$out"
  if [ $status -eq 3 ]; then
    # 3 means the check could not run. Not a failure, and not a pass either.
    say "  ${dim}note${off}  $label ${dim}did not run${off}\n"
    say "$(printf '%s\n' "$out" | sed 's/^/        /')\n"
  elif [ $status -eq 0 ]; then
    say "  ${green}ok${off}    $label\n"
  else
    say "  ${red}FAIL${off}  $label ${dim}(exit $status)${off}\n"
    say "$(printf '%s\n' "$out" | sed 's/^/        /')\n"
    failed=$((failed + 1))
  fi
}

# A gate that this tier does not run is named, never silently omitted.
skip() { skipped+=("$1"); }

# Fold the staged hook output in first, so it lands in the commit these gates
# are being run for. See scripts/fold-logs.mjs for why it is staged.
#
# Not in --json or --fast: those are what the Stop hook runs, on every turn, and
# a hook that writes a tracked file every turn is ledger row 25 -- the loop that
# sustained itself for an hour at about a commit a minute.
[ "$fold" -eq 1 ] && { node "$(dirname "$0")/fold-logs.mjs" >/dev/null 2>&1 || true; }

say "gates\n"
# The application gates need an application. When harness.config.json has no
# app.dir they exit 3 -- did not run -- and render as a note. A template that
# printed ok for a check it never performed would teach the opposite of the one
# rule this repository has.
app_gate() {
  local label="$1" cmd="$2"
  if [ -z "$APP_DIR" ]; then
    say "  ${dim}note${off}  $label ${dim}no app.dir in harness.config.json${off}\n"
    record "$label" 3 "no app.dir in harness.config.json"
    return
  fi
  # The command's exit code is translated, never passed through.
  #
  # 0/1/2/3 is a contract between the scripts in this repository. An
  # application's build tool knows nothing about it: `tsc` exits 2 for "type
  # errors found", which this rendered as "could not look", and anything at all
  # exiting 3 rendered as "did not run" -- a note, not a failure. A test command
  # that blew up with exit 3 produced `note tests did not run` and `gates.sh`
  # exited 0. The suite died and the gates passed.
  #
  # So: zero is success, anything else is a failure of this gate. did-not-run is
  # a judgement the harness makes -- there is no app.dir -- and never one an
  # arbitrary command is allowed to make on its behalf.
  local out status
  out=$(bash -c "cd \"$APP_DIR\" && $cmd" 2>&1); status=$?
  [ $status -eq 0 ] || status=1
  run "$label" bash -c "printf '%s' \"\$1\" >&2; exit $status" _ "$out"
}

# ── the fast tier: what an edit can break, in a couple of seconds ────────────
app_gate "typecheck"      "$APP_TYPECHECK"
app_gate "tests"          "$APP_TEST"
run "clock boundary"      node scripts/clock-boundary.mjs
run "ci trigger"          node scripts/ci-trigger.mjs
run "agent contract"      node scripts/agent-contract.mjs
run "ci parity"           node scripts/ci-parity.mjs

# ── everything else ─────────────────────────────────────────────────────────
if [ $fast -eq 1 ]; then
  skip "smoke (browser)"; skip "mutation"; skip "usage churn"
  skip "audit log tests"; skip "environment"; skip "same everywhere"
  skip "failure ledger"; skip "eval runner"; skip "learn refuses"; skip "agent behaviour"
  skip "harness evals"
else
  # The shell is the part the unit suite cannot reach. --quick skips it because
  # it builds and launches a browser.
  if [ $quick -eq 1 ]; then skip "smoke (browser)"; else
    run "smoke (browser)"   node scripts/smoke.mjs
  fi
  if [ $quick -eq 1 ]; then skip "mutation"; else
    run "mutation"          node scripts/mutate.mjs
  fi
  run "usage churn"         node scripts/churn-check.mjs
  # `node --test`, not a shell conditional.
  #
  # This was `command -v python3 && python3 -m pytest ... || echo "skipped"`,
  # which is `A && B || C`: when python3 existed and pytest FAILED -- a missing
  # module, or a failing assertion -- the `||` branch ran and the whole command
  # exited 0. The gate printed `ok`. pytest was not installed on this machine,
  # so it had printed `ok` for a check that never ran, every time, while
  # doctor.sh correctly reported a note about it. The two disagreed and the one
  # deciding "safe to push" was the one that lied. Ledger row 47.
  #
  # node is required by the harness itself, so there is no unavailable case to
  # paper over: if node is missing, nothing here runs at all.
  run "audit log tests"     node --test audit_log/export.test.mjs
  run "environment"         bash scripts/doctor.sh
  run "same everywhere"     bash scripts/same-everywhere.sh
  run "failure ledger"      bash scripts/ledger.sh
  if [ $quick -eq 1 ]; then skip "eval runner"; skip "learn refuses"; skip "agent behaviour"; skip "harness evals"; else
    run "eval runner"       bash scripts/eval-runner.sh
    run "learn refuses"     bash scripts/learn-check.sh
    run "agent behaviour"   bash scripts/agent-config-diff.sh
    run "harness evals"     bash evals/run.sh
  fi
fi

for s in ${skipped+"${skipped[@]}"}; do
  record "$s" 4 "not run in this tier"
done

if [ "$json" -eq 1 ]; then
  node "$(dirname "$0")/gates-report.mjs" "$outdir"
  [ $failed -eq 0 ] || exit 1
  exit 0
fi

echo
if [ ${#skipped[@]} -gt 0 ]; then
  # Named, not silent. "all gates pass" after running four of fourteen is the
  # shape of failure this whole repository is built to refuse.
  printf '%snot run in this tier:%s %s\n' "$dim" "$off" "$(IFS=,; echo "${skipped[*]}" | sed 's/,/, /g')"
fi
if [ $failed -eq 0 ]; then
  if [ ${#skipped[@]} -gt 0 ]; then
    echo "${green}every gate in this tier passes${off} — run ${dim}bash scripts/gates.sh${off} for the rest"
  else
    echo "${green}all gates pass${off} — safe to push"
  fi
  exit 0
fi
echo "${red}${failed} gate(s) failed${off} — fix before pushing"
exit 1
