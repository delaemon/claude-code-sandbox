# Worklog — input agent (round 3)

Owns `puyopuyo/src/input/` and `puyopuyo/tests/input/`. Nothing else.

Written entry-by-entry as the decisions were made, not reconstructed at the end
— see round 2's note in `CONTRACT.md`.

## 2026-09-12T06:21Z — module shape

**Decision**: three files. `src/input/source.ts` holds the `InputSource`
interface exactly as frozen in the contract; `src/input/keyboard.ts` holds
`createKeyboardInput`, `KeyboardOptions`, the default key map and the timing
defaults; `src/input/index.ts` is the barrel the render agent imports
(`../input/index.js`), matching how `src/game/` and `src/score/` are imported.

**Why**: `InputSource` is the thing `main.ts` depends on and the thing a future
gamepad or touch source would also implement, so it does not belong inside the
keyboard file. The barrel exists because round 2's log records that the renderer
imports `../game/index.js` directly — there is no top-level barrel, so each
directory has to provide its own.

**Evidence**: `CONTRACT.md` lines 189-203 (frozen `InputSource`);
`docs/worklog/game.md` "Open" (no top-level barrel); `src/game/index.ts`.

**Open**: nothing.

## 2026-09-12T06:22Z — DAS 170 ms, ARR 50 ms; soft drop 100/40

**Decision**: `KeyboardOptions` exposes four numbers with these defaults —
`dasMs: 170`, `arrMs: 50` for horizontal movement, and `softDropDasMs: 100`,
`softDropArrMs: 40` for soft drop. All four are overridable.

**Why**: at 60 Hz these are ~10 frames of delay and ~3 frames of repeat.
170 ms is comfortably longer than a deliberate tap (a tap is 30-80 ms), so a
single press can never produce two moves, and short enough that a held key
starts sliding without feeling stuck. 50 ms crosses the whole 6-wide board in
about 250 ms after the delay, which is fast without overshooting by a column.
Soft drop gets its own shorter pair because holding *down* is never exploratory
— it always means "fall faster now" — whereas holding *left* is often a
single-column nudge that must not repeat. One shared pair of numbers would have
forced a compromise that is wrong for one of the two.

Rejected: a single `repeatMs` with no initial delay (every tap becomes a slide);
per-key rather than per-action timings (the key map is remappable, so timings
keyed on `ArrowLeft` would break the moment someone remaps it).

**Evidence**: values chosen from the standard 60 Hz frame budget; verified by
`tests/input/keyboard.test.ts`, which asserts nothing repeats at 169 ms and the
first repeat lands at 170 ms.

**Open**: these are feel values, not measured ones. Nobody has played the game
yet — once `main.ts` runs, they are the first thing to tune, and they are
options precisely so tuning needs no code change.

## 2026-09-12T06:23Z — opposing keys: last press wins, release falls back

**Decision**: holding left and then pressing right emits `moveRight` at once and
starts a fresh DAS for right; left stays *held but suspended* and produces
nothing. Releasing right hands control back to left, which restarts from a full
DAS delay and emits **no** action on the release itself. Symmetric for the other
order. Soft drop is independent of both — down + left repeat at the same time.

**Why**: last-press-wins is what every modern falling-block game does, and it is
the only rule where a correction is instant: the player who is sliding left and
sees the gap is to the right presses right and moves right on that frame.
Rejected "both held = neutral" (the board stops dead and the player has to
release and re-press to get anything, which reads as a dropped input) and
"first press wins" (the correction does nothing until the old key is released).

The two sub-decisions inside it, which are the ones a later reader will
second-guess:
- *Release emits nothing.* A key going **up** must never produce a movement; if
  releasing right also stepped left, the piece would drift after the player
  stopped asking for anything.
- *The fallback restarts DAS rather than resuming left's old charge.* Resuming a
  charge means the piece can start machine-gunning left the instant right is
  released, which looks like a bug from the player's seat. A fresh delay makes
  the fallback feel like a fresh press, which is what it is.

**Evidence**: implemented in `src/input/keyboard.ts` (`setHorizontalOwner`);
`tests/input/keyboard.test.ts` covers press-left/press-right/release-right,
including that the release itself is silent and that left then needs a full
`dasMs` before repeating.

**Open**: nothing.

## 2026-09-12T06:34Z — telling the browser's key-repeat storm from ours

**Decision**: a `keydown` is treated as a real press only if `event.repeat !== true`
**and** the key is not already in the held map. Everything else is dropped.

**Why**: holding a key makes the OS fire a stream of `keydown` events at the
system repeat rate. If those were treated as presses the game would have two
auto-repeats fighting — one at whatever rate the player's OS is set to, which
this project neither controls nor can test, on top of the DAS/ARR the contract
asks for. `event.repeat` is the standard flag for it. The second check is not
redundant: a synthetic or forwarded event (including the ones this repo's own
tests dispatch) can omit the flag, and "a key I already think is down cannot be
pressed again" is true regardless.

The same held-map check is what keeps rotation and hard drop firing once per
press: they are not in the repeating set, so their only source of a second
action would have been a storm keydown, and that is now filtered.

**Evidence**: `src/input/keyboard.ts` `onKeyDown`; tests
"ignores the browser's own key-repeat storm" (flagged) and "…even when the
event omits the repeat flag" (unflagged).

**Open**: nothing.

