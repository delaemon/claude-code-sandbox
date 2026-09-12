#!/usr/bin/env bash
# Stop hook: record what this session has spent, into audit_log/usage.md.
#
# The rule this enforces is "token usage is written alongside the logs", and it
# is a hook rather than a line in CLAUDE.md for the reason CLAUDE.md itself
# gives: that file is advisory and can be missed, a hook is executed by the
# harness. It therefore keeps holding after the session that added it ends, in
# any session that checks out this branch.
#
# It writes rather than nags. A Stop hook that exited 2 to demand the agent add
# a line could refuse to let a session finish, which is a far worse failure than
# a missing row — so this one never blocks: it exits 0 on every path.
#
# What it will not do is invent a row. If the transcript cannot be read or holds
# no usage records, the file is left exactly as it was; a session that was not
# measured must not appear as a session that cost nothing. Visibility for that
# case comes from scripts/doctor.sh, which runs this hook and checks it.
#
# The figures are ROUNDED, and that is the point rather than sloppiness. The
# first version wrote exact counts and a minute-precision timestamp, so the file
# changed on every single stop — a tracked file permanently dirty, and a
# "commit your changes" warning on every turn. Writing it precisely bought no
# durability either: an uncommitted row dies with the VM exactly like no row at
# all. Rounded, the file changes a handful of times per session, each change
# meaning the session crossed a real threshold. `scripts/usage.sh --line` is
# where exact live numbers come from.
#
# The granularity is set from a measured burn rate, not guessed: this session
# ran 3,000-32,000 tokens a turn, averaging ~10,000. A first attempt rounded
# output to 10,000, which output crosses every two or three turns, so the file
# still churned and the warning came back. At 500,000 a typical turn moves the
# file once in ~50 turns and the worst observed turn once in ~15. The separate
# output column is gone: it tracked the same work at a tenth of the scale, so it
# set the churn rate no matter what the token column did.
#
# node, not python3: the cloud image has python3 and a dev container need not.
#
# The body lives in log-usage.mjs. It used to be inlined in `node -e` here,
# which broke three times on the same thing: an apostrophe inside the single
# quotes ends the shell string and the hook stops being valid JavaScript. A
# failing Stop hook is non-blocking, so it simply did nothing and said nothing.
# doctor.sh now runs `node --check` on the module, which an inlined program
# could not be given.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" 2>/dev/null || exit 0
[ -d audit_log ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

node "$(dirname "$0")/log-usage.mjs" 2>/dev/null

exit 0
