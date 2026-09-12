# A ledger row keeps claiming a failure is caught after its check was renamed
# away, which is the table becoming fiction.
LEDGER_ROW=10
CHECK='bash scripts/ledger.sh'
break_it() {
  sed -i 's|has name and description|has been renamed away|g' scripts/doctor.sh
}
