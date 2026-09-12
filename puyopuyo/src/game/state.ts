/**
 * Game state: the phases, the inputs, and how a game starts.
 *
 * The state is a **discriminated union over `phase`**, not a bag of optional
 * fields. A `ResolvingState` has no `piece`, so nothing can move a piece
 * during a chain; a `FallingState` has no `result`, so nothing can advance a
 * chain while the player is in control. The reducer narrows on `phase` once
 * and hands the narrowed state to a handler typed to accept only that phase —
 * an illegal input in a phase is not ignored at runtime, it does not typecheck.
 *
 * Time is an input. Nothing in this directory reads `Date.now`,
 * `performance.now`, `setTimeout` or `requestAnimationFrame`.
 */

import {
  HEIGHT,
  HIDDEN_ROWS,
  WIDTH,
  createBoard,
  type Board,
  type Color,
  type ResolveResult,
} from '../core/index.js';
import type { Piece } from './piece.js';
import { createQueue, type PieceQueue } from './queue.js';

/** Tunables. Durations are milliseconds of *input* time, never wall clock. */
export interface GameConfig {
  readonly width: number;
  readonly height: number;
  /** Rows at the top that never pop and never form groups. */
  readonly hiddenRows: number;
  /** The column a pair spawns in — the one that decides game over. */
  readonly spawnX: number;
  /** Row of the axis at spawn; the child spawns directly above it. */
  readonly spawnY: number;
  /** Milliseconds per row of natural falling. */
  readonly fallIntervalMs: number;
  /** Grace period between the piece grounding and it locking. 0 = instant. */
  readonly lockDelayMs: number;
  /** Milliseconds each chain step is held before the next one pops. */
  readonly chainStepMs: number;
  /** Pause between a chain finishing and the next pair appearing. */
  readonly spawnDelayMs: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  width: WIDTH,
  height: HEIGHT,
  hiddenRows: HIDDEN_ROWS,
  // Third column, as in the real game. With HIDDEN_ROWS = 1 the axis spawns on
  // the first visible row and the child sits in the hidden row above it.
  spawnX: 2,
  spawnY: HIDDEN_ROWS,
  fallIntervalMs: 800,
  lockDelayMs: 500,
  chainStepMs: 300,
  spawnDelayMs: 0,
};

/** Running totals a UI or a scorer can read off the state. */
export interface Stats {
  readonly piecesPlaced: number;
  /** Number of locks that popped at least one group. */
  readonly chains: number;
  readonly longestChain: number;
  readonly totalCleared: number;
}

export const EMPTY_STATS: Stats = {
  piecesPlaced: 0,
  chains: 0,
  longestChain: 0,
  totalCleared: 0,
};

/** The fields every phase carries. `baseOf` in `step.ts` copies exactly these. */
export interface GameCommon {
  readonly config: GameConfig;
  readonly board: Board;
  readonly queue: PieceQueue;
  /** Sum of every tick fed in so far. Derived from inputs, not from a clock. */
  readonly elapsedMs: number;
  readonly stats: Stats;
  /** The result of the most recent lock, for scoring and rendering. */
  readonly lastResolve: ResolveResult | null;
}

/** Waiting to put the next pair on the board. */
export interface SpawningState extends GameCommon {
  readonly phase: 'spawning';
  /** Milliseconds waited so far, against `config.spawnDelayMs`. */
  readonly sinceMs: number;
}

/** The player is in control and the pair still has room below it. */
export interface FallingState extends GameCommon {
  readonly phase: 'falling';
  readonly piece: Piece;
  /** Milliseconds accumulated toward the next row of natural falling. */
  readonly fallAccMs: number;
}

/** The pair is resting; the player still has `lockDelayMs` to act. */
export interface LockingState extends GameCommon {
  readonly phase: 'locking';
  readonly piece: Piece;
  readonly fallAccMs: number;
  /** Milliseconds accumulated toward locking. */
  readonly lockAccMs: number;
}

/** A chain is playing out, one step at a time. No piece exists. */
export interface ResolvingState extends GameCommon {
  readonly phase: 'resolving';
  readonly result: ResolveResult;
  /** How many of `result.steps` have been shown. `board` matches. */
  readonly stepIndex: number;
  readonly sinceMs: number;
}

export type GameOverReason = 'spawn-blocked';

/** Terminal. Every input is a no-op from here. */
export interface GameOverState extends GameCommon {
  readonly phase: 'gameover';
  readonly reason: GameOverReason;
  /** The pair that could not be placed, for a "you died here" overlay. */
  readonly blockedPiece: Piece;
}

/** The phases in which player actions mean anything. */
export type ControllableState = FallingState | LockingState;

export type GameState =
  | SpawningState
  | FallingState
  | LockingState
  | ResolvingState
  | GameOverState;

/** A slice of elapsed time. The only way the world advances on its own. */
export interface TickInput {
  readonly type: 'tick';
  /** Milliseconds since the last tick. Must be finite and >= 0. */
  readonly ms: number;
}

export type PlayerActionType =
  | 'moveLeft'
  | 'moveRight'
  | 'rotateCW'
  | 'rotateCCW'
  | 'softDrop'
  | 'hardDrop';

export interface PlayerAction {
  readonly type: PlayerActionType;
}

export type Input = TickInput | PlayerAction;

/** `{ type: 'tick', ms }`. */
export function tick(ms: number): TickInput {
  return { type: 'tick', ms };
}

/** `{ type }` for a player action, so tests read as `step(s, action('hardDrop'))`. */
export function action(type: PlayerActionType): PlayerAction {
  return { type };
}

export const MOVE_LEFT: PlayerAction = { type: 'moveLeft' };
export const MOVE_RIGHT: PlayerAction = { type: 'moveRight' };
export const ROTATE_CW: PlayerAction = { type: 'rotateCW' };
export const ROTATE_CCW: PlayerAction = { type: 'rotateCCW' };
export const SOFT_DROP: PlayerAction = { type: 'softDrop' };
export const HARD_DROP: PlayerAction = { type: 'hardDrop' };

export interface NewGameOptions {
  /** Injected randomness for the queue. Required — there is no default. */
  readonly rng: () => number;
  readonly config?: Partial<GameConfig>;
  readonly colors?: readonly Color[];
  readonly previewSize?: number;
  /** Start from an existing board, e.g. a test fixture. Defaults to empty. */
  readonly board?: Board;
}

/**
 * A new game, in the `spawning` phase: the first pair appears on the first
 * tick, because nothing in this module happens without an input.
 */
export function createGame(options: NewGameOptions): SpawningState {
  const config: GameConfig = { ...DEFAULT_CONFIG, ...options.config };
  const board = options.board ?? createBoard(config.width, config.height);
  const queue = createQueue(options.rng, {
    ...(options.colors === undefined ? {} : { colors: options.colors }),
    ...(options.previewSize === undefined ? {} : { previewSize: options.previewSize }),
  });
  return {
    phase: 'spawning',
    config,
    board,
    queue,
    elapsedMs: 0,
    stats: EMPTY_STATS,
    lastResolve: null,
    sinceMs: 0,
  };
}

/** The piece the player controls, if there is one right now. */
export function activePiece(state: GameState): Piece | null {
  return state.phase === 'falling' || state.phase === 'locking' ? state.piece : null;
}

/** Is the game over? */
export function isGameOver(state: GameState): state is GameOverState {
  return state.phase === 'gameover';
}
