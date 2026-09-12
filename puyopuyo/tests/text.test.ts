import { describe, expect, it } from 'vitest';
import {
  BoardParseError,
  boardHeight,
  boardMatches,
  boardWidth,
  formatBoard,
  getCell,
  parseBoard,
  parseBoardBottom,
} from '../src/core/index.js';

describe('text format', () => {
  it('parses rows top-first with . as empty', () => {
    const board = parseBoard(`
      .RGG.
      .....
    `);
    expect(boardHeight(board)).toBe(2);
    expect(boardWidth(board)).toBe(5);
    expect(getCell(board, 0, 0)).toBeNull();
    expect(getCell(board, 1, 0)).toBe('red');
    expect(getCell(board, 2, 0)).toBe('green');
    expect(getCell(board, 3, 0)).toBe('green');
    expect(getCell(board, 4, 0)).toBeNull();
    expect(getCell(board, 0, 1)).toBeNull();
  });

  it('round-trips parse -> format', () => {
    const text = ['.RGG.', 'BBYYP', '.....'].join('\n');
    expect(formatBoard(parseBoard(text))).toBe(text);
  });

  it('ignores indentation and blank padding lines', () => {
    expect(boardMatches(parseBoard('\n\n  RR  \n\n'), 'RR')).toBe(true);
  });

  it('rejects ragged rows and unknown characters', () => {
    expect(() => parseBoard('RR\nRRR')).toThrow(BoardParseError);
    expect(() => parseBoard('RZ')).toThrow(BoardParseError);
  });

  it('parseBoardBottom pads up to a full playfield', () => {
    const board = parseBoardBottom('RR', 6, 13);
    expect(boardHeight(board)).toBe(13);
    expect(boardWidth(board)).toBe(6);
    expect(getCell(board, 0, 12)).toBe('red');
    expect(getCell(board, 1, 12)).toBe('red');
    expect(getCell(board, 2, 12)).toBeNull();
    expect(getCell(board, 0, 11)).toBeNull();
  });
});
