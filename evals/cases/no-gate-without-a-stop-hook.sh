# Only one of the three engines can run something on every turn, so under the other two nothing ran the gates automatically at all — and the repository said nothing about it
#
# Written by scripts/learn.mjs, which ran this case before the row was kept:
# the check had to pass against an unbroken copy and fail against a broken one.
# A row whose case does not catch is not written at all.
LEDGER_ROW=46
CHECK='bash scripts/doctor.sh'
break_it() {
  rm -f githooks/pre-commit
  [ -e githooks/pre-commit ] && exit 1 || true
}
