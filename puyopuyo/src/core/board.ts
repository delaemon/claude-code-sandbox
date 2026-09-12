/**
 * Board model.
 *
 * Contract (docs/worklog/CONTRACT.md):
 *  - 6 wide x 12 tall playfield, plus 1 hidden spawn row on top => 13 rows.
 *  - Origin top-left, indexed `board[y][x]`, y grows downward. Never board[x][y].
 *  - A cell is a colour or empty; empty is `null` and colours are a non-empty
 *    string union, so the two can never be confused.
 *
 * No DOM, no timers, no randomness in this module (or anywhere under core/).
 */

/** Playfield width in columns. */
export const WIDTH = 6;
/** Number of hidden rows above the visible playfield (the spawn row). */
export const HIDDEN_ROWS = 1;
/** Visible playfield height in rows. */
export const VISIBLE_HEIGHT = 12;
/** Total row count, hidden row included. Row 0 is hidden. */
export const HEIGHT = HIDDEN_ROWS + VISIBLE_HEIGHT;

/** The colours a puyo can have. Deliberately none of them is `""`. */
export const COLORS = ['red', 'green', 'blue', 'yellow', 'purple'] as const;

export type Color = (typeof COLORS)[number];

/** A board cell: a colour, or `null` for empty. */
export type Cell = Color | null;

/** A board is a rectangular grid of rows: `board[y][x]`. */
export type Board = readonly (readonly Cell[])[];

/** A mutable grid, used internally while building a new board. */
export type MutableBoard = Cell[][];

/** A position on the board. */
export interface Pos {
  readonly x: number;
  readonly y: number;
}

const COLOR_SET: ReadonlySet<string> = new Set<string>(COLORS);

/** Type guard: is `value` one of the known colours? */
export function isColor(value: unknown): value is Color {
  return typeof value === 'string' && COLOR_SET.has(value);
}

/** Number of rows in `board`. */
export function boardHeight(board: Board): number {
  return board.length;
}

/** Number of columns in `board`, derived from its first row. */
export function boardWidth(board: Board): number {
  return board[0]?.length ?? 0;
}

/**
 * An empty board. Defaults to the contract's 6x13, but the size is a parameter
 * so tests can use small boards without restating the whole playfield.
 */
export function createBoard(width: number = WIDTH, height: number = HEIGHT): Board {
  if (!Number.isInteger(width) || width < 0) throw new RangeError(`bad width: ${width}`);
  if (!Number.isInteger(height) || height < 0) throw new RangeError(`bad height: ${height}`);
  return Array.from({ length: height }, () => new Array<Cell>(width).fill(null));
}

/** Is (x, y) inside `board`? */
export function inBounds(board: Board, x: number, y: number): boolean {
  return y >= 0 && y < board.length && x >= 0 && x < boardWidth(board);
}

/**
 * The cell at (x, y). Throws on out-of-bounds rather than returning `null`:
 * "off the board" and "empty" are different things and conflating them hides
 * bugs in flood fill and gravity. Use `inBounds` first when a miss is expected.
 */
export function getCell(board: Board, x: number, y: number): Cell {
  if (!inBounds(board, x, y)) throw new RangeError(`out of bounds: (${x}, ${y})`);
  return board[y]![x]!;
}

/** A copy of `board` with (x, y) set to `cell`. Boards are never mutated. */
export function setCell(board: Board, x: number, y: number, cell: Cell): Board {
  if (!inBounds(board, x, y)) throw new RangeError(`out of bounds: (${x}, ${y})`);
  const next = board.map((row) => row);
  next[y] = board[y]!.map((c, i) => (i === x ? cell : c));
  return next;
}

/** A mutable deep copy of `board`, for algorithms that fill a grid in place. */
export function cloneMutable(board: Board): MutableBoard {
  return board.map((row) => [...row]);
}

/** Structural equality of two boards. */
export function boardsEqual(a: Board, b: Board): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, y) => {
    const other = b[y]!;
    return row.length === other.length && row.every((cell, x) => cell === other[x]);
  });
}

/** Every position on the board, in row-major (top-to-bottom) order. */
export function* positions(board: Board): Generator<Pos> {
  const width = boardWidth(board);
  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < width; x++) yield { x, y };
  }
}
