# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository structure

This repo contains two independent projects:

- **Root (`main.py`, `orchestrator.py`, `agents/`, `utils/`)** — a multi-agent coding pipeline that automates the full SDLC using the Anthropic API.
- **`f1map/`** — a standalone FastAPI + vanilla-JS web app that visualizes F1 race telemetry using FastF1 data. See `f1map/CLAUDE.md` for its commands and architecture.

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

Hook contract, for anything added here: the tool call arrives as JSON on stdin;
exit 0 allows it, **exit 2 blocks it and feeds stderr back to Claude as the
reason**, any other code only surfaces an error without blocking. A broken hook
fails silently, so run a new hook by hand against both a case it should block
and one it should allow before committing it.

Prefer a hook over an instruction in this file when something must happen every
time: this file is advisory and can be missed, whereas hooks are executed by the
harness.

### Pending: does `enabledPlugins` reach a cloud session?

`settings.json` registers the official marketplace via `extraKnownMarketplaces`
and enables `claude-code-setup@claude-plugins-official`. This is a probe, not a
dependency — nothing in this repo needs that plugin, and its one skill is
read-only. It is here to settle a question the docs leave open.

The docs say two things that pull in opposite directions:

- *"declare the plugin under `enabledPlugins` in `.claude/settings.json` for
  cloud sessions"* — so committing it is the documented route.
- *"As of v2.1.195, adding the marketplace doesn't install plugins that come
  from an external source … doesn't load until the team member installs it"* —
  and a GitHub-hosted marketplace is an external source.

Which one wins in a cloud session can only be observed at session start, so
**check this at the start of the next session on this repo**:

- **Loaded** — a skill named `claude-code-setup:claude-automation-recommender`
  appears in the available skills. Committing plugins works here; replace the
  probe with a plugin that earns its place (`pr-review-toolkit` and
  `commit-commands` are the plausible candidates for this repo; `typescript-lsp`
  is not — cloud sessions don't start plugin language servers).
- **Not loaded** — the plugin is reported as not installed, with a
  `claude plugin install` command to run. Then committed plugins only reach
  local CLI sessions, and the two keys should be dropped from `settings.json`
  rather than left as decoration.

Record the answer here either way and delete this section: an experiment nobody
wrote down gets run again.
