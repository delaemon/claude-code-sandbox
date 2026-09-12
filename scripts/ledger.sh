#!/usr/bin/env bash
# Check that the failure ledger is not fiction.
#
# docs/LEDGER.md pairs each failure this harness has had with the executable
# check that now catches it. The value of that table depends entirely on the
# checks being real, so this verifies every one: a `doctor.sh` assertion label
# must appear in doctor.sh, and a path must exist.
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
  # Match the label text anywhere in doctor.sh rather than requiring the
  # surrounding quotes. Labels are built with variables in them --
  # ok "agent $name has name and description" -- so a quote-anchored match finds
  # nothing and reports a real check as missing. That is the third time in this
  # harness that an assertion has searched for a value using its spelling from
  # before the code transformed it.
  elif grep -qF "$bare" scripts/doctor.sh 2>/dev/null; then
    printf '  ok    %s. doctor.sh: %s\n' "$num" "$bare"
  else
    printf '  FAIL  %s. no such check: %s\n' "$num" "$bare"
    missing=$((missing + 1))
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
