/**
 * Puyo Puyo scoring lookup tables — the "Classic" set (Puyo Puyo Tsu and the
 * compile-era games), which is the set the Puyo Nexus chain simulator applies
 * by default.
 *
 * Sources (both read in full, not reconstructed from memory):
 *  - puyonexus/puyosim, `resources/scripts/simulator.js` — the chain simulator
 *    that Puyo Nexus's own wiki links to. It carries both the Classic and the
 *    Fever variants of every table:
 *      colorBonus:  [[0, 3, 6, 12, 24], [0, 2, 4, 8, 16]]
 *      groupBonus:  [[0, 2, 3, 4, 5, 6, 7, 10], [0, 1, 2, 3, 4, 5, 6, 8]]
 *      chainPowers: [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288,
 *                    320, 352, 384, 416, 448, 480, 512, 544, 576, 608, 640, 672]
 *      clearBonus = clamp(chainPower + colorBonus + groupBonus, 1, 999)
 *      score      = (puyoCleared * 10) * clearBonus
 *  - TehRealSalt/sugoi, `wadsrc/lua/kimokawaiii/puyo/Lua_Puyo.lua` — an
 *    independent implementation whose tables are annotated row by row
 *    ("// 11+", "// 6 colors cleared"), which is what pins down what each
 *    index *means*.
 *
 * The two disagree in exactly one cell: chain power for a 6-chain is 96 in
 * puyosim and 92 in the Lua table. 96 is used here — puyosim is the reference
 * simulator, 96 continues the doubling/step pattern of the surrounding entries,
 * and 92 looks like a transcription slip. See docs/worklog/score.md.
 *
 * Pure data and pure functions: no DOM, no timers, no randomness.
 */

import { POP_THRESHOLD } from '../core/groups.js';

/** Chain power by chain number: `CHAIN_POWER[n - 1]` is the power of an n-chain. */
export const CHAIN_POWER: readonly number[] = [
  0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288,
  320, 352, 384, 416, 448, 480, 512, 544, 576, 608, 640, 672,
];

/**
 * Colour bonus by how many distinct colours popped in one step:
 * `COLOR_BONUS[colors - 1]`.
 *
 * puyosim's Classic table stops at 5 colours; the 6-colour entry (48) comes
 * from the Lua table. This board only has 5 colours, so the last entry is
 * unreachable here — it is present so the table is not silently truncated.
 */
export const COLOR_BONUS: readonly number[] = [0, 3, 6, 12, 24, 48];

/**
 * Group bonus by group size: `GROUP_BONUS[size - 4]`, with the last entry
 * covering 11 or more. Applied per group and summed over the groups that
 * popped in the step.
 */
export const GROUP_BONUS: readonly number[] = [0, 2, 3, 4, 5, 6, 7, 10];

/** The multiplier is clamped to this range before it is applied. */
export const MIN_CLEAR_BONUS = 1;
export const MAX_CLEAR_BONUS = 999;

/** Points per cell cleared, before the bonus multiplier. */
export const POINTS_PER_CELL = 10;

/**
 * Chain power for a 1-based chain number.
 *
 * Chains past the end of the table hold the last value. puyosim continues with
 * `previous + chainPowerInc`, and its default increment is 0; the Lua table
 * keeps adding 32. The disagreement is unreachable on a 6x13 board (the
 * longest possible chain is ~19) and the 999 clamp would swallow most of it
 * anyway, so the flatter of the two is used.
 */
export function chainPower(chain: number): number {
  if (!Number.isFinite(chain) || chain < 1) return 0;
  const index = Math.min(Math.trunc(chain), CHAIN_POWER.length) - 1;
  return CHAIN_POWER[index] ?? 0;
}

/** Colour bonus for a count of distinct colours popped in one step. */
export function colorBonus(colorCount: number): number {
  if (!Number.isFinite(colorCount) || colorCount < 1) return 0;
  const index = Math.min(Math.trunc(colorCount), COLOR_BONUS.length) - 1;
  return COLOR_BONUS[index] ?? 0;
}

/**
 * Group bonus for a single group of `size` cells.
 *
 * `threshold` is the pop threshold the chain was resolved with (`resolve`
 * takes one). puyosim indexes the table at `size - min(4, puyoToClear)`, so a
 * minimum-size group always scores 0 however low the threshold is set; that
 * rule is reproduced here rather than assuming a threshold of 4.
 */
export function groupBonus(size: number, threshold: number = POP_THRESHOLD): number {
  const offset = Math.min(POP_THRESHOLD, threshold);
  const index = Math.trunc(size) - offset;
  if (!Number.isFinite(index) || index < 0) return 0;
  return GROUP_BONUS[Math.min(index, GROUP_BONUS.length - 1)] ?? 0;
}

/**
 * The multiplier actually applied to a step: the summed bonuses, clamped.
 * The lower bound is what makes a first single-colour 4-pop score 40 instead
 * of 0.
 */
export function clampClearBonus(rawBonus: number): number {
  return Math.min(Math.max(rawBonus, MIN_CLEAR_BONUS), MAX_CLEAR_BONUS);
}
