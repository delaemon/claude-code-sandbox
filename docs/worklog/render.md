# render — worklog

Owns `puyopuyo/src/render/`, `puyopuyo/tests/render/`, `puyopuyo/src/main.ts`,
`puyopuyo/index.html`, `puyopuyo/src/style.css`.

Entries are appended when the decision is made, not at the end — round 2's
lesson (CONTRACT.md, "write the log entry when you decide").

## 2026-09-12T06:25Z — geometry is one integer `cell` and everything derived from it

**Decision**: `src/render/geometry.ts` exposes `createLayout({ cell, ... })`,
which derives every rect from a single integer cell size in units of that cell:
`pad = gap = round(cell/2)`, board `cols x rows` at `(pad, pad)`, a side panel
`3 * cell` wide starting `gap` to the right of the board, the preview slots at
the top of that panel and the HUD below them. Canvas size falls out:
`(cols + 4.5) * cell` by `(rows + 1) * cell`, rounded. `fitLayout(w, h, opts)`
is the only function that chooses a cell size — `floor(min(w/(cols+4.5),
h/(rows+1)))`, clamped to `[MIN_CELL, MAX_CELL]` — and then calls
`createLayout`. No canvas import anywhere in the module.

**Why**: the contract wants geometry testable as arithmetic. One free variable
means every test is an exact integer identity rather than a float comparison,
and the responsive behaviour is one function (`fitLayout`) rather than being
smeared through the drawing code. Rejected: laying out from a fixed pixel
design and scaling with `ctx.scale`, which makes the tests assert on a
transform they cannot see, and makes the hidden-row offset a float.

**The off-by-one, stated once**: `cellRect(layout, x, y)` takes a *board* row
(`y = 0` is the hidden spawn row) and returns
`board.y + (y - hiddenRows) * cell`. So `y = hiddenRows` is the top visible row
and sits exactly on `board.y`; `y = 0` returns a rect *above* the board rect,
with a negative offset. `isVisible(layout, y)` is the guard, and `draw` skips
every cell it rejects. Returning an out-of-band rect rather than throwing or
clamping is deliberate: clamping would draw the hidden row on top of row 1,
which is exactly the bug the contract warns about and is invisible on screen.

**Evidence**: `src/render/geometry.ts`; `tests/render/geometry.test.ts` asserts
`cellRect(y=hiddenRows).y === board.y`, `cellRect(y=0).y === board.y - cell`,
that the last visible row's bottom is exactly `board.y + board.h`, and that the
board rect is `12 * cell` tall — not 13 — at four different cell sizes.

**Open**: nothing here yet.
