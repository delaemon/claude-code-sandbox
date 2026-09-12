#!/usr/bin/env bash
# SubagentStop hook. Body in record-subagent.mjs; see the note there about why
# the schema is recorded rather than assumed.
#
# Exits 0 on every path. SubagentStop supports blocking, and a harness that
# cannot finish a subagent because its audit log failed is a worse outcome than
# an unrecorded run.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" 2>/dev/null || exit 0
[ -d audit_log ] || exit 0
command -v node >/dev/null 2>&1 || exit 0
node "$(dirname "$0")/record-subagent.mjs" 2>/dev/null
exit 0
