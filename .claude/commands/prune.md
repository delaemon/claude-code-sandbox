---
description: Remove guidance from CLAUDE.md that an executable check already enforces
---

`CLAUDE.md` is loaded in full at the start of every session, so its length is a
tax on every future session. It is currently **$(wc -l < CLAUDE.md) lines**.

Find every passage that an executable check already enforces, and delete it.

- Read `scripts/doctor.sh`, `scripts/ledger.sh`, `scripts/agent-config-diff.sh`
  and `.claude/hooks/` first, so you know what is actually enforced.
- A rule with a check behind it needs at most a pointer to the check, not a
  restatement of it.
- Keep what no check can carry: why a decision was made, what would break if it
  were reversed, and the conventions that fail quietly (`board[y][x]`, the
  hidden row).
- Delete anything that describes a past state of the repository rather than the
  current one.
- **Do not delete a rule to make the file shorter when nothing enforces it.**
  Raise it instead: propose the check that would let the prose go.

Report the before and after line count, and list what you removed and what
enforces each removed rule now.
