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

## Open rows

**3** and **6** have no executable check.

- **3** is arguably uncheckable: the tests assert against the palette because the
  hex values are a design choice, not a correctness property. What would close it
  is a mutation check — permute the palette, require at least one test to fail —
  which is worth doing and is not done.
- **6** was fixed by rounding, and the granularity was then set from a measured
  burn rate. Nothing asserts the file stays stable, so a future edit that
  re-tightens it would reintroduce the churn silently.
