#!/usr/bin/env bash
# Read harness.config.json from shell, without inventing defaults.
#
# Sourced by the hooks and by gates.sh. Sets APP_DIR (empty when unconfigured),
# APP_INSTALL, APP_TYPECHECK, APP_TEST and BASE_BRANCH. Callers decide what
# "unconfigured" means for them -- but it is never "passed".
# $HARNESS_CONFIG points the whole harness at a different config, exactly as it
# does for scripts/config.mjs. It existed for node callers only, so a check
# reached from shell could not be exercised against a fixture at all -- and a
# check nobody can exercise is the shape of failure this repository is about.
_hcroot=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
case "${HARNESS_CONFIG:-}" in
  "")  _hc=$_hcroot/harness.config.json ;;
  /*)  _hc=$HARNESS_CONFIG ;;
  *)   _hc=$_hcroot/$HARNESS_CONFIG ;;
esac
if [ -r "$_hc" ] && command -v node >/dev/null 2>&1; then
  eval "$(node -e '
    const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const q = (v) => "\x27" + String(v ?? "").replace(/\x27/g, "\x27\\\x27\x27") + "\x27";
    const a = c.app || {};
    console.log(`APP_DIR=${q(a.dir)}`);
    console.log(`APP_INSTALL=${q(a.install)}`);
    console.log(`APP_TYPECHECK=${q(a.typecheck)}`);
    console.log(`APP_TEST=${q(a.test)}`);
    console.log(`APP_SMOKE=${q(a.smoke)}`);
    console.log(`BASE_BRANCH=${q((c.git || {}).baseBranch)}`);
  ' "$_hc" 2>/dev/null)"
fi
: "${APP_DIR:=}" "${APP_INSTALL:=}" "${APP_TYPECHECK:=}" "${APP_TEST:=}" "${APP_SMOKE:=}"
: "${BASE_BRANCH:=}"
