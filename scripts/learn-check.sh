#!/usr/bin/env bash
# Does scripts/learn.mjs actually refuse an unearned ledger row?
#
# learn.mjs exists so that "verified by breaking" is earned by running rather
# than typed. That promise is worth exactly as much as its refusal path, and a
# refusal path is the part of any tool least likely to be exercised -- it only
# runs when something is already going wrong.
#
# So it is exercised here, three ways, **in a throwaway copy**: learn.mjs edits
# docs/LEDGER.md and writes into evals/cases/, and a self-test that did that to
# the real tree would leave a row behind the first time it was interrupted.
#
#   a check that catches            the positive. Without it the two refusals
#                                   below are met by a tool that refuses
#                                   everything, which would pass this script
#                                   while being useless.
#   a break that damages nothing    the vacuous case: the check passes after the
#                                   break, so the row was never true.
#   a break that does not land      the sed matches nothing. This repository has
#                                   read a verdict without confirming the break
#                                   landed three separate times, and each time
#                                   believed a check was working.
#
# Usage:  bash scripts/learn-check.sh
# Exit 0 when all three are handled correctly, 1 when one is not, 2 when this
# could not look.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
repo=$PWD

green=$'\033[32m'; red=$'\033[31m'; off=$'\033[0m'
bad=0
ok()  { printf '  %sok%s    %s\n' "$green" "$off" "$1"; }
err() { printf '  %sFAIL%s  %s\n' "$red" "$off" "$1"; bad=$((bad + 1)); }

[ -r scripts/learn.mjs ] || { echo "No scripts/learn.mjs to test." >&2; exit 2; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

clone="$work/r"
mkdir -p "$clone"
if ! ( cd "$repo" && tar -cf - --exclude=node_modules --exclude=dist --exclude=.vite . ) \
     | ( cd "$clone" && tar -xf - ) 2>/dev/null; then
  echo "Could not copy the repository to test against." >&2
  exit 2
fi
[ -f "$clone/scripts/learn.mjs" ] && [ -f "$clone/docs/LEDGER.md" ] || {
  echo "The copy came out incomplete. Refusing to report a pass from it." >&2
  exit 2
}
[ -d "$repo/app/node_modules" ] && ln -s "$repo/app/node_modules" "$clone/app/node_modules" 2>/dev/null

rows() { grep -c '^| [0-9]' "$clone/docs/LEDGER.md" 2>/dev/null || echo 0; }

# Every attempt uses the same check, `ci-trigger.mjs`, so the three differ only
# in the break. That is the variable under test.
attempt() {
  local name="$1" breakage="$2"
  ( cd "$clone" && node scripts/learn.mjs \
      --name "$name" \
      --failure "A probe written by scripts/learn-check.sh" \
      --check "node scripts/ci-trigger.mjs" \
      --break "$breakage" ) >/dev/null 2>&1
  echo $?
}

before=$(rows)

# ── the positive ────────────────────────────────────────────────────────────
# A break the check really does catch: point the config at a branch ci.yml does
# not trigger on.
code=$(attempt learncheck-real \
  "node -e 'const f=require(\"fs\");const c=JSON.parse(f.readFileSync(\"harness.config.json\",\"utf8\"));c.git.baseBranch=\"nowhere\";f.writeFileSync(\"harness.config.json\",JSON.stringify(c,null,2))'")
after=$(rows)
if [ "$code" = "0" ] && [ "$after" -eq $((before + 1)) ] && [ -f "$clone/evals/cases/learncheck-real.sh" ]; then
  ok "a check that catches its break is written to the ledger"
else
  err "learn.mjs did not keep a row it should have (exit $code, rows $before to $after)"
  echo "        Every refusal below would then be met by a tool that refuses" >&2
  echo "        everything, so this stops here rather than claim three passes." >&2
  echo
  echo "learn.mjs self-test: could not establish a positive." >&2
  exit 1
fi

# ── a break that damages nothing ────────────────────────────────────────────
before=$(rows)
code=$(attempt learncheck-vacuous "true")
after=$(rows)
if [ "$code" = "1" ] && [ "$after" -eq "$before" ] && [ ! -f "$clone/evals/cases/learncheck-vacuous.sh" ]; then
  ok "a break the check does not notice is refused, and nothing is kept"
else
  err "a vacuous break was accepted (exit $code, rows $before to $after)"
fi

# ── a break that does not land ──────────────────────────────────────────────
before=$(rows)
code=$(attempt learncheck-noland "sed -i 's|not-present-in-this-file|x|' harness.config.json")
after=$(rows)
if [ "$code" = "1" ] && [ "$after" -eq "$before" ] && [ ! -f "$clone/evals/cases/learncheck-noland.sh" ]; then
  ok "a break that never landed is refused, and nothing is kept"
else
  err "a break that changed nothing was accepted (exit $code, rows $before to $after)"
fi

echo
if [ "$bad" -eq 0 ]; then
  echo "learn.mjs earns its rows"
  exit 0
fi
echo "An unearned ledger row can reach the table. The column is a claim again." >&2
exit 1
