# Worklog — game agent

Owns `puyopuyo/src/game/`, `puyopuyo/tests/game/`, and the `hiddenRows` option
on `src/core/resolve.ts`.

**Written by the orchestrating session, not by the agent.** The agent was
terminated mid-run by a rate limit after its code and tests were on disk but
before it wrote this file. The decisions below are read back out of the code and
confirmed against the test suite, so they are recorded rather than lost — but
they are reconstructed, and the reasons are inferred from the implementation and
its comments, not stated by the author. Treat the *what* as verified and the
*why* as a best reading.

## 2026-09-12 — rotation refuses rather than double-kicks

**Decision**: `rotate(board, piece, direction)` tries the rotated position; if it
does not fit, it tries exactly one kick, shifting the piece by the inverse of
the child's offset; if that does not fit either it returns `null` and the
rotation does not happen. No second kick, no 180° flip.

**Why**: one kick is what makes rotating against a wall or a neighbouring stack
feel right, which is the case players actually hit. Returning `null` rather than
silently keeping the old piece makes the refusal explicit at the call site, so
the reducer decides what a refused rotation means instead of the geometry
quietly swallowing it.

**Evidence**: `src/game/piece.ts:114-122`; `tests/game/piece.test.ts` (16 tests,
passing) covers the rotation cases including the wall case.

## 2026-09-12 — game over is a blocked spawn column

**Decision**: when a freshly spawned piece does not fit, the state becomes
`{ phase: 'gameover', reason: 'spawn-blocked', blockedPiece }`. The queue is
deliberately *not* advanced, so a UI can still show the pair that had nowhere to
go.

**Why**: this is the real game's rule — you lose when the stack reaches the
spawn column, not when it reaches the top of the playfield. Keeping the blocked
piece in the state means the losing position can be drawn rather than inferred.

**Evidence**: `src/game/step.ts:88-99`; `tests/game/step.test.ts` (27 tests,
passing).

## 2026-09-12 — the contract's two invariants hold

**Decision**: nothing under `src/game/` reads a clock or generates randomness.
Time enters only as `tick(ms)`; the queue takes an injected `rng: () => number`,
with `mulberry32` provided as a seeded generator for tests and used by default
nowhere.

**Evidence**: `grep -rnE "Date\.now|performance\.|setTimeout|setInterval|
requestAnimationFrame|Math\.random|document|window" src/game/` returns only
comment lines saying these are absent. `src/game/rng.ts`, `queue.ts:49-69`.

**Why it matters**: this is what lets 27 reducer tests run with no clock and no
flake, the same way `resolve` is tested with no canvas.

## 2026-09-12 — phases are a discriminated union

**Decision**: `GameState = SpawningState | FallingState | LockingState |
ResolvingState | GameOverState`, discriminated on `phase`, and
`Input = TickInput | PlayerAction`.

**Why**: the contract asked for illegal input in a phase to be impossible to act
on rather than merely ignored. A union on `phase` gets that from the compiler —
a handler that reaches for a field the current phase does not carry fails to
typecheck.

**Evidence**: `src/game/state.ts:91-161`; `npm run typecheck` exits 0.

## Open

- **No log from the author.** Anything the agent decided and did not encode in
  code or comments is gone. The cheap fix for next time is to have agents write
  their log entry *when they make the decision*, not at the end — a log written
  last is the first thing lost to an interruption.
- Rendering and real browser input are still not started; `src/main.ts` is
  round 1's placeholder. That is round 3, and it is now the only thing between
  this and a playable game.
- Nothing exports `src/game/` or `src/score/` from a top-level barrel; the
  renderer imports `../game/index.js` and `../score/index.js` directly.
