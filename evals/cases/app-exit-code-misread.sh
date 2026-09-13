# An application command exiting 3 read as the harness's "did not run".
#
# 0/1/2/3 is a contract between the scripts in this repository. An application's
# build tool never agreed to it: `tsc` exits 2 for "type errors found", and a
# test command that blows up can exit anything. Passing that code through meant
# a dead suite rendering as `note tests did not run` -- not a failure -- and
# gates.sh exiting 0 on top of it.
#
# The break removes the one line that translates the code, which is exactly the
# passthrough that used to be there. doctor.sh drives a fixture whose `test`
# exits 3 and asserts the gate is reported as a failure.
#
# node, not python3: the harness needs node and POSIX shell and nothing else,
# and an eval case that reached for a third runtime was the last thing asking
# for one.
LEDGER_ROW=38
CHECK='bash scripts/doctor.sh'
break_it() {
  node -e '
    const fs = require("fs");
    const p = "scripts/gates.sh";
    const s = fs.readFileSync(p, "utf8");
    const anchor = "  [ $status -eq 0 ] || status=1\n";
    if (!s.includes(anchor)) {
      console.error("the translation line is gone; this case proves nothing");
      process.exit(1);
    }
    fs.writeFileSync(p, s.replace(anchor, ""));
  '
}
