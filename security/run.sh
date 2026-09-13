#!/usr/bin/env sh
# security/run.sh -- the one verdict for the arena. Runs the unit suite and the
# adversary-vs-container demo; non-zero if the container ever loses. Depends on
# node and POSIX sh only (AGENTS.md: no third runtime, nothing an engine
# provides). node:test is built in -- no install step.
set -eu
here="$(CDPATH= cd "$(dirname "$0")" && pwd)"

echo "== unit suite =="
# A directory arg is read as a module by this node; name the files explicitly.
node --test "$here"/*.test.mjs

echo
echo "== arena (inert adversary vs container) =="
node "$here/arena.mjs"
