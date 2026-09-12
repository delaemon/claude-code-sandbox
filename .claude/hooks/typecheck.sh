#!/usr/bin/env bash
# PostToolUse hook: typecheck puyopuyo/ after an edit to one of its .ts files.
#
# Reads the tool call as JSON on stdin. Exit 2 is load-bearing: stderr from a
# PostToolUse hook that exits 0 is discarded and never reaches Claude, so a
# failure reported any other way is a failure nobody sees.
#
# Parses with `node` rather than `python3`, so it behaves the same in a cloud
# session and in the dev container. Unlike block-secrets.sh this may fail open —
# it is an advisory check, and an environment with no node cannot run tsc to
# begin with.
set -uo pipefail

project_dir="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

command -v node >/dev/null 2>&1 || exit 0

path=$(node -e '
  let s = "";
  process.stdin.on("data", d => (s += d));
  process.stdin.on("end", () => {
    try {
      process.stdout.write(String(JSON.parse(s)?.tool_input?.file_path ?? ""));
    } catch {
      process.stdout.write("");
    }
  });
' 2>/dev/null) || exit 0

# Only .ts files inside puyopuyo/ are our business. Paths may be absolute or
# project-relative.
rel="${path#"$project_dir"/}"
case "$rel" in
  puyopuyo/*.ts) ;;
  *) exit 0 ;;
esac

# Never block work before the project is installable or installed.
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
