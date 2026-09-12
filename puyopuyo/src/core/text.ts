/**
 * Text format for boards, so tests and fixtures can be written as string
 * literals instead of nested arrays.
 *
 *   const b = parseBoard(`
 *     ......
 *     ..RR..
 *     ..RR..
 *   `);
 *
 * One character per cell, one line per row, top row first.
 * `.` (and ` `) are empty; the letters below are colours.
 *
 * Leading/trailing blank lines are dropped and each line is trimmed of
 * surrounding whitespace, so a template literal can be indented to match the
 * surrounding code.
 */

import {
  boardWidth,
  type Board,
  type Cell,
  type Color,
} from './board.js';

/** Character used for an empty cell when serialising. */
export const EMPTY_CHAR = '.';

/** Colour -> single character, used by `formatBoard`. */
export const COLOR_TO_CHAR: Readonly<Record<Color, string>> = {
  red: 'R',
  green: 'G',
  blue: 'B',
  yellow: 'Y',
  purple: 'P',
};

/** Character -> colour, used by `parseBoard`. Accepts upper or lower case. */
export const CHAR_TO_COLOR: Readonly<Record<string, Color>> = {
  R: 'red',
  G: 'green',
  B: 'blue',
  Y: 'yellow',
  P: 'purple',
};

/** Thrown when a board string cannot be parsed. */
export class BoardParseError extends Error {
  override name = 'BoardParseError';
}

function splitRows(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Parse one character into a cell. Throws on anything unrecognised. */
export function parseCell(char: string): Cell {
  if (char === EMPTY_CHAR || char === ' ' || char === '_') return null;
  const color = CHAR_TO_COLOR[char.toUpperCase()];
  if (color === undefined) throw new BoardParseError(`unknown board character: ${JSON.stringify(char)}`);
  return color;
}

/** Serialise one cell to a character. */
export function formatCell(cell: Cell): string {
  return cell === null ? EMPTY_CHAR : COLOR_TO_CHAR[cell];
}

/**
 * Parse a board from text. All rows must be the same width; a ragged literal
 * is a typo in the test, not something to pad silently.
 */
export function parseBoard(text: string): Board {
  const lines = splitRows(text);
  if (lines.length === 0) throw new BoardParseError('empty board text');

  const width = lines[0]!.length;
  return lines.map((line, y) => {
    if (line.length !== width) {
      throw new BoardParseError(
        `row ${y} has width ${line.length}, expected ${width} (rows must be rectangular)`,
      );
    }
    return [...line].map(parseCell);
  });
}

/** Serialise a board back to the same text format (no trailing newline). */
export function formatBoard(board: Board): string {
  return board.map((row) => row.map(formatCell).join('')).join('\n');
}

/**
 * Compare a board against expected text, ignoring indentation and blank
 * padding lines. Returns true when they match.
 */
export function boardMatches(board: Board, text: string): boolean {
  return formatBoard(board) === splitRows(text).join('\n');
}

/**
 * Parse a board and place it at the bottom of a full-size (or given-size)
 * board. Lets a test describe just the interesting bottom rows.
 */
export function parseBoardBottom(text: string, width: number, height: number): Board {
  const parsed = parseBoard(text);
  const parsedWidth = boardWidth(parsed);
  if (parsedWidth > width) {
    throw new BoardParseError(`board text is ${parsedWidth} wide, wider than ${width}`);
  }
  if (parsed.length > height) {
    throw new BoardParseError(`board text is ${parsed.length} tall, taller than ${height}`);
  }
  const padTop = height - parsed.length;
  const padRight = width - parsedWidth;
  const empties = (n: number): Cell[] => new Array<Cell>(n).fill(null);
  return [
    ...Array.from({ length: padTop }, () => empties(width)),
    ...parsed.map((row) => [...row, ...empties(padRight)]),
  ];
}
