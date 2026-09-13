# A bug in the shell that no unit test can reach.
#
# This replays two rows at once, because they are one failure seen twice.
#
# Row 33: the clock boundary makes the core testable by pushing everything
# untestable into main.ts. Nothing then opened main.ts. Fifty-two green tests
# sat beside a fresh ten-mine game reporting `0` mines remaining, and the only
# thing that ever noticed was a browser.
#
# Row 32: the browser gate rebuilt only when dist/ was missing, so it drove
# whatever bundle happened to be lying there. It is caught here for free --
# `setup` leaves a *correct* dist/ in place and the break touches only the
# source. A gate that reuses that build passes, which is the regression.
#
# The break is the original bug, restored exactly: the mine readout taken from
# a board whose mines are not laid until the first click.
LEDGER_ROW=33
CHECK='node scripts/smoke.mjs'
setup() {
  # A good build, left where a gate that reuses one would find it.
  (cd app && npm run build) >/dev/null 2>&1
}
break_it() {
  sed -i 's/remainingAgainst(level.mines, game)/remainingAgainst(game.mines, game)/' \
    app/src/main.ts
}
