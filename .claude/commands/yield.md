---
description: Report which gates have ever caught anything here
---

Run `node scripts/yield.mjs` and report it.

Read the two halves separately. A `quiet` gate is one that has never failed here
*and* has no ledger row explaining it — those are the candidates to move to a
slower tier. A `holding` gate has a ledger row: its silence is the thing it was
built to produce, so leave it alone.

Also report the harness/application split of the ledger. If the harness half is
still almost all of it after real work on a real codebase, say so plainly: the
gates are catching their own construction rather than earning on the code.

Exit 3 means nothing has been recorded yet. That is not zero yield — say
"nothing recorded", never "no gate has caught anything".

Do not propose deleting a gate on the numbers alone. Whether a failure is still
plausible in this codebase is not something the record can answer.
