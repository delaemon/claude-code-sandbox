# doctor.sh drives gates.sh against a fixture to test the runner, and those runs landed in the real gate record — the tests gate showed nine failures that were a fixture failing on purpose, and yield.mjs read them as a gate catching something
#
# Written by scripts/learn.mjs, which ran this case before the row was kept:
# the check had to pass against an unbroken copy and fail against a broken one.
# A row whose case does not catch is not written at all.
LEDGER_ROW=50
CHECK='bash scripts/doctor.sh'
break_it() {
  sed -i '/if (process.env.HARNESS_CONFIG && !process.env.AUDIT_DIR) process.exit(0);/d' scripts/record-gates.mjs
}
