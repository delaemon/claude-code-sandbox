# Session token usage

Maintained by `.claude/hooks/log-usage.sh`, a Stop hook, so it keeps being
written after the session that added it ends. One row per session, updated
in place.

`tokens` is output + cache writes + fresh input, the same definition
`audit_log/export.py` uses for the run index. Cache reads are excluded on
purpose: each request re-reads the whole context, so counting them reports
the context size multiplied by the number of turns rather than the work.

A session with no usage records is absent rather than zero.

| session | requests | tokens | output | context | updated |
|---|---|---|---|---|---|
| `fb2095ed` | 971 | 4,934,276 | 862,036 | 159,312 | 2026-09-12T12:15Z |
