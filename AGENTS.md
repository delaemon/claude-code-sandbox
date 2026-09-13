# AGENTS.md

The contract for any coding agent working in this repository.

**This file is the single source of truth, and no engine owns it.** Claude Code,
Codex and Gemini CLI all read *this* text — see `docs/ENGINES.md` for how each
one is pointed at it. `scripts/agent-contract.mjs` fails the build if any of
them stops reading it, because an engine quietly running on a different contract
is exactly the kind of silent failure this repository exists to refuse.

Engine-specific material lives beside each engine's own configuration and is
deliberately **not** unified: `CLAUDE.md` for Claude Code, `GEMINI.md` for
Gemini CLI. Those files add; they never restate what is here.

## What this repository is

A reusable harness for agentic development, and one application to keep it
honest. The harness is the point; `app/` exists because a harness with nothing
pointed at it cannot be caught lying. Four of its gates reported "did not run"
until the application arrived, and pointing it at one produced eleven ledger
rows in an afternoon.

Everything project-specific lives in **`harness.config.json`** — where the code
is, how to install, typecheck, test and smoke it, which mutants to apply, which
branch is the integration branch, which engines are supported. No script, hook
or workflow knows a directory name. Adding a hardcoded path to one is the thing
to avoid here.

| Path | Holds |
| --- | --- |
| `harness.config.json` | The only file that knows what this harness is pointed at. |
| `AGENTS.md` | This file. The contract every engine reads. |
| `app/` | The application the harness is pointed at. A pure core, and one shell file holding every clock, random source and DOM call. |
| `scripts/` | The gates. `gates.sh` runs them all and gives one verdict; `autopilot.mjs` says which to fix first; `learn.mjs` records what was learned. |
| `evals/` | Replays the failures in `docs/LEDGER.md` against the checks that claim to catch them. |
| `docs/LEDGER.md` | Every failure this harness has had, and the check that catches it now. |
| `docs/ENGINES.md` | How each agent engine is wired to this contract, and what is not shared. |
| `docs/AUTOMATION.md` | The loop: what runs the gates, what reads them, what records the result. |
| `docs/worklog/` | `CONTRACT.md`, what parallel agents must agree on before they start, and one log per run. |
| `audit_log/` | Redacted transcripts of every agent run, and what each session spent. |
| `.github/workflows/` | CI — the same gates in an engine-free environment. |

## The one rule

**A guard that cannot run must not look like a guard that passed.** Every
failure in `docs/LEDGER.md` is a version of it, and the exit codes carry it:

| exit | means | `gates.sh` shows |
| --- | --- | --- |
| 0 | ran, passed | `ok` |
| 1 | ran, failed | `FAIL` |
| 2 | could not look | `FAIL` — a broken guard is a failure |
| 3 | not configured | `note  did not run` |

With no `app.dir` set, typecheck, tests, the clock boundary, the browser smoke
check and mutation testing report **3**. They are not green. Keep it that way:
a template that printed `ok` for a check it never performed would teach the
opposite of its own lesson.

**That vocabulary is a contract between the scripts here, and nothing else
speaks it.** `tsc` exits 2 for "type errors found"; a test runner that blows up
can exit anything. So `gates.sh` translates an application command's code
rather than passing it through — zero is a pass, anything else is a failed
gate — and did-not-run stays a judgement the harness makes, never one an
arbitrary command makes on its behalf. Reading them literally meant a test
command exiting 3 rendering as `note tests did not run` while `gates.sh`
exited 0: the suite died and the gates passed. Ledger row 38.

`app.smoke` is the exception, and a deliberate one: it is a script written
against this contract, living in this repository, and its exit 3 (no browser
driver here) is passed through.

## Pointing it at an application

Set `app.dir` in `harness.config.json` and the application gates turn on.
`install`, `typecheck` and `test` are the commands to run inside that
directory.

`testReportsFailures` is the regex that means "the suite reported a failed
test". Mutation testing needs it because **a non-zero exit is not a kill** — a
mutant that breaks the parser or hangs also exits non-zero, with nothing having
asserted on the behaviour it claims to test.

**The boundary concentrates risk as well as removing it.** Pushing every clock,
random source and DOM call into one file is what lets the core be tested with
no browser and nothing flaky — and it leaves every remaining untestable thing
in that one file, which nothing then opened. A browser found a fresh ten-mine
game reporting `0` mines remaining, past fifty-two green tests. `app.smoke` is
the gate for the shell: a command like `app.test`, so the harness still knows
no directory name, and exit 3 rather than a pass on a machine with no browser
driver.

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

## Running the gates

**`bash scripts/gates.sh` is the one command for "is this ready to push".**
`--fast` is the couple-of-seconds tier, `--quick` skips the browser and the
minutes-long gates, and `--json` hands the results to a program instead of
asking it to parse coloured text. **A tier names the gates it did not ask**, and
never prints "all gates pass".

| | gates | takes |
| --- | --- | --- |
| `gates.sh --fast` | 6 | ~2s — what an edit can break |
| `gates.sh --quick` | 11 | ~20s |
| `gates.sh` | 17 | ~2m — the only tier allowed to say *all gates pass* |

`node scripts/autopilot.mjs` turns a failing run into a work order: the failures
ordered by **what causes what**, with the evidence pulled out of each gate's own
output. Work it from the top — a failing typecheck makes every test result
below it meaningless.

