#!/usr/bin/env bash
# SessionStart hook: make the repo runnable in a fresh (e.g. Claude Code on the web) container.
# Only the root pipeline's deps are installed here — they are small. f1map pulls in
# pandas/numpy/fastf1 and takes minutes, so it stays on-demand.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

if python3 -c 'import anthropic, pytest' 2>/dev/null; then
  echo "deps: already present"
else
  echo "deps: installing root requirements.txt ..."
  python3 -m pip install --quiet --disable-pip-version-check -r requirements.txt \
    && echo "deps: ok" \
    || echo "deps: FAILED — run 'pip install -r requirements.txt' by hand"
fi

echo "f1map deps are NOT installed automatically: cd f1map && pip install -r requirements.txt"
