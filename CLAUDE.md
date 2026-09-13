# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this repository is

A reusable harness for agentic development, and nothing else yet. The
application is whatever the next project puts here; the harness is the point.

Everything project-specific lives in **`harness.config.json`** — where the code
is, how to install, typecheck and test it, which mutants to apply, which branch
is the integration branch. No script, hook or workflow knows a directory name.
Adding a hardcoded path to one is the thing to avoid here.

| Path | Holds |
| --- | --- |
| `harness.config.json` | The only file that knows what this harness is pointed at. |
| `.claude/` | Hooks, agents, commands and settings — the part that survives a VM reclaim. |
| `scripts/` | The gates. `gates.sh` runs them all and gives one verdict. |
| `evals/` | Replays the failures in `docs/LEDGER.md` against the checks that claim to catch them. |
| `docs/LEDGER.md` | Every failure this harness has had, and the check that catches it now. |
| `docs/worklog/` | `CONTRACT.md`, what parallel agents must agree on before they start, and one log per run. |
| `audit_log/` | Redacted transcripts of every agent run, and what each session spent. |
| `.github/workflows/` | CI — the same gates in a third environment. |

## The one rule

**A guard that cannot run must not look like a guard that passed.** Every
failure in `docs/LEDGER.md` is a version of it, and the exit codes carry it:

| exit | means | `gates.sh` shows |
| --- | --- | --- |
| 0 | ran, passed | `ok` |
| 1 | ran, failed | `FAIL` |
| 2 | could not look | `FAIL` — a broken guard is a failure |
| 3 | not configured | `note  did not run` |

With no `app.dir` set, typecheck, tests, the clock boundary and mutation
testing report **3**. They are not green. Keep it that way: a template that
printed `ok` for a check it never performed would teach the opposite of its
own lesson.

## Pointing it at an application

Set `app.dir` in `harness.config.json` and the application gates turn on.
`install`, `typecheck` and `test` are the commands to run inside that
directory.

`testReportsFailures` is the regex that means "the suite reported a failed
test". Mutation testing needs it because **a non-zero exit is not a kill** — a
mutant that breaks the parser or hangs also exits non-zero, with nothing having
asserted on the behaviour it claims to test.

`clockBoundary` is opt-in and off by default: pushing clocks and randomness to a
single file is a real design choice, not every project makes it, and a check
configured for a project that did not make it fails on correct code.
`evals/fixtures/clock/` is a fixture, not an application — it exists so the
clock check is still exercised when no project is configured.

**When adding a test, ask whether a plausible bug in the code it covers would
fail it. If not, add a mutant.** Mutants must damage **behaviour, never data**:
the first attempt to prove a renderer's colour tests bit did it by permuting the
palette, which passes, correctly, because the expectations are written against
that same palette.

## Two environments, one flow

The same flow from a cloud session and from a dev container: work on a session
branch, open a PR against the integration branch, merge.

| | Cloud session (mobile, web) | Dev container (a machine) |
| --- | --- | --- |
| Where it runs | Anthropic-managed VM, reclaimed when idle | Docker on your machine, repo bind-mounted |
| Setup | none | **Reopen in Container** — `.devcontainer/devcontainer.json` |
| Node | 22 | 22, pinned to the same major |
| Opening a PR | the GitHub tools | `gh`, installed by a feature |
| Type errors surface via | `hooks/typecheck.sh` | the language server, plus the same hook |
| Edits land | in the VM; lost unless pushed | on your disk immediately |

**`bash scripts/gates.sh` is the one command for "is this ready to push".**
`doctor.sh` runs each hook and asserts its exit code, because a hook that works
in one environment and quietly does nothing in the other is the failure that
matters here. `same-everywhere.sh` asserts `doctor.sh` itself runs the same
checks in both. CI runs all of them, so drift is caught rather than discovered.

Follow from this when adding to the harness:

- **Depend on `node`, not `python3`.** Node is required by the harness itself,
  so it exists wherever this repository is usable. Python is optional and only
  `audit_log`'s tests use it.
- **A guard that cannot run must not look like a guard that passed.**
  `block-secrets.sh` falls back to matching its raw input when no parser is
  available, and still refuses.
- **Add a case to `doctor.sh`** for anything new that could differ between the
  two environments.

