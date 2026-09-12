#!/usr/bin/env bash
# SessionStart hook: make the repo usable in a fresh (e.g. Claude Code on the
# web) container, so the first thing a session does is not an install.
#
# Nothing here is deferred. puyopuyo's three dev dependencies install in about
# two seconds, which is cheap enough to pay on every fresh container rather than
# leaving a session to discover it needs them.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

if [ -d puyopuyo/node_modules ]; then
  echo "puyopuyo: deps already present"
elif [ -f puyopuyo/package-lock.json ]; then
  echo "puyopuyo: installing deps ..."
  if (cd puyopuyo && npm ci --no-audit --no-fund >/dev/null 2>&1); then
    echo "puyopuyo: ok"
  else
    echo "puyopuyo: FAILED — run 'cd puyopuyo && npm ci' by hand"
  fi
fi

# audit_log/test_export.py is the only Python left here, so pytest is installed
# as a single package rather than from a requirements file.
if ! python3 -c 'import pytest' 2>/dev/null; then
  if python3 -m pip install --quiet --disable-pip-version-check pytest 2>/dev/null; then
    echo "audit_log: pytest ok"
  else
    echo "audit_log: pytest install FAILED — 'pip install pytest' to run its tests"
  fi
fi
