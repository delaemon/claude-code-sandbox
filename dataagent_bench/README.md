# DataAgent-Bench (KDD Cup 2026) solution

Pipeline for the DataAgent-Bench task format: each task is a directory with
`task.json` + `context/` (mixed CSV / JSON / documents / SQLite); the agent
must produce a `prediction.csv` that is scored against a hidden `gold.csv`.

The official baseline is a plain ReAct agent (filesystem/python/sqlite tools,
16 steps). This solution keeps that skeleton but attacks where the points
actually are, in priority order:

1. **Local evaluation harness first** (`evaluate.py`) — scores the public
   split and classifies every miss as *format* / *interpretation* /
   *computation*, so each iteration targets the biggest bucket. Format losses
   (right answer, wrong CSV shape) are typically 20–30% of misses on this kind
   of benchmark and are free points.
2. **Code as the source of truth** (`solver.py`, `sandbox.py`) — the model
   never states an answer directly; `prediction.csv` must be written by
   executed Python. Exploration is done *deterministically before the loop*
   (`profiler.py` profiles every context file: CSV schemas, JSON shapes,
   SQLite DDL + row counts, doc excerpts), so agent steps are spent solving.
3. **Format validator inside the loop** (`validator.py`) — `submit` runs the
   validator and bounces violations back to the agent; after the run a
   deterministic `repair()` fixes column case/order, stray index columns,
   whitespace and float formatting against the declared output spec.
4. **Self-consistency** (`consensus.py`) — K independent solves, canonical
   fingerprint vote (whole-file majority → per-cell vote → medoid).
5. **Cross-route verification** (`pipeline.py`) — when the vote is not
   unanimous, one extra solve constrained to an alternative route (SQL if the
   task has SQLite, otherwise pure pandas) is added to the vote; an
   independent route agreeing with a candidate is strong evidence.

## Usage

```bash
pip install -r dataagent_bench/requirements.txt
export ANTHROPIC_API_KEY=...   # or run inside Claude Code remote

# offline check of all deterministic components (no API needed)
python -m dataagent_bench.smoke_test

# solve one task
python -m dataagent_bench.cli solve path/to/task_dir --run-root runs

# solve a whole split, then score it against gold.csv
python -m dataagent_bench.cli solve-all path/to/tasks_root --run-root runs
python -m dataagent_bench.cli eval path/to/tasks_root --run-root runs
# → runs/report.md with accuracy + failure distribution
```

Every intermediate stays on disk under `runs/<task_id>/` (per-sample
`run_k/prediction.csv`, executed snippets, `transcript.json`, `meta.json`),
so a bad task is debugged by reading files, not by re-running.

## Tuning knobs (env vars)

| var | default | meaning |
|---|---|---|
| `DAB_MODEL` | `claude-opus-4-8` | model for all agents (closed track: strongest wins) |
| `DAB_N_SAMPLES` | 3 | self-consistency runs per task |
| `DAB_VERIFY` | 1 | cross-route verification on weak consensus |
| `DAB_MAX_STEPS` | 30 | agent loop budget per run |
| `DAB_PY_TIMEOUT` | 120 | seconds per executed snippet |

Budget guide: cheap sweep = `DAB_N_SAMPLES=1 DAB_VERIFY=0`; leaderboard run =
defaults; hard-task rerun = `DAB_N_SAMPLES=5`.

## Assumptions to re-check against the real starter kit

`task.py` reads `task.json` leniently (question under `question`/`task`/
`instruction`/…, output spec under `output_columns`/`output_format`/…), and the
scorer assumes order-insensitive exact match with numeric tolerance. When the
official starter kit is in hand, align three spots: the key names in
`task.py`, row-order sensitivity in `validator.canonical()` (set
`sort_rows=False` if gold is order-sensitive), and the metric in
`evaluate.score_one()`.

`sample_tasks/demo_sales/` is a toy task for the smoke test and end-to-end
dry runs (build its SQLite part with `python dataagent_bench/sample_tasks/demo_sales/build_db.py`).
