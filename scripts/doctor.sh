#!/usr/bin/env bash
# Check that this environment satisfies what the repository assumes.
#
# The repository is worked on from two places — an Anthropic-hosted cloud
# session, and a dev container on a developer's machine — and the flow is meant
# to be identical from either: work, open a PR against puyo-puyo-web, merge.
# "Identical" is a claim, and this is what makes it a testable one.
#
# It checks the toolchain versions the two must share, and then runs the hooks
# and asserts their exit codes, because a hook is the part most likely to work
# in one environment and silently do nothing in the other. That is not
# hypothetical: the hooks once parsed their input with python3, which the cloud
# image happens to have, and on a host without it the secret guard exited 0 and
# let `.env` through.
#
# Usage:  bash scripts/doctor.sh
# Exit 0 when the environment is usable, 1 when something the flow depends on
# is broken.
set -uo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"

pass=0
fail=0
warn=0

ok()   { printf '  \033[32mok\033[0m    %s\n' "$1"; pass=$((pass + 1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail + 1)); }
note() { printf '  \033[33mnote\033[0m  %s\n' "$1"; warn=$((warn + 1)); }

echo "environment"
if [ -n "${CODESPACES:-}" ]; then
  ok "GitHub Codespaces"
elif [ -n "${REMOTE_CONTAINERS:-}${DEVCONTAINER:-}" ] || [ -f /.dockerenv ]; then
  ok "container (dev container or similar)"
else
  ok "host or cloud session"
fi
ok "repo at $repo"

echo
echo "toolchain"
if command -v node >/dev/null 2>&1; then
  major=$(node -p 'process.versions.node.split(".")[0]')
  if [ "$major" = "22" ]; then
    ok "node $(node --version)"
  else
    bad "node $(node --version) — the cloud session and CI are on 22, so results here are not comparable"
  fi
else
  bad "node missing — nothing in this repository works without it"
fi

command -v npm >/dev/null 2>&1 && ok "npm $(npm --version)" || bad "npm missing"
command -v git >/dev/null 2>&1 && ok "git $(git --version | awk '{print $3}')" || bad "git missing"

# How a PR gets opened differs by environment, and only one of these is needed.
if command -v gh >/dev/null 2>&1; then
  ok "gh $(gh --version | head -1 | awk '{print $3}') — PRs open from the CLI"
else
  note "no gh — fine in a cloud session, where PRs go through the GitHub tools; install it in a dev container"
fi

# Python is optional by design: only audit_log's tests use it, and no hook does.
if command -v python3 >/dev/null 2>&1; then
  python3 -c 'import pytest' 2>/dev/null \
    && ok "python3 with pytest — audit_log tests runnable" \
    || note "python3 without pytest — 'pip install pytest' to run audit_log's tests"
else
  note "no python3 — audit_log's tests are unavailable; nothing else needs it"
fi

echo
echo "project"
if [ -d puyopuyo/node_modules ]; then
  ok "puyopuyo dependencies installed"
else
  note "puyopuyo/node_modules missing — run 'cd puyopuyo && npm ci'"
fi

echo
echo "branch"
# The rule itself lives in scripts/branch-state.sh, which the SessionStart hook
# also calls. Two copies of it would eventually disagree, and a rule that
# contradicts itself is worse than no rule.
branch_msg=$(bash scripts/branch-state.sh)
case $? in
  0) ok "$branch_msg" ;;
  1) note "$branch_msg" ;;
  *) bad "$branch_msg" ;;
esac

echo
echo "hooks"
for h in session-start block-secrets typecheck log-usage; do
  [ -x ".claude/hooks/$h.sh" ] && ok "$h.sh executable" || bad "$h.sh missing or not executable"
done

# Behaviour, not presence. Each case states what the hook must do and the run
# has to agree.
hook_exit() {
  printf '%s' "$2" | bash ".claude/hooks/$1.sh" >/dev/null 2>&1
  echo $?
}

check_hook() {
  local label="$1" name="$2" payload="$3" want="$4"
  local got
  got=$(hook_exit "$name" "$payload")
  if [ "$got" = "$want" ]; then
    ok "$label (exit $got)"
  else
    bad "$label — expected exit $want, got $got"
  fi
}

check_hook "block-secrets refuses .env"      block-secrets \
  '{"tool_name":"Write","tool_input":{"file_path":"'"$repo"'/.env"}}' 2
check_hook "block-secrets refuses *.key"     block-secrets \
  '{"tool_name":"Write","tool_input":{"file_path":"'"$repo"'/x.key"}}' 2
