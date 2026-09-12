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

## 2026-09-12T06:50Z — the fake context records style, not just calls

**Decision**: `tests/render/fake-context.ts` is a `RecordingContext` that logs
every call as `{ fn, args, text, fillStyle, strokeStyle, globalAlpha, font,
textAlign }` and implements `save`/`restore` as a real push/pop of those
properties. Assertions are then written against that record — arc count, arc
centres, `fillText` strings.

**Why**: recording bare call names is enough for "how many puyos" and useless
for "was the dead piece dimmed" or "did the alpha leak into the rest of the
frame". Emulating the save/restore stack is what makes the second assertion
possible at all, and it caught the thing it was written for: without a
`restore`, the preview panel would be drawn at 45% alpha after a game over.

**Evidence**: `npx vitest run tests/render` → 46 passed
(geometry 24, draw 18, hud 4). The tests that matter to the contract's warning:
`draws 12 rows of a full board, not 13` (a full 6x13 board draws 72 board
puyos, not 78) and `never draws the hidden row into the playfield` (setting
`board[0][0]` changes no call at all).

**Open**: no test asserts the *picture* — only the calls. A puyo drawn in the
right place with `fillStyle` left at the background colour would pass. The
palette is data (`palette.ts`), so a colour typo is a one-line fix; a
screenshot test is not worth a browser this round (the contract says as much).

## 2026-09-12T07:05Z — the frame: actions first, then the tick, then draw

**Decision**: `main.ts` does, per `requestAnimationFrame`:
`elapsed = clamp(now - previous, 0, 100)` → `input.advance(elapsed)` →
`for (a of input.drain()) state = step(state, a)` → `state = step(state,
tick(elapsed))` → `syncLayout()` → `draw(ctx, state, layout)`.

**Why each part of that order**:

- **`advance` before `drain`**: auto-repeat actions generated by this frame's
  elapsed time are then in the queue this frame, instead of arriving one frame
  late. Both calls get the *same* ms as the reducer, which is what keeps DAS
  and gravity on one clock.
- **Actions before the tick**: the player's keypresses happened during the
  frame that just ended, before this frame's time passed. Ticking first would
  drop the piece a row and *then* apply the move the player made before it
  fell — which is how a hard drop lands one row lower than it looked.
- **Clamp to 100ms**: a backgrounded tab hands back a gap of seconds on the
  first frame after it returns. Feeding that in whole would lock, resolve and
  possibly end the game before a single frame is drawn. Clamping loses real
  time, which is the right thing to lose; the alternative (pausing on
  `visibilitychange`) is more state for the same outcome.

**Also here, because nowhere else may have it**: `mulberry32(seed)` with the
seed from `Date.now() ^ Math.random()`, or from `?seed=<n>` when the URL says
so. The stack below is deterministic given a seed and a list of inputs, so a
run can be replayed by URL — that is worth six lines.

**Evidence**: `src/main.ts`; `grep -rn "performance\.\|requestAnimationFrame\|
Math\.random\|Date\.now" src/` matches `src/main.ts` only (plus comments in
`src/game/` and `src/input/` saying they contain none).

**Open**: `r` restarts only from the game-over screen, so a stray keypress
cannot throw away a live game; there is no pause key. Restart advances the seed
by one rather than reseeding from the clock, so consecutive games from
`?seed=N` are still reproducible.

## 2026-09-12T07:10Z — the page is a box for the canvas, sized in CSS

**Decision**: `index.html` is a three-row flex column — title bar, stage,
key legend — and `main.ts` measures the *stage*, not the window, then calls
`fitLayout(stageW, stageH)`. The canvas gets an explicit CSS size in the
layout's units and a backing store multiplied by `devicePixelRatio` (capped at
3), with `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` applied once per resize.

**Why**: measuring a container that CSS already sized means the responsive
rules stay in CSS and the renderer keeps taking plain CSS pixels — nothing
under `src/render/` knows what a device pixel ratio is, and the geometry tests
stay integer arithmetic. The stage is `flex: 1; min-height: 0`, which is what
actually makes `clientHeight` definite; without `min-height: 0` a flex child
refuses to shrink and the canvas grows the page instead of fitting it. There is
no feedback loop, because the canvas's own size never affects the stage's.

**Evidence**: `npm run build` → `dist/index.html 1.22 kB`,
`dist/assets/index-*.css 1.64 kB`, `dist/assets/index-*.js 18.26 kB`, built in
348ms. The stylesheet is linked from `index.html` rather than imported from
`main.ts` deliberately: a `import './style.css'` does not typecheck under
`tsc --noEmit` without a module declaration, and Vite processes the `<link>`
just as well.

**Open**: **the game is not playable on a phone.** It *fits* a phone — the
layout scales down to a 10px cell and the key legend wraps — but the only input
source this round is a keyboard, so a touch device can watch and not play.
Touch controls are a round-4 job for the input agent (`InputSource` is the
right seam: a `createTouchInput` producing the same `PlayerAction[]` needs no
change here beyond attaching it).

