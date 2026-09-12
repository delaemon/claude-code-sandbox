/**
 * Chain scoring: a pure function over a `ResolveResult`.
 *
 * Formula (see ./tables.ts for where the tables come from):
 *
 *   stepScore = cleared * 10 * clamp(chainPower + colorBonus + groupBonus, 1, 999)
 *   total     = sum of the step scores
 *
 * Every bonus component is returned alongside the number, because a score you
 * cannot explain is a score nobody can debug: a UI can render "4 chain,
 * 2 colours, x35" straight off a `StepScore`.
 *
 * Pure: imports from `src/core/` and nothing else. No DOM, no timers, no
 * randomness, no game state.
 */

import { POP_THRESHOLD } from '../core/groups.js';
import type { ChainStep, ResolveResult } from '../core/resolve.js';
import {
  POINTS_PER_CELL,
  chainPower,
  clampClearBonus,
  colorBonus,
  groupBonus,
} from './tables.js';

export interface ScoreOptions {
  /**
   * The pop threshold the chain was resolved with. Only affects the group
   * bonus, and only when it is below 4. Defaults to `POP_THRESHOLD`.
   */
  readonly threshold?: number;
}

/** The score of one chain step, with the components that produced it. */
export interface StepScore {
  /** 1-based position in the chain, copied from the `ChainStep`. */
  readonly chain: number;
  /** Cells cleared in this step. */
  readonly cleared: number;
  /** Distinct colours that popped in this step. */
  readonly colorCount: number;
  /** Size of each group that popped, in the order `resolve` reported them. */
  readonly groupSizes: readonly number[];
  /** Bonus from the chain number. */
  readonly chainPower: number;
  /** Bonus from clearing several colours at once. */
  readonly colorBonus: number;
  /** Bonus from oversized groups, summed over the groups in this step. */
  readonly groupBonus: number;
  /** `chainPower + colorBonus + groupBonus`, before the 1..999 clamp. */
  readonly rawBonus: number;
  /** The multiplier actually applied: `rawBonus` clamped to 1..999. */
  readonly clearBonus: number;
  /** `cleared * 10 * clearBonus`. */
  readonly score: number;
}

/** The score of a whole `ResolveResult`. */
export interface ChainScore {
  /** Sum of every step's score. 0 when nothing popped. */
  readonly total: number;
  /** One entry per chain step, in order. */
  readonly steps: readonly StepScore[];
  /** Number of steps, mirrored from the `ResolveResult`. */
  readonly chainCount: number;
  /** Cells cleared across the whole chain. */
  readonly totalCleared: number;
}

/** Score a single chain step. */
export function scoreStep(step: ChainStep, options: ScoreOptions = {}): StepScore {
  const threshold = options.threshold ?? POP_THRESHOLD;

  const groupSizes = step.groups.map((group) => group.cells.length);
  const power = chainPower(step.chain);
  const colors = colorBonus(step.colors.length);
  const groups = groupSizes.reduce((sum, size) => sum + groupBonus(size, threshold), 0);

  const rawBonus = power + colors + groups;
  const clearBonus = clampClearBonus(rawBonus);

  return {
    chain: step.chain,
    cleared: step.cleared,
    colorCount: step.colors.length,
    groupSizes,
    chainPower: power,
    colorBonus: colors,
    groupBonus: groups,
    rawBonus,
    clearBonus,
    score: step.cleared * POINTS_PER_CELL * clearBonus,
  };
}

/** Score every step of a resolved chain, with the per-step breakdown. */
export function scoreChain(result: ResolveResult, options: ScoreOptions = {}): ChainScore {
  const steps = result.steps.map((step) => scoreStep(step, options));
  return {
    total: steps.reduce((sum, step) => sum + step.score, 0),
    steps,
    chainCount: result.chainCount,
    totalCleared: result.totalCleared,
  };
}

/** Just the number, for callers that only want to add it to a running total. */
export function totalScore(result: ResolveResult, options: ScoreOptions = {}): number {
  return scoreChain(result, options).total;
}
