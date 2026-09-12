import { describe, expect, it } from 'vitest';
import {
  boardHeight,
  boardWidth,
  boardsEqual,
  createBoard,
  getCell,
  HEIGHT,
  inBounds,
  setCell,
  WIDTH,
} from '../src/core/index.js';

describe('board', () => {
  it('defaults to the contract size: 6 wide, 12 visible rows + 1 hidden = 13', () => {
    expect(WIDTH).toBe(6);
    expect(HEIGHT).toBe(13);
    const board = createBoard();
    expect(boardHeight(board)).toBe(13);
    expect(boardWidth(board)).toBe(6);
  });

  it('starts empty', () => {
    const board = createBoard();
    for (let y = 0; y < boardHeight(board); y++) {
      for (let x = 0; x < boardWidth(board); x++) {
        expect(getCell(board, x, y)).toBeNull();
      }
    }
  });

  it('is indexed [y][x], not [x][y]', () => {
    // A 3-wide, 2-tall board: (2, 1) is valid, (1, 2) is not.
    const board = createBoard(3, 2);
    expect(inBounds(board, 2, 1)).toBe(true);
    expect(inBounds(board, 1, 2)).toBe(false);

    const written = setCell(board, 2, 1, 'red');
    expect(written[1]![2]).toBe('red');
  });

  it('setCell returns a new board and leaves the original alone', () => {
    const board = createBoard(3, 3);
    const next = setCell(board, 1, 1, 'blue');
    expect(getCell(next, 1, 1)).toBe('blue');
    expect(getCell(board, 1, 1)).toBeNull();
    expect(boardsEqual(board, next)).toBe(false);
  });

  it('throws rather than confusing out-of-bounds with empty', () => {
    const board = createBoard(2, 2);
    expect(() => getCell(board, 2, 0)).toThrow(RangeError);
    expect(() => getCell(board, 0, -1)).toThrow(RangeError);
    expect(getCell(board, 1, 1)).toBeNull();
  });
});
