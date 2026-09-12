import { describe, expect, it } from 'vitest';
import { findGroups, findPoppableGroups, parseBoard } from '../src/core/index.js';

const sizes = (text: string): number[] =>
  findGroups(parseBoard(text))
    .map((g) => g.cells.length)
    .sort((a, b) => b - a);

describe('connected groups', () => {
  it('finds nothing on an empty board', () => {
    expect(findGroups(parseBoard('...\n...'))).toEqual([]);
  });

  it('finds a horizontal group of 4', () => {
    const groups = findPoppableGroups(parseBoard('RRRR..'));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.color).toBe('red');
    expect(groups[0]!.cells).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it('finds a vertical group of 4', () => {
    expect(findPoppableGroups(parseBoard('G.\nG.\nG.\nG.'))).toHaveLength(1);
  });

  it('finds an L-shaped group of 4', () => {
    const groups = findPoppableGroups(
      parseBoard(`
      B...
      B...
      BB..
      `),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.cells).toHaveLength(4);
  });

  it('does not pop a group of exactly 3', () => {
    expect(sizes('RRR.')).toEqual([3]);
    expect(findPoppableGroups(parseBoard('RRR.'))).toEqual([]);

    expect(
      findPoppableGroups(
        parseBoard(`
        R...
        R...
        R...
        `),
      ),
    ).toEqual([]);
  });

  it('does not connect diagonally', () => {
    // Four reds on a diagonal: four groups of one, nothing poppable.
    const text = `
      R...
      .R..
      ..R.
      ...R
    `;
    expect(sizes(text)).toEqual([1, 1, 1, 1]);
    expect(findPoppableGroups(parseBoard(text))).toEqual([]);

    // A 2x2 checkerboard: still no connection between the matching colours.
    expect(sizes('RY\nYR')).toEqual([1, 1, 1, 1]);
  });

  it('does not merge groups of different colours that touch', () => {
    expect(sizes('RRGG')).toEqual([2, 2]);
  });

  it('keeps same-colour groups separate when they are not connected', () => {
    expect(sizes('RR.RR')).toEqual([2, 2]);
    expect(findPoppableGroups(parseBoard('RR.RR'))).toEqual([]);
  });
});
