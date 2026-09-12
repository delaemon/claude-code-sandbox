#!/usr/bin/env bash
# SessionStart hook: make the repo usable in a fresh (e.g. Claude Code on the
# web) container, so the first thing a session does is not an install.
#
# The version this replaces installed a root requirements.txt for a Python
# pipeline that no longer exists on this branch, and deliberately skipped the
# heavy deps of a second project that is also gone. puyopuyo/ is now the only
# application here and its three dev dependencies are cheap, so nothing is
# deferred: the install runs only when node_modules is absent.
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
