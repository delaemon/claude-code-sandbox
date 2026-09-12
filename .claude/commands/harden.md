---
description: Turn a failure into an executable check, verified by reproducing the failure
argument-hint: [the failure, or blank for the most recent one]
---

Close this failure so it cannot recur silently: **$ARGUMENTS**

If no failure is named, use the most recent one in this session.

This is the loop that makes the harness better every time rather than merely
longer. Work it in order and do not skip the fourth step, which is the only one
that proves anything.

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
4. **Reproduce the failure and watch the check fail.** In a throwaway clone.
   Then restore and watch it pass. A check you have only seen pass is not
   evidence.
5. **Add a row to `docs/LEDGER.md`** — the failure, the check, and that you saw
   it fail. Run `bash scripts/ledger.sh`.
6. **Delete the prose the check now covers.** `CLAUDE.md` is loaded in full every
   session, so every line it keeps is paid for forever. An executable check and a
   paragraph saying the same thing is one too many. This step is the one that
   gets skipped, and skipping it is why the file grows.
