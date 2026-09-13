# A permission broad enough to run anything, added to settings.json.
#
# The break commits, because the gate reviews a pull request: it compares the
# base against HEAD, so an uncommitted edit never reaches it. The first version
# of this case only touched the working tree and reported the gate as broken
# when the case was.
#
# The base ref is created here rather than assumed. It used to be whatever
# `git.baseBranch` named, which meant the case passed on a machine that happened
# to have fetched that branch and reported the gate as broken on one that had
# not -- and it reported it as "already failing", when the gate was in fact
# exiting 3, did-not-run, perfectly correctly. A case that needs the machine it
# runs on to be a particular machine is the shape of ledger rows 1 and 28.
LEDGER_ROW=4
CHECK='bash scripts/agent-config-diff.sh eval-base'
setup() {
  # The clone's HEAD, unbroken, is exactly the right base: everything the gate
  # should find is what break_it commits on top of it.
  git branch -f eval-base HEAD
}
break_it() {
  node -e '
    const fs = require("fs");
    const s = JSON.parse(fs.readFileSync(".claude/settings.json", "utf8"));
    s.permissions.allow.push("Bash(*)");
    fs.writeFileSync(".claude/settings.json", JSON.stringify(s, null, 2) + "\n");
  '
  git -c user.email=eval@local -c user.name=eval commit -q -am "widen permissions"
}
