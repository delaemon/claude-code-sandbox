import { describe, expect, it } from 'vitest';
import { formatBoard, parseBoard, resolve } from '../src/core/index.js';

const run = (text: string) => resolve(parseBoard(text));

/** Normalise expected board text the same way `formatBoard` emits it. */
const norm = (text: string) => formatBoard(parseBoard(text));

describe('resolve', () => {
  it('leaves a board with no group of 4 alone', () => {
    const text = `
      RGRG
      GRGR
      RGRG
    `;
    const result = run(text);
    expect(result.chainCount).toBe(0);
    expect(result.steps).toEqual([]);
    expect(result.totalCleared).toBe(0);
    expect(formatBoard(result.board)).toBe(norm(text));
  });

  it('does not pop a group of exactly 3', () => {
    const text = `
      R...
      R...
      RGGG
    `;
    const result = run(text);
    expect(result.chainCount).toBe(0);
    expect(formatBoard(result.board)).toBe(norm(text));
  });

  it('pops a single group: chain of 1', () => {
    const result = run(`
      ....
      ....
      RRRR
    `);
    expect(result.chainCount).toBe(1);
    expect(result.totalCleared).toBe(4);
    expect(result.steps[0]!.groups).toHaveLength(1);
    expect(result.steps[0]!.groups[0]!.color).toBe('red');
    expect(result.steps[0]!.colors).toEqual(['red']);
    expect(formatBoard(result.board)).toBe(norm('....\n....\n....'));
  });

  it('pops two groups in the same step without counting it as a chain', () => {
    const result = run(`
      RRRRGG
      ....GG
    `);
    expect(result.chainCount).toBe(1);
    expect(result.steps[0]!.groups).toHaveLength(2);
    expect(result.steps[0]!.cleared).toBe(8);
    expect([...result.steps[0]!.colors].sort()).toEqual(['green', 'red']);
  });

  it('settles floating cells before checking for pops', () => {
    // Before gravity the reds form groups of 3 and 2; they only become one
    // group of 5 after falling.
    const result = run(`
      R.RR
      RR..
      ....
    `);
    expect(result.chainCount).toBe(1);
    expect(formatBoard(result.board)).toBe(norm('....\n....\n....'));
  });

  it('resolves a 2-chain', () => {
    // Reds pop first; the three greens above then fall onto the fourth green
    // that was sitting under the red block.
    const result = run(`
      G.....
      G.....
      G.....
      R.....
      RRR...
      GYY...
    `);

    expect(result.chainCount).toBe(2);
    expect(result.totalCleared).toBe(8);
    expect(result.steps.map((s) => s.colors)).toEqual([['red'], ['green']]);
    expect(result.steps.map((s) => s.cleared)).toEqual([4, 4]);
    expect(formatBoard(result.board)).toBe(
      norm(`
        ......
        ......
        ......
        ......
        ......
        .YY...
      `),
    );
  });

  it('resolves a 3-chain', () => {
    // red -> green -> blue, each pop letting the stack above fall onto its
    // fourth same-coloured puyo.
    const result = run(`
      B.....
      B.....
      B.....
      G.....
      G.....
      G.....
      R.....
      RRR...
      GBY...
    `);

    expect(result.chainCount).toBe(3);
    expect(result.totalCleared).toBe(12);
    expect(result.steps.map((s) => s.colors)).toEqual([['red'], ['green'], ['blue']]);
    expect(result.steps.map((s) => s.cleared)).toEqual([4, 4, 4]);
    expect(result.steps.map((s) => s.chain)).toEqual([1, 2, 3]);
    expect(formatBoard(result.board)).toBe(
      norm(`
        ......
        ......
        ......
        ......
        ......
        ......
        ......
        ......
        ..Y...
      `),
    );
  });

  it('records the board after each step', () => {
    const result = run(`
      G.....
      G.....
      G.....
      R.....
      RRR...
      GYY...
    `);
    expect(formatBoard(result.steps[0]!.board)).toBe(
      norm(`
        ......
        ......
        G.....
        G.....
        G.....
        GYY...
      `),
    );
    expect(formatBoard(result.steps.at(-1)!.board)).toBe(formatBoard(result.board));
  });

  it('does not mutate the input board', () => {
    const text = '....\n....\nRRRR';
    const board = parseBoard(text);
    resolve(board);
    expect(formatBoard(board)).toBe(text);
  });
});
