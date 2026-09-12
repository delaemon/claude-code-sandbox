# audit_log

Full transcripts of every subagent run, exported from the session VM into the
repository so they outlive it.

```bash
python3 audit_log/export.py            # export + regenerate INDEX.md
python3 audit_log/export.py --dry-run  # report without writing
python3 -m pytest audit_log/test_export.py
```

- `runs/<agent-id>.jsonl` — one redacted transcript per agent run, one JSON
  object per line: every prompt, every tool call, every result.
- `INDEX.md` — generated. Agent id, size, tool calls, redaction count, start
  time, and the opening text of each run.

## Why this exists

Subagent transcripts are written inside the session's VM, which is reclaimed
after a period of inactivity. Everything in them dies with it, and nothing
about them reaches claude.ai. Copying them here gives them the two properties
an audit trail needs and the VM cannot provide: they outlive the machine, and
git history makes after-the-fact edits visible.

## What this is not

**It is not OpenTelemetry.** OTel exports structured spans and metrics to an
observability backend, where they can be queried and aggregated. This is
transcript archival to git — the same goal reached with the storage that was
actually available. If this repository ever needs real observability, OTel is
still the right answer and this is not a substitute for it.

**It is not the worklogs.** `docs/worklog/` holds the decisions each agent made
and why, distilled to the point where the next agent can read all of them and
still have room to work. This directory holds everything, unfiltered. The two
have opposite requirements and cannot be the same artifact:

|  | `docs/worklog/` | `audit_log/` |
| --- | --- | --- |
| Written by | the agent, as a claim | the harness, as a record |
| Content | why | what |
| Completeness | deliberately partial | useless if partial |
| Pruning | **required** — stale entries send the next agent down a path that is already closed | **forbidden** — a log you can edit proves nothing |
| Size | 56 KB | 2.6 MB |

A worklog entry that has served its purpose gets deleted. Deleting from an
audit log destroys the only thing it was for.

**It does not cover the whole session.** Only subagent runs are transcribed
here. The orchestrating conversation lives on claude.ai and is not exported;
what it decided is in git history and the PR descriptions instead.

## Redaction

This repository is public, so every line passes through a redactor before it is
written. Known credential shapes — Anthropic, OpenAI, GitHub, Slack, AWS and
Google keys, bearer tokens, JWTs, private key headers, and `NAME=value` for
names implying a secret — are replaced with `[REDACTED:<kind>:<digest>]`.

The digest is a truncated SHA-256 of the secret, so two occurrences of the same
credential still match each other across the archive. "The same token was used
in both runs" stays answerable without the token being readable.

Two things the redactor deliberately does **not** touch:

- **Placeholders.** `ANTHROPIC_API_KEY=your_key_here` is a line from
  `CLAUDE.md` telling a human what to run. Masking it protects nobody.
- **Hashes and SHAs.** A rule based on "looks random" eats git SHAs and content
  digests, which are exactly what an audit trail exists to preserve. The
  patterns are anchored on vendor prefixes and key names instead.

`test_export.py` covers both directions, because a redactor is only as good as
its negative cases. It has already caught one real hole: the Google key pattern
originally demanded an exact length and let a key one character off walk
straight through.

**The redactor is a safety net, not a guarantee.** It matches shapes it knows.
A credential in an unusual format, or one printed without a recognisable prefix,
can still reach a public repository — and a secret pushed to a public repository
is not undone by deleting it. Do not rely on this to make careless commands safe.

## Size

2.6 MB across six runs, and git keeps every version forever. The export is
idempotent — a finished agent's transcript never changes, so re-running it adds
new runs without rewriting old ones and the archive grows linearly rather than
quadratically. It is still worth deciding, before this repository gets large,
whether full transcripts are what you want in git or whether the index alone
would do.
