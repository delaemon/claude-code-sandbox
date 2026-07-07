"""Full per-task pipeline:

  profile → K independent solves (self-consistency) → vote →
  [weak consensus?] cross-route verification solve → adjudicate →
  deterministic repair → final prediction.csv

Runs are laid out under <run_root>/<task_id>/run_k/ so every intermediate
prediction and transcript stays inspectable, mirroring the file-based
debuggability of the root pipeline's workspace/ convention.
"""
import json
import shutil
from pathlib import Path

from . import config
from .consensus import vote
from .solver import solve_once
from .task import Task, load_task
from .validator import frames_match, load_prediction, repair, validate


def _has_sqlite(task: Task) -> bool:
    exts = {".sqlite", ".sqlite3", ".db"}
    return any(p.suffix.lower() in exts for p in task.context_dir.rglob("*") if p.is_file())


def solve_task(task_dir: str | Path, run_root: str | Path, out_path: str | Path | None = None,
               n_samples: int | None = None, verify: bool | None = None,
               verbose: bool = True) -> dict:
    """Solve one task end to end. Returns a metadata dict (also written to meta.json)."""
    task = load_task(task_dir)
    n_samples = n_samples if n_samples is not None else config.N_SAMPLES
    verify = verify if verify is not None else config.VERIFY
    run_root = Path(run_root) / task.task_id
    run_root.mkdir(parents=True, exist_ok=True)
    out_path = Path(out_path) if out_path else run_root / "prediction.csv"

    # ── phase 1: K independent solves ────────────────────────────────────────
    candidates = []
    for k in range(n_samples):
        temp = config.TEMPERATURES[k % len(config.TEMPERATURES)]
        result = solve_once(task, run_root / f"run_{k}", temperature=temp, verbose=verbose)
        if result.prediction_path:
            candidates.append(result.prediction_path)
        elif verbose:
            print(f"[pipeline] run_{k} produced no prediction")

    if not candidates:
        meta = {"task_id": task.task_id, "status": "failed", "reason": "no run produced a prediction"}
        (run_root / "meta.json").write_text(json.dumps(meta, indent=2))
        return meta

    consensus = vote(candidates)

    # ── phase 2: cross-route verification when consensus is weak ─────────────
    verification = None
    if verify and not consensus.unanimous:
        route = "sql" if _has_sqlite(task) else "pandas"
        vres = solve_once(task, run_root / "run_verify", temperature=0.0,
                          route=route, verbose=verbose)
        if vres.prediction_path:
            agree = frames_match(load_prediction(consensus.winner),
                                 load_prediction(vres.prediction_path))
            verification = {"route": route, "agrees": agree}
            if not agree:
                # the verifier disagrees with a weak consensus: re-vote with the
                # verification run included — an independent route that matches
                # any original candidate is strong evidence for that answer
                consensus = vote(candidates + [vres.prediction_path])
                verification["revoted"] = True

    # ── phase 3: deterministic repair + final validation ─────────────────────
    shutil.copyfile(consensus.winner, out_path)
    repair(out_path, task.output_columns or None)
    final = validate(out_path, task.output_columns or None)

    meta = {
        "task_id": task.task_id,
        "status": "ok" if final.ok else "format_error",
        "prediction": str(out_path),
        "n_candidates": len(candidates),
        "consensus": {"method": consensus.method, "unanimous": consensus.unanimous,
                      "majority": consensus.majority, "votes": list(consensus.votes.values())},
        "verification": verification,
        "validation": {"ok": final.ok, "errors": final.errors, "warnings": final.warnings},
    }
    (run_root / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    if verbose:
        print(f"[pipeline] {task.task_id}: {meta['status']} "
              f"(consensus={consensus.method}, verify={verification})")
    return meta
