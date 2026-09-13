#!/usr/bin/env bash
# PostToolUse: typecheck the application after an edit inside it.
#
# **Exits 2 on a type error**, which is the only exit code that reaches Claude.
# Stderr from a hook exiting 0 is discarded, so a hook that merely printed the
# error would be a hook nobody reads.
#
# It exits 0 for paths outside the application and when dependencies are not
# installed, so it can never block work before the first install.
#
# node, not python3: the project may be anything, but node is what runs this
# harness. The hooks here once parsed with python3, which the cloud image has
# and a container need not, and on a host without it the secret guard exited 0
# and let .env through.
set -uo pipefail
payload=$(cat 2>/dev/null || true)
project_dir="${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
cd "$project_dir" 2>/dev/null || exit 0
. scripts/app-config.sh 2>/dev/null || true

[ -n "$APP_DIR" ] || exit 0
[ -n "$APP_TYPECHECK" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

file=$(printf '%s' "$payload" | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    try { process.stdout.write(JSON.parse(s).tool_input?.file_path ?? ""); } catch {}
  });' 2>/dev/null)
[ -n "$file" ] || exit 0

rel=${file#"$project_dir"/}
case "$rel" in
  "$APP_DIR"/*.ts|"$APP_DIR"/*.tsx) ;;
  *) exit 0 ;;
esac

cd "$project_dir/$APP_DIR" 2>/dev/null || exit 0
[ -d node_modules ] || {
  echo "typecheck: skipped, $APP_DIR/node_modules not installed yet"
  exit 0
}

if ! out=$(eval "$APP_TYPECHECK" 2>&1); then
  echo "typecheck failed for $rel ($APP_TYPECHECK, cwd $APP_DIR/):" >&2
  printf '%s\n' "$out" >&2
  exit 2
fi
exit 0