## 2026-09-12T06:36Z — three smaller calls, recorded because they are invisible

**Decision**, with the reason inline:

- **`preventDefault()` on mapped keys, on by default, overridable.** Arrow keys
  and space scroll the page; a game where hard drop also scrolls the window is
  broken in a way no test in Node will ever catch. It is an option because a
  host embedding the canvas in a larger page may want to decide that itself.
- **`blur` clears every held key.** Alt-tab while holding left and the matching
  `keyup` is delivered to nobody; without this the piece keeps sliding after the
  player comes back. It emits no actions — it only forgets. `detach()` removes
  this listener along with the other two.
- **The DAS→ARR transition carries the overflow** (`acc -= dasMs`), it does not
  reset to zero. With 16 ms frames a reset would round every repeat up to the
  next frame and make the effective ARR drift above the configured one. Carrying
  it means one `advance(500)` produces exactly as many repeats as thirty
  `advance(16.67)` calls, which is also what makes the tests' large steps
  meaningful.

Also: `drain()` after `detach()` still returns actions produced before the
detach. Detaching stops *listening*; silently swallowing input the player
already gave would be a different and worse behaviour.

**Evidence**: `src/input/keyboard.ts`; `tests/input/keyboard.test.ts` covers the
blur case and the detach case, and asserts one `advance(1000)` matches the
per-frame sum.

**Open**: `advance(ms)` has no cap on repeats emitted per call — a 10-second
stall while a key is held would queue ~200 moves. That is arithmetically right
and clamping elapsed time is `main.ts`'s job (it is the only file with a clock),
so the clamp belongs there, not here. Flagging it so it is a decision rather
than an oversight.

## 2026-09-12T06:44Z — verification

**Decision**: done; 32 input tests, all deterministic, no timers anywhere.

**Evidence**: run in `puyopuyo/`.

```
$ npm run typecheck

> puyopuyo@0.0.0 typecheck
> tsc --noEmit

$ npm test

> puyopuyo@0.0.0 test
> vitest run

 RUN  v3.2.7 /home/user/claude-code-sandbox/puyopuyo

 ✓ tests/input/keyboard.test.ts (32 tests) 18ms
 ✓ tests/render/geometry.test.ts (24 tests) 19ms
 ✓ tests/game/step.test.ts (27 tests) 40ms
 ✓ tests/game/queue.test.ts (7 tests) 11ms
 ✓ tests/game/hidden-rows.test.ts (7 tests) 6ms
 ✓ tests/game/piece.test.ts (16 tests) 10ms
 ✓ tests/resolve.test.ts (9 tests) 10ms
 ✓ tests/score/score.test.ts (11 tests) 21ms
 ✓ tests/groups.test.ts (8 tests) 11ms
 ✓ tests/board.test.ts (5 tests) 11ms
 ✓ tests/text.test.ts (5 tests) 5ms
 ✓ tests/score/tables.test.ts (6 tests) 6ms
 ✓ tests/gravity.test.ts (6 tests) 5ms

 Test Files  13 passed (13)
      Tests  163 passed (163)
```

163 = round 2's 107, plus my 32, plus 24 the render agent had landed under
`tests/render/` by the time I ran. Nothing under `tests/render/` failed and
`tsc` reported nothing in `src/render/` or `src/main.ts`, so there was nothing
of theirs to leave alone. `npx vitest run tests/input` passes on its own (32/32),
so my file does not depend on theirs.

The no-clock invariant, checked the same way round 2 checked `src/game/`:

```
$ grep -rnE "Date\.now|performance\.|setTimeout|setInterval|requestAnimationFrame|Math\.random" src/input/
src/input/source.ts:12: * `Date.now`, `performance.now`, `setTimeout`, `setInterval` or
src/input/source.ts:13: * `requestAnimationFrame`; that is what makes auto-repeat testable in Node with
src/input/keyboard.ts:5: * fed the same elapsed milliseconds as the game tick. `grep` for `Date.now`,
src/input/keyboard.ts:6: * `performance.`, `setTimeout`, `setInterval` or `requestAnimationFrame` in
```

Comment lines only, in both files — same result the game agent got, for the
same reason.

**Open**: none beyond the two already flagged above (the feel values want
playtesting; `advance` is uncapped by design and `main.ts` owns the clamp).

## 2026-09-12T06:45Z — the frozen interface, as implemented

**Decision**: implemented exactly as frozen — `attach(target)`, `detach()`,
`advance(ms)`, `drain()`, and `createKeyboardInput(options?)`. No objection to
record: the queue-not-callbacks choice is the right one, and it is what makes
`main.ts` able to hand the reducer a defined order of actions per tick.

Things I added *around* the frozen surface, none of which change it:
`KeyboardOptions` (shape was left to me), the `DEFAULT_*` constants exported so
a UI can show the bindings without duplicating them, and `KeyMap` as a named
type. `src/input/index.ts` re-exports all of it plus `InputSource`.

**Evidence**: `src/input/source.ts` is the contract's block verbatim;
`npm run typecheck` exits 0 against it.

**Open**: `main.ts` is the render agent's file, so the wiring — `attach` to
`window` or the canvas, `advance(dt)` with the same `dt` as `tick(dt)`, then
`drain()` and feed each action to `step` — is theirs to do. The order that
matters: **advance before drain**, and drain's actions applied in the order
returned. If they are applied in a different order relative to the tick, the
repeat rate silently changes.
