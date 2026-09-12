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
   * The running total, including however much of a chain currently on screen
   * has actually popped.
   *
   * `stats.score` banks a chain only once its last step has been shown, so
   * during `resolving` this adds the shown steps on top. The number therefore
   * climbs with the pops instead of jumping to the total before the player sees
   * why, and never counts the same chain twice.
   */
  readonly score: number;
  /** Score of the chain being shown, on its own. */
  readonly chainScore: number;
  /** Chain steps shown so far (`chainCount` once the chain has finished). */
  readonly chain: number;
  readonly pieces: number;
  readonly cleared: number;
  readonly best: number;
  readonly gameOver: boolean;
}

/** The HUD numbers for a state. */
export function hudModel(state: GameState): HudModel {
  const result = state.lastResolve;
  const resolving = state.phase === 'resolving';
  const shownSteps = resolving ? state.stepIndex : (result?.steps.length ?? 0);

  let chainScore = 0;
  let chain = 0;
  if (result !== null) {
    const shown = scoreChain(result).steps.slice(0, shownSteps);
    chainScore = shown.reduce((sum, step) => sum + step.score, 0);
    chain = shown.length;
  }

  return {
    // Only while resolving is the chain still unbanked; afterwards
    // `stats.score` already contains it and adding it again would double count.
    score: state.stats.score + (resolving ? chainScore : 0),
    chainScore,
    chain,
    pieces: state.stats.piecesPlaced,
    cleared: state.stats.totalCleared,
    best: state.stats.longestChain,
    gameOver: state.phase === 'gameover',
  };
}
