/**
 * Where everything goes, as arithmetic.
 *
 * No canvas, no DOM, no clock: every function here is a pure map from numbers
 * to numbers, so the layout can be tested exactly rather than by looking at
 * it. `draw` never computes a coordinate of its own — if a pixel position is
 * not derived from a `Layout`, it is a bug.
 *
 * One free variable: `cell`. Every other distance is derived from it, which is
 * what keeps the whole layout an integer identity at any size and makes the
 * responsive case a single function (`fitLayout`).
 *
 *   +--------------------------------+
 *   | pad                            |
 *   |  +-----------+ gap +--------+  |
 *   |  |           |     | NEXT   |  |   panel.w = 3 * cell
 *   |  |  board    |     | [slot] |  |
 *   |  |  cols x   |     | [slot] |  |
 *   |  |  rows     |     |        |  |
 *   |  |           |     | hud    |  |
 *   |  +-----------+     +--------+  |
 *   +--------------------------------+
 *
 * The row convention is the contract's: `board[y][x]`, `y` grows downward, and
 * row 0 is the hidden spawn row. `cellRect` takes *board* rows, so the hidden
 * row maps above the board rect and `isVisible` is what keeps it off screen.
 */

import { HIDDEN_ROWS, VISIBLE_HEIGHT, WIDTH } from '../core/index.js';

/** A rectangle in CSS pixels, top-left origin. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** How many upcoming pairs the preview panel has room for, by default. */
export const DEFAULT_PREVIEW_COUNT = 2;

/** Below this a puyo is a smudge; above it the board stops fitting phones. */
export const MIN_CELL = 10;
export const MAX_CELL = 48;

export interface LayoutOptions {
  /** Side of one cell, in CSS pixels. Must be a positive integer. */
  readonly cell: number;
  /** Visible columns. Defaults to the contract's 6. */
  readonly cols?: number;
  /** Visible rows, hidden rows excluded. Defaults to the contract's 12. */
  readonly rows?: number;
  /** Rows at the top of the board that are never drawn. Defaults to 1. */
  readonly hiddenRows?: number;
  /** Preview slots in the side panel. May be 0. */
  readonly previewCount?: number;
}

/** Everything `draw` is allowed to know about pixels. */
export interface Layout {
  readonly cell: number;
  readonly cols: number;
  /** Visible rows. The board rect is this tall in cells, never `+ hiddenRows`. */
  readonly rows: number;
  readonly hiddenRows: number;
  readonly previewCount: number;
  readonly pad: number;
  readonly gap: number;
  /** The visible playfield. Excludes the hidden row by construction. */
  readonly board: Rect;
  /** The whole side column: preview slots on top, HUD below. */
  readonly panel: Rect;
  /** The preview slots' bounding box, label excluded. */
  readonly next: Rect;
  /** What is left of the panel under the preview: score and stats. */
  readonly hud: Rect;
  /** Canvas size in CSS pixels. */
  readonly width: number;
  readonly height: number;
}

