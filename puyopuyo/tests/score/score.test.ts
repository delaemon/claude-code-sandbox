import { describe, expect, it } from 'vitest';
import { parseBoard, resolve } from '../../src/core/index.js';
import { scoreChain, scoreStep, totalScore } from '../../src/score/index.js';

/**
 * Inputs are built by running the real `resolve` on boards written in
 * `core/text.ts`'s string format, never by hand-writing a `ResolveResult`.
 * If the core's shape changes, these break instead of quietly passing.
 */
const run = (text: string) => resolve(parseBoard(text));

describe('scoreChain', () => {
  it('scores a single 4-group pop as 40', () => {
    const result = run(`
      ....
      ....
      RRRR
    `);
    const score = scoreChain(result);

    expect(result.chainCount).toBe(1);
    expect(score.total).toBe(40);
    expect(score.steps).toHaveLength(1);
    expect(score.steps[0]!.cleared).toBe(4);
    expect(score.steps[0]!.score).toBe(40);
  });

  it('applies the max(1, ...) floor on a first single-colour 4-pop', () => {
    // 1-chain => chain power 0, one colour => colour bonus 0, group of exactly
    // 4 => group bonus 0. The raw bonus is 0; without the floor the step would
    // score nothing at all.
    const step = scoreChain(run(`
      ....
      ....
      RRRR
    `)).steps[0]!;

    expect(step.chainPower).toBe(0);
    expect(step.colorBonus).toBe(0);
    expect(step.groupBonus).toBe(0);
    expect(step.rawBonus).toBe(0);
    expect(step.clearBonus).toBe(1);
    expect(step.score).toBe(4 * 10 * 1);
  });

  it('adds the colour bonus for two colours popping in one step', () => {
    const result = run(`
      RRRRGG
      ....GG
    `);
    const score = scoreChain(result);
    const step = score.steps[0]!;

    expect(result.chainCount).toBe(1);
    expect(step.colorCount).toBe(2);
    expect(step.chainPower).toBe(0);
    expect(step.colorBonus).toBe(3);
    expect(step.groupBonus).toBe(0);
    expect(step.cleared).toBe(8);
    // 8 cells x 10 x (0 + 3 + 0)
    expect(step.score).toBe(240);
    expect(score.total).toBe(240);
  });

  it('adds the colour bonus for three colours popping in one step', () => {
    const step = scoreChain(run('RRRRGGGGBBBB')).steps[0]!;

    expect(step.colorCount).toBe(3);
    expect(step.colorBonus).toBe(6);
    expect(step.groupSizes).toEqual([4, 4, 4]);
    expect(step.groupBonus).toBe(0);
    expect(step.score).toBe(12 * 10 * 6);
  });

  it('adds the group bonus for an oversized group', () => {
    const step = scoreChain(run(`
      .....
      RRRRR
    `)).steps[0]!;

    expect(step.groupSizes).toEqual([5]);
    expect(step.colorBonus).toBe(0);
    expect(step.groupBonus).toBe(2);
    // 5 cells x 10 x (0 + 0 + 2)
    expect(step.score).toBe(100);
  });

  it('caps the group bonus at the 11-or-more entry', () => {
    const step = scoreChain(run(`
      RRRRRR
      RRRRRR
    `)).steps[0]!;

    expect(step.groupSizes).toEqual([12]);
    expect(step.groupBonus).toBe(10);
    expect(step.clearBonus).toBe(10);
    expect(step.score).toBe(12 * 10 * 10);
  });

  it('sums group bonuses over several groups in the same step', () => {
    // A group of 5 reds and a group of 6 greens pop together:
    // group bonus 2 + 3, colour bonus 3 for two colours.
    const step = scoreChain(run('RRRRR.GGGGGG')).steps[0]!;

    expect([...step.groupSizes].sort((a, b) => a - b)).toEqual([5, 6]);
    expect(step.colorCount).toBe(2);
    expect(step.colorBonus).toBe(3);
    expect(step.groupBonus).toBe(2 + 3);
    expect(step.rawBonus).toBe(0 + 3 + 5);
    expect(step.score).toBe(11 * 10 * 8);
  });

  it('totals a two-step chain, with chain power on the second step only', () => {
    // The reds pop first; the stray green falls into the green column and
    // makes a group of four, which pops as the second link.
    const result = run(`
      ......
      ......
      .G....
      GR....
      GR....
      GRR...
    `);
    const score = scoreChain(result);

    expect(result.chainCount).toBe(2);
    expect(score.steps).toHaveLength(2);

    expect(score.steps[0]!.chain).toBe(1);
    expect(score.steps[0]!.chainPower).toBe(0);
    expect(score.steps[0]!.clearBonus).toBe(1);
    expect(score.steps[0]!.score).toBe(40);

    expect(score.steps[1]!.chain).toBe(2);
    expect(score.steps[1]!.chainPower).toBe(8);
    expect(score.steps[1]!.colorBonus).toBe(0);
    expect(score.steps[1]!.groupBonus).toBe(0);
    expect(score.steps[1]!.score).toBe(4 * 10 * 8);

    expect(score.total).toBe(40 + 320);
    expect(score.total).toBe(score.steps.reduce((sum, s) => sum + s.score, 0));
    expect(score.totalCleared).toBe(8);
    expect(score.chainCount).toBe(2);
  });

  it('scores a board that does not pop as 0', () => {
    const result = run(`
      RGRG
      GRGR
      RGRG
    `);
    const score = scoreChain(result);

    expect(score.steps).toEqual([]);
    expect(score.total).toBe(0);
    expect(totalScore(result)).toBe(0);
  });

  it('totalScore agrees with the breakdown', () => {
    const result = run(`
      ......
      ......
      .G....
      GR....
      GR....
      GRR...
    `);

    expect(totalScore(result)).toBe(scoreChain(result).total);
  });

  it('scoreStep scores a step on its own, out of the result', () => {
    const result = run(`
      ......
      ......
      .G....
      GR....
      GR....
      GRR...
    `);

    expect(scoreStep(result.steps[1]!)).toEqual(scoreChain(result).steps[1]!);
  });
});