## 2026-09-12T07:20Z — a smoke test for the one file that is all side effects

**Decision**: `tests/render/main.test.ts` stubs `window` and `document` with
the smallest objects `main.ts` needs, hands it the same `RecordingContext` the
draw tests use as its 2d context, imports the module and drives frames by hand.

**Why**: every other file here is a pure function with a unit test; `main.ts`
is the wiring, and wiring fails at exactly the points unit tests cannot see — a
selector that matches nothing, a `getContext` result used before the null
check, a loop that never asks for a second frame. Five stubbed properties buy
"input → step → draw runs end to end, twice, and the piece falls on its own".
It is the only test that imports a module for its side effects, so it lives
alone in its own file.

**Evidence**: it caught the real bug in `main.ts` before a browser ever did —
`ctx` narrowed by a null check does not stay narrowed inside the hoisted
`frame`/`syncLayout` declarations, which `tsc` reported as
`src/main.ts(100,3): error TS18047: 'ctx' is possibly 'null'`. Fixed with an
annotated alias rather than a non-null assertion.

## 2026-09-12T07:25Z — verification

**Decision**: nothing outstanding; all three commands pass with the input
agent's module in place (`src/input/` landed while this was being written, and
matches the frozen interface exactly — `attach`/`detach`/`advance`/`drain`,
`createKeyboardInput(options?)`, arrows + `z`/`x` + space).

**Evidence** — real output, `puyopuyo/` as the working directory:

```
$ npm run typecheck

> puyopuyo@0.0.0 typecheck
> tsc --noEmit

$ npm test

> puyopuyo@0.0.0 test
> vitest run

 RUN  v3.2.7 /home/user/claude-code-sandbox/puyopuyo

 ✓ tests/game/step.test.ts (27 tests) 32ms
 ✓ tests/render/main.test.ts (5 tests) 263ms
 ✓ tests/render/draw.test.ts (18 tests) 36ms
 ✓ tests/input/keyboard.test.ts (32 tests) 21ms
 ✓ tests/render/geometry.test.ts (24 tests) 25ms
 ✓ tests/game/hidden-rows.test.ts (7 tests) 6ms
 ✓ tests/score/score.test.ts (11 tests) 13ms
 ✓ tests/game/queue.test.ts (7 tests) 13ms
 ✓ tests/board.test.ts (5 tests) 7ms
 ✓ tests/game/piece.test.ts (16 tests) 13ms
 ✓ tests/resolve.test.ts (9 tests) 11ms
 ✓ tests/render/hud.test.ts (4 tests) 10ms
 ✓ tests/text.test.ts (5 tests) 7ms
 ✓ tests/score/tables.test.ts (6 tests) 5ms
 ✓ tests/groups.test.ts (8 tests) 8ms
 ✓ tests/gravity.test.ts (6 tests) 4ms

 Test Files  16 passed (16)
      Tests  190 passed (190)
   Start at  06:33:06
   Duration  2.75s (transform 641ms, setup 0ms, collect 1.41s, tests 473ms, environment 5ms, prepare 1.65s)

$ npm run build

> puyopuyo@0.0.0 build
> vite build

vite v7.3.6 building client environment for production...
transforming...
✓ 26 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                  1.22 kB │ gzip: 0.57 kB
dist/assets/index-CtaWxKIf.css   1.64 kB │ gzip: 0.83 kB
dist/assets/index-BOEauP62.js   18.26 kB │ gzip: 7.20 kB
✓ built in 307ms
```

190 = the 107 that existed before round 3, plus 32 from the input agent, plus
51 here (geometry 24, draw 18, hud 4, main 5).

## Open — for the next round

1. **`GameState` has no cumulative score.** The HUD says `LAST CHAIN` because
   that is all the state can answer. Fix in `src/game/`: add `score` to `Stats`
   and add `totalScore(result)` to it in `tickResolving`. Renderer needs a
   one-line change once it exists. (Full reasoning in the 06:35Z entry.)
2. **No touch input, so a phone can watch but not play.** The page fits a phone;
   the only `InputSource` is a keyboard. `createTouchInput` behind the same
   interface would need nothing from this layer but an `attach`.
3. **No landing ghost and no lock-delay feedback.** A resting piece looks
   exactly like a falling one, so the half-second of lock delay is invisible.
   Both are pure functions of the state (`isGrounded`, `lockAccMs`) and belong
   in `draw` when someone wants them.
4. **Nothing asserts colour.** The tests check what was drawn and where, never
   what it looked like; a wrong `fillStyle` would pass. See the 06:50Z entry.
5. **Two notes on the contract itself, neither of which I changed.** It freezes
   `draw(ctx, state, layout)` without saying what `Layout` is, so I defined it
   (geometry only — cell, board/panel/next/hud rects, canvas size); and it
   assumes a score can be shown from `GameState`, which item 1 above is about.
