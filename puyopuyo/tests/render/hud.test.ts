import { describe, expect, it } from 'vitest';
import {
  HEIGHT,
  HIDDEN_ROWS,
  WIDTH,
  parseBoardBottom,
  resolve,
  type ResolveResult,
} from '../../src/core/index.js';
import {
  HARD_DROP,
  MOVE_LEFT,
  createGame,
  step,
  stepAll,
  tick,
  type GameState,
  type ResolvingState,
} from '../../src/game/index.js';
import { scoreChain } from '../../src/score/index.js';
import { hudModel } from '../../src/render/index.js';

const allRed = () => 0;
const CONFIG = { fallIntervalMs: 10_000, lockDelayMs: 0, chainStepMs: 300, spawnDelayMs: 0 };

const started = (text?: string): GameState =>
  step(
    createGame({
      rng: allRed,
      config: CONFIG,
      ...(text === undefined ? {} : { board: parseBoardBottom(text, WIDTH, HEIGHT) }),
    }),
    tick(0),
  );

/** A real resolving state — a red pair dropped onto three reds, so it pops. */
function resolvingState(): ResolvingState {
  const state = stepAll(started('R.....\nR.....\nR.....'), [MOVE_LEFT, MOVE_LEFT, HARD_DROP]);
  if (state.phase !== 'resolving') throw new Error(`expected resolving, got ${state.phase}`);
  return state;
}

/**
 * A two-step chain: four greens pop, the blues above them fall and make four.
 * Built with `resolve` directly so the fixture is honest about being a fixture.
 */
const twoChain: ResolveResult = resolve(
  parseBoardBottom(
    `
    ..B...
    ..B...
    .BG...
    BGGG..
    `,
    WIDTH,
    HEIGHT,
  ),
  { hiddenRows: HIDDEN_ROWS },
);

describe('hudModel', () => {
  it('reports zeroes for a fresh game', () => {
    expect(hudModel(started())).toEqual({
      score: 0,
      chain: 0,
      pieces: 0,
      cleared: 0,
      best: 0,
      gameOver: false,
    });
  });

  it('counts only the chain steps that have been shown', () => {
    expect(twoChain.chainCount).toBe(2); // the fixture is what it claims to be
    const scored = scoreChain(twoChain);
    const base = resolvingState();
    const at = (stepIndex: number): GameState => ({
      ...base,
      result: twoChain,
      lastResolve: twoChain,
      stepIndex,
    });

    expect(hudModel(at(0))).toMatchObject({ score: 0, chain: 0 });
    expect(hudModel(at(1))).toMatchObject({ score: scored.steps[0]!.score, chain: 1 });
    expect(hudModel(at(2))).toMatchObject({ score: scored.total, chain: 2 });
    expect(scored.steps[0]!.score).toBeLessThan(scored.total);
  });

  it('keeps showing the finished chain once the piece has been placed', () => {
    const resolved = resolvingState();
    const settled = stepAll(resolved, [tick(CONFIG.chainStepMs), tick(CONFIG.chainStepMs)]);
    expect(settled.phase).not.toBe('resolving');
    const model = hudModel(settled);
    expect(model.score).toBe(scoreChain(settled.lastResolve!).total);
    expect(model.pieces).toBe(1);
    expect(model.cleared).toBe(5);
    expect(model.best).toBe(1);
  });

  it('flags game over', () => {
    const full = Array.from({ length: HEIGHT }, () =>
      Array.from({ length: WIDTH }, () => 'red' as const),
    );
    const over = step(createGame({ rng: allRed, config: CONFIG, board: full }), tick(0));
    expect(hudModel(over).gameOver).toBe(true);
  });
});
