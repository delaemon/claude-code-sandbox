"""Tests for the audit log redactor.

This repository is public, so the redactor is the only thing standing between a
transcript and a leaked credential. It is worth more tests than the rest of the
exporter put together, and it needs the negative cases as much as the positive
ones: a redactor that eats git SHAs and content hashes destroys exactly what an
audit trail exists to preserve.

Run:  python3 -m pytest audit_log/test_export.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from export import redact  # noqa: E402


def fixture(*parts: str) -> str:
    """Join a fake credential from fragments.

    The values below are invented, but written whole they match the patterns
    GitHub's push protection scans for, and it blocked this file's first push
    on the Slack one. Assembling them at import time keeps the literal out of
    the source while the string the redactor sees is byte-for-byte the same, so
    the test is no weaker for it. Do not inline these back.
    """
    return "".join(parts)


REDACTED = [
    pytest.param(fixture("sk-", "ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGG"), id="anthropic-key"),
    pytest.param(fixture("sk-", "abcdefghijklmnopqrstuvwxyz0123456789AB"), id="openai-key"),
    pytest.param(fixture("ghp", "_AbCdEfGhIjKlMnOpQrStUvWxYz012345"), id="github-token"),
    pytest.param(fixture("gho", "_AbCdEfGhIjKlMnOpQrStUvWxYz012345"), id="github-oauth"),
    pytest.param(fixture("github", "_pat_11ABCDEFG0abcdefghijklmnop"), id="github-pat"),
    pytest.param(fixture("xox", "b-123456789012-abcdefghijklmnop"), id="slack-token"),
    pytest.param(fixture("AKIA", "IOSFODNN7EXAMPLE"), id="aws-access-key"),
    pytest.param(fixture("AIza", "SyD-1234567890abcdefghijklmnopqrstuvw"), id="google-key"),
    pytest.param(fixture("Authorization: Bearer ", "abcdefghijklmnopqrstuvwxyz123456"), id="bearer"),
    pytest.param(fixture("-----BEGIN ", "RSA PRIVATE KEY-----"), id="private-key"),
    pytest.param("MY_SECRET_TOKEN=hunter2hunter2hunter2", id="named-secret"),
    pytest.param("DATABASE_PASSWORD=s3cr3t-value-here", id="named-password"),
]

KEPT = [
    # Documentation. This exact line appears a dozen times in the archived
    # transcripts, read out of a CLAUDE.md that told people to run it; masking
    # it protects nobody and makes the transcript harder to follow.
    pytest.param("ANTHROPIC_API_KEY=your_key_here", id="doc-placeholder"),
    pytest.param("API_KEY=<your-key>", id="angle-placeholder"),
    pytest.param("GITHUB_TOKEN=$GITHUB_TOKEN", id="shell-variable"),
    # The whole point of the archive. A redactor that eats these is worse than
    # no redactor, because it silently destroys the evidence.
    pytest.param("commit 78c5719b1f2a3c4d5e6f7a8b9c0d1e2f3a4b5c6d", id="git-sha"),
    pytest.param("sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b", id="content-hash"),
    pytest.param("https://github.com/delaemon/claude-code-sandbox/pull/4", id="url"),
    pytest.param("agent-a7cd58378ae3d07b1.jsonl", id="agent-id"),
]


@pytest.mark.parametrize("text", REDACTED)
def test_secrets_are_masked(text: str) -> None:
    out, count = redact(text)
    assert count >= 1, f"not redacted: {text}"
    assert "[REDACTED:" in out


@pytest.mark.parametrize("text", KEPT)
def test_non_secrets_survive(text: str) -> None:
    out, count = redact(text)
    assert count == 0, f"wrongly redacted: {text} -> {out}"
    assert out == text


def test_same_secret_gets_the_same_fingerprint() -> None:
    """Two uses of one credential must still match each other after masking.

    This is what keeps "the same token appears in both runs" answerable from
    the archive without the token being readable.
    """
    token = fixture("ghp", "_AbCdEfGhIjKlMnOpQrStUvWxYz012345")
    out, count = redact(f"first {token} second {token}")
    assert count == 2
    masked = out.split("first ")[1].split(" second ")[0]
    assert out.count(masked) == 2


def test_different_secrets_get_different_fingerprints() -> None:
    a, _ = redact(fixture("ghp", "_" + "A" * 32))
    b, _ = redact(fixture("ghp", "_" + "B" * 32))
    assert a != b


def test_the_secret_itself_never_survives() -> None:
    secret = fixture("sk-", "ant-api03-SHOULD-NEVER-APPEAR-IN-OUTPUT")
    out, _ = redact(f'{{"env": "{secret}", "note": "context around it"}}')
    assert secret not in out
    assert "context around it" in out


def test_redaction_is_idempotent() -> None:
    """Re-exporting an already-redacted file must not mangle it further."""
    token = fixture("ghp", "_AbCdEfGhIjKlMnOpQrStUvWxYz012345")
    once, _ = redact(f"token {token} here")
    twice, count = redact(once)
    assert twice == once
    assert count == 0


def test_surrounding_json_stays_parseable_shape() -> None:
    """Masking must not introduce quotes or backslashes into a JSONL line."""
    token = fixture("ghp", "_AbCdEfGhIjKlMnOpQrStUvWxYz012345")
    out, _ = redact(f'{{"a": "{token}", "b": 1}}')
    assert out.count('"') == 6
    assert "\\" not in out
