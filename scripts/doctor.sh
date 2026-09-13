#!/usr/bin/env bash
# Check that this environment satisfies what the repository assumes.
#
# The repository is worked on from two places — an Anthropic-hosted cloud
# session, and a dev container on a developer's machine — and the flow is meant
# to be identical from either: work, open a PR against the integration branch,
# merge.
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
. "$repo/scripts/app-config.sh"

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

# No python3 probe. The harness needs node and POSIX shell and nothing else --
# audit_log was the last thing that wanted a third runtime, and its tests run on
# `node --test` now. The probe that used to be here reported a note while
# gates.sh reported `ok` for the same never-executed check, which is the
# disagreement ledger row 47 is about.

echo
echo "project"
# CI's first step is `node scripts/config.mjs --github-output`, and every later
# step reads what it emits. If it stops emitting a key, the steps that gate on
# that key are skipped -- and a skipped step is a grey tick, not a red one, so
# the whole application half of CI would go quiet without failing.
cfg_out=$(node scripts/config.mjs --github-output 2>&1)
if [ $? -ne 0 ]; then
  bad "config.mjs --github-output failed: $cfg_out"
else
  missing=""
  for key in app_dir app_install app_typecheck app_test app_smoke clock_boundary mutants; do
    printf '%s\n' "$cfg_out" | grep -q "^$key=" || missing="$missing $key"
  done
  if [ -n "$missing" ]; then
    bad "config.mjs --github-output emits no$missing — CI steps reading them would be skipped, not failed"
  else
    ok "config.mjs --github-output emits every key CI gates on"
  fi
fi

if [ -z "$APP_DIR" ]; then
  note "no app.dir in harness.config.json — the application gates will not run"
elif [ -d "$APP_DIR/node_modules" ]; then
  ok "$APP_DIR dependencies installed"
else
  note "$APP_DIR/node_modules missing — run '(cd $APP_DIR && $APP_INSTALL)'"
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
for h in session-start block-secrets typecheck log-usage record-subagent; do
  [ -x ".claude/hooks/$h.sh" ] && ok "$h.sh executable" || bad "$h.sh missing or not executable"
done

