---
description: Turn a failure into an executable check, verified by reproducing the failure
argument-hint: [the failure, or blank for the most recent one]
---

Close this failure so it cannot recur silently: **$ARGUMENTS**

If no failure is named, use the most recent one in this session.

This is the loop that makes the harness better every time rather than merely
longer. Steps 1 to 3 are yours. Steps 4 and 5 are `scripts/learn.mjs`, which
will not let you skip them.

1. **State the failure as a behaviour**, not as a diff. "The guard exited 0 when
   node was absent", not "the script was wrong". A behaviour can be asserted; a
   diff cannot.
2. **Ask where it belongs.** A hook if it must hold every time and the harness
   can enforce it. A `doctor.sh` case if it differs between environments. A CI
   gate if it is only visible against the base. Prose in `CLAUDE.md` only if
   none of those can carry it — and then say so in the ledger rather than
   pretending it is closed.
3. **Write the check so it cannot pass vacuously.** Probe the path that actually
   exercises the guard. This harness has already shipped a check that pointed at
   a *missing* file, stopped at an earlier guard, and stayed green while the
   guard it protected was deleted.
4. **Hand it to `learn.mjs` with the break that should trip it.**

   ```bash
   node scripts/learn.mjs \
     --name   the-case-file-name \
     --failure "the behaviour, one sentence, as it will read in the ledger" \
     --check  "the command that must fail once the break lands" \
     --break  "shell that damages a throwaway copy" \
     --catcher "scripts/thing.sh"   # or the literal text of an assertion label
   ```

   It writes the eval case and the ledger row, replays the case, and **removes
   both if the break does not make the check fail**. There is no way through it
   that leaves a row you have not earned: not a break that damages nothing, not
   a break whose `sed` never matched, not a check that was already failing. Each
   of those has happened here, and each reads as success if nobody looks.

   `--dry-run` shows what it would write. `--next` gives the next row number.

5. **Read what it says.** "Not learned" is information, not an obstacle — it
   usually means the check does not look at what you damaged, which is exactly
   what you wanted to find out before trusting it.

Then run `bash scripts/gates.sh` and report: the failure, the check, and the
line from the replay that shows it caught.

If the failure is one no executable check can carry, say so explicitly and add
the row with `-` in the check column. An open row is honest. A closed row with
nothing behind it is the thing this whole repository exists to prevent.
