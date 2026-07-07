# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository structure

This repo contains three independent projects:

- **Root (`main.py`, `orchestrator.py`, `agents/`, `utils/`)** — a multi-agent coding pipeline that automates the full SDLC using the Anthropic API.
- **`f1map/`** — a standalone FastAPI + vanilla-JS web app that visualizes F1 race telemetry using FastF1 data. See `f1map/CLAUDE.md` for its commands and architecture.
- **`golf_swing_pose/`** — a PyTorch pipeline that extracts 2D golf-swing skeleton keypoints and swing-phase (address/top/impact/etc.) events from front-view iPhone video, using an original SimCC-style pose head and a BiLSTM event head (not a wrapper around MediaPipe/MMPose). See `golf_swing_pose/README.md` for setup, usage, and accuracy caveats.

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
