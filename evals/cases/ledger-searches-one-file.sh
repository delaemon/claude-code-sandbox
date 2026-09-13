# The ledger credits checks it can find. It could only find them in one file.
#
# Assertion labels are printed by doctor.sh, by the eval runner's self-test and
# by the application's browser gate. ledger.sh searched doctor.sh and nothing
# else, so a row naming a label from either of the others was reported as
# naming a check that does not exist -- the table declaring its own working
# guards to be fiction, which is the direction it must never fail in.
#
# The break narrows the search back to doctor.sh alone. Row 34 names a label
# that lives in the application's smoke gate, so it then reads as missing.
LEDGER_ROW=35
CHECK='bash scripts/ledger.sh'
break_it() {
  sed -i 's|^for f in scripts/\*\.sh .*|for f in scripts/doctor.sh; do|' scripts/ledger.sh
  # A break that did not land proves nothing, so refuse to be one.
  grep -q '^for f in scripts/doctor.sh; do' scripts/ledger.sh || exit 1
}
