# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository structure

This repo contains three independent projects:

- **Root (`main.py`, `orchestrator.py`, `agents/`, `utils/`)** — a multi-agent coding pipeline that automates the full SDLC using the Anthropic API.
- **`f1map/`** — a standalone FastAPI + vanilla-JS web app that visualizes F1 race telemetry using FastF1 data. See `f1map/CLAUDE.md` for its commands and architecture.
- **`puyopuyo/`** — a browser Puyo Puyo game in TypeScript (see below).

They do not share code or dependencies; treat them as separate codebases when making changes.

## Multi-Agent Coding Pipeline (root)

### Commands

```bash
# Install dependencies
pip install -r requirements.txt

# Set API key (or rely on Claude Code remote OAuth token at /home/claude/.claude/remote/.session_ingress_token)
export ANTHROPIC_API_KEY=your_key_here

# Run with a task description
python main.py "Create a Python module that implements a stack with push/pop/peek and overflow protection."

# Or interactive mode (paste task, then Ctrl+D)
python main.py
```

There is no test suite for this pipeline's own code — `pytest`/test generation is something the pipeline *produces* for the task it's given, run inside each `workspace/<run_id>/` directory, not against this repo.

### Architecture

```
Task Description
  → RequirementsAgent     → requirements.md
  → ImplementationAgent   → src/*.py
  → TestGeneratorAgent    → tests/*.py
  → TestRunnerAgent       → test_report.json + test_results_summary.md
  → ReporterAgent         → final_report.md
```

