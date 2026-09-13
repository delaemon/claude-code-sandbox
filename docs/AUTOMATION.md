# The loop, and what closes it

This harness started as a set of checks a person had to remember to run. This
file is about the part that came after: making the *running* of them, the
*reading* of them, and the *recording* of what they found happen without anyone
remembering anything.

## The gap

Everything here was already executed by something. Hooks fire because the
harness fires them. CI runs because GitHub runs it. `gates.sh` exists and gives
one verdict. And then there was a gap, in three places:

| gap | what actually happened |
| --- | --- |
| running them | a turn ends, nobody ran the gates, CI finds out twenty minutes and a push later — and two of the three engines have no way to run anything on a turn at all |
| reading them | seventeen results, and the first one you fix is the one that was only failing because of another |
| recording them | `/harden` ends in "add a row to `docs/LEDGER.md`" — a person editing a markdown table, ticking *verified by breaking* on their own authority |

Each is small. Each is the kind of step that gets skipped precisely when things
are going badly, which is when it matters.

## What closes it

```
        edit
          │
          ▼
   ┌──────────────┐   every stop, ~2s      ┌──────────────────┐
   │ gate-stop.sh │ ─────────────────────▶ │ gates.sh --fast  │
   └──────────────┘                        │        --json    │
          ▲                                └────────┬─────────┘
          │ additionalContext                       │ results as data
          │ (exit 0, never exit 2)                  ▼
   ┌──────┴───────┐                        ┌──────────────────┐
   │  next turn   │ ◀───── work order ──── │  autopilot.mjs   │
   └──────┬───────┘                        └──────────────────┘
          │                                   ordered by cause,
          │ fix the cause                     evidence extracted
          ▼
   ┌──────────────┐    the failure was the harness's own
   │  learn.mjs   │ ◀──────────────────────────────────────
   └──────┬───────┘
          │ writes the row AND the eval case,
          │ replays it, keeps neither unless it caught
          ▼
   docs/LEDGER.md + evals/cases/*.sh
```

### Running them — a Stop hook, or a git hook

Only one of the three engines this repository supports can run something on
every turn. The trigger therefore differs per engine while everything after it
is shared — `docs/ENGINES.md` has the table:

| | trigger |
| --- | --- |
| Claude Code | `.claude/hooks/gate-stop.sh`, every stop |
| Codex, Gemini CLI | `githooks/pre-commit`, at commit time |
| all three | CI, on every push and pull request |

#### `.claude/hooks/gate-stop.sh`

A Stop hook running the **fast tier**: the six gates that answer in about two
seconds. The verdict comes back through `hookSpecificOutput.additionalContext`,
so it reaches the next turn's reasoning at no cost in tool calls.

Four ledger rows shape it, and all four are failures this repository has
already had:

- **Row 25.** A hook that dirties a tracked file every turn starts a loop: the
  commit runs CI, CI notifies, the notification wakes a turn, the turn writes
  another line. It ran for an hour at about a commit a minute. So this hook
  writes nothing tracked, and `--json` does not fold the staged logs.
- **Row 11.** Five stops inside a minute is faster than a person, so it goes
  quiet. Insurance against a runaway that was never demonstrated — worth paying
  for because the thing it guards against spends a quota unattended.
- **Row 8.** Exit 0 with `additionalContext`, never exit 2. Exit 2 is for
  stopping something, not for being heard; believing otherwise cost a tool call
  every turn.
- **Row 32.** A verdict about a tree that has since changed is worse than no
  verdict, so the fingerprint of what was checked is stored beside the result.

And one rule that is not a row: **it never says green.** The fast tier asks
six questions of seventeen, and the line it returns names the eleven it did not
ask. A subset reporting "all gates pass" is precisely the failure this
repository exists to refuse.

### Reading them — `scripts/autopilot.mjs`

Takes a `gates.sh --json` report and returns a work order. Three things it does
that reading the raw output does not:

1. **Orders by what causes what.** A broken environment makes every other
   result meaningless; a failing typecheck makes the test run meaningless. The
   first entry is the one to fix, not the first one that happened to run.
2. **Extracts the line that matters.** Each gate fails in a shape it knows —
   `error TS`, `SURVIVED`, `NOT caught`, `file:line` — so the order carries the
   evidence rather than the three hundred lines around it.
3. **Says what did not run.** Two failures out of a tier that skipped eleven
   checks is not "two things left to do". It is two things to do and eleven
   questions not yet asked.

```console
$ node scripts/autopilot.mjs --fast
gates: 3 failing of 4 run — in the order to fix them

1. typecheck — the application does not compile
     src/pure/board.ts(70,14): error TS2322: Type 'string' is not assignable to type 'number'.
   → fix the type errors first — every result below this was produced against code that does not build

2. clock boundary — a clock or a random source escaped the one file allowed to hold one
     app/src/pure/game.ts:84: Date.now
   → move it back behind the boundary, or take the value as an argument
...
```

`--json` gives the same thing as data.

### Recording them — `scripts/learn.mjs`

The ledger's `verified by breaking` column used to be a claim. `evals/run.sh`
made it *re-checkable* (row 18) — but re-checking a claim only helps if it was
true when written, and nothing checked that. `ledger.sh` asks whether the named
check **exists**, never whether it catches anything.

`learn.mjs` writes the eval case and the row, replays the case, and **removes
both** unless the check passed against an unbroken copy and failed against a
broken one. Three ways through it end in nothing being kept:

- a break that damages nothing the check looks at,
- a break that never landed — the `sed` matched nothing,
- a check that was already failing for an unrelated reason.

All three have happened here. All three read as success if nobody looks.

This is the run that produced row 42 — the tool's first row is its own, the
failure that ledger rows were written by hand recorded by the thing that
stopped them being:

```console
$ node scripts/learn.mjs \
    --name learn-keeps-unearned-row \
    --failure 'Ledger rows were written by hand, so a row could be added whose check had never been seen to catch anything' \
    --check 'bash scripts/learn-check.sh' \
    --catcher 'scripts/learn-check.sh' \
    --break "$BREAK"
row 42, case evals/cases/learn-keeps-unearned-row.sh — replaying it
  ok    learn-keeps-unearned-row           row 42

1 replayed, 1 still caught, 0 NOT caught

learned: row 42 is in docs/LEDGER.md, and evals/cases/learn-keeps-unearned-row.sh replays it.
Its "verified by breaking" was earned by running, not by being typed.
```

`--next` prints the next free row number; `--dry-run` shows what it would
write and verifies nothing.

## The tiers

| | gates | takes | what it is for |
| --- | --- | --- | --- |
| `--fast` | 6 | ~2s | every stop, or every commit. What an edit can break. |
| `--quick` | 11 | ~20s | no browser, no mutants, no eval replay. A sanity check mid-work. |
| (none) | 17 | ~2m | before pushing. The only tier allowed to say *all gates pass*. |

A tier always names what it skipped. `gates.sh --fast` says
`every gate in this tier passes` and lists the rest — never `all gates pass`.

## What is still a person's job

Deciding whether a failure is worth a check at all, and stating it as a
behaviour rather than as a diff. `learn.mjs` will refuse a check that does not
bite, but it cannot tell you that the thing you checked was the wrong thing.

`/auto` runs the loop. `/harden` records what it taught you. Neither decides
what matters.
