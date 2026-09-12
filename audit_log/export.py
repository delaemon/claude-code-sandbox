#!/usr/bin/env python3
"""Export this session's subagent transcripts into audit_log/ for committing.

Transcripts live inside the ephemeral VM and die with it. This copies them into
the repository, where git gives them the two properties an audit trail needs
that the VM cannot: they outlive the machine, and history makes them tamper
evident.

Every line is passed through a redactor first, because this repository is
public. The redactor is the load-bearing part: today's transcripts happen to
contain no real credential, but a future round only has to cat the wrong file
once, and a secret pushed to a public repository is not undone by deleting it.

Usage:  python3 audit_log/export.py [--dry-run]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "audit_log"

# Credential shapes worth redacting. Deliberately anchored on vendor prefixes
# and explicit key names rather than on entropy: a generic "looks random" rule
# eats git SHAs and content hashes, which are exactly what an audit trail needs
# to keep.
PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("anthropic-key", re.compile(r"sk-ant-[A-Za-z0-9_\-]{16,}")),
    ("openai-key", re.compile(r"sk-[A-Za-z0-9]{32,}")),
    ("github-token", re.compile(r"gh[pousr]_[A-Za-z0-9]{16,}")),
    ("github-pat", re.compile(r"github_pat_[A-Za-z0-9_]{20,}")),
    ("slack-token", re.compile(r"xox[abprs]-[A-Za-z0-9\-]{10,}")),
    ("aws-access-key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    # Length is deliberately a lower bound, not the exact 35 a real key carries:
    # a filter that misses a credential because it was one character off is
    # worse than one that occasionally masks an innocent AIza-prefixed string.
    ("google-key", re.compile(r"\bAIza[0-9A-Za-z_\-]{30,}")),
    ("bearer", re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._\-]{20,}")),
    ("private-key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}")),
]

# `NAME=value` for names that imply a secret. The placeholder guard keeps
# documentation readable: the archived transcripts contain
# `export ANTHROPIC_API_KEY=your_key_here` a dozen times, read out of a
# CLAUDE.md that told people to run it. Masking a line like that protects
# nobody and makes the transcript harder to follow.
SECRET_NAME = (
    r"(?:[A-Z0-9_]*"
    r"(?:SECRET|TOKEN|PASSWORD|PASSWD|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY)"
    r"[A-Z0-9_]*)"
)
ASSIGNMENT = re.compile(rf"\b({SECRET_NAME})=([^\s\"'\\,;)]+)")
PLACEHOLDER = re.compile(
    r"^(?:your[_\-]?\w*|<[^>]*>|\.{3,}|x{3,}|changeme|example\w*|dummy\w*"
    r"|fake\w*|test\w*|none|null|\$\{?\w+\}?)$",
    re.IGNORECASE,
)


def _mask(kind: str, secret: str) -> str:
    """Replace a secret with a stable fingerprint.

    The digest is what makes the redaction useful rather than merely safe: two
    occurrences of the same credential still match each other across the whole
    archive, so "the same token was used in both runs" stays answerable without
    the token itself being readable.
    """
    digest = hashlib.sha256(secret.encode("utf-8")).hexdigest()[:12]
    return f"[REDACTED:{kind}:{digest}]"


def redact(text: str) -> tuple[str, int]:
    """Return the text with credentials masked, and how many were masked."""
    count = 0

    for kind, pattern in PATTERNS:

        def sub(match: re.Match[str], kind: str = kind) -> str:
            nonlocal count
            count += 1
            return _mask(kind, match.group(0))

        text = pattern.sub(sub, text)

    def sub_assignment(match: re.Match[str]) -> str:
        nonlocal count
        name, value = match.group(1), match.group(2)
        if PLACEHOLDER.match(value):
            return match.group(0)
        count += 1
        return f"{name}={_mask('env:' + name.lower(), value)}"

    return ASSIGNMENT.sub(sub_assignment, text), count


def find_transcripts() -> list[Path]:
    root = Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude")) / "projects"
    if not root.is_dir():
        root = Path("/root/.claude/projects")
    if not root.is_dir():
        return []
    return sorted(p for p in root.glob("*/*/subagents/agent-*.jsonl") if p.is_file())


def summarise(path: Path) -> dict[str, object]:
    """Read one transcript for the index: size, tool calls, timing, opening text."""
    first_text = ""
    tools = 0
    lines = 0
    started: str | None = None
    ended: str | None = None
    # None until a usage record is seen, so "no usage recorded" and "cost
    # nothing" render differently. A run that cost nothing does not exist.
    tokens: int | None = None

    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        lines += 1
        try:
            entry = json.loads(raw)
        except json.JSONDecodeError:
            continue
        timestamp = entry.get("timestamp")
        if timestamp:
            started = started or timestamp
            ended = timestamp
        usage = (entry.get("message") or {}).get("usage")
        if isinstance(usage, dict) and isinstance(usage.get("output_tokens"), int):
            # Output, cache writes and fresh input. Cache *reads* are left out
            # on purpose: every request re-reads the whole context, so summing
            # them across a run reports a number two orders of magnitude larger
            # than the work done, at a rate that is not what it costs.
            tokens = (tokens or 0) + sum(
                usage.get(k, 0) or 0
                for k in ("output_tokens", "cache_creation_input_tokens", "input_tokens")
            )

        content = (entry.get("message") or {}).get("content")
        if isinstance(content, list):
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "tool_use":
                    tools += 1
                elif block.get("type") == "text" and not first_text:
                    first_text = " ".join(block.get("text", "").split())[:120]
        elif isinstance(content, str) and not first_text:
            first_text = " ".join(content.split())[:120]

    return {
        "agent": path.stem.removeprefix("agent-"),
        "lines": lines,
        "tool_calls": tools,
        "tokens": tokens,
        "started": started,
        "ended": ended,
        "first_text": first_text,
    }


def write_index(rows: list[dict[str, object]]) -> None:
    lines = [
        "# Run index",
        "",
        "Regenerated in full by `audit_log/export.py`. Last run "
        f"{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%SZ')}.",
        "",
        "| agent | lines | tool calls | tokens | redactions | started | opening text |",
        "|---|---|---|---|---|---|---|",
    ]
    for row in sorted(rows, key=lambda r: str(r["started"] or "")):
        text = str(row["first_text"]).replace("|", "\\|")
        tok = row.get("tokens")
        tok_cell = f"{tok:,}" if isinstance(tok, int) else "-"
        lines.append(
            f"| `{row['agent']}` | {row['lines']} | {row['tool_calls']} | {tok_cell} "
            f"| {row['redactions']} | {row['started'] or '-'} | {text} |"
        )
    (OUT / "INDEX.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report without writing")
    args = parser.parse_args()

    transcripts = find_transcripts()
    if not transcripts:
        print("no subagent transcripts found", file=sys.stderr)
        return 1

    runs = OUT / "runs"
    rows: list[dict[str, object]] = []
    total_redactions = 0
    written = 0

    for path in transcripts:
        clean, redactions = redact(path.read_text(encoding="utf-8", errors="replace"))
        total_redactions += redactions
        info = summarise(path)
        info["redactions"] = redactions
        rows.append(info)

        target = runs / f"{info['agent']}.jsonl"
        if args.dry_run:
            written += 1
            continue
        # A finished agent's transcript never changes, so skipping identical
        # files keeps the archive append-only: re-running the export adds new
        # runs without producing a fresh git object for every old one.
        if target.exists() and target.read_text(encoding="utf-8") == clean:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(clean, encoding="utf-8")
        written += 1

    if not args.dry_run:
        write_index(rows)

    verb = "would export" if args.dry_run else "exported"
    print(f"{verb} {written}/{len(transcripts)} transcripts, {total_redactions} redactions")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
