# Worklog

One file per agent run: what it decided, why, what it verified, and what it
cost. `CONTRACT.md` beside it is what parallel agents must agree on *before*
they start, and is not a worklog.

Empty in the template on purpose. The previous project's entries were deleted
rather than carried over: they described a harness that has since been rewritten
to be config-driven, and a worklog that describes a past state of the repository
sends the next agent down a path that is already closed. Entries here are
**meant to be pruned** — this directory is a working aid, not a record.

The record is `audit_log/`, which is the opposite: complete, unfiltered, and
never edited. The two have opposite requirements and cannot be the same
artifact; `audit_log/README.md` sets out why.

What survived the extraction is in `docs/LEDGER.md`: each failure paired with
the check that catches it. That one is kept because the checks are still here
and `scripts/ledger.sh` asserts it stays true.

## What an entry holds

```markdown
## <ISO timestamp> — <the decision, in a line>

**Decision**: what you did, concretely enough to disagree with.

**Why**: the alternative you rejected and what it would have cost.

**Verified**: how you know — including the break you made deliberately and
watched fail. A test you have only seen pass is not evidence.

**Cost**: the run's tokens, per CLAUDE.md.
```
