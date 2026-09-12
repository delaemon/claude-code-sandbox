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

# audit_log/test_export.py is the only Python left here. Python is optional in
# this repository — nothing else needs it and the hooks deliberately do not — so
# a host without it is not a problem worth shouting about, and this stays quiet
# rather than failing the session start.
if command -v python3 >/dev/null 2>&1; then
  if ! python3 -c 'import pytest' 2>/dev/null; then
    python3 -m pip install --quiet --disable-pip-version-check pytest 2>/dev/null \
      && echo "audit_log: pytest ok" \
      || echo "audit_log: no pytest — 'pip install pytest' to run its tests"
  fi
else
  echo "audit_log: no python3 — its tests are unavailable here; everything else works"
fi
