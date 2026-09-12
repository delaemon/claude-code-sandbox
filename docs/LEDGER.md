# Failure ledger

Every failure this harness has had, and the executable check that now catches it.

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
| 3 | Colour tests passed when two palette entries were swapped — they asserted against the same palette they tested | - | yes |
| 4 | `agent-config-diff.sh` reported "no files changed" on a PR changing four, because `git diff` exited 128 into `/dev/null` | `scripts/agent-config-diff.sh` | yes |
| 5 | The config gate did not watch `CODEOWNERS` — the list of exactly what it is about | `scripts/agent-config-diff.sh` | yes |
| 6 | The usage log rewrote itself every turn, leaving the tree permanently dirty | - | yes |
| 7 | A `doctor.sh` probe used a *missing* transcript, stopped at an earlier guard, and stayed green while the guard it protected was deleted | `log-usage records nothing when it cannot measure` | yes |
| 8 | CLAUDE.md claimed exit 0 could not reach Claude; it can, via stdout JSON, and the error cost a tool call every turn | `log-usage returns the usage line as Stop additionalContext` | yes |
| 10 | `ledger.sh` searched doctor.sh for a label including its surrounding quotes, so an interpolated label read as a missing check | `scripts/ledger.sh` | yes |
| 9 | A subagent or command file with broken frontmatter does not error — it silently never loads, and the session runs without the agent it believed it had | `has name and description` | yes |

| 11 | The Stop hook spoke on every stop; two turns then arrived with no user input, which is the shape of a hook that talks, starts a turn, and talks again | `scripts/doctor.sh` | bounded, not proven |
| 12 | A `doctor.sh` probe ran the usage hook against the real log, leaving a row behind on every run — a diagnostic contaminating the record it checked | `USAGE_LOG` | yes |
| 13 | Rows were appended rather than sorted, so any other session shifted the order and the file changed with no value changing — silently undoing the rounding |  `.claude/hooks/log-usage.mjs` | yes |
| 14 | The hook body was inlined in `node -e` inside single quotes; an apostrophe in a comment ended the shell string and broke it, three separate times, and a failing Stop hook does nothing quietly | `parses` | yes |
| 15 | The test for 13 compared three checksums that were all empty, because the hook was broken — it passed because everything failed equally | - | n/a |

## Open rows

**3** and **6** have no executable check, **11** is bounded rather than
diagnosed, and **15** is a habit rather than a mechanism.

**15** is the one worth re-reading. The fix for row 13 was verified by comparing
checksums before and after — and all three were empty strings, because the hook
under test was broken and never wrote the file. Equal, therefore "no churn",
therefore green. The same shape as rows 3, 7 and 10, committed inside the
verification of a fix for that shape. What closes it is asserting a positive
first: the rebuilt test checks the file is non-empty and the rows are present
*before* comparing anything, so a total failure cannot read as a pass.

**11** was never confirmed to be a loop. The emission is now tied to the rounded
row, so it can fire at most once per threshold crossing and a loop cannot run
twice, and `stop_hook_active` is honoured. What is missing is the diagnosis: if
the two turns had another cause, this bound was paid for nothing. Cheap
insurance against an unbounded bill, but insurance, not understanding.

- **3** is arguably uncheckable: the tests assert against the palette because the
  hex values are a design choice, not a correctness property. What would close it
  is a mutation check — permute the palette, require at least one test to fail —
  which is worth doing and is not done.
- **6** was fixed by rounding, and the granularity was then set from a measured
  burn rate. Nothing asserts the file stays stable, so a future edit that
  re-tightens it would reintroduce the churn silently.
