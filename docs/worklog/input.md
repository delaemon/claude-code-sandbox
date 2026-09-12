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