function requirePositiveInt(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer, got ${value}`);
  }
  return value;
}

function requireCount(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
  return value;
}

/**
 * The full layout for a given cell size.
 *
 * Deterministic and integral: same options in, same integers out.
 */
export function createLayout(options: LayoutOptions): Layout {
  const cell = requirePositiveInt('cell', options.cell);
  const cols = requirePositiveInt('cols', options.cols ?? WIDTH);
  const rows = requirePositiveInt('rows', options.rows ?? VISIBLE_HEIGHT);
  const hiddenRows = requireCount('hiddenRows', options.hiddenRows ?? HIDDEN_ROWS);
  const previewCount = requireCount('previewCount', options.previewCount ?? DEFAULT_PREVIEW_COUNT);

  const pad = Math.round(cell / 2);
  const gap = Math.round(cell / 2);

  const board: Rect = { x: pad, y: pad, w: cols * cell, h: rows * cell };
  const panel: Rect = { x: board.x + board.w + gap, y: board.y, w: cell * 3, h: board.h };

  // Room for the "NEXT" caption above the slots.
  const labelH = Math.round(cell * 0.9);
  const slotsH = previewCount === 0 ? 0 : previewCount * 2 * cell + (previewCount - 1) * gap;
  const next: Rect = { x: panel.x, y: panel.y + labelH, w: panel.w, h: slotsH };

  const hudY = next.y + next.h + gap * 2;
  const hud: Rect = { x: panel.x, y: hudY, w: panel.w, h: Math.max(0, panel.y + panel.h - hudY) };

  return {
    cell,
    cols,
    rows,
    hiddenRows,
    previewCount,
    pad,
    gap,
    board,
    panel,
    next,
    hud,
    width: panel.x + panel.w + pad,
    height: board.y + board.h + pad,
  };
}

/** Width, in cells, the layout occupies: board + gaps + panel. */
export function widthInCells(cols: number): number {
  return cols + 4.5;
}

/** Height, in cells, the layout occupies: board + padding. */
export function heightInCells(rows: number): number {
  return rows + 1;
}

/**
 * The largest layout that fits `viewportW x viewportH` CSS pixels.
 *
 * The cell size is floored, so the result is never larger than the viewport,
 * and clamped to `[MIN_CELL, MAX_CELL]` — a clamped-up layout overflows a very
 * small viewport on purpose, because a 3px puyo is not a game.
 */
export function fitLayout(
  viewportW: number,
  viewportH: number,
  options: Omit<LayoutOptions, 'cell'> = {},
): Layout {
  const cols = options.cols ?? WIDTH;
  const rows = options.rows ?? VISIBLE_HEIGHT;
  const byWidth = viewportW / widthInCells(cols);
  const byHeight = viewportH / heightInCells(rows);
  const raw = Math.floor(Math.min(byWidth, byHeight));
  const cell = Math.max(MIN_CELL, Math.min(MAX_CELL, Number.isFinite(raw) ? raw : MIN_CELL));
  return createLayout({ ...options, cell });
}

/**
 * The rect of board cell `(x, y)`, where `y` is a **board** row: `y = 0` is the
 * hidden spawn row and `y = hiddenRows` is the top visible row.
 *
 * The hidden row deliberately maps *above* `layout.board` (a negative offset)
 * rather than being clamped into it: clamping would silently draw the spawn row
 * on top of the first visible row, which looks almost right and is wrong. Call
 * `isVisible` first.
 */
export function cellRect(layout: Layout, x: number, y: number): Rect {
  return {
    x: layout.board.x + x * layout.cell,
    y: layout.board.y + (y - layout.hiddenRows) * layout.cell,
    w: layout.cell,
    h: layout.cell,
  };
}

/** Is board row `y` inside the visible playfield? */
export function isVisibleRow(layout: Layout, y: number): boolean {
  return y >= layout.hiddenRows && y < layout.hiddenRows + layout.rows;
}

/** Is board cell `(x, y)` inside the visible playfield? */
export function isVisible(layout: Layout, x: number, y: number): boolean {
  return isVisibleRow(layout, y) && x >= 0 && x < layout.cols;
}

/** The rect of preview slot `slot`: one cell wide, two tall, centred in the panel. */
export function previewSlotRect(layout: Layout, slot: number): Rect {
  const { cell, next, gap } = layout;
  return {
    x: next.x + Math.round((next.w - cell) / 2),
    y: next.y + slot * (2 * cell + gap),
    w: cell,
    h: 2 * cell,
  };
}

/**
 * One cell of a preview slot. Row 0 is the top cell (the child, at rotation 0)
 * and row 1 is the bottom cell (the axis) — the pair as it spawns.
 */
export function previewCellRect(layout: Layout, slot: number, row: number): Rect {
  const s = previewSlotRect(layout, slot);
  return { x: s.x, y: s.y + row * layout.cell, w: layout.cell, h: layout.cell };
}
