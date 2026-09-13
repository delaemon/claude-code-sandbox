---
description: Run the gates, fix what they found, and keep going until they are green
argument-hint: [optional: a tier — fast, quick, or blank for everything]
---

Drive this tree to green without further prompting.

1. **Ask.** `node scripts/autopilot.mjs $ARGUMENTS` — it runs the gates and
   returns the failures ordered by what causes what, with the evidence pulled
   out of each one. Work the list from the top: a failing typecheck makes the
   test results below it meaningless, and fixing those first is wasted effort.

2. **Fix the cause, not the symptom.** If a gate is red because a check is
   wrong, fix the check. If it is red because the code is wrong, fix the code.
   Never fix a gate by making it ask less — a test deleted, a mutant removed, a
   `doctor.sh` case narrowed — without saying so plainly.

3. **Re-ask after each fix.** One change can close several rows, and can open
   one somewhere unrelated: the eval suite exists because a check can be
   disabled by an edit somewhere else entirely.

4. **When a failure was the harness's own**, run `/harden` on it before moving
   on. A failure that leaves no check behind will happen again, and the next
   session will not have watched it happen.

5. **Stop when `bash scripts/gates.sh` prints `all gates pass`** — every gate,
   not a tier. `--fast` and `--quick` leave gates unasked, and they name the
   ones they skipped for exactly this reason.

Report: what was red, what you changed, and what you verified — with the line
that shows it. Lead with anything you could not fix and why.
