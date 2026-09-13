# The audit-log gate used `A && B || C`, so a failing or missing pytest exited 0 and the gate printed `ok`. pytest was not installed here, so it had reported ok for a check that never ran — while `doctor.sh` correctly reported a note, and the one deciding "safe to push" was the one that lied
#
# Written by scripts/learn.mjs, which ran this case before the row was kept:
# the check had to pass against an unbroken copy and fail against a broken one.
# A row whose case does not catch is not written at all.
LEDGER_ROW=47
CHECK='node scripts/autopilot.mjs --quick --json'
break_it() {
  printf '\nimport { test as brk } from "node:test";\nimport abrk from "node:assert/strict";\nbrk("deliberately failing", () => abrk.equal(1, 2));\n' >> audit_log/export.test.mjs
  grep -q 'deliberately failing' audit_log/export.test.mjs || exit 1
}
