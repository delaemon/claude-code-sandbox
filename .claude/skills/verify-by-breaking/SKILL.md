---
name: verify-by-breaking
description: Prove a test, check, hook or guard actually works by making it fail on purpose, in a throwaway clone. Use before claiming any check catches anything, after writing or changing one, and whenever a check has only ever been seen to pass.
---

# Verify by breaking

A check you have only seen pass is not evidence. It may be reaching the thing it
checks, or it may be stopping at an earlier guard, asserting on a value the code
has already transformed, or comparing two empty strings. All four have happened
in this repository, and all four were green.

So: **break the subject, watch the check fail, restore, watch it pass.**

## The procedure

1. **State the claim as a behaviour that could be false.** "The guard refuses
   `.env` even with no JSON parser", not "the guard is correct". If you cannot
   state it that way, the check has no claim and that is the finding.
2. **Copy the repository to a temp directory.** Never the working tree. An
   earlier session damaged its own checkout doing this by hand and spent the
   next while recovering hooks from git.
   ```bash
   work=$(mktemp -d); cp -a "$PWD" "$work/x"; cd "$work/x"
   ```
   Use `cp -a`, not `git clone`, when uncommitted work must be under test.
   Keep `.git` if the check compares against a branch.
3. **Run the check first and require it to pass.** A check already failing for
   an unrelated reason will "fail after the break" and prove nothing.
4. **Break the subject, not the check.** Damage the code the check protects.
5. **Assert it fails, and read the message.** A failure with a message nobody
   can act on is half a check.
6. **Restore and confirm it passes again.**

## What to break

Aim at the ways a check passes without looking:

| trap | how to trigger it |
| --- | --- |
| an earlier guard swallows the probe | point it at something *missing* rather than merely wrong |
| the assertion never matches | check the spelling *after* truncation, rounding, escaping |
| everything fails equally | assert a positive first — the file exists, rows are present |
| the tool is absent | run with a `PATH` lacking `node`, with empty and malformed stdin |
| the pattern no longer matches anything | confirm the allowed case still matches it |

## In this repository

`evals/run.sh` already does all of this for the failures in `docs/LEDGER.md`:
each case breaks something in a fresh copy and asserts the named check fails,
having first required it to pass. **A new check belongs there**, as a case
naming its ledger row, not only as a paragraph saying it was verified once.

Exit codes the harness relies on: hooks use 2 to block and 0 to allow, and
`scripts/agent-config-diff.sh` uses 3 for "did not run", which `gates.sh` shows
as a note rather than a pass.
