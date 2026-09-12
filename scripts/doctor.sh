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
# Nothing in this repository notices when a branch's PR has been merged and
# work carries on top of it anyway. That happened: PR #5 merged at 07:12 and
# the next commit landed at 07:22 on the pre-merge tip, so it belonged to no
# open PR and never reached the base. It was harmless only because the merge
# commit carried an identical tree; with another branch merged in between, the
# next PR would have proposed undoing it.
#
# ahead/behind separates the two cases cleanly. Everything you have already
# merged (behind, nothing ahead) means start again from the base. Behind with
# work of your own means the base simply moved.
base="${DOCTOR_BASE:-puyo-puyo-web}"
base_ref=""
for candidate in "origin/$base" "$base"; do
  git rev-parse --verify --quiet "$candidate" >/dev/null && { base_ref="$candidate"; break; }
done

if [ "$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" = "$base" ]; then
  ok "on $base, the integration branch"
elif [ -z "$base_ref" ]; then
  note "no local ref for $base — cannot compare (normal in a CI checkout)"
else
  behind=$(git rev-list --count "HEAD..$base_ref" 2>/dev/null || echo 0)
  ahead=$(git rev-list --count "$base_ref..HEAD" 2>/dev/null || echo 0)
  if [ "$behind" -eq 0 ]; then
    ok "up to date with $base_ref ($ahead ahead)"
  elif [ "$ahead" -eq 0 ]; then
    bad "every commit here is already in $base_ref, and it has moved $behind ahead — this branch's PR is merged and finished. Re-cut it: git fetch origin $base && git checkout -B \$(git rev-parse --abbrev-ref HEAD) $base_ref"
  else
    note "$behind behind $base_ref with $ahead of your own — bring the base in: git merge $base_ref"
  fi
fi

echo
echo "hooks"
for h in session-start block-secrets typecheck; do
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

echo
printf 'checked: %d ok, %d note, %d failed\n' "$pass" "$warn" "$fail"
[ "$fail" -eq 0 ] || {
  echo "This environment does not match what the repository assumes. See CLAUDE.md." >&2
  exit 1
}
