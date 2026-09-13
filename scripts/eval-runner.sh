#!/usr/bin/env bash
# Does the eval suite tell its own outcomes apart?
#
# `evals/run.sh` is what makes the failure ledger honest: every other check in
# this repository is replayed by it. Nothing replayed the runner. It was
# untested code deciding whether tested code is trustworthy, which is the
# arrangement this repository exists to refuse.
#
# It cannot be checked by an eval case -- the runner refuses a CHECK that
# re-enters it, correctly, so this is the one guard that needs its own file.
#
# Four synthetic cases are put to it, each a way a case can prove nothing:
#
#   a check that reports did-not-run   exit 3 before the break. The gate is
#                                      fine; the case has not arranged what it
#                                      needs. Reported as "already failing"
#                                      once, which sent a session hunting for a
#                                      bug in a working gate.
#   a check that never fails           the vacuous case: nothing the break does
#                                      makes it complain.
#   a break that disables the check    exit 3 *after* the break. Any non-zero
#                                      exit used to count as caught, and 3 is
#                                      exactly what a guard that has been
#                                      switched off reports. A break that turns
#                                      the alarm off is not a break it caught.
#   a real catch                       the positive. Without it this script
#                                      would pass against a runner that failed
#                                      everything, which is the same vacuous
#                                      shape as the cases it is testing for.
#
# Usage:  bash scripts/eval-runner.sh
# Exit 0 when all four are reported correctly, 1 when one is not, 2 when this
# could not look.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

green=$'\033[32m'; red=$'\033[31m'; off=$'\033[0m'
bad=0
ok()  { printf '  %sok%s    %s\n' "$green" "$off" "$1"; }
err() { printf '  %sFAIL%s  %s\n' "$red" "$off" "$1"; bad=$((bad + 1)); }

[ -x evals/run.sh ] || [ -r evals/run.sh ] || { echo "No evals/run.sh to test." >&2; exit 2; }

cases=$(mktemp -d)
trap 'rm -rf "$cases"' EXIT

# Every synthetic case names a ledger row that exists, because the runner
# checks that too and a case rejected for a missing row would never reach the
# behaviour under test here.
row=$(grep -oE '^\| [0-9]+ \|' docs/LEDGER.md | head -1 | tr -dc '0-9')
[ -n "$row" ] || { echo "docs/LEDGER.md has no numbered rows to borrow." >&2; exit 2; }

cat > "$cases/unconfigured.sh" <<EOF
LEDGER_ROW=$row
CHECK='node -e "process.exit(3)"'
break_it() { :; }
EOF

cat > "$cases/vacuous.sh" <<EOF
LEDGER_ROW=$row
CHECK='true'
break_it() { :; }
EOF

cat > "$cases/disables.sh" <<EOF
LEDGER_ROW=$row
CHECK='node -e "process.exit(require(\"fs\").existsSync(\"EVAL-SELFTEST-BROKEN\") ? 3 : 0)"'
break_it() { touch EVAL-SELFTEST-BROKEN; }
EOF

cat > "$cases/genuine.sh" <<EOF
LEDGER_ROW=$row
CHECK='node -e "process.exit(require(\"fs\").existsSync(\"EVAL-SELFTEST-BROKEN\") ? 1 : 0)"'
break_it() { touch EVAL-SELFTEST-BROKEN; }
EOF

# Colour is stripped before matching. A runner's own output is coloured when it
# believes a terminal is watching and plain when piped, and this repository has
# already shipped an assertion that read a value in the spelling it had before
# something transformed it -- five times, by the ledger's count.
run_case() {
  EVAL_CASES_DIR="$cases" bash evals/run.sh "$1" 2>&1 | sed 's/\x1b\[[0-9;]*m//g'
}

# The positive first. If the runner cannot report a genuine catch, every
# negative below is met for the wrong reason and this script would pass against
# a runner that is simply broken.
out=$(run_case genuine)
if printf '%s' "$out" | grep -q '^  ok  *genuine'; then
  ok "a genuine catch is reported as caught"
else
  err "the runner did not report a genuine catch — every case below proves nothing"
  printf '%s\n' "$out" | sed 's/^/        /'
  # Stop here rather than report three passes earned by a runner that fails
  # everything it is given.
  echo
  echo "eval runner self-test: could not establish a positive." >&2
  exit 1
fi

out=$(run_case unconfigured)
if printf '%s' "$out" | grep -qi 'did-not-run'; then
  ok "a check reporting did-not-run is named as that, not as failing"
else
  err "exit 3 before the break is not distinguished from a failing check"
  printf '%s\n' "$out" | sed 's/^/        /'
fi

out=$(run_case vacuous)
if printf '%s' "$out" | grep -q 'is not$\|says this is caught'; then
  ok "a check that never fails is reported as not caught"
else
  err "a check that cannot fail was reported as catching something"
  printf '%s\n' "$out" | sed 's/^/        /'
fi

out=$(run_case disables)
if printf '%s' "$out" | grep -q 'stop running'; then
  ok "a break that only switches the check off is refused"
else
  err "a break that made the check exit 3 counted as a catch"
  printf '%s\n' "$out" | sed 's/^/        /'
fi

echo
if [ "$bad" -eq 0 ]; then
  echo "eval runner tells its four outcomes apart"
  exit 0
fi
echo "The eval suite cannot be trusted to report what it found." >&2
exit 1
