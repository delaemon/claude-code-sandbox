"""Offline smoke test for every deterministic component (no API key needed).

  python -m dataagent_bench.smoke_test

Covers: task loading, context profiling (CSV/JSON/SQLite), format validation +
repair, canonical fingerprinting, consensus voting, and the evaluation harness
including failure classification. The LLM solve loop itself is exercised
separately with `cli.py solve` once ANTHROPIC_API_KEY is available.
"""
import shutil
import sqlite3
import tempfile
from pathlib import Path

from .consensus import vote
from .evaluate import evaluate, score_one
from .profiler import profile_context
from .task import load_task
from .validator import fingerprint, repair, validate

DEMO = Path(__file__).parent / "sample_tasks" / "demo_sales"


def _build_sqlite(context_dir: Path) -> None:
    db = context_dir / "stores.sqlite"
    db.unlink(missing_ok=True)
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE stores (store_id TEXT PRIMARY KEY, city TEXT)")
    conn.executemany("INSERT INTO stores VALUES (?, ?)",
                     [("S1", "Tokyo"), ("S2", "Osaka")])
    conn.commit()
    conn.close()


def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="dab_smoke_"))
    task_root = tmp / "tasks" / "demo_sales"
    shutil.copytree(DEMO, task_root)
    _build_sqlite(task_root / "context")

    # ── task loading ──────────────────────────────────────────────────────────
    task = load_task(task_root)
    assert task.task_id == "demo_sales"
    assert task.output_columns == ["category", "total_revenue"]
    assert "total revenue" in task.question
    print("task loading ................ ok")

    # ── profiler ──────────────────────────────────────────────────────────────
    profile = profile_context(task.context_dir)
    for needle in ["orders.csv", "products.json", "stores.sqlite",
                   "order_date", "category", "CREATE TABLE stores"]:
        assert needle in profile, f"profile missing {needle!r}"
    print("profiler .................... ok")

    # ── validator: messy but correct prediction gets repaired ────────────────
    runs = tmp / "runs"
    pred_dir = runs / "demo_sales"
    pred_dir.mkdir(parents=True)
    pred = pred_dir / "prediction.csv"
    # wrong column case+order, stray index column, whitespace, float formatting
    pred.write_text(",Total_Revenue ,CATEGORY\n0,600.00, software\n1,75,hardware \n")
    res = validate(pred, task.output_columns)
    assert res.warnings or not res.ok
    repair(pred, task.output_columns)
    res = validate(pred, task.output_columns)
    assert res.ok, res.report()
    assert fingerprint(pred) == fingerprint(task.gold_path), "repair should make it gold-equivalent"
    print("validator + repair .......... ok")

    # ── consensus voting ──────────────────────────────────────────────────────
    a, b, c = (tmp / f"cand_{i}.csv" for i in range(3))
    a.write_text("category,total_revenue\nhardware,75.0\nsoftware,600.0\n")
    b.write_text("CATEGORY,Total_Revenue\nsoftware,600.000\nhardware,75\n")  # same after canon
    c.write_text("category,total_revenue\nhardware,999.0\nsoftware,600.0\n")
    cons = vote([a, b, c])
    assert cons.majority and cons.method == "majority"
    assert fingerprint(cons.winner) == fingerprint(a)
    print("consensus vote .............. ok")

    # ── evaluator + failure classification ───────────────────────────────────
    summary = evaluate(tmp / "tasks", runs)
    assert summary["accuracy"] == 1.0, summary

    wrong_val = tmp / "wrong_val.csv"
    wrong_val.write_text("category,total_revenue\nhardware,75.0\nsoftware,601.0\n")
    s = score_one(wrong_val, task.gold_path, task.output_columns)
    assert s.failure_class == "computation", s

    wrong_rows = tmp / "wrong_rows.csv"
    wrong_rows.write_text("category,total_revenue\nhardware,75.0\n")
    s = score_one(wrong_rows, task.gold_path, task.output_columns)
    assert s.failure_class == "interpretation", s

    wrong_cols = tmp / "wrong_cols.csv"
    wrong_cols.write_text("cat,revenue\nhardware,75.0\nsoftware,600.0\n")
    s = score_one(wrong_cols, task.gold_path, task.output_columns)
    assert s.failure_class == "format", s

    s = score_one(tmp / "does_not_exist.csv", task.gold_path, task.output_columns)
    assert s.failure_class == "missing", s
    print("evaluator + classification .. ok")

    shutil.rmtree(tmp)
    print("\nall smoke tests passed")


if __name__ == "__main__":
    main()
