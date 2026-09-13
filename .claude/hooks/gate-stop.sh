#!/usr/bin/env bash
# Stop hook: run the fast gates and hand the next turn a work order.
#
# The wrapper exists for the same reason log-usage.sh has one: the body is a
# module rather than a `node -e` string. Inlining it put the program inside
# shell single quotes, where one apostrophe in a comment ended the string and
# broke the hook -- three separate times, silently, because a failing Stop hook
# is non-blocking and simply does nothing. In a file it can be checked, and
# doctor.sh runs `node --check` over every .mjs in this directory.
#
# **Exits 0 on every path.** A Stop hook that exited non-zero could stop a
# session from ever finishing, which is far worse than a missing verdict. It is
# heard through stdout JSON -- additionalContext -- not through exit 2. Ledger
# row 8 is the turn-by-turn cost of believing otherwise.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" 2>/dev/null || exit 0
command -v node >/dev/null 2>&1 || exit 0
[ -f scripts/autopilot.mjs ] || exit 0

node "$(dirname "$0")/gate-stop.mjs" 2>/dev/null

exit 0