### The harness checks itself

Three of `gates.sh`'s gates are about the harness rather than the application:

- **`evals/run.sh`** replays every failure `docs/LEDGER.md` claims is caught.
  Each case breaks something in a throwaway copy and asserts the named check
  fails, **having first required it to pass** — without that, a check already
  broken for some other reason would report a success it did not earn. The
  ledger's "verified by breaking" column was a hand-written claim until this
  existed. **A new check belongs here as a case, not only as a paragraph.**
- **`scripts/ledger.sh`** asserts every check the ledger names still exists. A
  deleted check means the failure can happen again, while the table goes on
  saying it cannot.
- **`scripts/agent-config-diff.sh`** reviews changes to the agent's own
  configuration, below.

### Changes to the agent's own behaviour

Some files here decide what the agent may do and what the next session
believes. `scripts/agent-config-diff.sh` holds the list, reports every change to
them into the pull request summary, and **fails only when a guard is weaker than
on the base** — adding one never blocks. The asymmetry is deliberate: changes to
these files are constant, and a check that fails on all of them gets ignored.

Its checks compare **effective state and behaviour, never diff lines** — ask "is
`.env` still refused?", not "was this line removed?". A textual check cannot
tell a rewrite that kept every protection from one that dropped them, and cannot
see a guard hollowed out in place. `docs/LEDGER.md` row 4 is what happens
otherwise. **Write new checks the same way.**

### Token usage is logged, every session

**What a session or an agent run cost is written alongside the logs, always**,
and **shown in the conversation every turn**. One definition throughout: output
+ cache writes + fresh input, never cache reads, which would report the context
size times the turn count rather than the work.

| where | what | written by |
| --- | --- | --- |
| `audit_log/turns.jsonl` | one line per stop, **append-only**, numbers only | `hooks/log-usage.sh` |
| `audit_log/usage.md` | one rounded row per session | the same hook |
| `audit_log/INDEX.md` | a `tokens` column per subagent run | `export.py` |
| `docs/worklog/*.md` | the cost of the run an entry describes | by hand |

**Per-turn detail goes in `turns.jsonl` because it appends.** The churn that
forced rounding came from rewriting a row in place and re-sorting it, so the
file changed on every stop for reasons unrelated to the numbers; an append adds
one line. `usage.md` stays rounded so the durable summary is not fifty rows of
one session. `docs/LEDGER.md` rows 6, 12 and 13 carry that history.

**Hook output is staged outside git until there is other work to commit it
with** — `audit_log/.turns-pending.jsonl` and friends, folded in by
`scripts/fold-logs.mjs` when `gates.sh` runs. A tracked file that changes every
turn has no quiet state: commit it and CI runs and notifies, don't commit it and
the "uncommitted changes" warning arrives instead. Either way the next turn is
provoked. `paths-ignore` does not help — on `pull_request` it is evaluated
against the whole PR diff, not the push.

**The line returns to the conversation on every stop.** It was once narrowed to
threshold crossings on a suspicion of a hook talking itself into a loop — never
diagnosed, and it removed something that had been asked for. A rate breaker
targets the runaway instead: five stops inside a minute is faster than a person,
so the line goes quiet and `turns.jsonl` keeps recording.

**Subagent totals cover only runs that left a transcript**, and the line says
how many those are. `agent_transcript_path` names where a transcript would go,
not where one is.

**Never claim to know how much quota is left.** Nothing records it: rate-limit
state reaches a transcript only on a refusal, never while requests are being
served. A number invented here would be believed right up until the session
stopped working. *Nothing enforces this — it is prose, and prose is missed.*

That a session which could not be measured is never written as one that cost
nothing **is** enforced, by `doctor.sh`.

## Branch and PR workflow

The integration branch is named in `harness.config.json` (`git.baseBranch`), and
`scripts/branch-state.sh` is the one place that reads it. Work happens on
disposable session branches (`claude/<slug>-<suffix>`) cut from it and merged
back by pull request.

- **Set the base explicitly on every PR.** GitHub resets the base dropdown to
  the repository default, so a PR opened without setting it targets the wrong
  branch. In this repository the default branch is a leftover session branch and
  nothing is ever merged into it.
