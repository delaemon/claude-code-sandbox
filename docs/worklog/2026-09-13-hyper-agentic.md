## 2026-09-13 — Point the harness at an application, then close the loop around it

**Decision**: two things, and the second only became visible because of the
first.

1. `app/` — a Minesweeper with a pure core and one shell file holding every
   clock, random source and DOM call. Not a demo. Four gates reported *did not
   run* until it existed, and a harness with nothing pointed at it cannot be
   caught lying.
2. The automation layer: `gates.sh --json` and `--fast`, `autopilot.mjs`,
   `.claude/hooks/gate-stop.sh`, `learn.mjs`, and the two self-tests that
   exercise the new machinery (`eval-runner.sh`, `learn-check.sh`).

**Why**: the harness was complete as a set of checks and incomplete as a loop.
Running them, reading them and recording what they found were all still done by
hand — and each is the kind of step that gets skipped exactly when things are
going badly.

The alternative considered for the Stop hook was running the full gate set on
every stop. Rejected at two minutes a turn; the fast tier is 2.4s. The cost of
that choice is that the hook must never say *green*, because it asks four
questions of fifteen — so it names the eleven it did not ask, every time.

The alternative for `learn.mjs` was leaving `/harden` as prose and trusting the
ritual. Rejected because `evals/run.sh` already exists to re-check the ledger's
claims, and re-checking a claim only helps if it was true when written. Nothing
checked that.

**Verified**: 15 gates green in 2m04s, and every new guard watched failing
before being trusted:

- `ci-trigger.mjs` — six breaks: wrong branch, no `push:` block, the right name
  present only in a comment, and two legitimately-broad forms that must pass.
- `eval-runner.sh` — four, one per outcome, plus a runner made to fail
  everything, which the positive case caught.
- `app/smoke.mjs` — the mine-readout bug reintroduced, first-click safety
  removed, the clock left running. One failing check each, named correctly.
- the exit-code translation — a fixture whose `test` exits 3; with the
  translation reverted, `doctor.sh` goes red.
- the gate hook — hook scratch un-ignored, the `--where` probe made inert, and
  the stdin redirect removed (which hangs `doctor.sh`, which is why the bound
  is there).
- `learn.mjs` — its own refusal path, three ways, in a throwaway copy.

Eleven new ledger rows, 31 to 42. Row 42 was written by `learn.mjs` itself.

**What went wrong along the way**, since that is the part worth reading:

- Three test expectations of mine were wrong before the code ever was — the
  `(2,1)` adjacency, a win-walk that hit a flood fill, and a mine cell's own
  neighbour count. The suite caught all three, which is the suite working.
- I restored a file with `git checkout` between break cases and tested the
  *committed* version three times in a row without noticing. Exactly the
  "confirm the break lands before reading the verdict" failure this ledger
  keeps recording.
- `pkill -f http-server` and `pkill -f doctor.sh` each matched their own shell
  and killed the command running them. Twice.

**Cost**: 1,195,667 output + cache-write tokens across 365 requests, by
`scripts/usage.sh --line`. Remaining quota is not recorded anywhere and is not
claimed here.
