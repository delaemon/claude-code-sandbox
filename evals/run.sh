#!/usr/bin/env bash
# Replay the failures docs/LEDGER.md says are caught, and check they still are.
#
# Each case runs in its own clone of the working tree, including uncommitted
# changes, because the point is to test the harness as it is right now. Nothing
# here touches the real checkout: an earlier session damaged its own working
# tree doing exactly this by hand.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
repo=$PWD
filter="${1:-}"

green=$'\033[32m'; red=$'\033[31m'; dim=$'\033[2m'; off=$'\033[0m'
pass=0; fail=0

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

for case_file in evals/cases/*.sh; do
  [ -e "$case_file" ] || break
  name=$(basename "$case_file" .sh)
  [ -z "$filter" ] || case "$name" in *"$filter"*) ;; *) continue ;; esac

  clone="$work/$name"
  # A copy rather than `git clone`: uncommitted work must be under test too.
  # .git stays -- agent-config-diff.sh compares against the base branch, and
  # without it the case tested nothing. The first run of this suite reported
  # that case as NOT CAUGHT, which was true of the suite before it was true of
  # the gate.
  cp -a "$repo" "$clone" 2>/dev/null

  unset -f break_it 2>/dev/null || true
  CHECK=""; LEDGER_ROW=""
  # shellcheck disable=SC1090
  . "$case_file"

  # evals/ stays in the copy: docs/LEDGER.md now names evals/run.sh as the check
  # for a row, and deleting it made ledger.sh fail before any break, which the
  # runner correctly reported as a case proving nothing. Recursion is refused
  # here instead, which is what the deletion was really guarding against.
  case "$CHECK" in
    *evals/run.sh*|*gates.sh*)
      printf '  %sFAIL%s  %-34s CHECK would re-enter the eval suite\n' "$red" "$off" "$name"
      fail=$((fail + 1)); continue ;;
  esac

  if [ -z "$CHECK" ] || ! declare -F break_it >/dev/null; then
    printf '  %sFAIL%s  %-34s case defines no CHECK or no break_it\n' "$red" "$off" "$name"
    fail=$((fail + 1)); continue
  fi
  if ! grep -q "^| $LEDGER_ROW |" "$repo/docs/LEDGER.md"; then
    printf '  %sFAIL%s  %-34s no ledger row %s\n' "$red" "$off" "$name" "$LEDGER_ROW"
    fail=$((fail + 1)); continue
  fi

  # Before: the check must pass, or a "failure" after the break proves nothing.
  if ! ( cd "$clone" && eval "$CHECK" ) >/dev/null 2>&1; then
    printf '  %sFAIL%s  %-34s check already failing before the break\n' "$red" "$off" "$name"
    fail=$((fail + 1)); continue
  fi

  ( cd "$clone" && break_it ) >/dev/null 2>&1

  if ( cd "$clone" && eval "$CHECK" ) >/dev/null 2>&1; then
    printf '  %sFAIL%s  %-34s %sledger row %s says this is caught; it is not%s\n' \
      "$red" "$off" "$name" "$dim" "$LEDGER_ROW" "$off"
    fail=$((fail + 1))
  else
    printf '  %sok%s    %-34s %srow %s%s\n' "$green" "$off" "$name" "$dim" "$LEDGER_ROW" "$off"
    pass=$((pass + 1))
  fi
done

echo
if [ $((pass + fail)) -eq 0 ]; then
  echo "No cases ran. Refusing to report that as a pass." >&2
  exit 1
fi
printf '%d replayed, %d still caught, %d NOT caught\n' "$((pass + fail))" "$pass" "$fail"
[ $fail -eq 0 ] || exit 1
