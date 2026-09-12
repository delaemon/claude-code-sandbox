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
| `audit_log/` | Redacted transcripts of every agent run, plus the exporter that writes them. |
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

Keep that boundary. It is why 190 tests run with no clock and nothing flakes,
and `grep` for `Date.now`, `performance.now`, `setTimeout`,
`requestAnimationFrame` or `Math.random` outside `main.ts` is the check that it
still holds.

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

**`bash scripts/doctor.sh` checks that the environment you are in actually
satisfies those assumptions.** It reports the toolchain, then runs each hook and
asserts its exit code, because a hook that works in one environment and quietly
does nothing in the other is the failure mode that matters here — and one that
has already happened: the hooks once parsed their input with `python3`, which
the cloud image has and a container need not, and on a host without it the
secret guard exited 0 and let `.env` through. CI runs `doctor.sh` too, so drift
is caught rather than discovered.

Follow from this when adding to the harness:

- **Depend on `node`, not `python3`.** The project is TypeScript, so node exists
  wherever this repository is usable. Python is optional and only
  `audit_log`'s tests use it.
- **A guard that cannot run must not look like a guard that passed.**
  `block-secrets.sh` falls back to matching its raw input when no parser is
  available, and still refuses.
- **Add a case to `doctor.sh`** for anything new that could differ between the
  two.

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
  before doing anything else — `git fetch origin puyo-puyo-web && git checkout
  -B <branch> origin/puyo-puyo-web` — rather than committing on top of the
  merged tip. `scripts/doctor.sh` fails when every commit on the branch is
  already in the base, which is exactly that state.
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

- `settings.json` — wires the hooks below, registers the official plugin
  marketplace, and allowlists `npm`, `pytest`, read-only `git` and common read
  commands. `npm install` is deliberately absent: pulling an arbitrary package
  is exactly the moment a prompt is worth paying for.
- `hooks/session-start.sh` (SessionStart) — installs dependencies so a fresh
  container is usable immediately.
- `hooks/block-secrets.sh` (PreToolUse on `Edit|Write|NotebookEdit`) — blocks
  edits to `.env`, `*.pem`, `*.key` and the session token file. When no JSON
  parser is available it matches the raw payload instead and still refuses,
  over-blocking rather than failing open.
- `hooks/typecheck.sh` (PostToolUse on `Edit|Write`) — runs `npm run typecheck`
  in `puyopuyo/` after any edit to a `.ts` file there and **exits 2 on type
  errors**. It exits 0 for other paths, and when `node_modules` is missing, so
  it can never block work before install.

**Hook contract.** The tool call arrives as JSON on stdin. Exit 0 allows it;
**exit 2 blocks it and feeds stderr back to Claude as the reason**; any other
code surfaces an error without blocking. Stderr from a hook that exits 0 is
discarded and never reaches Claude, which is why `typecheck.sh` exits 2 rather
than merely printing. A broken hook fails silently, so run a new one by hand
against both a case it should block and one it should allow before committing
it.

Prefer a hook over an instruction in this file whenever something must happen
every time: this file is advisory and can be missed, hooks are executed by the
harness.

### Plugins

`settings.json` registers `anthropics/claude-plugins-official` via
`extraKnownMarketplaces` and enables plugins through `enabledPlugins`. **This
works in cloud sessions**, verified here: the plugin's skills appeared with no
per-user `claude plugin install`, settling a question the docs answer two
incompatible ways. A committed `settings.json` is a real distribution channel,
not just a local-CLI one.

Two limits it does not lift. Plugins load at **session start**, so a change
reaches only the next session, and only if it is on the branch that session
checks out. And cloud sessions never start plugin language servers.

`pr-review-toolkit` earns its slot because all work here goes through pull
requests. `typescript-lsp` is enabled for the local case — it gives inline
diagnostics when the repository is opened on a machine, and is ignored rather
than broken in the cloud, so one committed config serves both. In a cloud
session `hooks/typecheck.sh` is what actually catches type errors.

## CI (`.github/workflows/ci.yml`)

One job on Node 22: `npm ci`, `npm run typecheck`, `npm test`, with `puyopuyo/`
as the working directory.

The `push` trigger names `puyo-puyo-web` explicitly, because a default-branch
trigger would never fire here. The `pull_request` trigger is left unfiltered so
every PR in the repository is checked.
