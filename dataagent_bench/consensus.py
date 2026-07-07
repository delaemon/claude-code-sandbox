"""Self-consistency voting across independent solve runs.

Single-run ReAct variance is the cheapest thing to buy back: run the solver
K times at different temperatures, canonicalize each prediction.csv, and vote.
Whole-file majority first; if no majority but shapes agree, per-cell vote;
otherwise the medoid (the prediction most similar to the others).
"""
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from .validator import canonical, fingerprint, load_prediction


@dataclass
class ConsensusResult:
    winner: Path                 # path of the chosen prediction.csv
    votes: dict                  # fingerprint -> count
    unanimous: bool
    majority: bool               # strict majority (> K/2)
    method: str                  # "unanimous" | "majority" | "cell-vote" | "medoid" | "single"


def vote(paths: list[Path]) -> ConsensusResult:
    paths = [p for p in paths if p and Path(p).exists()]
    if not paths:
        raise ValueError("no candidate predictions to vote on")
    if len(paths) == 1:
        return ConsensusResult(paths[0], {}, unanimous=True, majority=True, method="single")

    fps = {p: fingerprint(p) for p in paths}
    counts = Counter(fps.values())
    top_fp, top_n = counts.most_common(1)[0]

    if len(counts) == 1:
        return ConsensusResult(paths[0], dict(counts), True, True, "unanimous")
    if top_n > len(paths) / 2:
        winner = next(p for p in paths if fps[p] == top_fp)
        return ConsensusResult(winner, dict(counts), False, True, "majority")

    # no strict majority: try a per-cell vote if all frames share canonical shape
    frames = {p: canonical(load_prediction(p)) for p in paths}
    shapes = {(tuple(f.columns), len(f)) for f in frames.values()}
    if len(shapes) == 1:
        merged = _cell_vote(list(frames.values()))
        merged_fp = merged.to_csv(index=False)
        # if the merged frame equals one of the candidates, return that file;
        # otherwise write the merged frame next to the first candidate
        for p in paths:
            if fps[p] == merged_fp:
                return ConsensusResult(p, dict(counts), False, False, "cell-vote")
        out = paths[0].parent.parent / "prediction_cellvote.csv"
        merged.to_csv(out, index=False)
        return ConsensusResult(out, dict(counts), False, False, "cell-vote")

    # shapes disagree: pick the medoid — the candidate whose fingerprint ties
    # with the most other candidates (falls back to the largest cluster's rep)
    winner = next(p for p in paths if fps[p] == top_fp)
    return ConsensusResult(winner, dict(counts), False, False, "medoid")


def _cell_vote(frames: list[pd.DataFrame]) -> pd.DataFrame:
    base = frames[0].copy()
    for col in base.columns:
        for i in range(len(base)):
            values = [f[col].iloc[i] for f in frames]
            base.loc[i, col] = Counter(values).most_common(1)[0][0]
    return base
