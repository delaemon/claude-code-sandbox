/**
 * The reducer: `step(state, input) -> state`. Pure.
 *
 * Every transition is driven by an input. Ticks carry elapsed milliseconds
 * from outside; nothing here reads a clock or schedules anything.
 *
 * Phase handling is deliberately split into one handler per phase, each typed
 * to accept only the states it applies to. `applyAction` takes a
 * `ControllableState` and a `PlayerAction`, so "rotate during a chain" or
 * "tick handling that assumes a piece" cannot be written, not merely ignored.
 */

import { applyGravity, resolve, type Board } from '../core/index.js';
// The one dependency this layer has beyond core. Scoring stays a pure function
// of a ResolveResult; all this does is bank its answer when a chain finishes,
// because a total has to accumulate in the state and nothing above here holds
// state to accumulate it in.
import { totalScore } from '../score/index.js';
import {
  fits,
  isGrounded,
  lockPiece,
  moveDown,
  rotate,
  spawnPiece,
  translate,
  type Piece,
} from './piece.js';
import { queueTake } from './queue.js';
import type {
  ControllableState,
  GameCommon,
  FallingState,
  GameOverState,
  GameState,
  Input,
  LockingState,
  PlayerAction,
  ResolvingState,
  SpawningState,
  Stats,
} from './state.js';

/**
 * Advance the game by one input.
 *
 * Player actions only ever reach `applyAction`, which only accepts a
 * controllable (falling/locking) state; ticks are the only thing spawning,
 * resolving and game over react to.
 */
export function step(state: GameState, input: Input): GameState {
  if (input.type === 'tick') {
    const ms = input.ms;
    if (!Number.isFinite(ms) || ms < 0) throw new RangeError(`bad tick ms: ${ms}`);
    const advanced = { ...state, elapsedMs: state.elapsedMs + ms };
    switch (advanced.phase) {
      case 'spawning':
        return tickSpawning(advanced, ms);
      case 'falling':
      case 'locking':
        return tickControllable(advanced, ms);
      case 'resolving':
        return tickResolving(advanced, ms);
      case 'gameover':
        return advanced;
    }
  }
  // `input` is a PlayerAction here, and only a controllable state can act on one.
  switch (state.phase) {
    case 'falling':
    case 'locking':
      return applyAction(state, input);
    case 'spawning':
    case 'resolving':
    case 'gameover':
      return state;
  }
}

/** Run a whole list of inputs, front to back. */
export function stepAll(state: GameState, inputs: readonly Input[]): GameState {
  return inputs.reduce<GameState>(step, state);
}

// ---------------------------------------------------------------- spawning

function tickSpawning(state: SpawningState, ms: number): GameState {
  const sinceMs = state.sinceMs + ms;
  if (sinceMs < state.config.spawnDelayMs) return { ...state, sinceMs };

  const { pair, queue } = queueTake(state.queue);
  const piece = spawnPiece(pair, state.config.spawnX, state.config.spawnY);

  // Game over: the spawn column is blocked. The queue is deliberately *not*
  // advanced, so a UI can still show the pair that had nowhere to go.
  if (!fits(state.board, piece)) {
    const over: GameOverState = {
      ...baseOf(state),
      phase: 'gameover',
      reason: 'spawn-blocked',
      blockedPiece: piece,
    };
    return over;
  }

  const spawned: FallingState = {
    ...baseOf(state),
    phase: 'falling',
    queue,
    piece,
    fallAccMs: 0,
  };
  return spawned;
}

/**
 * The fields every phase shares. Phase transitions copy exactly these and then
 * add the new phase's own fields, rather than spreading the old state whole:
 * spreading would carry the previous phase's fields along as dead properties
 * that the union's types say are not there.
 */
function baseOf(state: GameState): GameCommon {
  const { config, board, queue, elapsedMs, stats, lastResolve } = state;
  return { config, board, queue, elapsedMs, stats, lastResolve };
}

// ------------------------------------------------------------ controllable

function falling(state: ControllableState, piece: Piece, fallAccMs: number): FallingState {
  return { ...baseOf(state), phase: 'falling', piece, fallAccMs };
}

function locking(
  state: ControllableState,
  piece: Piece,
  fallAccMs: number,
  lockAccMs: number,
): LockingState {
  return { ...baseOf(state), phase: 'locking', piece, fallAccMs, lockAccMs };
}

/**
 * Natural gravity, then the lock decision.
 *
 * The lock timer only charges on a tick that begins with the piece already
 * resting, so a piece that grounds *during* this tick gets its full
 * `lockDelayMs` starting from the next one. With `lockDelayMs: 0` that
 * degenerates to locking the moment it grounds.
 */
