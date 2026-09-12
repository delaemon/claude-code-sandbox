#!/usr/bin/env bash
# Report what a change does to the agent's own behaviour.
#
# Most of this repository is a game. A handful of files are not: they decide
# what the agent may do, what runs automatically, and what the next session
# believes. A diff touching those should read differently from one touching the
# renderer, and whoever merges should not have to remember which files those
# are.
#
# Two outputs, deliberately different in force:
#
#   - A summary of every behaviour-affecting file the change touches. It never
#     fails. Legitimate changes to these files are constant, and a check that
#     cries wolf on all of them gets ignored — which is worse than not having
#     one.
#
#   - A failure, but only where a guard is actually weaker afterwards. Adding a
#     guard is never blocked. The asymmetry is the design.
#
# The weakening checks compare *effective state and behaviour*, never diff
# lines. The first version matched removed lines and failed on its own hooks:
# rewriting a hook deletes every line it then re-adds, so a rewrite that kept
# every protection looked identical to one that dropped them. Asking "is `.env`
# still refused?" has no such failure mode.
#
# Usage:  bash scripts/agent-config-diff.sh [BASE_REF]
# Exit 0 when nothing is weakened, 1 when something is.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 0

base="${1:-${DOCTOR_BASE:-puyo-puyo-web}}"
base_ref=""
for candidate in "origin/$base" "$base"; do
  git rev-parse --verify --quiet "$candidate" >/dev/null 2>&1 && { base_ref="$candidate"; break; }
done
# Exit 3 -- did not run -- rather than 0. There is nothing wrong with this
# situation: a checkout without the base ref is ordinary, and failing on it
# would be noise. But gates.sh printed `ok` for it, so a check that never looked
# read exactly like a check that looked and found nothing. That is the one thing
# this repository refuses everywhere else, and the eval suite found it here.
if [ -z "$base_ref" ]; then
  echo "No ref for $base: this check did not run." >&2
  exit 3
fi

# A three-dot range needs a merge base, and a shallow clone may not have one.
# Checking that first is not pedantry: the first version sent the error to
# /dev/null, so `git diff` exiting 128 produced an empty list and the step
# reported "No agent-behaviour files changed" on a pull request that changed
# four of them. A check that cannot run must not look like a check that passed —
# the same rule the hooks in this repository follow.
if ! git merge-base "$base_ref" HEAD >/dev/null 2>&1; then
  echo "Cannot compare against \`$base\`: no merge base is reachable." >&2
  echo "A shallow checkout causes this. Use actions/checkout with fetch-depth: 0." >&2
  exit 1
fi

range="$base_ref...HEAD"
# Kept deliberately narrower than CODEOWNERS' `/.github/`: an issue template
# changes nothing about what the agent may do. CODEOWNERS itself is here
# because it is the list of which files this whole check is about, and this
# check omitting it is exactly the blind spot it exists to prevent — it did,
# on the pull request that introduced it.
watched=('.claude/**' 'CLAUDE.md' '.github/workflows/**' 'scripts/**'
         '.devcontainer/**' 'docs/worklog/CONTRACT.md' '.github/CODEOWNERS')
if ! changed=$(git diff --name-only "$range" -- "${watched[@]}"); then
  echo "\`git diff $range\` failed; refusing to report this as no change." >&2
  exit 1
fi

if [ -z "$changed" ]; then
  echo "No agent-behaviour files changed."
  exit 0
fi

