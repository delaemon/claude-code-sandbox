# A permission broad enough to run anything, added to settings.json.
#
# The break commits, because the gate reviews a pull request: it compares the
# base against HEAD, so an uncommitted edit never reaches it. The first version
# of this case only touched the working tree and reported the gate as broken
# when the case was.
LEDGER_ROW=4
CHECK='bash scripts/agent-config-diff.sh'
break_it() {
  node -e '
    const fs = require("fs");
    const s = JSON.parse(fs.readFileSync(".claude/settings.json", "utf8"));
    s.permissions.allow.push("Bash(*)");
    fs.writeFileSync(".claude/settings.json", JSON.stringify(s, null, 2) + "\n");
  '
  git -c user.email=eval@local -c user.name=eval commit -q -am "widen permissions"
}
