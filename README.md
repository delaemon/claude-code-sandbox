# Agentic AI harness

A reusable harness for developing software with Claude Code, built one failure
at a time — every one of them in `docs/LEDGER.md`, paired with the executable
check that now catches it.

The application is yours. Everything else — the gates, the hooks, the audit
trail, the eval suite that replays past failures, and the loop that runs all of
it without being asked — is here already, and points itself at your project
through one file.

```bash
bash scripts/doctor.sh        # does this environment satisfy the assumptions?
bash scripts/gates.sh         # is this ready to push?
node scripts/autopilot.mjs    # which failure do I fix first?
```

`app/` is a working Minesweeper. It is not a demo: a harness with nothing
pointed at it cannot be caught lying, and pointing this one at an application
produced ten new ledger rows in an afternoon — including a gate that reported a
failure already fixed, a gate that went red at random, and a test command whose
exit code made `gates.sh` print `ok` while the suite was dying.

## The one rule

**A guard that cannot run must not look like a guard that passed.**

Every row in `docs/LEDGER.md` is a version of it. One of the most recent: an
application's test command exited 3, `gates.sh` read that in its own vocabulary
as *not configured*, printed a grey note, and exited 0. The suite had died and
the gates passed.

Everything here is that sentence applied repeatedly. Exit codes carry it:

| exit | means | shown as |
| --- | --- | --- |
| 0 | the check ran and passed | `ok` |
| 1 | the check ran and failed | `FAIL` |
| 2 | the check could not look | `FAIL` — a broken guard is a failure |
| 3 | the check is not configured | `note  did not run` |

Straight out of the box, with no application configured, `gates.sh` prints
`note  did not run` for typecheck, tests, the clock boundary and mutation
testing. It does not print `ok`. That is the whole idea, and it is why the
template ships that way rather than with a placeholder that goes green.

## Setup

Everything project-specific lives in `harness.config.json`:

```json
{
  "git":  { "baseBranch": "main" },
  "app":  { "dir": "app", "install": "npm ci",
            "typecheck": "npm run typecheck", "test": "npm test",
            "smoke": "node smoke.mjs",
            "testReportsFailures": "Tests\\s+\\d+\\s+failed" },
  "clockBoundary": { "enabled": false, "srcDir": null, "allowedFile": "main.ts",
                     "forbidden": ["Date.now", "setTimeout", "Math.random"] },
  "mutants": []
}
```

Set `app.dir` and the application gates turn on. Nothing else needs editing:
the hooks, `scripts/`, and `.github/workflows/ci.yml` all read this file, so
there is no directory name hardcoded anywhere for the next project to find.

`testReportsFailures` matters more than it looks. Mutation testing counts a
mutant as killed only when the suite *reports a failed test* — a non-zero exit
can also mean the runner crashed, which proves nothing about the mutant.

`app.smoke` is the gate for the part your unit suite cannot reach. If you push
clocks, randomness and the DOM into one file to make the rest testable, that
file is where all the remaining risk now lives — and nothing was looking at it.
Point this at a script that drives the built application and asserts what a
user sees. Exit 3 from it means *no browser here*, which reports as did-not-run
rather than as a pass.

## What is in here

| Path | Holds |
| --- | --- |
| `harness.config.json` | The only file that knows what this harness is pointed at. |
| `app/` | The application it is pointed at — a pure core, and one shell file holding every clock, random source and DOM call. |
| `.claude/` | Hooks, agents, slash commands, settings. Survives a VM reclaim. |
| `scripts/` | The gates. Each is runnable on its own; `gates.sh` runs them all. |
| `evals/` | Replays every failure in `docs/LEDGER.md` and checks it is still caught. |
| `audit_log/` | Subagent transcripts, redacted, plus per-session token usage. |
| `docs/LEDGER.md` | Every failure this harness has had, paired with the check that catches it now. |
| `docs/AUTOMATION.md` | The loop: what runs the gates, what reads them, and what records what they found. |
| `docs/worklog/` | What agents must agree on before they start, and one log per run. |
| `.github/workflows/ci.yml` | The same gates, in a third environment. |

## The gates

