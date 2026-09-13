#!/usr/bin/env bash
# Replay the failures docs/LEDGER.md says are caught, and check they still are.
#
# Each case runs in its own copy of the working tree, including uncommitted
# changes, because the point is to test the harness as it is right now. Nothing
# here touches the real checkout: an earlier session damaged its own working
# tree doing exactly this by hand.
#
# Usage:  bash evals/run.sh [name-filter]
#         EVAL_CASES_DIR=dir  run a different set of cases (used to test this
#                             runner itself, which nothing else can do --
#                             a case whose CHECK is this script is refused)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
repo=$PWD
filter="${1:-}"
cases_dir="${EVAL_CASES_DIR:-evals/cases}"
. "$repo/scripts/app-config.sh"

green=$'\033[32m'; red=$'\033[31m'; dim=$'\033[2m'; off=$'\033[0m'
pass=0; fail=0

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# A copy rather than `git clone`: uncommitted work must be under test too. .git
# stays -- agent-config-diff.sh compares against the base branch, and without it
# the case tested nothing. The first run of this suite reported that case as NOT
# CAUGHT, which was true of the suite before it was true of the gate.
#
# node_modules is excluded and symlinked back instead. Copying it worked while
# this repository had no application; pointing the harness at one turned every
# case into a several-hundred-megabyte copy, which on a cloud session's fixed
# disk allowance is not slow but fatal -- and a suite that dies of ENOSPC
# reports nothing about the checks it was meant to replay.
clone_repo() {
  local dst="$1"
  mkdir -p "$dst"
  if ! ( cd "$repo" && tar -cf - --exclude=node_modules --exclude=dist \
                              --exclude=.vite --exclude=.pytest_cache . ) \
       | ( cd "$dst" && tar -xf - ) 2>/dev/null; then
    # No usable tar. Copy everything and prune afterwards rather than run
    # against a clone that is missing files: a case is only evidence if what it
    # breaks is what this repository actually ships.
    cp -a "$repo/." "$dst/" 2>/dev/null
    find "$dst" -name node_modules -type d -prune -exec rm -rf {} + 2>/dev/null
  fi
  if [ -n "$APP_DIR" ] && [ -d "$repo/$APP_DIR/node_modules" ]; then
    ln -s "$repo/$APP_DIR/node_modules" "$dst/$APP_DIR/node_modules" 2>/dev/null
  fi
  # A positive assertion on the copy itself. Without it a clone that came out
  # empty makes every check fail after the break -- and every case would report
  # `ok`, the suite cheerfully confirming a harness it never copied.
  [ -d "$dst/scripts" ] && [ -f "$dst/docs/LEDGER.md" ]
}

for case_file in "$cases_dir"/*.sh; do
  [ -e "$case_file" ] || break
  name=$(basename "$case_file" .sh)
  [ -z "$filter" ] || case "$name" in *"$filter"*) ;; *) continue ;; esac

  clone="$work/$name"
  if ! clone_repo "$clone"; then
    printf '  %sFAIL%s  %-34s could not copy the repository to test against\n' \
      "$red" "$off" "$name"
    fail=$((fail + 1)); continue
  fi

  unset -f break_it setup 2>/dev/null || true
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

  # Optional: put the clone into the state the check needs before measuring it.
  # Some checks need something the working tree does not carry -- a base ref for
  # a gate that reviews a pull request, a fixture for one that needs an
  # application. Without this the case could only arrange that inside break_it,
  # after the "must pass first" measurement had already been taken against a
  # check that could not run.
  if declare -F setup >/dev/null; then
    if ! ( cd "$clone" && setup ) >/dev/null 2>&1; then
      printf '  %sFAIL%s  %-34s setup failed\n' "$red" "$off" "$name"
      fail=$((fail + 1)); continue
    fi
  fi

  # Before: the check must pass, or a "failure" after the break proves nothing.
  ( cd "$clone" && eval "$CHECK" ) >/dev/null 2>&1
  before=$?
  if [ "$before" -eq 3 ]; then
    # Exit 3 is this harness's did-not-run, and it is not the same thing as a
    # check that failed. Reported as its own outcome because the fix is a
    # different one: the case has to arrange what the check needs, in `setup`.
    # Calling this "already failing" sent a session looking for a bug in a gate
    # that was working correctly and simply had no base ref to compare against.
    printf '  %sFAIL%s  %-34s %scheck reports did-not-run here; give the case a setup%s\n' \
      "$red" "$off" "$name" "$dim" "$off"
    fail=$((fail + 1)); continue
  fi
  if [ "$before" -ne 0 ]; then
    printf '  %sFAIL%s  %-34s check already failing before the break (exit %d)\n' \
      "$red" "$off" "$name" "$before"
    fail=$((fail + 1)); continue
  fi

  ( cd "$clone" && break_it ) >/dev/null 2>&1

  ( cd "$clone" && eval "$CHECK" ) >/dev/null 2>&1
  after=$?
  if [ "$after" -eq 0 ]; then
    printf '  %sFAIL%s  %-34s %sledger row %s says this is caught; it is not%s\n' \
      "$red" "$off" "$name" "$dim" "$LEDGER_ROW" "$off"
    fail=$((fail + 1))
  elif [ "$after" -eq 3 ]; then
    # The break stopped the check from running rather than making it fail. The
    # case looks caught and has proved nothing: a guard turned off reports 3
    # just as readily as one that was never configured.
    printf '  %sFAIL%s  %-34s %sthe break made the check stop running, not fail%s\n' \
      "$red" "$off" "$name" "$dim" "$off"
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
