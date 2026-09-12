/**
 * What the HUD says, as data.
 *
 * Split out of `draw` so the numbers can be tested without a canvas at all,
 * and so the one piece of real logic in the renderer — how much of a chain's
 * score has been earned *so far* — is not buried in a `fillText` call.
 *
 * Pure: a function of `GameState` only. No clock, no accumulation.
 */

import type { GameState } from '../game/index.js';
import { scoreChain } from '../score/index.js';

export interface HudModel {
  /**
   * Score of the chain being shown. During `resolving` only the steps that have
   * actually popped on screen are counted, so the number climbs with the chain
   * instead of jumping to the total before the player sees why.
   */
  readonly score: number;
  /** Chain steps shown so far (`chainCount` once the chain has finished). */
  readonly chain: number;
  readonly pieces: number;
  readonly cleared: number;
  readonly best: number;
  readonly gameOver: boolean;
}

/**
 * The HUD numbers for a state.
 *
 * Note what is *not* here: a running total across the whole game. `GameState`
 * carries only `lastResolve`, so a cumulative score cannot be derived from it —
 * see docs/worklog/render.md. This reports the last chain, which is what the
 * state can actually answer.
 */
export function hudModel(state: GameState): HudModel {
  const result = state.lastResolve;
  const shownSteps =
    state.phase === 'resolving' ? state.stepIndex : (result?.steps.length ?? 0);

  let score = 0;
  let chain = 0;
  if (result !== null) {
    const scored = scoreChain(result);
    const shown = scored.steps.slice(0, shownSteps);
    score = shown.reduce((sum, step) => sum + step.score, 0);
    chain = shown.length;
  }

  return {
    score,
    chain,
    pieces: state.stats.piecesPlaced,
    cleared: state.stats.totalCleared,
    best: state.stats.longestChain,
    gameOver: state.phase === 'gameover',
  };
}
