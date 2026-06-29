# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository structure

This repo contains two independent projects:

- **Root (`main.py`, `orchestrator.py`, `agents/`, `utils/`)** — a multi-agent coding pipeline that automates the full SDLC using the Anthropic API.
- **`f1map/`** — a standalone FastAPI + vanilla-JS web app that visualizes F1 race telemetry using FastF1 data.

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

## F1 Race Map (`f1map/`)

### Commands

```bash
cd f1map
pip install -r requirements.txt

# Run directly
python server.py        # http://0.0.0.0:8000

# Run with LAN URL + QR code for phone access
python start.py [--port 8000] [--host 0.0.0.0]
```

No test suite exists for this app.

### Architecture

- `server.py` is a FastAPI backend that wraps the `fastf1` library (F1's official timing API). All FastF1 calls are blocking/sync, so every loader (`_load_schedule`, `_load_info`, `_load_positions`, `_load_laps`, `_load_telemetry`) runs inside `run_in_threadpool` from the async route handlers.
- Two separate caches exist and must not be confused:
  - `cache/` — FastF1's own raw HTTP/session cache (`fastf1.Cache.enable_cache`).
  - `data_cache/` — this app's processed JSON cache, one file per `(year, round, session_type[, driver])`. Each cached file embeds `"_v": CACHE_VERSION`; bump `CACHE_VERSION` in `server.py` whenever the shape of cached data changes — stale-version files are auto-deleted and recomputed on next request.
- `_load_info` determines the real driver lineup for a session from `session.laps["DriverNumber"]` (actual participants), falling back to `session.drivers` only if no lap data exists — this avoids showing retired/non-starting drivers.
- Position/telemetry data is resampled onto a uniform time axis at `SAMPLE_HZ` (4 Hz) via linear interpolation (`_resample`), so the frontend always receives evenly spaced frames regardless of FastF1's native sampling.
- Errors distinguish "data not available" (`ValueError` → HTTP 404, with a Japanese message suggesting 2023/2024 data) from unexpected failures (→ HTTP 500).
- The frontend (`static/index.html`, `static/app.js`, `static/style.css`) is plain JS/CSS served directly via `StaticFiles` — no build step.
- `start.py` is a convenience launcher that detects the LAN IP, prints a QR code (via `qrcode` if installed), and otherwise imports and runs the same `server:app`.
