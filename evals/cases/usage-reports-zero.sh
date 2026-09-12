# The hook records a session it could not measure, so an unmeasured session and
# one that cost nothing become indistinguishable in the log.
#
# The break targets readUsage returning null for a transcript with no usage
# records. An earlier version of this case edited a line that the hook no longer
# has, so it broke nothing and the suite reported the guard as missing -- which
# is the suite working, and is why the case is pinned to behaviour rather than
# to a line that happened to exist.
LEDGER_ROW=7
CHECK='bash scripts/doctor.sh'
break_it() {
  sed -i 's|return calls === 0 ? null : { calls, out, tokens, ctx };|return { calls, out, tokens, ctx };|' \
    .claude/hooks/log-usage.mjs
}
