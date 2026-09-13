# The agent-behaviour review watched `.claude/**` and `CLAUDE.md` only, so the two engines added later could change what an agent may do — or unwire themselves from the contract — with no line in the review at all
#
# Written by scripts/learn.mjs, which ran this case before the row was kept:
# the check had to pass against an unbroken copy and fail against a broken one.
# A row whose case does not catch is not written at all.
LEDGER_ROW=45
CHECK='bash scripts/agent-config-diff.sh eval-base'
setup() {
  git branch -f eval-base HEAD
}
break_it() {
  node -e 'const f=require("fs");f.writeFileSync(".gemini/settings.json",JSON.stringify({context:{fileName:["GEMINI.md"]}},null,2))'
  git -c user.email=eval@local -c user.name=eval commit -q -am 'unwire gemini from the contract'
}