check_hook "block-secrets allows source"     block-secrets \
  '{"tool_name":"Write","tool_input":{"file_path":"'"$repo"'/puyopuyo/src/main.ts"}}' 0
check_hook "typecheck ignores non-TypeScript" typecheck \
  '{"tool_name":"Edit","tool_input":{"file_path":"'"$repo"'/README.md"}}' 0

# The usage log must never block a session from finishing, and must never
# record a session it could not measure. The second is the one worth asserting:
# a row of zeros and a transcript that could not be read would look the same in
# the log, which is the failure this repository keeps coming back to.
check_hook "log-usage never blocks a stop"   log-usage \
  '{"session_id":"doctor-probe","transcript_path":"/nonexistent/t.jsonl"}' 0

# The probe transcript must EXIST and merely carry no usage, or the hook stops
# at its "file is missing" guard and this check passes without reaching the one
# it is here to test. The first version of this check made exactly that mistake
# and stayed green while the guard was removed.
usage_log="$repo/audit_log/usage.md"
probe=$(mktemp); printf '{"type":"user"}\n' > "$probe"
before=$(cat "$usage_log" 2>/dev/null | cksum)
printf '%s' "{\"session_id\":\"doctor-probe\",\"transcript_path\":\"$probe\"}" \
  | bash "$repo/.claude/hooks/log-usage.sh" >/dev/null 2>&1
after=$(cat "$usage_log" 2>/dev/null | cksum)
rm -f "$probe"
# The hook truncates the session id to 8 characters, so the row would read
# `doctor-p`. Grepping for the full name would never match and the assertion
# would be dead — it was, on the first try.
# Exit 0 carries a structured channel: JSON on stdout, whose additionalContext
# reaches the next turn. It is the reason the usage line costs no tool call, so
# it is asserted rather than assumed.
real_t=$(ls -t "$HOME"/.claude/projects/*/*.jsonl 2>/dev/null | head -1)
if [ -n "$real_t" ]; then
  emitted=$(printf '{"session_id":"ctx-probe","transcript_path":"%s"}' "$real_t" \
    | bash "$repo/.claude/hooks/log-usage.sh" 2>/dev/null)
  if printf '%s' "$emitted" | node -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        const c=JSON.parse(s).hookSpecificOutput;
        process.exit(c.hookEventName==="Stop" && /^\[tok\]/.test(c.additionalContext) ? 0 : 1);
      })' 2>/dev/null; then
    ok "log-usage returns the usage line as Stop additionalContext"
  elif [ -z "$emitted" ]; then
    # Silence here is correct when the rounded row has not moved: the emission
    # is bounded so a Stop hook cannot talk itself into a loop. Reported rather
    # than passed silently, so a channel that has genuinely died is visible.
    note "log-usage stayed silent — the usage row has not moved since last stop"
  else
    bad "log-usage no longer emits additionalContext on exit 0"
  fi
fi

if [ "$before" = "$after" ] && ! grep -q 'doctor-p' "$usage_log" 2>/dev/null; then
  ok "log-usage records nothing when it cannot measure"
else
  bad "log-usage wrote a row for a session it could not measure"
fi

# A subagent definition with broken or missing frontmatter does not error --
# it simply never loads, and the session runs without the agent it thought it
# had. Same for a slash command. Both are exactly the quiet-failure shape this
# repository exists to refuse, so both are parsed here.
echo
echo "agents and commands"
for f in .claude/agents/*.md; do
  [ -e "$f" ] || break
  name=$(basename "$f")
  if head -1 "$f" | grep -q '^---$' \
     && awk 'NR>1 && /^---$/{exit} NR>1 && /^name:/{n=1} END{exit !n}' "$f" \
     && awk 'NR>1 && /^---$/{exit} NR>1 && /^description:/{d=1} END{exit !d}' "$f"; then
    ok "agent $name has name and description"
  else
    bad "agent $name has malformed frontmatter — it will not load, silently"
  fi
done
for f in .claude/commands/*.md; do
  [ -e "$f" ] || break
  name=$(basename "$f")
  if head -1 "$f" | grep -q '^---$'; then
    ok "command /$(basename "$f" .md) has frontmatter"
  else
    bad "command $name has no frontmatter"
  fi
done

echo
printf 'checked: %d ok, %d note, %d failed\n' "$pass" "$warn" "$fail"
[ "$fail" -eq 0 ] || {
  echo "This environment does not match what the repository assumes. See CLAUDE.md." >&2
  exit 1
}
