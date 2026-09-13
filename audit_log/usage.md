# Session token usage

One rounded row per session, by `.claude/hooks/log-usage.sh` on Stop. Rounded
so this file changes a few times a day rather than every turn; `turns.jsonl`
beside it has the per-turn numbers, and appends rather than rewriting.

`tokens` is output + cache writes + fresh input, never cache reads, which
would report the context size times the turn count. A session with no usage
records is absent rather than zero.

| session | requests | tokens | updated |
|---|---|---|---|
| `fb2095ed` | ~2,000 | ~8,500,000 | 2026-09-13 |
