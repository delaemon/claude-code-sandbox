# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this repository is

A browser Puyo Puyo in TypeScript, and the harness that develops it. The game
is the deliverable; the harness is the point, since this repository doubles as a
sandbox for practising multi-agent development.

| Path | Holds |
| --- | --- |
| `puyopuyo/` | The game. The only application code here. |
| `.claude/` | Hooks and settings — the part of the setup that survives a VM reclaim. |
| `docs/worklog/` | `CONTRACT.md`, what parallel agents must agree on before they start, and one log per agent run. |
| `audit_log/` | Redacted transcripts of every agent run, the exporter that writes them, and `usage.md` — what each session spent. |
| `.github/workflows/` | CI. |

## Puyo Puyo (`puyopuyo/`)

TypeScript + Vite, tested with Vitest. No framework and no runtime
dependencies. Run everything with `puyopuyo/` as the working directory:

```bash
npm ci
npm run dev        # play it
npm test
npm run typecheck
npm run build
```

The architecture is one idea applied repeatedly: **everything that makes code
hard to test is pushed outward, and `main.ts` absorbs all of it.**

| Layer | Rule |
| --- | --- |
| `src/core/` | Board, gravity, groups, chain resolution. Plain data in and out. No DOM, no timers, no randomness. |
| `src/game/` | `step(state, input)`. Time arrives as `tick(ms)`; the queue's `rng` is injected. |
| `src/score/` | Scoring over a `ResolveResult`. Depends on `core` and nothing else. |
| `src/input/` | Keyboard with DAS/ARR, and touch gestures. Both advance via `advance(ms)`, never a timer; `combineInputs` presents them to the loop as one. |
| `src/render/` | Geometry and drawing. Takes state and a context. |
| `src/main.ts` | **The only file that may read a clock or generate randomness.** |

Keep that boundary. It is why the whole suite runs with no clock and nothing
flakes, and `scripts/clock-boundary.mjs` is what holds it — it strips comments
first, because several files describe the rule in prose, and it refuses to
report a pass when `main.ts` no longer matches its pattern.

Two conventions worth repeating because getting them wrong fails quietly:

- **`board[y][x]`, `y` downward.** Transposed, the game almost works.
- **The hidden row (row 0) does not pop.** It is `resolve`'s `hiddenRows`
  option, defaulting to 0 so the rule tests still exercise any board; the game
  layer passes `HIDDEN_ROWS`.

Board geometry and the chain rules are fixed in `docs/worklog/CONTRACT.md`.
`tsconfig.json` sets `incremental` with its build info under
`node_modules/.cache/`, so a per-edit `typecheck` costs about a second.

## Two environments, one flow

This repository is worked on from two places, and the flow is the same from
either: **work on a session branch, open a PR against `puyo-puyo-web`, merge.**

| | Cloud session (mobile, web) | Dev container (a machine) |
| --- | --- | --- |
| Where it runs | Anthropic-managed VM, reclaimed when idle | Docker on your machine, repo bind-mounted |
| Setup | none | **Reopen in Container** — `.devcontainer/devcontainer.json` |
| Node | 22 | 22, pinned to the same major |
| Opening a PR | the GitHub tools | `gh`, installed by a feature |
| Type errors surface via | `hooks/typecheck.sh` | the language server, plus the same hook |
| Edits land | in the VM; lost unless pushed | on your disk immediately |

Everything that makes the flow work is committed, so neither environment needs
setting up by hand: `.claude/` carries the hooks and settings, `.devcontainer/`
carries the container, and `.github/workflows/` carries CI.

**`bash scripts/gates.sh` is the one command for "is this ready to push"** —
typecheck, tests, `doctor.sh`, the ledger and the config review. `doctor.sh`
runs each hook and asserts its exit code, because a hook that works in one
environment and quietly does nothing in the other is the failure that matters
here. CI runs both, so drift is caught rather than discovered.

Follow from this when adding to the harness:

