# Failure ledger

Every failure this harness has had, and the executable check that now catches it.

**Inherited history.** These failures happened in the project this harness was
extracted from. They are kept, rather than reset with the rest of the logs,
because the checks they produced are still here — and a check with no story
attached is the first one someone deletes as unexplained. The shapes recur, too:
a guard that cannot run, a test that passes vacuously, a probe that pollutes
what it measures. Add your own rows below; do not renumber these.

A row is only closed when a **check exists and has been seen to fail** on the
failure it names — verified by reproducing the failure deliberately, in a
throwaway clone, never in the working tree. A row with no check is not a lesson
learned; it is prose, and prose is missed. `scripts/ledger.sh` fails when a row
names a check that does not exist, so this file cannot quietly drift into
fiction.

`check` names either a `doctor.sh` assertion label, or a file that performs the
check. `-` means **open**: the failure is understood and nothing yet stops it
happening again.

| # | failure | check | verified by breaking |
|---|---|---|---|
| 1 | Hooks parsed stdin with `python3`; on a host without it the secret guard exited 0 and let `.env` through | `block-secrets refuses .env` | yes |
| 2 | Kept committing on a branch whose PR had already merged | `scripts/branch-state.sh` | yes |
| 3 | Colour tests passed when two palette entries were swapped — they asserted against the same palette they tested | `scripts/mutate.mjs` | yes |
| 4 | `agent-config-diff.sh` reported "no files changed" on a PR changing four, because `git diff` exited 128 into `/dev/null` | `scripts/agent-config-diff.sh` | yes |
| 5 | The config gate did not watch `CODEOWNERS` — the list of exactly what it is about | `scripts/agent-config-diff.sh` | yes |
| 6 | The usage log rewrote itself every turn, leaving the tree permanently dirty | `scripts/churn-check.mjs` | yes |
| 7 | A `doctor.sh` probe used a *missing* transcript, stopped at an earlier guard, and stayed green while the guard it protected was deleted | `log-usage records nothing when it cannot measure` | yes |
| 8 | CLAUDE.md claimed exit 0 could not reach Claude; it can, via stdout JSON, and the error cost a tool call every turn | `log-usage returns the usage line as Stop additionalContext` | yes |
| 10 | `ledger.sh` searched doctor.sh for a label including its surrounding quotes, so an interpolated label read as a missing check | `scripts/ledger.sh` | yes |
| 9 | A subagent or command file with broken frontmatter does not error — it silently never loads, and the session runs without the agent it believed it had | `has name and description` | yes |

| 11 | The Stop hook spoke on every stop; two turns then arrived with no user input, which looked like a hook that talks, starts a turn, and talks again | `goes quiet after six stops` | diagnosed, see below |
| 12 | A `doctor.sh` probe ran the usage hook against the real log, leaving a row behind on every run — a diagnostic contaminating the record it checked | `USAGE_LOG` | yes |
| 13 | Rows were appended rather than sorted, so any other session shifted the order and the file changed with no value changing — silently undoing the rounding |  `.claude/hooks/log-usage.mjs` | yes |
| 14 | The hook body was inlined in `node -e` inside single quotes; an apostrophe in a comment ended the shell string and broke it, three separate times, and a failing Stop hook does nothing quietly | `parses` | yes |
| 15 | The test for 13 compared three checksums that were all empty, because the hook was broken — it passed because everything failed equally | `scripts/mutate.mjs` | yes |
| 16 | `CLAUDE.md` named a `grep` as "the check" keeping clocks out of `src/`; nothing ran it, and a naive version would have false-positived on the files describing the rule in prose | `scripts/clock-boundary.mjs` | yes |
| 17 | `agent-config-diff.sh` exited 0 when no base ref existed, so `gates.sh` printed `ok` for a check that never looked | `scripts/gates.sh` | yes |
| 18 | The ledger's "verified by breaking" column was a hand-written claim; nothing re-ran those breakages, so a weakened check would keep reading as caught | `evals/run.sh` | yes |
| 19 | The mutation runner wrote each mutant into the working tree; a Stop hook commits every turn, and a commit was nearly made with a mutant staged | `scripts/mutate.mjs` | yes |
| 20 | It counted any non-zero exit as a kill, so a mutant that only broke the parser, or hung, reported as a confident kill with nothing asserted | `scripts/mutate.mjs` | yes |
| 21 | `--only` with a missing or empty value selected every mutant, so a run believed narrow returned green for the whole suite | `scripts/mutate.mjs` | yes |
| 22 | The churn check compared two `cksum` reads of a file that did not exist, and two empty strings compare equal | `scripts/churn-check.mjs` | yes |
| 23 | `mutate.mjs` decided "killed" by matching raw vitest output, which is coloured in CI and not locally, so every mutant passed here and the first reported BROKEN there — a verdict that depended on where it ran | `scripts/mutate.mjs` | yes |
| 24 | That BROKEN message named two guesses and printed no output, so the CI failure it reported could not be diagnosed from the log | `scripts/mutate.mjs` | yes |
| 25 | Committing the per-turn log ran CI, whose completion sent a PR notification, which woke a turn, which appended another line — a loop sustaining itself about once a minute with no input | `scripts/fold-logs.mjs` | observed live |
| 26 | Only one of the two hooks that write logs was staged, so `subagents.jsonl` kept dirtying the tree by itself — one writer fixed reads as fixed until the other fires | `hooks write only staged logs` | yes |
| 27 | Staging the logs silently disabled the check that the hook records nothing it cannot measure: it compared tracked files the hook had stopped writing, so it passed with the guard deleted | `log-usage records nothing` | yes |
| 28 | Three `doctor.sh` cases took their probe from `$HOME/.claude/projects`, which CI does not have, so they were skipped there — printing neither ok nor bad, leaving doctor green with the guards they cover deleted | `scripts/same-everywhere.sh` | yes |

