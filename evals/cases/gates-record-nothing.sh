# Nothing recorded what each gate did, so seventeen checks could only grow: every failure added one, no run ever said which had caught anything, and a gate that had never bitten cost time on every run with nothing saying so
#
# Written by scripts/learn.mjs, which ran this case before the row was kept:
# the check had to pass against an unbroken copy and fail against a broken one.
# A row whose case does not catch is not written at all.
LEDGER_ROW=49
CHECK='bash scripts/doctor.sh'
break_it() {
  rm -f scripts/record-gates.mjs
}