- When the base advances, bring it in with `git merge`. Do **not** rebase:
  session branches are already pushed, and rewriting their history breaks any
  checkout that has them.
- **Once your PR is merged, the branch is finished.** Re-cut it from the base
  rather than committing on top of the merged tip. `scripts/branch-state.sh`
  detects that state and prints the command; `doctor.sh` fails on it.

## Cloud session constraints

Sessions run in an ephemeral VM, reclaimed after a period of inactivity.
Reopening restores the conversation but not the VM: uncommitted work,
background shell commands and running subagents are gone.

- Commit and push early. Work that exists only on disk is temporary.
- A session waiting for the user to approve a tool call counts as *inactive* and
  can expire during that wait. Keep routine commands in `permissions.allow`
  rather than letting them prompt.
- Durable state lives outside the VM: GitHub, and server-side Routines (the
  `send_later` tool).

## Claude Code harness (`.claude/`)

Config here survives a VM reclaim, so behaviour that must hold across sessions
belongs in these files rather than in a prompt.

`doctor.sh` asserts what each hook *does*, so what follows is only the reasoning
a check cannot hold:

- `settings.json` allowlists `npm`, `pytest` and read-only commands. **`npm
  install` is deliberately absent**: pulling an arbitrary package is exactly the
  moment a prompt is worth paying for.
- `block-secrets.sh` falls back to matching its raw payload when no JSON parser
  is available, **over-blocking rather than failing open**.
- `session-start.sh` and `typecheck.sh` read `harness.config.json` and do
  nothing when no application is configured. `typecheck.sh` also exits 0 when
  `node_modules` is missing, so it can never block work before install.
- `log-usage.sh` **exits 0 on every path**. A Stop hook that blocked could stop
  a session from ever finishing, which is worse than a missing row.
- `record-subagent.sh` (SubagentStop) writes to `audit_log/subagents.jsonl`. It
  records the payload's **known fields by value and the rest by name only**: the
  documented schema is incomplete, this repository is public, and an
  unrecognised field could hold conversation text. Its known list is therefore a
  disclosure decision — only fields that cannot carry a message belong in it —
  and `doctor.sh` asserts both halves.

**Hook contract.** The event arrives as JSON on stdin. **Exit 2 blocks**, on the
events that support blocking (`PreToolUse`, `UserPromptSubmit`, `Stop`), and the
reason comes from stderr. Any other non-zero code surfaces an error without
blocking.

**Exit 0 is not silent.** Stderr is discarded, but **stdout is read as JSON**,
and `hookSpecificOutput.additionalContext` reaches the next turn's reasoning —
supported on `Stop`, `SessionStart`, `UserPromptSubmit` and `PostToolUse`, but
not `PreToolUse`, which uses `permissionDecision` instead.

**Reach for exit 0 with `additionalContext` first; exit 2 is for stopping
something, not for being heard.** Believing otherwise cost a tool call every
turn — `docs/LEDGER.md` row 8.

A hook that breaks fails silently, so run a new one by hand against a case it
should block and one it should allow, then give it a `doctor.sh` case.

Prefer a hook over an instruction in this file whenever something must happen
every time: this file is advisory and can be missed, hooks are executed by the
harness.

### Plugins

`settings.json` registers `anthropics/claude-plugins-official` via
`extraKnownMarketplaces` and enables plugins through `enabledPlugins`. **This
works in cloud sessions** — verified here, with no per-user `claude plugin
install`. A committed `settings.json` is a real distribution channel.

Two limits it does not lift: plugins load at **session start**, so a change
reaches only the next session and only on the branch that session checks out;
and cloud sessions never start plugin language servers, which is why
`hooks/typecheck.sh` rather than `typescript-lsp` is what catches type errors
there.

## CI (`.github/workflows/ci.yml`)

One job on Node 22. It reads `harness.config.json` through
`node scripts/config.mjs --github-output`, so it holds no project-specific fact
either — the workflow is the same file in every repository using this harness.
The harness gates always run; the application steps are skipped when no
`app.dir` is set, and a step writes into the run summary saying they **did not
run** rather than leaving four grey ticks next to green ones.

The `push` trigger names the integration branch explicitly, because a
default-branch trigger would never fire here. The `pull_request` trigger is left
unfiltered so every PR in the repository is checked.