explain() {
  case "$1" in
    .claude/settings.json)    echo "permissions, hook wiring, enabled plugins" ;;
    .claude/hooks/*)          echo "code the harness runs automatically" ;;
    .claude/*)                echo "agent configuration" ;;
    CLAUDE.md)                echo "what the next session believes about this repo" ;;
    docs/worklog/CONTRACT.md) echo "what parallel agents are bound to" ;;
    .github/workflows/*)      echo "what CI checks" ;;
    .github/CODEOWNERS)       echo "who owns the files that decide agent behaviour" ;;
    .devcontainer/*)          echo "the environment the agent runs in locally" ;;
    scripts/*)                echo "checks the harness and CI depend on" ;;
    *)                        echo "agent behaviour" ;;
  esac
}

echo "## Agent behaviour is affected by this change"
echo
echo "| file | what it controls | change |"
echo "|---|---|---|"
while IFS= read -r file; do
  [ -n "$file" ] || continue
  stat=$(git diff --numstat "$range" -- "$file" | awk '{printf "+%s −%s", $1, $2}')
  [ -e "$file" ] || stat="**removed**"
  printf '| `%s` | %s | %s |\n' "$file" "$(explain "$file")" "$stat"
done <<< "$changed"
echo

# ------------------------------------------------------------------ findings
findings=()
add() { findings+=("$1"); }

# --- settings.json, compared as data rather than as text.
if git diff --name-only "$range" -- .claude/settings.json | grep -q .; then
  git show "$base_ref:.claude/settings.json" > /tmp/acd-base.json 2>/dev/null || echo '{}' > /tmp/acd-base.json
  report=$(node -e '
    const fs = require("fs");
    const read = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return {}; } };
    const before = read("/tmp/acd-base.json");
    const after = read(".claude/settings.json");
    const out = [];

    // A hook event that used to be wired and is not any more.
    const events = (s) => Object.keys(s.hooks ?? {});
    for (const e of events(before)) {
      if (!events(after).includes(e)) out.push(`the ${e} hook is no longer wired`);
    }

    // A deny rule that has gone.
    const deny = (s) => new Set(s.permissions?.deny ?? []);
    for (const rule of deny(before)) {
      if (!deny(after).has(rule)) out.push(`the deny rule ${rule} was removed`);
    }

    // A newly allowed pattern broad enough to cover arbitrary commands.
    const allow = (s) => new Set(s.permissions?.allow ?? []);
    const broad = /^(\*|Bash\(\*\)|Bash\((sudo|rm|curl|chmod|eval)\b)/;
    for (const rule of allow(after)) {
      if (!allow(before).has(rule) && broad.test(rule)) out.push(`a broad new permission: ${rule}`);
    }

    // Switches whose only effect is to stop the harness protecting anything.
    for (const key of ["disableAllHooks", "disableBypassPermissionsMode"]) {
      if (after[key] === true && before[key] !== true) out.push(`${key} was turned on`);
    }
    if (after.permissions?.defaultMode === "bypassPermissions"
        && before.permissions?.defaultMode !== "bypassPermissions") {
      out.push("defaultMode was set to bypassPermissions");
    }
    process.stdout.write(out.join("\n"));
  ' 2>/dev/null)
  while IFS= read -r line; do [ -n "$line" ] && add "$line"; done <<< "$report"
  rm -f /tmp/acd-base.json
fi

# --- A hook that existed at the base and does not now.
for path in $(git ls-tree -r --name-only "$base_ref" -- .claude/hooks 2>/dev/null); do
  [ -e "$path" ] || add "\`$path\` was deleted"
done

# --- The secret guard, asked what it does rather than how it is written.
if [ -x .claude/hooks/block-secrets.sh ]; then
  for name in .env .env.local secret.pem id.key; do
    code=0
    printf '{"tool_name":"Write","tool_input":{"file_path":"/repo/%s"}}' "$name" \
      | bash .claude/hooks/block-secrets.sh >/dev/null 2>&1 || code=$?
    [ "$code" -eq 2 ] || add "the secret guard no longer refuses \`$name\` (exit $code)"
  done
fi

# --- doctor.sh losing hook assertions it used to make.
if git diff --name-only "$range" -- scripts/doctor.sh | grep -q .; then
  before=$(git show "$base_ref:scripts/doctor.sh" 2>/dev/null | grep -c 'check_hook')
  after=$(grep -c 'check_hook' scripts/doctor.sh 2>/dev/null)
  [ "${before:-0}" -gt "${after:-0}" ] \
    && add "doctor.sh asserts fewer hook behaviours than before (${before:-0} to ${after:-0})"
fi

if [ ${#findings[@]} -eq 0 ]; then
  echo "No guard is weaker than it was on \`$base\`."
  exit 0
fi

echo "### This change weakens a guard"
echo
for f in "${findings[@]}"; do echo "- $f"; done
echo
echo "Adding a guard is never blocked; removing one is. If this is deliberate,"
echo "say so in the pull request — a human can merge past a failing check."
exit 1
