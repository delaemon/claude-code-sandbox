# A stray NUL byte made a check's source read as binary to git, so `git diff` showed only a byte count and the agent-behaviour review could not report what had changed in it
#
# Written by scripts/learn.mjs, which ran this case before the row was kept:
# the check had to pass against an unbroken copy and fail against a broken one.
# A row whose case does not catch is not written at all.
LEDGER_ROW=43
CHECK='bash scripts/doctor.sh'
break_it() {
  printf 'const sentinel = "\000";\n' >> scripts/ci-trigger.mjs
  LC_ALL=C tr -d '\000' < scripts/ci-trigger.mjs | cmp -s - scripts/ci-trigger.mjs && exit 1
}
