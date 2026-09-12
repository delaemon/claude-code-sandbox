# A subagent definition with no description does not error. It silently never
# loads, and the session runs believing it has an agent it does not.
LEDGER_ROW=9
CHECK='bash scripts/doctor.sh'
break_it() {
  sed -i '0,/^description:/{/^description:/d}' .claude/agents/verifier.md
}
