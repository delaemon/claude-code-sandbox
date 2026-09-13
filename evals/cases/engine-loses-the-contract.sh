# Three engines were claimed to read one contract, and each reached it by a different mechanism — so unwiring one (dropping `@AGENTS.md` from CLAUDE.md) left the other two reading it, CI green, and one line removed in a markdown file
#
# Written by scripts/learn.mjs, which ran this case before the row was kept:
# the check had to pass against an unbroken copy and fail against a broken one.
# A row whose case does not catch is not written at all.
LEDGER_ROW=44
CHECK='node scripts/agent-contract.mjs'
break_it() {
  sed -i '1{/^@AGENTS.md$/d}' CLAUDE.md
  head -1 CLAUDE.md | grep -q '^@AGENTS.md$' && exit 1 || true
}