| Gate | Asks |
| --- | --- |
| typecheck, tests | the ordinary ones — *needs `app.dir`* |
| `smoke.mjs` | does the application work in a browser, where the unit suite cannot look? — *needs `app.smoke`* |
| `clock-boundary.mjs` | has a named class of call escaped the one file allowed to make it? — *opt-in* |
| `mutate.mjs` | if the code were wrong, would the suite notice? — *needs mutants* |
| `churn-check.mjs` | does the usage log still change rarely enough to stay committable? |
| `doctor.sh` | does this environment satisfy what the flow assumes — including running each hook and asserting its exit code? |
| `same-everywhere.sh` | does `doctor.sh` run the same checks on a workstation and in CI? |
| `ci-trigger.mjs` | does CI actually run on the branch everything merges into? |
| `agent-contract.mjs` | do all three agent engines still read the same `AGENTS.md`? |
| `ci-parity.mjs` | does CI run every gate `gates.sh` runs? |
| `ledger.sh` | does every check the ledger names still exist? |
| `eval-runner.sh` | can the eval suite tell its own four outcomes apart? |
| `learn-check.sh` | does `learn.mjs` really refuse a row whose check catches nothing? |
| `agent-config-diff.sh` | does this change weaken a guard on the agent's own behaviour? |
| `evals/run.sh` | replays each ledger failure in a throwaway copy and requires the named check to catch it |

The bottom half are the unusual ones: they check the checks. A ledger of past
failures is worth having only if the checks it credits are real, so `ledger.sh`
asserts they exist and `evals/run.sh` breaks something and requires each to
fail — having first required it to pass, because a "failure" after a break
proves nothing if the check was already failing. And the suite that does all
that replaying was itself unreplayed until `eval-runner.sh` existed: untested
code deciding whether tested code can be trusted.

Three tiers, and **a tier always names what it did not ask**:

| | gates | takes |
| --- | --- | --- |
| `gates.sh --fast` | 6 | ~2s — what runs on every turn, or at commit time |
| `gates.sh --quick` | 11 | ~20s |
| `gates.sh` | 17 | ~2m — the only tier allowed to say *all gates pass* |

## Three engines, one contract

Claude Code, Codex and Gemini CLI all work in this repository, and all three
read the same **`AGENTS.md`**. Nothing is generated per vendor: each engine is
pointed at the original by its own native mechanism.

| | reads the contract via | engine-specific file |
| --- | --- | --- |
| Claude Code | `CLAUDE.md` with `@AGENTS.md` | `CLAUDE.md`, `.claude/` |
| Codex | `AGENTS.md` natively | `.codex/` |
| Gemini CLI | `.gemini/settings.json` → `context.fileName` | `GEMINI.md` |

Three mechanisms means unwiring one leaves the other two working and CI green,
so `scripts/agent-contract.mjs` reads what each engine would read and fails if
any of them has lost the contract — or if an adapter has started restating it
instead of importing it. [`docs/ENGINES.md`](docs/ENGINES.md) is the full
picture, including why the contract is **not** compiled per vendor.

Hooks, permissions, MCP servers and model choice stay per engine on purpose.
Everything below that seam — `scripts/`, `evals/`, CI — never learns which
engine invoked it.

## The loop that runs it

Checks you have to remember to run are checks that get skipped exactly when
things are going badly. Three pieces close that, and
[`docs/AUTOMATION.md`](docs/AUTOMATION.md) is the long version:

| | |
| --- | --- |
| `.claude/hooks/gate-stop.sh` | Stop hook (Claude Code). Runs the fast tier every turn and hands the next turn a work order, so a turn cannot end believing green while the tree is red. Writes nothing tracked, goes quiet after five stops in a minute, never claims green from a subset. |
| `githooks/pre-commit` | The same fast tier at commit time, for engines with no hook system. `git config core.hooksPath githooks` to enable. |
| `scripts/autopilot.mjs` | Orders the failures by what causes what, pulls the evidence out of each gate's own output, says what to do next. |
| `scripts/learn.mjs` | Writes a ledger row and its eval case, replays it, and **removes both unless the check was seen to catch the break**. |

`learn.mjs` is why the ledger's *verified by breaking* column is now earned by
running rather than typed. It refuses a break that damages nothing, a break
whose `sed` never matched, and a check that was already failing — each of which
has happened here, and each of which reads as success if nobody looks.

## Why a ledger

Every row in `docs/LEDGER.md` is a way this harness was once wrong, and the
check that means it cannot be wrong that way again. It is inherited history:
the failures happened in the project this was extracted from, and the checks
came out of them. They are kept because the *shapes* recur — a guard that
cannot run, a test that passes vacuously, a probe that pollutes what it
measures — and because a check with no story attached is the first one someone
deletes.

## Environments

The same flow from a cloud session (phone, web) and from a dev container on a
machine. `.devcontainer/` carries the container, `.claude/` the hooks,
`.github/workflows/` the CI. `doctor.sh` is what asserts the two environments
really do satisfy the same assumptions, because a hook that works in one and
quietly does nothing in the other is the failure mode that matters — and one
that has already happened.
