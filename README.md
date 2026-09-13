# Agentic AI harness

A reusable harness for developing software with Claude Code, extracted from a
repository where it was built one failure at a time.

The application is yours. Everything else — the gates, the hooks, the audit
trail, the eval suite that replays past failures — is here already, and points
itself at your project through one file.

```bash
bash scripts/doctor.sh      # does this environment satisfy the assumptions?
bash scripts/gates.sh       # is this ready to push?
```

## The one rule

**A guard that cannot run must not look like a guard that passed.**

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

## What is in here

| Path | Holds |
| --- | --- |
| `harness.config.json` | The only file that knows what this harness is pointed at. |
| `.claude/` | Hooks, agents, slash commands, settings. Survives a VM reclaim. |
| `scripts/` | The gates. Each is runnable on its own; `gates.sh` runs them all. |
| `evals/` | Replays every failure in `docs/LEDGER.md` and checks it is still caught. |
| `audit_log/` | Subagent transcripts, redacted, plus per-session token usage. |
| `docs/LEDGER.md` | Every failure this harness has had, paired with the check that catches it now. |
| `docs/worklog/` | What agents must agree on before they start, and one log per run. |
| `.github/workflows/ci.yml` | The same gates, in a third environment. |

## The gates

| Gate | Asks |
| --- | --- |
| typecheck, tests | the ordinary ones — *needs `app.dir`* |
| `clock-boundary.mjs` | has a named class of call escaped the one file allowed to make it? — *opt-in* |
| `mutate.mjs` | if the code were wrong, would the suite notice? — *needs mutants* |
| `churn-check.mjs` | does the usage log still change rarely enough to stay committable? |
| `doctor.sh` | does this environment satisfy what the flow assumes — including running each hook and asserting its exit code? |
| `same-everywhere.sh` | does `doctor.sh` run the same checks on a workstation and in CI? |
| `ledger.sh` | does every check the ledger names still exist? |
| `agent-config-diff.sh` | does this change weaken a guard on the agent's own behaviour? |
| `evals/run.sh` | replays each ledger failure in a throwaway copy and requires the named check to catch it |

The last three are the unusual ones. A ledger of past failures is worth having
only if the checks it credits are real, so `ledger.sh` asserts they exist and
`evals/run.sh` breaks something and requires each to fail — having first
required it to pass, because a "failure" after a break proves nothing if the
check was already failing.

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