function tickControllable(state: ControllableState, ms: number): GameState {
  const { fallIntervalMs, lockDelayMs } = state.config;
  const startedGrounded = state.phase === 'locking';
  let piece = state.piece;
  let fallAccMs = state.fallAccMs + ms;

  if (fallIntervalMs > 0) {
    while (fallAccMs >= fallIntervalMs) {
      const moved = moveDown(state.board, piece);
      if (moved === null) break;
      piece = moved;
      fallAccMs -= fallIntervalMs;
    }
  }

  if (!isGrounded(state.board, piece)) return falling(state, piece, fallAccMs);

  const lockAccMs = startedGrounded ? state.lockAccMs + ms : 0;
  if (lockAccMs >= lockDelayMs) return lockAndResolve(state, piece);
  return locking(state, piece, fallAccMs, lockAccMs);
}

/**
 * A player action. Moving or rotating a resting piece does **not** reset the
 * lock timer — it only cancels locking when the piece ends up with room below
 * it again, which is what stops a player stalling forever by spinning in place.
 */
function applyAction(state: ControllableState, input: PlayerAction): GameState {
  const board = state.board;

  switch (input.type) {
    case 'moveLeft':
      return reposition(state, translate(board, state.piece, -1, 0));
    case 'moveRight':
      return reposition(state, translate(board, state.piece, 1, 0));
    case 'rotateCW':
      return reposition(state, rotate(board, state.piece, 'cw'));
    case 'rotateCCW':
      return reposition(state, rotate(board, state.piece, 'ccw'));
    case 'softDrop': {
      // One row down, and the natural-fall accumulator restarts. Resting is a
      // no-op: locking on demand is what hard drop is for.
      return reposition(state, moveDown(board, state.piece), 0);
    }
    case 'hardDrop': {
      let piece = state.piece;
      for (;;) {
        const moved = moveDown(board, piece);
        if (moved === null) break;
        piece = moved;
      }
      return lockAndResolve(state, piece);
    }
  }
}

/** Apply a move that may have been refused (`null` = nothing happens). */
function reposition(
  state: ControllableState,
  moved: Piece | null,
  fallAccMs: number = state.fallAccMs,
): GameState {
  if (moved === null) return state;
  if (isGrounded(state.board, moved)) {
    return locking(state, moved, fallAccMs, state.phase === 'locking' ? state.lockAccMs : 0);
  }
  return falling(state, moved, fallAccMs);
}

// ---------------------------------------------------------------- locking

function lockAndResolve(state: ControllableState, piece: Piece): ResolvingState {
  const placed: Board = lockPiece(state.board, piece);
  const settled = applyGravity(placed);
  const result = resolve(settled, { hiddenRows: state.config.hiddenRows });
  const stats: Stats = { ...state.stats, piecesPlaced: state.stats.piecesPlaced + 1 };

  return {
    ...baseOf(state),
    phase: 'resolving',
    board: settled,
    result,
    stepIndex: 0,
    sinceMs: 0,
    stats,
    lastResolve: result,
  };
}

// -------------------------------------------------------------- resolving

function tickResolving(state: ResolvingState, ms: number): GameState {
  const { chainStepMs } = state.config;
  const steps = state.result.steps;
  let stepIndex = state.stepIndex;
  let sinceMs = state.sinceMs + ms;
  let board = state.board;

  while (stepIndex < steps.length && (chainStepMs <= 0 || sinceMs >= chainStepMs)) {
    board = steps[stepIndex]!.board;
    stepIndex += 1;
    if (chainStepMs > 0) sinceMs -= chainStepMs;
  }

  if (stepIndex < steps.length) return { ...state, board, stepIndex, sinceMs };

  const result = state.result;
  const stats: Stats = {
    ...state.stats,
    chains: state.stats.chains + (result.chainCount > 0 ? 1 : 0),
    longestChain: Math.max(state.stats.longestChain, result.chainCount),
    totalCleared: state.stats.totalCleared + result.totalCleared,
    // Banked only now, when the last step has been shown. Adding it when the
    // chain started would put the score ahead of the pops the player is
    // watching, which is the thing the staged animation exists to avoid.
    score: state.stats.score + totalScore(result),
  };
  const spawning: SpawningState = {
    ...baseOf(state),
    phase: 'spawning',
    board: result.board,
    stats,
    sinceMs: 0,
  };
  return spawning;
}
