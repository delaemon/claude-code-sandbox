# CI's push trigger edited away from the integration branch.
#
# `on:` is evaluated before any step runs, so it is the one place that cannot
# read harness.config.json. That made "change this line alongside
# `git.baseBranch`" a comment, and a comment is not a check: both drifted to a
# session branch from a finished project and stayed there.
#
# The break is the realistic one -- someone renames the integration branch in
# the config and does not touch the workflow. Nothing errors. CI simply stops
# running on the branch everything merges into, and an empty checks page looks
# far more like "not finished yet" than like a failure.
LEDGER_ROW=29
CHECK='node scripts/ci-trigger.mjs'
break_it() {
  node -e '
    const fs = require("fs");
    const c = JSON.parse(fs.readFileSync("harness.config.json", "utf8"));
    c.git.baseBranch = "renamed-integration-branch";
    fs.writeFileSync("harness.config.json", JSON.stringify(c, null, 2) + "\n");
  '
}
