"""prediction.csv validation, canonicalization and deterministic repair.

Empirically a large share of losses on this kind of benchmark are format
losses — the computed answer is right but the CSV differs from gold in column
naming/casing, column order, row order, float formatting, or stray whitespace.
Everything here is deterministic; the validator also runs *inside* the solve
loop (via the submit tool), so the agent gets a chance to fix its own format
violations before the run ends.
"""
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from . import config


@dataclass
class ValidationResult:
    ok: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def report(self) -> str:
        lines = []
        for e in self.errors:
            lines.append(f"ERROR: {e}")
        for w in self.warnings:
            lines.append(f"warning: {w}")
        return "\n".join(lines) or "ok"


def _norm_col(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(name).lower())


def load_prediction(path: Path) -> pd.DataFrame:
    return pd.read_csv(path, dtype=str, keep_default_na=False)


def validate(path: Path, expected_columns: list[str] | None = None) -> ValidationResult:
    res = ValidationResult(ok=True)
    if not Path(path).exists():
        return ValidationResult(ok=False, errors=[f"{path} does not exist"])
    try:
        df = load_prediction(path)
    except Exception as e:
        return ValidationResult(ok=False, errors=[f"not parseable as CSV: {e}"])
    if df.empty and len(df.columns) == 0:
        return ValidationResult(ok=False, errors=["CSV is empty (no header, no rows)"])
    if len(df) == 0:
        res.warnings.append("CSV has a header but zero data rows")
    if any(str(c).startswith("Unnamed:") for c in df.columns):
        res.warnings.append("unnamed column present — likely an index column was written; "
                            "use to_csv(..., index=False)")
    if expected_columns:
        got = [_norm_col(c) for c in df.columns]
        want = [_norm_col(c) for c in expected_columns]
        missing = [expected_columns[i] for i, w in enumerate(want) if w not in got]
        if missing:
            res.ok = False
            res.errors.append(
                f"missing expected columns {missing}; got {list(df.columns)}")
        elif list(df.columns) != expected_columns:
            res.warnings.append(
                f"columns differ from spec in name/case/order: got {list(df.columns)}, "
                f"expected {expected_columns} (repairable)")
    return res


def repair(path: Path, expected_columns: list[str] | None = None) -> bool:
    """Apply safe deterministic fixes in place. Returns True if the file changed."""
    df = load_prediction(path)
    changed = False

    # strip surrounding whitespace in headers and string cells
    stripped_cols = [str(c).strip() for c in df.columns]
    if stripped_cols != list(df.columns):
        df.columns = stripped_cols
        changed = True
    for col in df.columns:
        s = df[col].str.strip()
        if not s.equals(df[col]):
            df[col] = s
            changed = True

    # drop a leftover pandas index column
    unnamed = [c for c in df.columns if str(c).startswith("Unnamed:")]
    if unnamed and len(df.columns) > len(unnamed):
        df = df.drop(columns=unnamed)
        changed = True

    # rename/reorder to the declared output spec (case/punctuation-insensitive match)
    if expected_columns:
        norm_to_actual = {_norm_col(c): c for c in df.columns}
        if all(_norm_col(c) in norm_to_actual for c in expected_columns):
            ordered = [norm_to_actual[_norm_col(c)] for c in expected_columns]
            extras = [c for c in df.columns if c not in ordered]
            df = df[ordered + extras]
            rename = {a: e for a, e in zip(ordered, expected_columns) if a != e}
            if rename:
                df = df.rename(columns=rename)
                changed = True
            if extras:
                # keep extras only if the spec doesn't fully cover the frame width;
                # otherwise they are stray and dropped
                df = df[expected_columns]
                changed = True

    if changed:
        df.to_csv(path, index=False)
    return changed


# ── canonical form (used by voting and scoring) ───────────────────────────────

_NUM_RE = re.compile(r"^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$")


def _canon_cell(v: str) -> str:
    v = str(v).strip()
    if _NUM_RE.match(v):
        f = float(v)
        if f == int(f) and abs(f) < 1e15:
            return str(int(f))
        return f"{f:.6g}"
    return v.lower()


def canonical(df: pd.DataFrame, sort_rows: bool = True) -> pd.DataFrame:
    """Normalized copy: normalized column names, canonicalized cells, sorted rows."""
    out = df.copy()
    out.columns = [_norm_col(c) for c in out.columns]
    out = out[sorted(out.columns)]
    for col in out.columns:
        out[col] = out[col].map(_canon_cell)
    if sort_rows:
        out = out.sort_values(by=list(out.columns), kind="mergesort").reset_index(drop=True)
    return out


def fingerprint(path: Path) -> str:
    """Stable string identity of a prediction file, insensitive to column
    case/order, row order, float formatting and whitespace."""
    try:
        df = load_prediction(path)
    except Exception:
        return f"<unreadable:{path}>"
    return canonical(df).to_csv(index=False)


def frames_match(a: pd.DataFrame, b: pd.DataFrame) -> bool:
    ca, cb = canonical(a), canonical(b)
    if list(ca.columns) != list(cb.columns) or len(ca) != len(cb):
        return False
    for col in ca.columns:
        for x, y in zip(ca[col], cb[col]):
            if x == y:
                continue
            try:
                fx, fy = float(x), float(y)
            except ValueError:
                return False
            if not np.isclose(fx, fy, rtol=config.REL_TOL, atol=config.ABS_TOL):
                return False
    return True
