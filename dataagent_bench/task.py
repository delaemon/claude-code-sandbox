"""Task loading. A task is a directory containing task.json and (usually) context/.

The loader is deliberately lenient about task.json's schema: the raw JSON is
always preserved and shown to the model, while well-known fields (question text,
output column spec) are extracted opportunistically when present.
"""
import json
from dataclasses import dataclass, field
from pathlib import Path

# Keys that plausibly hold the task statement, in priority order.
_QUESTION_KEYS = ["question", "task", "instruction", "instructions", "prompt", "description", "query"]
# Keys that plausibly hold the expected output column list.
_COLUMN_KEYS = ["output_columns", "columns", "answer_columns", "output_format", "output_schema"]


@dataclass
class Task:
    task_dir: Path
    raw: dict
    question: str
    output_columns: list[str] = field(default_factory=list)

    @property
    def task_id(self) -> str:
        return self.raw.get("task_id") or self.raw.get("id") or self.task_dir.name

    @property
    def context_dir(self) -> Path:
        d = self.task_dir / "context"
        return d if d.is_dir() else self.task_dir

    @property
    def gold_path(self) -> Path:
        return self.task_dir / "gold.csv"


def _extract_columns(raw: dict) -> list[str]:
    for key in _COLUMN_KEYS:
        val = raw.get(key)
        if isinstance(val, list) and all(isinstance(c, str) for c in val):
            return val
        if isinstance(val, dict):
            cols = val.get("columns")
            if isinstance(cols, list) and all(isinstance(c, str) for c in cols):
                return cols
    return []


def load_task(task_dir: str | Path) -> Task:
    task_dir = Path(task_dir).resolve()
    task_json = task_dir / "task.json"
    if not task_json.exists():
        raise FileNotFoundError(f"task.json not found in {task_dir}")
    raw = json.loads(task_json.read_text())

    question = ""
    for key in _QUESTION_KEYS:
        if isinstance(raw.get(key), str) and raw[key].strip():
            question = raw[key].strip()
            break
    if not question:
        # fall back to the whole JSON so nothing is silently dropped
        question = json.dumps(raw, ensure_ascii=False, indent=2)

    return Task(task_dir=task_dir, raw=raw, question=question,
                output_columns=_extract_columns(raw))


def discover_tasks(root: str | Path) -> list[Path]:
    """Find every task directory (contains task.json) under root, root included."""
    root = Path(root).resolve()
    if (root / "task.json").exists():
        return [root]
    return sorted(p.parent for p in root.rglob("task.json"))
