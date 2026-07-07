"""Deterministic context exploration.

The official baseline spends ReAct steps discovering what files exist and what
their schemas are. We do that exploration in plain Python before the agent ever
runs, and hand the agent a compact profile of every file: CSV headers/dtypes/
samples, JSON structure, SQLite schemas with row counts, document excerpts.
This both saves agent steps for actual solving and removes a whole class of
"agent misread the schema" failures.
"""
import io
import json
import sqlite3
from pathlib import Path

import pandas as pd

from . import config

_CSV_EXT = {".csv", ".tsv"}
_JSON_EXT = {".json", ".jsonl", ".ndjson"}
_SQLITE_EXT = {".sqlite", ".sqlite3", ".db"}
_DOC_EXT = {".md", ".txt", ".rst", ".html"}

_SAMPLE_ROWS = 3
_DOC_EXCERPT_CHARS = 1200


def _profile_csv(path: Path) -> str:
    sep = "\t" if path.suffix == ".tsv" else ","
    try:
        head = pd.read_csv(path, sep=sep, nrows=200)
    except Exception as e:
        return f"(unreadable as CSV: {e})"
    try:
        with open(path, "rb") as f:
            n_rows = sum(1 for _ in f) - 1
    except Exception:
        n_rows = "?"
    buf = io.StringIO()
    buf.write(f"rows≈{n_rows}, columns ({len(head.columns)}):\n")
    for col in head.columns:
        s = head[col]
        desc = f"  - {col}: {s.dtype}"
        if pd.api.types.is_numeric_dtype(s) and len(s.dropna()):
            desc += f" [min={s.min()}, max={s.max()}]"
        else:
            uniq = s.dropna().unique()[:4]
            desc += f" e.g. {list(map(str, uniq))}"
        buf.write(desc + "\n")
    buf.write("sample rows:\n")
    buf.write(head.head(_SAMPLE_ROWS).to_csv(index=False))
    return buf.getvalue()


def _json_shape(obj, depth=0) -> str:
    if depth > 3:
        return "..."
    if isinstance(obj, dict):
        parts = [f"{k}: {_json_shape(v, depth + 1)}" for k, v in list(obj.items())[:12]]
        more = "" if len(obj) <= 12 else f", ...+{len(obj) - 12} keys"
        return "{" + ", ".join(parts) + more + "}"
    if isinstance(obj, list):
        inner = _json_shape(obj[0], depth + 1) if obj else "?"
        return f"list[{len(obj)}] of {inner}"
    return type(obj).__name__


def _profile_json(path: Path) -> str:
    try:
        text = path.read_text(errors="replace")
        if path.suffix in {".jsonl", ".ndjson"} or "\n{" in text[:2000]:
            lines = [l for l in text.splitlines() if l.strip()]
            first = json.loads(lines[0])
            return f"JSONL, {len(lines)} records, record shape: {_json_shape(first)}\nfirst record: {lines[0][:500]}"
        obj = json.loads(text)
        return f"shape: {_json_shape(obj)}\nexcerpt: {text[:500]}"
    except Exception as e:
        return f"(unreadable as JSON: {e})"


def _profile_sqlite(path: Path) -> str:
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    except Exception as e:
        return f"(unreadable as SQLite: {e})"
    buf = io.StringIO()
    try:
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        for t in tables:
            ddl = conn.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (t,)
            ).fetchone()[0]
            count = conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
            buf.write(f"table {t} ({count} rows):\n{ddl}\n")
            rows = conn.execute(f'SELECT * FROM "{t}" LIMIT {_SAMPLE_ROWS}').fetchall()
            cols = [d[0] for d in conn.execute(f'SELECT * FROM "{t}" LIMIT 0').description]
            buf.write(f"sample: {cols}\n")
            for r in rows:
                buf.write(f"        {r}\n")
    finally:
        conn.close()
    return buf.getvalue()


def _profile_doc(path: Path) -> str:
    text = path.read_text(errors="replace")
    excerpt = text[:_DOC_EXCERPT_CHARS]
    suffix = "" if len(text) <= _DOC_EXCERPT_CHARS else f"\n...({len(text)} chars total)"
    return excerpt + suffix


def profile_context(context_dir: Path, char_budget: int | None = None) -> str:
    """Return a markdown profile of every file under context_dir, size-bounded."""
    char_budget = char_budget or config.PROFILE_CHAR_BUDGET
    sections = []
    files = sorted(p for p in context_dir.rglob("*") if p.is_file())
    for path in files:
        rel = path.relative_to(context_dir)
        ext = path.suffix.lower()
        if ext in _CSV_EXT:
            body = _profile_csv(path)
        elif ext in _JSON_EXT:
            body = _profile_json(path)
        elif ext in _SQLITE_EXT:
            body = _profile_sqlite(path)
        elif ext in _DOC_EXT:
            body = _profile_doc(path)
        else:
            body = f"(binary/other, {path.stat().st_size} bytes)"
        sections.append(f"### {rel}\n{body.strip()}\n")

    profile = f"## Context files ({len(files)} files under {context_dir.name}/)\n\n" + "\n".join(sections)
    if len(profile) > char_budget:
        # trim per-section evenly rather than cutting off the file list entirely
        per = max(300, char_budget // max(1, len(sections)))
        trimmed = [s if len(s) <= per else s[:per] + "\n...(truncated)\n" for s in sections]
        profile = f"## Context files ({len(files)} files under {context_dir.name}/)\n\n" + "\n".join(trimmed)
        profile = profile[:char_budget]
    return profile
