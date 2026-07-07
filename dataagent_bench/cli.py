"""Command line interface.

  # solve one task (writes runs/<task_id>/prediction.csv + all intermediates)
  python -m dataagent_bench.cli solve path/to/task_dir --run-root runs

  # solve every task under a root
  python -m dataagent_bench.cli solve-all path/to/tasks_root --run-root runs

  # score predictions against gold.csv on the public split
  python -m dataagent_bench.cli eval path/to/tasks_root --run-root runs
"""
import argparse
import json
from pathlib import Path

from . import config
from .evaluate import evaluate
from .pipeline import solve_task
from .task import discover_tasks


def main() -> None:
    parser = argparse.ArgumentParser(prog="dataagent_bench")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_solve = sub.add_parser("solve", help="solve a single task directory")
    p_solve.add_argument("task_dir")
    p_solve.add_argument("--run-root", default="runs")
    p_solve.add_argument("--out", default=None, help="where to write the final prediction.csv")
    p_solve.add_argument("--samples", type=int, default=None,
                         help=f"self-consistency runs (default {config.N_SAMPLES})")
    p_solve.add_argument("--no-verify", action="store_true")
    p_solve.add_argument("--quiet", action="store_true")

    p_all = sub.add_parser("solve-all", help="solve every task under a root directory")
    p_all.add_argument("tasks_root")
    p_all.add_argument("--run-root", default="runs")
    p_all.add_argument("--samples", type=int, default=None)
    p_all.add_argument("--no-verify", action="store_true")
    p_all.add_argument("--limit", type=int, default=None)
    p_all.add_argument("--quiet", action="store_true")

    p_eval = sub.add_parser("eval", help="score predictions against gold.csv")
    p_eval.add_argument("tasks_root")
    p_eval.add_argument("--run-root", default="runs")
    p_eval.add_argument("--report-dir", default=None)

    args = parser.parse_args()

    if args.cmd == "solve":
        meta = solve_task(args.task_dir, args.run_root, out_path=args.out,
                          n_samples=args.samples,
                          verify=None if not args.no_verify else False,
                          verbose=not args.quiet)
        print(json.dumps(meta, ensure_ascii=False, indent=2))

    elif args.cmd == "solve-all":
        task_dirs = discover_tasks(args.tasks_root)
        if args.limit:
            task_dirs = task_dirs[: args.limit]
        print(f"{len(task_dirs)} tasks")
        for td in task_dirs:
            try:
                solve_task(td, args.run_root, n_samples=args.samples,
                           verify=None if not args.no_verify else False,
                           verbose=not args.quiet)
            except Exception as e:
                print(f"[pipeline] {td.name}: crashed: {e}")

    elif args.cmd == "eval":
        summary = evaluate(args.tasks_root, args.run_root, args.report_dir)
        print(f"accuracy {summary['n_correct']}/{summary['n_tasks']} "
              f"= {summary['accuracy']:.1%}")
        print(f"failures by class: {summary['failures_by_class']}")
        report_dir = Path(args.report_dir or args.run_root)
        print(f"reports: {report_dir / 'report.md'}, {report_dir / 'report.json'}")


if __name__ == "__main__":
    main()
