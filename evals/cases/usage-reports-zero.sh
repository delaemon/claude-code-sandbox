# The hook writes a row for a session it could not measure, so an unmeasured
# session and one that cost nothing become indistinguishable in the log.
LEDGER_ROW=7
CHECK='bash scripts/doctor.sh'
break_it() {
  sed -i 's|^  if (calls === 0) return;|  // weakened|' .claude/hooks/log-usage.mjs
}
