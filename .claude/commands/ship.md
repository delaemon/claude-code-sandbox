---
description: Take a request from understanding to a verified, pushed, watched pull request
argument-hint: <what to build or change>
---

Deliver this, end to end, without further prompting: **$ARGUMENTS**

The person asking is on a phone. They cannot read a long diff, cannot run
anything, and each round trip costs them more than it costs you. Spend tokens
freely to avoid needing a second prompt.

1. **Understand before editing.** Read the code that the change touches. If two
   readings of the request lead to materially different work, state the
   assumption you are taking and keep going — do not stop to ask unless
   proceeding either way would waste the work.
2. **Build it whole.** The requested scope is the deliverable. Do not narrow it
   silently. If part turns out to be blocked, finish everything else and say
   exactly what you left and why.
3. **Verify before pushing**, with `bash scripts/gates.sh`. A push that turns CI
   red costs a round trip, which is the expensive thing here.
4. **Prove the new behaviour bites.** A test that passes against code that was
   never wrong has told you nothing. Break the thing deliberately — in a
   throwaway clone, never in the working tree — watch the check fail, restore.
5. **Commit and push** to the session branch. Open a PR with
   `base:` the integration branch named in `harness.config.json` (`git.baseBranch`), then watch it and drive it to green.
6. **Report in the terminal**: what changed, what you verified and how, what you
   assumed, what you deliberately left. Lead with anything that went wrong.

If you hit a failure in the harness itself along the way, finish this task, then
run the `/harden` flow on it. A failure that leaves no check behind will happen
again.
