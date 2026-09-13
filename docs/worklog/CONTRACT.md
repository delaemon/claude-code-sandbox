# Agent contract

Fixed before any agent starts, so parallel agents don't collide and neither has
to wait on the other to learn an interface. Nothing here is negotiable by an
agent; if something in it is wrong, say so in your log instead of changing it.

**This is a template.** The harness sections below hold for any project using
it. The application sections are empty until a project fills them in — and an
empty section is honest, while a plausible-looking placeholder is the kind of
thing an agent reads as fact and builds on.

## File ownership (do not write outside your own set)

| Agent | Owns |
|-------|------|
| **app** | the directory named by `app.dir` in `harness.config.json` |
| **harness** | `.claude/`, `.github/`, `scripts/`, `evals/`, root `CLAUDE.md` |

Both write only their own log under `docs/worklog/`. Neither commits; the
orchestrating session reviews and commits.

An agent that needs something from the other's set asks for it in its log. The
two sets are disjoint on purpose: parallel agents run cold and cannot see each
other's work in flight, so a file two of them may write is a file that loses
one of their changes.

## Frozen interface — the harness

These are what the application agent may rely on and the harness agent may not
break without saying so here first.

- **`harness.config.json` is the only place a project-specific fact lives.** Its
  keys are `git.baseBranch`, `app.{dir,install,typecheck,test,testReportsFailures}`,
  `clockBoundary.{enabled,srcDir,allowedFile,forbidden}`, and `mutants[]`.
- **Exit codes across every check**: 0 passed, 1 failed, 2 could not run, 3 not
  configured. `gates.sh` renders 3 as a note and everything else non-zero as a
  failure. A check that cannot run never reports 0.
- **`bash scripts/gates.sh`** is the verdict. `--quick` skips the gates needing
  the network or the base branch.
- **Hooks read stdin as JSON and may block only on `PreToolUse`,
  `UserPromptSubmit` and `Stop`, with exit 2.** `hookSpecificOutput.additionalContext`
  on stdout reaches the next turn.

## Frozen interface — the application

*Fill this in before the first agent runs.* It should pin the things two agents
would otherwise each invent: the package scripts and their exact names, module
boundaries, shared type names, and where the entry point is.

Until it is filled in, `app.dir` is null, the application gates report "did not
run", and there is nothing here for parallel agents to collide over.

## Conventions that fail quietly

*Fill this in.* This section is for the rules where getting it wrong still
almost works — an index order, an off-by-one at a boundary, a coordinate
convention. Those are the ones worth writing down, because a rule that fails
loudly is caught by the first test.

A project that pushes clocks and randomness to a single file should say so here
and turn on `clockBoundary` in `harness.config.json`, so the rule is checked
rather than remembered.
