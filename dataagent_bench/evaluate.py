"""Local evaluation harness — build this first, everything else iterates on it.

Scores predictions against gold.csv on the public/demo split and, crucially,
classifies every miss so the failure distribution tells you where the points
are: format losses (right answer, wrong CSV shape) are fixed in validator.py,
interpretation losses (wrong row set) in the solve prompt, computation losses
(right shape, wrong values) by consensus/verification.
"""
import json
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from . import config
from .task import discover_tasks, load_task
from .validator import canonical, load_prediction, validate


@dataclass
class TaskScore:
    task_id: str
    correct: bool
    failure_class: str        # "" | "missing" | "format" | "interpretation" | "computation"
    detail: str
    cell_accuracy: float      # diagnostic; 1.0 for correct tasks


def _cells_equal(x: str, y: str) -> bool:
    if x == y:
        return True
    try:
        return bool(np.isclose(float(x), float(y),
                               rtol=config.REL_TOL, atol=config.ABS_TOL))
    except ValueError:
        return False


def score_one(pred_path: Path, gold_path: Path, expected_columns: list[str] | None) -> TaskScore:
    task_id = gold_path.parent.name
    if not pred_path.exists():
        return TaskScore(task_id, False, "missing", "no prediction.csv produced", 0.0)

    val = validate(pred_path, expected_columns)
    if not val.ok:
        return TaskScore(task_id, False, "format", "; ".join(val.errors), 0.0)

    gold = canonical(load_prediction(gold_path))
    pred = canonical(load_prediction(pred_path))

    if list(pred.columns) != list(gold.columns):
        return TaskScore(task_id, False, "format",
                         f"columns {list(pred.columns)} != gold {list(gold.columns)}", 0.0)
    if len(pred) != len(gold):
        return TaskScore(task_id, False, "interpretation",
                         f"{len(pred)} rows vs gold {len(gold)} — wrong entity set/filter", 0.0)

    total = max(1, len(gold) * len(gold.columns))
    wrong = sum(
        0 if _cells_equal(pred[c].iloc[i], gold[c].iloc[i]) else 1
        for c in gold.columns for i in range(len(gold))
    )
    acc = 1 - wrong / total
    if wrong == 0:
        return TaskScore(task_id, True, "", "", 1.0)
    return TaskScore(task_id, False, "computation",
                     f"{wrong}/{total} cells differ", round(acc, 4))


def evaluate(tasks_root: str | Path, predictions_root: str | Path,
             report_dir: str | Path | None = None) -> dict:
    """Score every task under tasks_root that has a gold.csv.

    predictions_root is the run_root used by pipeline.solve_task: the
    prediction for task <id> is expected at <predictions_root>/<id>/prediction.csv.
    """
    tasks_root = Path(tasks_root)
    predictions_root = Path(predictions_root)
    report_dir = Path(report_dir) if report_dir else predictions_root

    scores: list[TaskScore] = []
    for task_dir in discover_tasks(tasks_root):
        gold = task_dir / "gold.csv"
        if not gold.exists():
            continue
        task = load_task(task_dir)
        pred = predictions_root / task.task_id / "prediction.csv"
        scores.append(score_one(pred, gold, task.output_columns or None))

    if not scores:
        raise SystemExit(f"no tasks with gold.csv found under {tasks_root}")

    n = len(scores)
    n_correct = sum(s.correct for s in scores)
    by_class: dict[str, int] = {}
    for s in scores:
        if not s.correct:
            by_class[s.failure_class] = by_class.get(s.failure_class, 0) + 1

    summary = {
        "n_tasks": n,
        "n_correct": n_correct,
        "accuracy": round(n_correct / n, 4),
        "failures_by_class": by_class,
        "tasks": [asdict(s) for s in scores],
    }
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / "report.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    (report_dir / "report.md").write_text(_markdown_report(summary))
    return summary


def _markdown_report(summary: dict) -> str:
    lines = [
        "# DataAgent-Bench local evaluation",
        "",
        f"**Accuracy: {summary['n_correct']}/{summary['n_tasks']} = {summary['accuracy']:.1%}**",
        "",
        "## Failure distribution",
        "",
    ]
    if summary["failures_by_class"]:
        for cls, cnt in sorted(summary["failures_by_class"].items(), key=lambda x: -x[1]):
            lines.append(f"- {cls}: {cnt}")
    else:
        lines.append("- (none)")
    lines += ["", "## Per-task results", "", "| task | result | class | detail | cell acc |",
              "|---|---|---|---|---|"]
    for t in summary["tasks"]:
        mark = "✅" if t["correct"] else "❌"
        lines.append(f"| {t['task_id']} | {mark} | {t['failure_class']} "
                     f"| {t['detail'][:80]} | {t['cell_accuracy']:.2f} |")
    return "\n".join(lines) + "\n"
