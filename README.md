# Multi-Agent Coding Pipeline

Claude-powered pipeline that automates the full software development lifecycle:

```
Task Description
  → Requirements Agent     → requirements.md
  → Implementation Agent   → src/*.py
  → Test Generator Agent   → tests/*.py
  → Test Runner Agent      → test_report.json + test_results_summary.md
  → Reporter Agent         → final_report.md
```

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Set your API key
export ANTHROPIC_API_KEY=your_key_here

# Run with a task description
python main.py "Create a Python module that implements a stack data structure with push, pop, peek, and is_empty operations. Include overflow protection with a configurable max size."

# Or interactive mode
python main.py
```

## Architecture

| Component | File | Role |
|-----------|------|------|
| CLI entry | `main.py` | Parses args, calls Orchestrator |
| Orchestrator | `orchestrator.py` | Sequences all agents, manages workspace |
| Base Agent | `agents/base_agent.py` | Agentic loop (tool-use → Claude → repeat) |
| Requirements Agent | `agents/requirements_agent.py` | Spec & acceptance criteria |
| Implementation Agent | `agents/implementation_agent.py` | Production Python code |
| Test Generator | `agents/test_generator.py` | pytest test suite |
| Test Runner | `agents/test_runner.py` | Executes tests, captures JSON report |
| Reporter | `agents/reporter.py` | Final markdown report |
| Workspace | `utils/workspace.py` | Timestamped run directory |
| Tools | `utils/tools.py` | write_file, read_file, list_files, run_command, finish |

## Workspace Layout

Each run creates a timestamped directory under `workspace/`:

```
workspace/
  20240629_153012/
    _meta.json                  ← pipeline metadata
    requirements.md             ← Phase 1 output
    src/
      *.py                      ← Phase 2 output
    tests/
      conftest.py               ← Phase 3 output
      test_*.py
    test_report.json            ← Phase 4 output (pytest JSON)
    test_results_summary.md
    final_report.md             ← Phase 5 output
```

## Agent Design

Each agent extends `BaseAgent` which drives an **agentic tool-use loop**:

1. Send system prompt + user message to Claude
2. Claude responds with tool calls
3. Execute tools → append results
4. Repeat until `finish` tool is called or `end_turn`

Agents share a `Workspace` instance and communicate through files rather than in-memory objects, making each phase independently inspectable and re-runnable.
