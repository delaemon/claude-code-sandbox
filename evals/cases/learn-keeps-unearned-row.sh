# Ledger rows were written by hand, so a row could be added whose check had never been seen to catch anything — `ledger.sh` only asks whether the named check exists
#
# Written by scripts/learn.mjs, which ran this case before the row was kept:
# the check had to pass against an unbroken copy and fail against a broken one.
# A row whose case does not catch is not written at all.
LEDGER_ROW=42
CHECK='bash scripts/learn-check.sh'
break_it() {
  sed -i 's|^  fs.writeFileSync(LEDGER, ledgerBefore);$|  void 0;|' scripts/learn.mjs
  sed -i 's|^  try { fs.unlinkSync(casePath); } catch {}$|  void 0;|' scripts/learn.mjs
  grep -q 'void 0;' scripts/learn.mjs || exit 1
}
