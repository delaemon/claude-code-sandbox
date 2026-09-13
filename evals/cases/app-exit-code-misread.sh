# An application command exiting 3 read as the harness's "did not run".
#
# 0/1/2/3 is a contract between the scripts in this repository. An application's
# build tool never agreed to it: `tsc` exits 2 for "type errors found", and a
# test command that blows up can exit anything at all. Passing that code through
# meant a dead suite rendering as `note tests did not run` -- not a failure --
# and gates.sh exiting 0 on top of it.
#
# The break restores the passthrough. doctor.sh drives a fixture whose `test`
# exits 3 and asserts the gate is reported as a failure.
LEDGER_ROW=38
CHECK='bash scripts/doctor.sh'
break_it() {
  python3 - <<'PY'
import pathlib
p = pathlib.Path("scripts/gates.sh"); s = p.read_text()
old = '''  local out status
  out=$(bash -c "cd \\"$APP_DIR\\" && $cmd" 2>&1); status=$?
  [ $status -eq 0 ] || status=1
  run "$label" bash -c "printf '%s' \\"\\$1\\" >&2; exit $status" _ "$out"'''
assert old in s, "the passthrough anchor is gone; this case proves nothing"
p.write_text(s.replace(old, '''  run "$label" bash -c "cd \\"$APP_DIR\\" && $cmd"'''))
PY
}
