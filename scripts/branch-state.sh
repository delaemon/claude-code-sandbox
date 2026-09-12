#!/usr/bin/env bash
# Where this branch sits relative to the integration branch.
#
# One definition, two callers: scripts/doctor.sh reports it alongside the rest
# of the environment, and the SessionStart hook surfaces it at the moment it
# matters — before any work starts. Duplicating the rule in both is how they
# drift, and a rule that disagrees with itself is worse than no rule.
#
# Prints one line and exits:
#   0  fine (on the base, or not behind it, or nothing to compare against)
#   1  behind with commits of your own — the base moved, merge it in
#   2  behind with nothing of your own — every commit here is already in the
#      base, so this branch's PR is merged and the branch has to be re-cut
#
# Exit 2 is the case that bit this repository: a PR merged, work continued on
# the pre-merge tip, and the next commit belonged to no open PR. It was harmless
# only because the merge commit carried an identical tree.
#
# Usage: bash scripts/branch-state.sh [--fetch]
set -uo pipefail

cd "$(dirname "$0")/.." || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || { echo "not a git repository"; exit 0; }

base="${DOCTOR_BASE:-puyo-puyo-web}"

# The local ref goes stale the moment someone merges, which is exactly when this
# check matters, so callers that can afford the round trip pass --fetch.
if [ "${1:-}" = "--fetch" ]; then
  timeout 20 git fetch --quiet origin "$base" 2>/dev/null || true
fi

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [ "$branch" = "$base" ]; then
  echo "on $base, the integration branch"
  exit 0
fi

base_ref=""
for candidate in "FETCH_HEAD" "origin/$base" "$base"; do
  [ "$candidate" = "FETCH_HEAD" ] && [ "${1:-}" != "--fetch" ] && continue
  git rev-parse --verify --quiet "$candidate" >/dev/null 2>&1 && { base_ref="$candidate"; break; }
done

if [ -z "$base_ref" ]; then
  echo "no local ref for $base — cannot compare (normal in a CI checkout)"
  exit 0
fi

behind=$(git rev-list --count "HEAD..$base_ref" 2>/dev/null || echo 0)
ahead=$(git rev-list --count "$base_ref..HEAD" 2>/dev/null || echo 0)

if [ "$behind" -eq 0 ]; then
  echo "up to date with $base ($ahead ahead)"
  exit 0
fi

if [ "$ahead" -eq 0 ]; then
  echo "every commit on $branch is already in $base, which has moved $behind ahead — this branch's PR is merged and finished. Re-cut it: git fetch origin $base && git checkout -B $branch origin/$base"
  exit 2
fi

echo "$behind behind $base with $ahead of your own — bring the base in: git merge origin/$base"
exit 1
