# gates.sh and the CI workflow are two hand-maintained lists of the same questions, and nothing compared them — so a gate could exist locally and never run in CI. Two did: the audit-log tests and the usage-churn check, neither of which had a step at all
#
# Written by scripts/learn.mjs, which ran this case before the row was kept:
# the check had to pass against an unbroken copy and fail against a broken one.
# A row whose case does not catch is not written at all.
LEDGER_ROW=48
CHECK='node scripts/ci-parity.mjs'
break_it() {
  node -e '
    const fs = require("fs");
    const p = ".github/workflows/ci.yml";
    const s = fs.readFileSync(p, "utf8");
    const anchor = "      - name: Usage churn\n        run: node scripts/churn-check.mjs\n";
    if (!s.includes(anchor)) { console.error("anchor gone"); process.exit(1); }
    fs.writeFileSync(p, s.replace(anchor, ""));
  '
}
