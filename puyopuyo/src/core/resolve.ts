/**
 * Chain resolution: pop, settle, repeat until the board is stable.
 *
 * Pure: given the same board in, the same result comes out. Nothing here
 * touches the DOM, timers or randomness — an animating renderer can replay
 * `steps` at whatever speed it likes.
 */

import { cloneMutable, type Board, type Color } from './board.js';
import { applyGravity } from './gravity.js';
import { findPoppableGroups, POP_THRESHOLD, type Group } from './groups.js';

/** One pop of a chain: everything that popped simultaneously. */
export interface ChainStep {
  /** 1-based position in the chain. */
  readonly chain: number;
  /** The groups that popped in this step. */
  readonly groups: readonly Group[];
  /** Total cells cleared in this step. */
  readonly cleared: number;
  /** Distinct colours that popped in this step, in first-seen order. */
  readonly colors: readonly Color[];
  /** The board after this step's pops and the gravity that followed. */
  readonly board: Board;
}

export interface ResolveResult {
  /** The stable board: nothing floating, no group of 4+ left. */
  readonly board: Board;
  /** Number of pop steps. 0 when nothing popped. */
  readonly chainCount: number;
  /** What popped at each step, in order. */
  readonly steps: readonly ChainStep[];
  /** Total cells cleared across the whole chain. */
  readonly totalCleared: number;
}

export interface ResolveOptions {
  /**
   * How many rows at the top of the board are excluded from popping *and*
   * from group formation. Cells there still fall and still block.
   *
   * Default 0, so the rule tests can use any board they like; the game layer
   * passes `HIDDEN_ROWS`, which makes the decision visible at the call site
   * (see docs/worklog/CONTRACT.md, "Round 2").
   */
  readonly hiddenRows?: number;
  /** Minimum group size that pops. Default `POP_THRESHOLD` (4). */
  readonly threshold?: number;
}

/** Remove every cell listed in `groups`, then let the rest fall. */
export function popGroups(board: Board, groups: readonly Group[]): Board {
  const next = cloneMutable(board);
  for (const group of groups) {
    for (const { x, y } of group.cells) next[y]![x] = null;
  }
  return applyGravity(next);
}

/**
 * A view of `board` with the top `hiddenRows` rows blanked out. Used only to
 * *find* groups: popping still happens on the real board, so a hidden cell
 * neither pops nor glues two visible cells of its colour together.
 */
function withoutHiddenRows(board: Board, hiddenRows: number): Board {
  if (hiddenRows <= 0) return board;
  return board.map((row, y) => (y < hiddenRows ? row.map(() => null) : row));
}

/**
 * Settle the board, then repeatedly pop groups of `threshold`+ and settle
 * again, until nothing more pops.
 *
 * Gravity is applied *before* the first pop check, so a board written as a
 * string literal with floating cells behaves like one that was played into
 * that shape. That means `result.board` can differ from the input even when
 * `chainCount` is 0.
 *
 * With `hiddenRows > 0` the top rows are inert: cells there fall and block
 * like any other, but they never pop and never join a group.
 */
export function resolve(board: Board, options: ResolveOptions = {}): ResolveResult {
  const threshold = options.threshold ?? POP_THRESHOLD;
  const hiddenRows = options.hiddenRows ?? 0;
  if (!Number.isInteger(hiddenRows) || hiddenRows < 0) {
    throw new RangeError(`bad hiddenRows: ${hiddenRows}`);
  }

  let current = applyGravity(board);
  const steps: ChainStep[] = [];
  let totalCleared = 0;

  for (;;) {
    const groups = findPoppableGroups(withoutHiddenRows(current, hiddenRows), threshold);
    if (groups.length === 0) break;

    current = popGroups(current, groups);

    const cleared = groups.reduce((sum, g) => sum + g.cells.length, 0);
    totalCleared += cleared;
    steps.push({
      chain: steps.length + 1,
      groups,
      cleared,
      colors: [...new Set(groups.map((g) => g.color))],
      board: current,
    });
  }

  return { board: current, chainCount: steps.length, steps, totalCleared };
}
