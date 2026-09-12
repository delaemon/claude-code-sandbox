import { describe, expect, it } from 'vitest';
import { formatBoard, parseBoard, resolve } from '../../src/core/index.js';

/** Normalise expected board text the same way `formatBoard` emits it. */
const norm = (text: string) => formatBoard(parseBoard(text));
const run = (text: string, hiddenRows?: number) =>
  resolve(parseBoard(text), hiddenRows === undefined ? {} : { hiddenRows });

describe('resolve({ hiddenRows })', () => {
  const column = `
    R
    R
    R
    R
  `;

  it('defaults to 0: the top row pops like any other', () => {
    const result = run(column);
    expect(result.chainCount).toBe(1);
    expect(result.totalCleared).toBe(4);
  });

  it('excludes the hidden rows from popping', () => {
    const result = run(column, 1);
    expect(result.chainCount).toBe(0);
    expect(formatBoard(result.board)).toBe(norm(column));
  });

  it('excludes the hidden rows from group formation', () => {
    // Columns 0 and 2 hold two visible reds each; only the red bridge across
    // the hidden top row could join them into a group of 4+.
    const bridged = `
      RRR
      RGR
      RGR
    `;
    expect(run(bridged).chainCount).toBe(1);
    expect(run(bridged).totalCleared).toBe(7);

    const hidden = run(bridged, 1);
    expect(hidden.chainCount).toBe(0);
    expect(formatBoard(hidden.board)).toBe(norm(bridged));
  });

  it('still lets a hidden cell fall and block', () => {
    // Five reds in one column: the bottom four are visible and pop; the fifth
    // was in the hidden row, so it did not join them — and then it falls.
    // `hiddenRows` is a property of rows, not of the puyos sitting in them.
    const result = run(
      `
        R
        R
        R
        R
        R
      `,
      1,
    );
    expect(result.chainCount).toBe(1);
    expect(result.totalCleared).toBe(4);
    expect(formatBoard(result.board)).toBe(norm(`
      .
      .
      .
      .
      R
    `));
  });

  it('with hiddenRows >= height nothing can ever pop', () => {
    const result = run(column, 4);
    expect(result.chainCount).toBe(0);
    expect(formatBoard(result.board)).toBe(norm(column));
  });

  it('rejects a nonsensical hiddenRows', () => {
    const board = parseBoard(column);
    expect(() => resolve(board, { hiddenRows: -1 })).toThrow(RangeError);
    expect(() => resolve(board, { hiddenRows: 1.5 })).toThrow(RangeError);
  });

  it('still honours an explicit threshold', () => {
    const result = run(column, 1);
    expect(result.chainCount).toBe(0);
    expect(resolve(parseBoard(column), { hiddenRows: 1, threshold: 3 }).chainCount).toBe(1);
  });
});
