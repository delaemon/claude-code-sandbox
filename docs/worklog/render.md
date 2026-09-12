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

## 2026-09-12T06:35Z — the state carries no running score, so the HUD does not claim one

**Decision**: the HUD shows **`LAST CHAIN`** — the score of the most recent
`lastResolve`, via `scoreChain` from `src/score/` — plus `PIECES`, `CLEARED`
and `BEST` from `state.stats`. There is no cumulative game score on screen,
because there is none in `GameState` and I will not invent one.

**Why**: `GameState` carries `lastResolve` (one `ResolveResult`) and `Stats`
(`piecesPlaced`, `chains`, `longestChain`, `totalCleared`). A game total is a
sum over *every* resolve, which no field holds, and `draw` is forbidden to
accumulate anything between calls. The three ways out were all worse than
saying so:

- keeping the total in the renderer — banned by the contract ("no state of its
  own between calls"), and it would desynchronise the moment a frame is skipped;
- smuggling it through `Layout` — `layout` is geometry, and a `score` field in
  it is a type that lies;
- adding `score` to `Stats` — that is `src/game/`, which round 3 explicitly
  freezes ("if you believe it must, that is a finding for your log, not an
  edit").

**Nice consequence**: the chain score is computed from `steps.slice(0,
stepIndex)` during the `resolving` phase, so the number climbs step by step in
time with the pops the player is watching, rather than jumping to the total
before the chain has finished. `hudModel(state)` is a separate exported pure
function, so this is tested as arithmetic and not through a `fillText` call.

**Evidence**: `src/game/state.ts:73-86` (`GameCommon`, `Stats`) — no score
field; `src/render/hud.ts`; `tests/render/hud.test.ts`.

**Open**: **for round 4, a game-layer change**: add `score: number` to `Stats`,
incremented in `tickResolving` with `totalScore(result)` from `src/score/`. It
is a three-line change in `step.ts`, it belongs there (the renderer must not be
the thing that remembers your score), and the HUD will pick it up. Until then
"LAST CHAIN" is the honest label.

## 2026-09-12T06:40Z — colour is never the only signal, and one `arc` means one puyo

**Decision**: each of the five colours gets a distinct fill, a darker outline, a
lighter shine *and* a distinct glyph stamped on it — red triangle, green square,
blue diamond, yellow cross, purple chevron. Same-colour orthogonal neighbours
are joined by a fill bridge so a group reads as one blob.

**Why**: five hues at 20-40px is exactly the case where red/green and
blue/purple collapse for a colour-blind player, and the game is *about* telling
colours apart — an accessibility failure here is a gameplay failure. Shapes
plus lightness cost one extra path per puyo and survive a greyscale screenshot.
Rejected drawing eyes (the real game's cue): they are the same on every colour,
so they add pixels and no information.

**Second reason, and the one that shaped the implementation**: the glyphs are
polylines, never arcs, so **`ctx.arc` is called exactly once per puyo drawn**.
That gives the fake-context tests a precise, cheap invariant — "arcs ==
occupied visible cells + visible piece cells + preview cells" — which is what
catches "drew 13 rows instead of 12" directly instead of by pixel inspection.

**Evidence**: `src/render/palette.ts`, `drawPuyo` in `src/render/draw.ts`;
`tests/render/draw.test.ts` counts arcs.

## 2026-09-12T06:45Z — the game-over piece is drawn, and the preview is already right

**Decision**: on `phase: 'gameover'`, `draw` renders `state.blockedPiece` at 45%
alpha in the well, then a translucent overlay with `GAME OVER` and the reason.
Nothing special is done to the preview panel.

**Why**: the reducer deliberately does *not* advance the queue on a blocked
spawn (docs/worklog/game.md), so `upcoming(state.queue, n)` already has the
pair that had nowhere to go in slot 0. The "you died here" display the game
agent left the state for falls out of drawing the state as it is. Only the
visible cell of the blocked piece appears — its child is in the hidden row and
goes through the same `isVisible` guard as everything else.

**Evidence**: `drawActivePiece`/`drawGameOver` in `src/render/draw.ts`;
`tests/render/draw.test.ts` asserts the dimmed piece and the overlay text.
