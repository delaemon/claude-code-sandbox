#!/usr/bin/env bash
# Check that the failure ledger is not fiction.
#
# docs/LEDGER.md pairs each failure this harness has had with the executable
# check that now catches it. The value of that table depends entirely on the
# checks being real, so this verifies every one: a path must exist, and an
# assertion label must appear in a file that actually runs assertions.
#
# That last set used to be one file, scripts/doctor.sh. It stopped being true
# the moment assertions were written anywhere else -- the eval runner's
# self-test and the application's browser gate both print labelled checks --
# and a real, running assertion named in the ledger was reported as fiction.
# The set is derived below rather than listed, including the application's own
# smoke command, which the harness learns from harness.config.json like
# everything else project-specific.
#
# It also reports the reverse — a row with no check at all. Those are not
# failures: they are the honest count of what is still only written down. The
# number is printed so it cannot drift upward unnoticed.
#
# Usage:  bash scripts/ledger.sh
# Exit 0 when every named check exists, 1 when one does not.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

ledger=docs/LEDGER.md
[ -r "$ledger" ] || { echo "No $ledger to check." >&2; exit 1; }

# Every file that carries labelled assertions. Derived, not listed: a hand
# maintained list is the thing that went stale and turned a working check into
# a ledger row reading as fiction.
. "$(dirname "$0")/app-config.sh"
checkers=()
for f in scripts/*.sh scripts/*.mjs evals/run.sh .claude/hooks/*; do
  [ -f "$f" ] && checkers+=("$f")
done
# The application's own check command, wherever harness.config.json points.
if [ -n "$APP_DIR" ] && [ -n "$APP_SMOKE" ]; then
  for word in $APP_SMOKE; do
    [ -f "$APP_DIR/$word" ] && checkers+=("$APP_DIR/$word")
  done
fi
if [ ${#checkers[@]} -eq 0 ]; then
  echo "No check scripts found to search. Refusing to report every row as fiction." >&2
  exit 2
fi

rows=0; open=0; missing=0

while IFS='|' read -r _ num failure check _rest; do
  num=$(echo "$num" | xargs); check=$(echo "$check" | xargs)
  # Table rows only: a numeric first cell.
  case "$num" in ''|*[!0-9]*) continue ;; esac
  rows=$((rows + 1))

  if [ "$check" = "-" ]; then
    open=$((open + 1))
    printf '  open  %s. %s\n' "$num" "$(echo "$failure" | xargs | cut -c1-64)"
    continue
  fi

  # Strip the backticks the table uses for both kinds of reference.
  bare=${check//\`/}
  if [ -e "$bare" ]; then
    printf '  ok    %s. %s\n' "$num" "$bare"
  else
    # Match the label text anywhere in the checking files rather than requiring
    # the surrounding quotes. Labels are built with variables in them --
    # ok "agent $name has name and description" -- so a quote-anchored match
    # finds nothing and reports a real check as missing. That is the third time
    # in this harness that an assertion has searched for a value using its
    # spelling from before the code transformed it.
    # Comments are stripped first. Widening the search immediately made this
    # file credit itself: the paragraph above explains the quote-anchoring
    # mistake by quoting a real label, so grepping raw text found that label in
    # its own commentary and reported the check as present after it had been
    # renamed away in doctor.sh. The eval suite caught it on the first run --
    # a check finding its evidence in its own prose is row 16 all over again.
    #
    # grep reads a process substitution rather than a pipe. With `pipefail` on,
    # `sed file | grep -q` takes the *worst* status in the pipeline, and grep -q
    # exits the instant it matches -- which kills sed with SIGPIPE mid-file and
    # turns a successful match into a failing pipeline. It only bit labels that
    # matched early in a long file, so most rows stayed green and two real,
    # running checks were reported as not existing.
    found=""
    for f in "${checkers[@]}"; do
      if grep -qF "$bare" <(sed -e 's|//.*$||' -e 's|#.*$||' "$f" 2>/dev/null); then
        found=$f; break
      fi
    done
    if [ -n "$found" ]; then
      printf '  ok    %s. %s: %s\n' "$num" "$found" "$bare"
    else
      printf '  FAIL  %s. no such check: %s\n' "$num" "$bare"
      missing=$((missing + 1))
    fi
  fi
done < "$ledger"

echo
printf 'ledger: %d rows, %d closed, %d open, %d naming a check that does not exist\n' \
  "$rows" "$((rows - open))" "$open" "$missing"

[ "$missing" -eq 0 ] || {
  echo "A ledger row names a check that is not there. Either the check was" >&2
  echo "removed and the failure can happen again, or the row was never true." >&2
  exit 1
}