## Closed since, and how

**11 was not a loop.** The transcript settles it. `HOOK` records appear from
01:50 onwards — hours before `log-usage.sh` existed — so they are the
environment's own stop hooks, `git-check` and `reply-gate`. The
`HOOK → HOOK (0s)` pairs that looked like a hook re-entering are two different
hooks recording the same stop, at the same instant. Per-turn emission has since
run for a stretch of turns with no runaway. The two turns that started this had
another cause: GitHub notifications, which arrive as turns with no user input
and were mistaken for the hook talking to itself.

The bound stays anyway, in the cheaper form of a rate breaker: five stops inside
a minute is faster than a person, so the line goes quiet and the log keeps
writing. That is insurance against a failure mode that was never demonstrated,
which is the right price for something that would otherwise spend a quota
unattended.

**3 and 15 are closed by `scripts/mutate.mjs`.** A passing suite proves the
tests ran, not that they would catch anything. Four mutants damage behaviour —
the renderer ignoring its palette, `cellRect` transposed, the hidden-row offset
dropped, the chain multiplier frozen — and each must be noticed. Mutating the
*palette* is deliberately not among them: the hex values are a design choice,
which is exactly why the first attempt to prove these tests bit did it that way
and passed.

The runner refuses to report a pass it did not earn: exit 2 when a mutant's
target text is gone, when no mutants are selected, and when the suite is already
failing. All three verified, and the fourth — a surviving mutant reporting
exit 1 — verified by deleting the colour assertions.

**6 is closed by `scripts/churn-check.mjs`** — but not by the first attempt,
which is rows 22 and the three beside it. That version lived inside `doctor.sh`
and failed four ways at once: it reported success when the hook was deleted
(two `cksum` reads of a missing file are both empty, and empty equals empty),
when the column it measures was deleted, missed any tightening under 12.5x
because its probe sat exactly on a 500,000 boundary, and was built with
`python3` against this repository's own rule, skipping invisibly without it.

The replacement asserts a positive before comparing anything, runs three probes
straddling boundaries so a granularity of 250,000 or tighter is caught, and is
node only. Every one of those four failures was found by the `verifier` subagent
on its first run, and each was reproduced here before being fixed.

**25 is the loop that was actually there.** Row 11 suspected the Stop hook of
talking itself into turns and was diagnosed as innocent, correctly. Meanwhile
the same shape ran through a different path: the hook appends to the turn log,
the environment's git check asks for a commit, the commit runs CI, CI completing
sends a pull request notification, and the notification wakes a turn that
appends another line. Six of the ten commits on the pull request that found it
were that cycle, roughly a minute apart.

**The first fix did not work, and the commit message claiming it did was wrong
for about a minute.** `paths-ignore: ['audit_log/**']` was added to the CI
triggers; a commit touching only `audit_log/` ran CI anyway, 31 runs to 32. For
`pull_request`, the filter is evaluated against the pull request's whole diff,
not the push that updated it, so a PR containing any code is never excluded. The
filter is reverted: it cut coverage and bought nothing.

