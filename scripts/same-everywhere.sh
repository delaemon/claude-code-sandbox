#!/usr/bin/env bash
# Does doctor.sh actually run the same checks everywhere?
#
# Three of its cases took their probe from whatever transcript happened to exist
# under $HOME/.claude/projects. CI has no such directory, so those cases were
# skipped there -- printing neither ok nor bad, leaving doctor.sh green with the
# guards they cover deleted. The eval suite noticed, from a different direction,
# and only because it replays the original failure.
#
# This compares the checks doctor.sh emits with $HOME as it is against the same
# list with $HOME empty. Any check that appears in one and not the other is a
# check that does not run somewhere, which is the failure this repository is
# built around.
#
# Usage:  bash scripts/same-everywhere.sh
# Exit 0 when both lists match, 1 when they differ, 2 when it could not compare.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

labels() { sed 's/\x1b\[[0-9;]*m//g' | grep -E '^  (ok|note|FAIL)' | sed 's/^  [a-zA-Z]*  *//' | sort; }

with=$(bash scripts/doctor.sh 2>/dev/null | labels)
empty_home=$(mktemp -d)
without=$(HOME="$empty_home" bash scripts/doctor.sh 2>/dev/null | labels)
rm -rf "$empty_home"

# A positive first: if neither list has anything, the comparison is vacuous and
# would otherwise report agreement. Two empty lists are equal.
if [ -z "$with" ] || [ -z "$without" ]; then
  echo "doctor.sh emitted no checks in one of the two runs — nothing to compare." >&2
  exit 2
fi

only_with=$(comm -23 <(printf '%s\n' "$with") <(printf '%s\n' "$without"))
only_without=$(comm -13 <(printf '%s\n' "$with") <(printf '%s\n' "$without"))

if [ -z "$only_with" ] && [ -z "$only_without" ]; then
  echo "doctor.sh runs the same $(printf '%s\n' "$with" | wc -l | tr -d ' ') checks with and without a home directory"
  exit 0
fi

echo "doctor.sh does not run the same checks everywhere:" >&2
[ -n "$only_with" ] && printf '%s\n' "$only_with" | sed 's/^/  skipped without $HOME: /' >&2
[ -n "$only_without" ] && printf '%s\n' "$only_without" | sed 's/^/  only without $HOME: /' >&2
exit 1
