#!/usr/bin/env bash
# SessionStart: make a fresh checkout usable immediately.
#
# Installs the application's dependencies, if an application is configured.
# Nothing here is deferred: a session that has to wait for an install before it
# can run the tests is a session that skips running them.
#
# Also reports the branch state, because committing on a branch whose pull
# request has already merged is a mistake this harness has actually made, and
# scripts/branch-state.sh is the thing that notices.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" 2>/dev/null || exit 0
. scripts/app-config.sh 2>/dev/null || true

if [ -z "$APP_DIR" ]; then
  echo "harness: no app.dir in harness.config.json — application gates will not run"
elif [ -d "$APP_DIR/node_modules" ]; then
  echo "$APP_DIR: deps already present"
elif [ -n "$APP_INSTALL" ]; then
  echo "$APP_DIR: installing deps ..."
  if (cd "$APP_DIR" && eval "$APP_INSTALL" --no-audit --no-fund >/dev/null 2>&1) \
     || (cd "$APP_DIR" && eval "$APP_INSTALL" >/dev/null 2>&1); then
    echo "$APP_DIR: ok"
  else
    echo "$APP_DIR: FAILED — run '(cd $APP_DIR && $APP_INSTALL)' by hand"
  fi
fi

state=$(bash scripts/branch-state.sh --fetch 2>/dev/null)
case $? in
  1) echo "branch: $state" ;;
  2) echo "branch: STOP — $state" ;;
esac
exit 0
