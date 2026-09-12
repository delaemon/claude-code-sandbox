import { describe, expect, it } from 'vitest';
import { applyGravity, formatBoard, hasFloatingCells, parseBoard } from '../src/core/index.js';

/** Assert that gravity turns `before` into `after`. */
function settlesTo(before: string, after: string): void {
  expect(formatBoard(applyGravity(parseBoard(before)))).toBe(formatBoard(parseBoard(after)));
}

describe('gravity', () => {
  it('drops a single floating cell to the floor', () => {
    settlesTo(
      `
      R..
      ...
      ...
      `,
      `
      ...
      ...
      R..
      `,
    );
  });

  it('closes gaps in several columns at once', () => {
    settlesTo(
      `
      R.B
      ...
      G..
      ..Y
      `,
      `
      ...
      ...
      R.B
      G.Y
      `,
    );
  });

  it('preserves the order of cells within a column', () => {
    settlesTo(
      `
      R..
      ...
      G..
      ...
      B..
      `,
      `
      ...
      ...
      R..
      G..
      B..
      `,
    );
  });

  it('leaves a settled board untouched', () => {
    const text = ['.....', 'R.B..', 'RGB.Y'].join('\n');
    const board = parseBoard(text);
    expect(hasFloatingCells(board)).toBe(false);
    expect(formatBoard(applyGravity(board))).toBe(text);
  });

  it('detects floating cells', () => {
    expect(hasFloatingCells(parseBoard('R..\n...'))).toBe(true);
    expect(hasFloatingCells(parseBoard('...\nR..'))).toBe(false);
  });

  it('does not mutate the input board', () => {
    const text = 'R..\n...';
    const board = parseBoard(text);
    applyGravity(board);
    expect(formatBoard(board)).toBe(text);
  });
});