**Committing was never the problem.** Not committing loops too — the git check
asks, the ask wakes a turn, the turn writes another line. Any tracked file that
changes every turn has no quiet state.

So the source is cut instead. The hook writes to `audit_log/.turns-pending.jsonl`,
which git ignores, and `scripts/fold-logs.mjs` moves those lines into the
tracked log. `gates.sh` calls it, and gates run before every real commit here, so
the lines land with the work rather than alone. A turn that does nothing else
now leaves the tree clean and starts nothing.

**26 is the half of 25 that was missed.** `turns.jsonl` was staged and the tree
still dirtied every time a subagent finished, because `record-subagent.sh` wrote
straight into `subagents.jsonl`. `usage.md` was the same, less often. All three
are staged now and `scripts/fold-logs.mjs` folds them together.

`doctor.sh` asserts it by **behaviour rather than by grep**: a textual check was
written first and called `log-usage.mjs` a violator for *reading*
`audit_log/usage.md`, which it does legitimately to carry other sessions' rows
forward. The check fires each hook with its staging paths redirected and
requires the tracked logs to be byte-identical afterwards.

Verified in nine cases, including that a fold which cannot write exits 1 and
leaves the lines staged rather than reporting a fold that did not happen.

**28 is the same shape as 1, eleven rows later.** Row 1 was hooks that parsed
with `python3`, present in the cloud image and absent in a container, so the
secret guard exited 0 where python3 was missing. Row 28 is `doctor.sh` cases
that took their probe from a real transcript under `$HOME/.claude/projects`,
present here and absent on the runner, so three checks printed nothing at all
in CI and doctor stayed green with their guards deleted.

Both are a check that needs the machine it runs on to be a particular machine.
The probes are synthesised now, and `scripts/same-everywhere.sh` compares the
checks doctor emits with `$HOME` as it is against the same list with `$HOME`
empty: any check present in one and not the other fails it.

Finding it took two passes. The first attempt to verify the new script reported
that it did not catch a reintroduced dependency — because the `sed` meant to
reintroduce it had not matched, so nothing was broken and the check correctly
said nothing was wrong. Confirming the break lands before reading the verdict is
the habit this ledger keeps being about, and it was skipped again here.

**27 is the cost of 25 and 26, and the eval suite is what charged it.** Moving
the hooks to staged paths left `doctor.sh` comparing tracked files that the
hooks no longer touch — so the check for "records nothing it cannot measure"
compared two things that never changed, and passed against a hook with that
guard deleted. `evals/run.sh` replayed ledger row 7 and reported it NOT CAUGHT,
which is the suite doing precisely the job it was built for: a check can be
disabled by a change somewhere else entirely, and only replaying the original
failure notices.

The check reads the staged paths now, and asserts a positive first: a readable
transcript must produce a row before "no row" from an unmeasurable one means
anything. Verified both ways — the guard deleted fails it, and a hook that
writes nothing at all fails it as *inert* rather than passing.

**An estimate that was accurate and irrelevant.** Excluding `audit_log` from CI
had been raised once before and dropped, because Actions minutes are free for a
public repository. The minutes were never the harm; the notification was.
Estimating the wrong quantity correctly is its own way of being wrong — and the
exclusion turned out not to work either.

**23 and 24 came from CI**, after the rest of this had been verified locally.
`mutate.mjs` matched vitest's raw summary for `Tests N failed`; vitest colours
that line when it believes a terminal is watching, which it does under CI and
does not through `execSync` here. So the same code killed every mutant on this
machine and reported the first as BROKEN on the runner. ANSI is stripped before
matching now.

It is the fifth instance of the shape this repository keeps recording — an
assertion reading a value in the spelling it had *before* something transformed
it — and the first where the transformer was not our own code.

Worse was 24: that BROKEN branch printed two guesses, "does not compile, or it
hangs", and none of the output. A whole CI cycle produced no evidence. It prints
the last 25 lines now, which shows at a glance whether tests failed or files
failed to load.

**19 through 21** are the same review, on `mutate.mjs`. It mutated the working
tree, which is not theoretical in a session that commits on a Stop hook: a
commit was nearly made with `ArrowLeft: 'moveRight'` staged. Mutants run in a
throwaway copy now, with `node_modules` symlinked. "Killed" means the suite
reported a failed test, not that the run exited non-zero — a distinction that
immediately caught a new mutant of mine which hung instead of failing.

## Open rows

None.
