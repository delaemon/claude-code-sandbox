# Session token usage

Maintained by `.claude/hooks/log-usage.sh`, a Stop hook, so it keeps being
written after the session that added it ends. One row per session, updated
in place.

`tokens` is output + cache writes + fresh input, the same definition
`audit_log/export.py` uses for the run index. Cache reads are excluded on
purpose: each request re-reads the whole context, so counting them reports
the context size multiplied by the number of turns rather than the work.

A session with no usage records is absent rather than zero.

Figures are rounded, so this file changes a few times a session rather than
on every turn. Writing it exactly made it permanently dirty in git and bought
nothing: an uncommitted row dies with the VM just as a missing one does. Run
`bash scripts/usage.sh --line` for exact live numbers.

| session | requests | tokens | output | updated |
|---|---|---|---|---|
| `fb2095ed` | ~1,000 | ~5,000,000 | ~910,000 | 2026-09-12 |