- **Depend on `node`, not `python3`.** The project is TypeScript, so node exists
  wherever this repository is usable. Python is optional and only
  `audit_log`'s tests use it.
- **A guard that cannot run must not look like a guard that passed.**
  `block-secrets.sh` falls back to matching its raw input when no parser is
  available, and still refuses.
- **Add a case to `doctor.sh`** for anything new that could differ between the
  two.

### The harness checks itself

`bash scripts/gates.sh` is the single verdict, and two of its gates are about
the harness rather than the game:

- **`scripts/mutate.mjs`** damages behaviour and requires the suite to notice —
  the renderer ignoring its palette, `cellRect` transposed, the hidden-row
  offset dropped, the chain multiplier frozen. A passing suite proves the tests
  ran, not that they would catch anything. Mutating the *palette* is
  deliberately not among them: the hex values are a design choice, which is
  exactly why the first attempt to prove the colour tests bit did it that way
  and passed. **A new test belongs here as a mutant** if a plausible bug in the
  code it covers would not fail it.
- **`evals/run.sh`** replays every failure `docs/LEDGER.md` claims is caught.
  Each case breaks something in a throwaway copy and asserts the named check
  fails, **having first required it to pass** — without that, a check already
  broken for some other reason would report a success it did not earn. The
  ledger's "verified by breaking" column was a hand-written claim until this
  existed. **A new check belongs here as a case, not only as a paragraph.**
- **`scripts/agent-config-diff.sh`** reviews changes to the agent's own
  configuration, below.

Exit **3 means a check did not run**, and `gates.sh` shows it as a note rather
than a pass. The config gate returns it when there is no base ref to compare
against: an ordinary situation, but one that used to print `ok`.

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

`puyo-puyo-web` is a long-lived integration branch and **the end of the line**.
Work happens on disposable session branches (`claude/<slug>-<suffix>`) cut from
it and merged back by pull request.

- **Open every PR with `base: puyo-puyo-web`.** GitHub resets the base dropdown
  to the repository default on every new PR, so set it explicitly each time —
  it is the easiest mistake to make in this layout.
- **Nothing is ever merged into the default branch.** `puyo-puyo-web` is where
  the work stops. Do not open a PR against the default branch, and do not treat
  one as owed at the end of the project.
- The default branch is `claude/getting-started-1olkod`, not `main` — a
  leftover session branch. It matters only as the thing a PR must *not*
  accidentally target.
- When the base advances, bring it in with `git merge puyo-puyo-web`. Do **not**
  rebase: session branches are already pushed, and rewriting their history
  breaks any checkout that has them.
- **Once your PR is merged, the branch is finished.** Re-cut it from the base
  rather than committing on top of the merged tip. `scripts/branch-state.sh`
  detects that state and prints the command; `doctor.sh` fails on it.
- Because nothing leaves this branch, changes on it carry no consequence
  anywhere else.

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
- `typecheck.sh` exits 0 when `node_modules` is missing, so it can never block
  work before install.
- `log-usage.sh` **exits 0 on every path**. A Stop hook that blocked could stop
  a session from ever finishing, which is worse than a missing row.
- `record-subagent.sh` (SubagentStop) writes to `audit_log/subagents.jsonl`. It
  records the payload's **known fields by value and the rest by name only**: the
  documented schema is incomplete, this repository is public, and an
  unrecognised field could hold conversation text. Its known list is therefore a
  disclosure decision — only fields that cannot carry a message belong in it —
  and `doctor.sh` asserts both halves.

  It has already earned its place. The published reference does not name
  `agent_transcript_path`; two recorded payloads do, and it is the field that
  would retire the glob in `audit_log/export.py`. `export.py` is not pointed at
  it yet: knowing a field exists is not knowing what it holds.

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

One job on Node 22: `npm ci`, `npm run typecheck`, `npm test`, with `puyopuyo/`
as the working directory.

The `push` trigger names `puyo-puyo-web` explicitly, because a default-branch
trigger would never fire here. The `pull_request` trigger is left unfiltered so
every PR in the repository is checked.
