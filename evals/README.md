# Harness evals

`docs/LEDGER.md` claims, row by row, that a check was "verified by breaking".
Those words were true when they were written and are worth nothing afterwards:
a check can be weakened, a probe can stop reaching the guard it names, and the
table would still say `yes`.

These replay it. Each case breaks something in a throwaway clone and asserts the
named check **fails**. A case that passes when it should fail is the finding.

```bash
bash evals/run.sh            # every case
bash evals/run.sh secret     # cases whose name contains "secret"
```

A case is a shell file in `cases/` defining two things:

| | |
| --- | --- |
| `LEDGER_ROW` | the row it replays, so the two cannot drift apart |
| `break` | a function that damages the clone |
| `CHECK` | the command that must exit non-zero afterwards |

The runner asserts the check **passes before** the break as well. Without that,
a case whose check was already failing for an unrelated reason would report a
success it did not earn — the same vacuous-pass shape these cases exist to
catch, and one this repository has committed three times.