# A hook whose body is not valid JavaScript does not announce itself: a failing
# Stop hook is non-blocking, so it simply does nothing and says nothing. The
# body used to be inlined in `node -e` inside single quotes, where one
# apostrophe in a comment ended the shell string and broke it -- three separate
# times. In its own file it can be checked, so it is.
for m in .claude/hooks/*.mjs; do
  [ -e "$m" ] || break
  if node --check "$m" 2>/dev/null; then
    ok "$(basename "$m") parses"
  else
    bad "$(basename "$m") is not valid JavaScript — the hook would fail silently"
  fi
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
  '{"tool_name":"Write","tool_input":{"file_path":"'"$repo"'/README.md"}}' 0
check_hook "typecheck ignores non-TypeScript" typecheck \
  '{"tool_name":"Edit","tool_input":{"file_path":"'"$repo"'/README.md"}}' 0

# The usage log must never block a session from finishing, and must never
# record a session it could not measure. The second is the one worth asserting:
# a row of zeros and a transcript that could not be read would look the same in
# the log, which is the failure this repository keeps coming back to.
check_hook "log-usage never blocks a stop"   log-usage \
  '{"session_id":"doctor-probe","transcript_path":"/nonexistent/t.jsonl"}' 0

# The context warning, in all three directions that can go wrong.
#
# The hook has printed a bare `ctx` number every turn for a while, which nobody
# can act on without knowing what large looks like. Saying OVER is the whole
# value, so it has to be the thing asserted -- and the third case below is the
# one that matters: a config that fails to load must still warn. A threshold
# that switched itself off on a parse error would be a guard that looks like it
# ran, which is the failure this repository keeps returning to.
ctx_dir=$(mktemp -d)
mkdir -p "$ctx_dir/off/audit_log" "$ctx_dir/broken/audit_log"
sed 's/"compactAt": 400000/"compactAt": 0/' "$repo/harness.config.json" \
  > "$ctx_dir/off/harness.config.json" 2>/dev/null
echo 'not json' > "$ctx_dir/broken/harness.config.json"
# ctx is input + cache writes + cache reads of the LAST usage record.
printf '{"message":{"usage":{"output_tokens":100,"input_tokens":1000,"cache_creation_input_tokens":0,"cache_read_input_tokens":499000}}}\n' > "$ctx_dir/over.jsonl"
printf '{"message":{"usage":{"output_tokens":100,"input_tokens":1000,"cache_creation_input_tokens":0,"cache_read_input_tokens":99000}}}\n'  > "$ctx_dir/under.jsonl"
ctx_run() {
  printf '{"session_id":"ctxprobe","transcript_path":"%s"}' "$1" \
    | CLAUDE_PROJECT_DIR="$2" USAGE_LOG="$ctx_dir/u.md" TURNS_LOG="$ctx_dir/t.jsonl" \
      SUBAGENT_CACHE="$ctx_dir/c.json" bash "$repo/.claude/hooks/log-usage.sh" 2>/dev/null
}
ctx_over=$(ctx_run "$ctx_dir/over.jsonl" "$repo")
ctx_under=$(ctx_run "$ctx_dir/under.jsonl" "$repo")
ctx_off=$(ctx_run "$ctx_dir/over.jsonl" "$ctx_dir/off")
ctx_broken=$(ctx_run "$ctx_dir/over.jsonl" "$ctx_dir/broken")
rm -rf "$ctx_dir"
if ! printf '%s' "$ctx_over" | grep -q 'OVER'; then
  bad "log-usage does not warn past context.compactAt — the number is printed and nobody can act on it"
elif printf '%s' "$ctx_under" | grep -q 'OVER'; then
  bad "log-usage warns below context.compactAt — a warning on every turn is a warning nobody reads"
elif printf '%s' "$ctx_off" | grep -q 'OVER'; then
  bad "log-usage warns with context.compactAt 0 — turning it off has to work"
elif ! printf '%s' "$ctx_broken" | grep -q 'OVER'; then
  bad "log-usage goes quiet when harness.config.json will not parse — a guard that cannot read its threshold must warn, not hide"
else
  ok "log-usage warns past context.compactAt, is quiet under it, and still warns when the config will not parse"
fi

# The probe transcript must EXIST and merely carry no usage, or the hook stops
# at its "file is missing" guard and this check passes without reaching the one
# it is here to test. The first version of this check made exactly that mistake
# and stayed green while the guard was removed.
# The subagent recorder writes field values into a file in a public repository,
# so what it treats as "known" is a disclosure decision, not a formatting one.
# The list grew once already, to pick up agent_transcript_path. This asserts the
# two halves that matter: a known field keeps its value, and an unknown one --
# here the message-shaped field the harness really does send -- keeps only its
# name.
rec_log=$(mktemp)
printf '%s' '{"session_id":"probe","agent_transcript_path":"/p/agent-x.jsonl","last_assistant_message":"CONVERSATION TEXT"}' \
  | SUBAGENT_INDEX="$rec_log" bash "$repo/.claude/hooks/record-subagent.sh" >/dev/null 2>&1
rec_body=$(cat "$rec_log" 2>/dev/null)
rm -f "$rec_log"
if ! printf '%s' "$rec_body" | grep -q '/p/agent-x.jsonl'; then
  bad "record-subagent dropped a known field value — the index records nothing useful"
elif printf '%s' "$rec_body" | grep -q 'CONVERSATION TEXT'; then
  bad "record-subagent copied an unknown field value into a public log"
else
  ok "record-subagent keeps known values and only unknown field names"
fi

# The probes above must leave the real logs untouched. Asserting it here means a
# future probe that forgets one of the hook output paths is caught, rather than
# discovered as stray rows in a committed file.
# Every hook must write only to staged paths, never to a tracked log. Fixing
# one of two writers reads as fixed until the other fires -- turns.jsonl was
# staged while subagents.jsonl kept dirtying the tree on its own.
#
# Asserted by behaviour, not by grep: log-usage.mjs legitimately *reads*
# audit_log/usage.md to carry other sessions' rows forward, and a textual check
# called that a write. Fire each hook with every staging path redirected, then
# require the tracked logs to be untouched.
stage=$(mktemp -d)
tracked_before=$(cat "$repo"/audit_log/turns.jsonl "$repo"/audit_log/subagents.jsonl \
                     "$repo"/audit_log/usage.md 2>/dev/null | cksum)
stage_probe="$stage/probe.jsonl"
printf '{"message":{"usage":{"output_tokens":900,"cache_creation_input_tokens":4100,"input_tokens":0}}}\n' > "$stage_probe"
if [ -s "$stage_probe" ]; then
  printf '{"session_id":"stageprobe","transcript_path":"%s"}' "$stage_probe" \
    | USAGE_LOG="$stage/u.md" TURNS_LOG="$stage/t.jsonl" SUBAGENT_CACHE="$stage/c.json" \
      bash "$repo/.claude/hooks/log-usage.sh" >/dev/null 2>&1
fi
printf '{"session_id":"stageprobe","agent_id":"probe"}' \
  | SUBAGENT_INDEX="$stage/s.jsonl" bash "$repo/.claude/hooks/record-subagent.sh" >/dev/null 2>&1
tracked_after=$(cat "$repo"/audit_log/turns.jsonl "$repo"/audit_log/subagents.jsonl \
                    "$repo"/audit_log/usage.md 2>/dev/null | cksum)
rm -rf "$stage"
if [ "$tracked_before" = "$tracked_after" ]; then
  ok "hooks write only staged logs, never the tracked ones"
else
  bad "a hook wrote into a tracked log — the working tree dirties every turn again"
fi

prod_before=$(cat "$repo/audit_log/turns.jsonl" 2>/dev/null | cksum)

usage_log="$repo/audit_log/usage.md"
# A transcript with no usage records must produce no row at all. Checked
# against the STAGED paths, because the hook no longer writes the tracked ones
# -- when staging was introduced this check kept comparing the tracked files,
# which by then never changed either way, and it passed against a hook with the
# guard deleted. The eval suite caught that; it is why the probe below asserts a
# positive first.
# Both probes are synthesised. The first version took the positive case from
# whatever real transcript happened to be under $HOME/.claude/projects, which
# CI does not have -- so the whole check was skipped there, printing neither ok
# nor bad, and doctor.sh passed with the guard deleted. The eval suite caught
# it. A check that needs the machine it runs on to be a particular machine is a
# check that does not run.
probe_stage=$(mktemp -d)
real_probe="$probe_stage/withusage.jsonl"
printf '{"message":{"usage":{"output_tokens":900,"cache_creation_input_tokens":4100,"input_tokens":0}}}\n' \
  > "$real_probe"
empty_probe="$probe_stage/empty.jsonl"; printf '{"type":"user"}\n' > "$empty_probe"
run_probe() {
  printf '{"session_id":"doctor-probe","transcript_path":"%s"}' "$1" \
    | USAGE_LOG="$probe_stage/u.md" TURNS_LOG="$probe_stage/t.jsonl" \
      SUBAGENT_CACHE="$probe_stage/c.json" \
      bash "$repo/.claude/hooks/log-usage.sh" 2>/dev/null
}
# Positive first: a transcript carrying usage must produce a row, or "no row"
# below proves nothing about the guard.
run_probe "$real_probe" >/dev/null
if [ ! -s "$probe_stage/t.jsonl" ]; then
  bad "log-usage wrote nothing for a readable transcript — the probe is inert"
else
  : > "$probe_stage/t.jsonl"; rm -f "$probe_stage/u.md"
  run_probe "$empty_probe" >/dev/null
  if [ -s "$probe_stage/t.jsonl" ] || [ -s "$probe_stage/u.md" ]; then
    bad "log-usage recorded a session it could not measure"
  else
    ok "log-usage records nothing when it cannot measure"
  fi
fi
rm -rf "$probe_stage"

# Exit 0 carries a structured channel: JSON on stdout, whose additionalContext
# reaches the next turn. It is the reason the usage line costs no tool call, so
# it is asserted rather than assumed.
# Synthesised, not taken from whatever transcript happens to exist under $HOME.
# Two checks here were written that way and did not run in CI at all, printing
# neither ok nor bad -- a guard that needs a particular machine is a guard that
# does not run.
ctx_dir=$(mktemp -d); real_t="$ctx_dir/probe.jsonl"
printf '{"message":{"usage":{"output_tokens":900,"cache_creation_input_tokens":4100,"input_tokens":0}}}\n' > "$real_t"
if [ -s "$real_t" ]; then
  # Every output path the hook writes has to be redirected, not just the one
  # that existed when the probe was written. It gained turns.jsonl and this
  # probe left a `ctx-prob` row in the real one -- the same contamination that
  # was fixed for usage.md, repeated because the redirect was per-file.
  probe_dir=$(mktemp -d)
  emitted=$(printf '{"session_id":"ctx-probe","transcript_path":"%s"}' "$real_t" \
    | USAGE_LOG="$probe_dir/usage.md" TURNS_LOG="$probe_dir/turns.jsonl" \
      SUBAGENT_CACHE="$probe_dir/cache.json" \
      bash "$repo/.claude/hooks/log-usage.sh" 2>/dev/null)
  rm -rf "$probe_dir"
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
    rm -rf "$ctx_dir"
    note "log-usage stayed silent — the usage row has not moved since last stop"
  else
    bad "log-usage no longer emits additionalContext on exit 0"
  fi
fi


# A subagent definition with broken or missing frontmatter does not error --
# it simply never loads, and the session runs without the agent it thought it
# had. Same for a slash command. Both are exactly the quiet-failure shape this
# repository exists to refuse, so both are parsed here.
# The rate breaker is the only thing standing between a Stop hook that speaks
# every turn and one that could spend a quota unattended. The loop it guards
# against was diagnosed as never having happened (ledger row 11), which makes it
# insurance -- and insurance nobody checks is the thing this repository refuses.
brk_dir=$(mktemp -d)
brk_probe="$brk_dir/t.jsonl"
printf '{"message":{"usage":{"output_tokens":900,"cache_creation_input_tokens":4100,"input_tokens":0}}}\n' > "$brk_probe"
if [ -s "$brk_probe" ]; then
  brk_last=""
  for i in 1 2 3 4 5 6; do
    brk_last=$(printf '{"session_id":"brkprobe","transcript_path":"%s"}' "$brk_probe" \
      | USAGE_LOG="$brk_dir/u.md" TURNS_LOG="$brk_dir/t2.jsonl" \
        SUBAGENT_CACHE="$brk_dir/c.json" \
        bash "$repo/.claude/hooks/log-usage.sh" 2>/dev/null)
  done
  if printf '%s' "$brk_last" | grep -q 'silenced'; then
    ok "log-usage goes quiet after six stops inside a minute"
  else
    bad "log-usage kept speaking through six stops in a minute — the breaker is gone"
  fi
fi
rm -rf "$brk_dir"

# Rounding is the only thing stopping usage.md changing on every stop. The first
# version of this check lived here, in bash with a python3 probe, and failed
# four ways at once -- it passed when the hook was deleted, when the column it
# measures was deleted, missed any tightening under 12.5x, and skipped silently
# without python3. It is scripts/churn-check.mjs now.
churn_out=$(node "$repo/scripts/churn-check.mjs" 2>&1); churn_code=$?
case $churn_code in
  0) ok "usage.md holds still across an ordinary turn" ;;
  1) bad "usage.md churns — $(printf '%s' "$churn_out" | tail -1)" ;;
  *) bad "the churn check could not run — $(printf '%s' "$churn_out" | head -1)" ;;
esac

prod_after=$(cat "$repo/audit_log/turns.jsonl" 2>/dev/null | cksum)
if [ "$prod_before" = "$prod_after" ]; then
  ok "doctor probes leave the real turn log alone"
else
  bad "a doctor probe wrote into audit_log/turns.jsonl"
fi

# The engine-neutral automatic gate.
#
# Only Claude Code can run something on every turn. Under Codex and Gemini CLI
# the gates run when somebody remembers -- which is the step that gets skipped
# exactly when things are going badly. githooks/pre-commit is the portable
# substitute, and it is opt-in, so whether it is actually on is a fact worth
# reporting rather than assuming.
if [ -x githooks/pre-commit ]; then
  hookspath=$(git -C "$repo" config --get core.hooksPath 2>/dev/null || true)
  if [ "$hookspath" = "githooks" ]; then
    ok "githooks/pre-commit is enabled — the gates run at commit time"
  else
    note "githooks/pre-commit exists but core.hooksPath is '${hookspath:-unset}' — run 'git config core.hooksPath githooks' to gate commits"
  fi
else
  bad "githooks/pre-commit is missing or not executable — engines without hooks have no automatic gate"
fi

# Every source file the harness is made of must be text git can diff.
#
# A stray NUL byte makes git call a file binary: `git diff` shows `Bin 0 -> 4802
# bytes` and nothing else, and scripts/agent-config-diff.sh -- whose whole job
# is reporting what a change does to the agent's own behaviour -- can report
# only that the file changed size. A guard whose source cannot be reviewed is a
# guard whose weakening cannot be reviewed.
#
# It happened here: a glob translator used a placeholder character between two
# passes, and the byte written was NUL. The file ran correctly and read as
# binary for its whole life in the repository.
#
# Detected by comparing each file against itself with NULs stripped, which is
# exactly the property that matters and needs no guess about file types.
nul_files=""
nul_checked=0
while IFS= read -r f; do
  case "$f" in *.png|*.jpg|*.jpeg|*.gif|*.ico|*.pdf|*.woff|*.woff2|*.ttf) continue ;; esac
  [ -f "$f" ] || continue
  nul_checked=$((nul_checked + 1))
  LC_ALL=C tr -d '\000' < "$f" | cmp -s - "$f" || nul_files="$nul_files $f"
done <<EOF
$(git -C "$repo" ls-files scripts .claude .gemini .codex githooks evals docs app/src app/tests AGENTS.md CLAUDE.md GEMINI.md 2>/dev/null)
EOF
if [ "$nul_checked" -eq 0 ]; then
  bad "no source files were examined for NUL bytes — the probe is inert"
elif [ -n "$nul_files" ]; then
  bad "git cannot diff:$nul_files — a NUL byte makes it binary, and a guard nobody can review is not reviewed"
else
  ok "$nul_checked harness source files are text git can diff"
fi

# Every path a hook writes for itself must be one git ignores.
#
# A hook that leaves an untracked or modified file behind on every turn has no
# quiet state: commit it and CI runs and notifies, do not and the "uncommitted
# changes" warning arrives. Either way the next turn is provoked, which is
# ledger row 25 -- a loop that sustained itself for an hour at about a commit a
# minute with no input.
#
# The hooks are ASKED where they write, rather than the answer being kept here.
# A hand-maintained list of hook output paths went stale the moment a hook was
# added: .gitignore named three files, the fourth was not among them, and an
# untracked file appeared in git status on every turn within an hour of that
# row being read.
answered=0
for h in .claude/hooks/*.mjs; do
  [ -e "$h" ] || break
  # stdin from /dev/null, and a bound on the wait. A hook reads its event from
  # stdin, so a probe that lets one inherit doctor.sh's stdin simply blocks --
  # for ever, with no output and no error. That is not hypothetical: it hung
  # this script on its first run, and a check that hangs never reports, which
  # is the same family of failure as one that cannot look.
  where=$(CLAUDE_PROJECT_DIR="$repo" timeout 10 node "$h" --where </dev/null 2>/dev/null)
  [ -n "$where" ] || continue
  answered=$((answered + 1))
  if git -C "$repo" check-ignore -q "$where" 2>/dev/null; then
    ok "$(basename "$h") writes $where, which git ignores"
  else
    bad "$(basename "$h") writes $where and git does not ignore it — the tree dirties every turn"
  fi
done

# A positive, before the absence of a complaint means anything. Every hook
# answering nothing looks exactly like every hook being well behaved -- and it
# is what a probe that blocks on stdin produces, since `timeout` then leaves
# every answer empty and the loop above reports nothing at all.
if [ "$answered" -eq 0 ]; then
  bad "no hook answered --where — the probe is inert and proves nothing about any of them"
else
  ok "$answered hook(s) answered --where"
fi

# The gate hook must never block a stop, whatever it finds. A Stop hook that
# exits non-zero can stop a session from ever finishing, which is worse than
# any verdict it could have delivered.
gs_state=$(mktemp -d)
gs_out=$(printf '{"session_id":"doctor-probe"}' \
  | GATE_STOP_STATE="$gs_state/s.json" CLAUDE_PROJECT_DIR="$repo" \
    bash "$repo/.claude/hooks/gate-stop.sh" 2>/dev/null)
gs_code=$?
if [ "$gs_code" -ne 0 ]; then
  bad "gate-stop exited $gs_code — a Stop hook that blocks can stop a session finishing"
elif printf '%s' "$gs_out" | grep -q '"hookEventName": *"Stop"'; then
  ok "gate-stop returns its verdict as Stop additionalContext"
elif [ -z "$gs_out" ]; then
  note "gate-stop stayed silent — nothing has changed since its last verdict"
else
  bad "gate-stop exited 0 but said nothing a session can read"
fi
rm -rf "$gs_state"

# 0/1/2/3 is a contract between the scripts here. An application's build tool
# knows nothing about it -- and a `test` command exiting 3 was rendered as
# "did not run", a note rather than a failure, with gates.sh then exiting 0.
# The suite died and the gates passed, which is this repository's one rule
# broken by the one path that runs code it did not write.
#
# Asserted against a fixture, on the gate's own JSON, so that some *other*
# gate failing for an unrelated reason cannot make this pass: the claim is
# specifically that `tests` is reported as a failure.
ec_json=$(HARNESS_CONFIG=evals/fixtures/exit-codes/harness.config.json \
  bash "$repo/scripts/gates.sh" --fast --json 2>/dev/null)
ec_status=$(printf '%s' "$ec_json" | grep -A1 '"gate": "tests"' | grep -o '"status": "[a-z-]*"' | head -1)
case "$ec_status" in
  *'"fail"'*)
    ok "an app command exiting 3 is a failed gate, not a did-not-run" ;;
  "")
    bad "the exit-code fixture produced no verdict for the tests gate — the probe is inert" ;;
  *)
    bad "an app command exiting 3 reported as $ec_status — a dead suite reads as a check that never ran" ;;
esac

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
for f in .claude/skills/*/SKILL.md; do
  [ -e "$f" ] || break
  name=$(basename "$(dirname "$f")")
  if head -1 "$f" | grep -q '^---$' \
     && awk 'NR>1 && /^---$/{exit} NR>1 && /^name:/{n=1} END{exit !n}' "$f" \
     && awk 'NR>1 && /^---$/{exit} NR>1 && /^description:/{d=1} END{exit !d}' "$f"; then
    ok "skill $name has name and description"
  else
    bad "skill $name has malformed frontmatter — it will not load, silently"
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