Nothing in `scripts/` or `evals/` knows which engine invoked it. That is the
point: the verdict on a change must not depend on who wrote it.

### The harness checks itself

Several gates are about the harness rather than the application:

- **`evals/run.sh`** replays every failure `docs/LEDGER.md` claims is caught.
  Each case breaks something in a throwaway copy and asserts the named check
  fails, **having first required it to pass** — without that, a check already
  broken for some other reason would report a success it did not earn.
  **A new check belongs here as a case, not only as a paragraph.**
- **`scripts/ledger.sh`** asserts every check the ledger names still exists. A
  deleted check means the failure can happen again, while the table goes on
  saying it cannot.
- **`scripts/eval-runner.sh`** puts four synthetic cases to the eval runner,
  one per outcome. It cannot be an eval case — the runner refuses a `CHECK`
  that re-enters it — so the suite that replays every other check was itself
  unreplayed until this existed.
- **`scripts/learn-check.sh`** exercises `learn.mjs`'s refusal path, which is
  the half that matters and the half least likely to run on its own.
- **`scripts/agent-contract.mjs`** asserts every engine still reads this file.
- **`scripts/ci-parity.mjs`** asserts CI runs every gate `gates.sh` runs.
  They are two hand-maintained lists of the same questions and nothing
  compared them; two gates had no CI step at all.
- **`scripts/ci-trigger.mjs`** asserts CI actually runs on the integration
  branch. `on:` is evaluated before any step, so it is the one line that cannot
  read `harness.config.json`.
- **`scripts/agent-config-diff.sh`** reviews changes to the agent's own
  configuration, below.

### Recording what went wrong

`docs/LEDGER.md` pairs every failure this harness has had with the check that
now catches it. **Do not add a row by hand.** `node scripts/learn.mjs` writes
the row *and* its eval case, replays the case, and removes both unless the
check passed against an unbroken copy and failed against a broken one. It
refuses a break that damages nothing, a break whose `sed` never matched, and a
check that was already failing — all three have happened here, and all three
read as success if nobody looks.

```bash
node scripts/learn.mjs --name <slug> --failure "<behaviour>" \
  --check "<command that must fail after the break>" \
  --break "<shell that damages a throwaway copy>"
```

`--next` prints the next free row number; `--dry-run` writes and verifies
nothing.

### Changes to the agent's own behaviour

Some files decide what an agent may do and what the next session believes.
`scripts/agent-config-diff.sh` holds the list — every engine's configuration,
not one engine's — reports every change to them into the pull request summary,
and **fails only when a guard is weaker than on the base**; adding one never
blocks. The asymmetry is deliberate: changes to these files are constant, and a
check that fails on all of them gets ignored.

Its checks compare **effective state and behaviour, never diff lines** — ask "is
`.env` still refused?", not "was this line removed?". A textual check cannot
tell a rewrite that kept every protection from one that dropped them, and cannot
see a guard hollowed out in place. `docs/LEDGER.md` row 4 is what happens
otherwise. **Write new checks the same way.**

## Branch and PR workflow

The integration branch is named in `harness.config.json` (`git.baseBranch`), and
`scripts/branch-state.sh` is the one place that reads it. Work happens on
disposable session branches cut from it and merged back by pull request.

- **Set the base explicitly on every PR.** GitHub resets the base dropdown to
  the repository default, so a PR opened without setting it targets the wrong
  branch. `scripts/ci-trigger.mjs` asserts that `git.baseBranch` and the
  workflow's `push` trigger still name the same branch — they had both drifted
  to a finished project's session branch, so CI would have run on nothing.
- When the base advances, bring it in with `git merge`. Do **not** rebase:
  session branches are already pushed, and rewriting their history breaks any
  checkout that has them.
- **Once your PR is merged, the branch is finished.** Re-cut it from the base
  rather than committing on top of the merged tip. `scripts/branch-state.sh`
  detects that state and prints the command; `doctor.sh` fails on it.

## Adding to the harness

- **Depend on `node` and POSIX shell, and on nothing else.** Not on a third
  runtime, and not on anything an engine provides: a gate that only runs under
  one agent is a gate the other two do not have. Node is required by the
  harness itself and POSIX shell needs no installing, so between them the setup
  cost is one thing. `audit_log` was the last holdout — its exporter and tests
  were Python, and the gate that ran them printed `ok` with pytest not
  installed, so they had never run here or in CI. `node --test` is built in.
- **A guard that cannot run must not look like a guard that passed.**
  `block-secrets.sh` falls back to matching its raw input when no parser is
  available, and still refuses.
- **Add a case to `scripts/doctor.sh`** for anything that could differ between
  environments, and an eval case for anything the ledger claims is caught.
- **Prose is missed.** Prefer a check the harness executes over a sentence in a
  markdown file — including this one. A rule worth keeping is worth a gate.

## Instructions are not enforcement

Every engine treats these files as *context*, not as configuration it obeys.
None of them guarantee compliance, and all of them can be argued out of a rule
by a persuasive-looking diff.

So: anything that must hold every time belongs in something that executes —
a gate in `scripts/`, a step in CI, or an engine hook where the engine has one.
`docs/ENGINES.md` says which engines have hooks and what to use where they do
not. This file is advice; `gates.sh` is the verdict.
