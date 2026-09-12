#!/usr/bin/env bash
# PostToolUse hook: typecheck the puyopuyo/ TypeScript project after an edit to one of its .ts files.
# Reads the tool call as JSON on stdin. Exit 2 is load-bearing: stderr from a PostToolUse hook
# that exits 0 is never shown to Claude, so a failure has to exit 2 to be seen at all.
set -uo pipefail

project_dir="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

path=$(python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    print("")
    sys.exit(0)
print(data.get("tool_input", {}).get("file_path", "") or "")
' 2>/dev/null) || exit 0

# Only .ts files inside puyopuyo/ are our business. Paths may be absolute or project-relative.
rel="${path#"$project_dir"/}"
case "$rel" in
  puyopuyo/*.ts) ;;
  *) exit 0 ;;
esac

# Never block work before the project is installable/installed.
cd "$project_dir/puyopuyo" 2>/dev/null || exit 0
command -v npm >/dev/null 2>&1 || exit 0
[ -x node_modules/.bin/tsc ] || {
  echo "typecheck: skipped, puyopuyo/node_modules not installed yet (run: cd puyopuyo && npm ci)"
  exit 0
}

out=$(npm run typecheck --silent 2>&1)
status=$?
if [ "$status" -ne 0 ]; then
  echo "typecheck failed for $rel (npm run typecheck, cwd puyopuyo/):" >&2
  echo "$out" >&2
  exit 2
fi
exit 0