- `orchestrator.py` sequences the five agents and passes each phase's output as input to the next (e.g. `requirements.md` text is fed into the implementation prompt, source files are fed into test generation).
- Every agent extends `agents/base_agent.py:BaseAgent`, which drives an agentic tool-use loop: send system prompt + message → Claude responds with tool calls → `utils/tools.py:ToolHandler` executes them → results appended to message history → repeat until the agent calls the `finish` tool or returns `end_turn`.
- Agents communicate only through files in a shared `Workspace` (`utils/workspace.py`), not in-memory objects — each phase's artifacts are independently inspectable and the pipeline can be debugged by reading `workspace/<run_id>/_meta.json` and the per-phase output files.
- Each run gets a fresh timestamped directory: `workspace/<YYYYmmdd_HHMMSS>/`.
- Tool set available to agents (`utils/tools.py`): `write_file`, `read_file`, `list_files`, `run_command` (shell, 120s timeout, scoped to the workspace dir), and `finish` (ends the agent's loop with a summary + artifact list).
- Model and token limit are hardcoded in `agents/base_agent.py` (`MODEL = "claude-sonnet-4-6"`, `MAX_TOKENS = 8192`) — change there, not per-agent.
- Each agent file (`agents/*_agent.py`, `agents/reporter.py`, `agents/test_runner.py`) defines only a `SYSTEM` prompt and a `tools` list; behavior changes for a given phase mean editing that file's prompt, not `base_agent.py`.

## Puyo Puyo (`puyopuyo/`)

TypeScript + Vite, tested with Vitest; no framework and no runtime dependencies.
Run everything with `puyopuyo/` as the working directory: `npm ci`, then
`npm run dev`, `npm test`, `npm run typecheck`, `npm run build`.

`src/core/` is pure — board, gravity, group detection and chain resolution take
and return plain data, touch no DOM and import nothing from the rendering layer.
That is what makes the rules testable, so keep new rule logic there and let the
rendering layer read from it rather than reimplementing it. Board geometry and
the chain rules are fixed in `docs/worklog/CONTRACT.md`; `board[y][x]` with `y`
downward is the one convention worth repeating here, because transposing it
silently produces a game that almost works.

`tsconfig.json` sets `incremental` with its build info under
`node_modules/.cache/` so a per-edit `typecheck` costs about a second.

## Branch and PR workflow

`puyo-puyo-web` is a long-lived integration branch. Work happens on disposable
session branches (`claude/<slug>-<suffix>`) cut from it, which are merged back
via pull request.

- **Open every PR with `base: puyo-puyo-web`.** GitHub resets the base dropdown
  to the repository default on every new PR, so this must be set explicitly each
  time — it is the easiest mistake to make in this layout.
- **The repository default branch is `claude/getting-started-1olkod`, not
  `main`.** It is a leftover session branch that ended up as the default. Only
  the final `puyo-puyo-web` → default PR should target it.
- When the base advances, bring it in with `git merge puyo-puyo-web`. Do **not**
  rebase: session branches are already pushed, and rewriting their history
  breaks any checkout that has them.
- This layout adds one PR that is easy to forget: `puyo-puyo-web` → the default
  branch, once the project is done.

## Cloud session constraints

Sessions run in an ephemeral VM that is reclaimed after a period of inactivity.
Reopening a session restores the conversation history but not the VM — anything
uncommitted, plus background shell commands and running subagents, is gone.

- Commit and push early. Work that exists only on disk is temporary.
- A session waiting for the user to approve a tool call counts as *inactive* and
  can expire during that wait. Keep routine commands in `permissions.allow`
  (below) rather than letting them prompt.
- Durable state lives outside the VM: GitHub, and server-side Routines (the
  `send_later` tool). Anything held only inside the VM does not survive.

## Claude Code harness (`.claude/`)

Config here is the part of the setup that survives a VM reclaim, so behaviour
that must hold across sessions belongs in these files rather than in a prompt.

- `settings.json` — wires the hooks below and allowlists `pytest`, read-only
  `git`, and common read commands so they don't trigger permission prompts.
- `hooks/session-start.sh` (SessionStart) — installs the root
  `requirements.txt` so a fresh container can run the pipeline immediately.
  `f1map/`'s deps (pandas/numpy/fastf1) are deliberately left out: they take
  minutes to install and are rarely needed.
- `hooks/block-secrets.sh` (PreToolUse on `Edit|Write|NotebookEdit`) — blocks
  edits to `.env`, `*.pem`, `*.key` and the session token file.
- `hooks/typecheck.sh` (PostToolUse on `Edit|Write`) — runs `npm run typecheck`
  in `puyopuyo/` after any edit to a `.ts` file there, and **exits 2 on type
  errors**. Exit 2 is not decoration: stderr from a PostToolUse hook that exits
  0 is discarded, so reporting failure any other way means Claude never sees it.
  The hook exits 0 without running anything for other paths, and also when
  `puyopuyo/node_modules` is missing, so it can never block work before install.

Hook contract, for anything added here: the tool call arrives as JSON on stdin;
exit 0 allows it, **exit 2 blocks it and feeds stderr back to Claude as the
reason**, any other code only surfaces an error without blocking. A broken hook
fails silently, so run a new hook by hand against both a case it should block
and one it should allow before committing it.

Prefer a hook over an instruction in this file when something must happen every
time: this file is advisory and can be missed, whereas hooks are executed by the
harness.

### Committed plugins do load in cloud sessions (verified)

A probe settled this, since the docs answer it twice and incompatibly:
`discover-plugins` says to declare a plugin under `enabledPlugins` in
`.claude/settings.json` when `/plugin` is unavailable, while
`settings-reference` says that as of v2.1.195 a plugin from an external source
does not load until each user installs it — and a GitHub-hosted marketplace is
an external source.

**Result: it loads.** With `extraKnownMarketplaces` registering
`anthropics/claude-plugins-official` and `enabledPlugins` naming a plugin from
it, that plugin's skills appeared in a cloud session on this repo with no
per-user `claude plugin install`. So `.claude/settings.json` is a working
distribution channel here, not just for local CLI sessions.

Two caveats the probe does not cover: plugins load at **session start**, so a
change only takes effect in the next session, and it must be on the branch that
session checks out — a plugin added on a session branch does not reach sessions
cut from `puyo-puyo-web` until it merges. Cloud sessions also don't start plugin
language servers, so LSP plugins (`typescript-lsp` and friends) are pointless
here whatever the settings say.

`pr-review-toolkit` is enabled: this repo's work runs through pull requests
against `puyo-puyo-web`, so review agents are the plugin that earns its slot.
`typescript-lsp` is enabled too, despite the line above: it is dead weight in a
cloud session but gives inline diagnostics on `puyopuyo/` when the repo is
opened locally, and being ignored rather than broken here means one committed
config serves both. In a cloud session `hooks/typecheck.sh` is what actually
catches type errors.

## CI (`.github/workflows/ci.yml`)

One job on Node 22: `npm ci`, `npm run typecheck`, `npm test`, all with
`puyopuyo/` as the working directory.

The `push` trigger names `puyo-puyo-web` explicitly. A workflow that triggers on
the default branch would never run here, because the default branch is a
leftover session branch (see above) that nothing is pushed to. The
`pull_request` trigger is deliberately left unfiltered: restricting it to base
`puyo-puyo-web` would skip the one PR that targets the default branch.
