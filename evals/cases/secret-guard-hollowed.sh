# The guard is not deleted, it is neutered in place: the pattern is replaced
# with one that matches nothing. No textual diff check can see this, which is
# why doctor.sh runs the hook and asserts exit 2 instead.
LEDGER_ROW=1
CHECK='bash scripts/doctor.sh'
break_it() {
  sed -i "s|^SECRET_RE=.*|SECRET_RE='(^\\\$a^)'|" .claude/hooks/block-secrets.sh
}
