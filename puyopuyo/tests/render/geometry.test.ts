import { describe, expect, it } from 'vitest';
import { HIDDEN_ROWS, VISIBLE_HEIGHT, WIDTH } from '../../src/core/index.js';
import {
  MAX_CELL,
  MIN_CELL,
  cellRect,
  createLayout,
  fitLayout,
  isVisible,
  isVisibleRow,
  previewCellRect,
  previewSlotRect,
} from '../../src/render/geometry.js';

const CELLS = [10, 16, 24, 31, 48];

describe('createLayout', () => {
  it('defaults to the contract board: 6 wide, 12 visible rows, 1 hidden', () => {
    const l = createLayout({ cell: 20 });
    expect(l.cols).toBe(WIDTH);
    expect(l.rows).toBe(VISIBLE_HEIGHT);
    expect(l.hiddenRows).toBe(HIDDEN_ROWS);
  });

  it('sizes the board rect from the VISIBLE rows only, at every cell size', () => {
    for (const cell of CELLS) {
      const l = createLayout({ cell });
      expect(l.board.w).toBe(6 * cell);
      // 12, not 13: the hidden row is not part of the playfield rect.
      expect(l.board.h).toBe(12 * cell);
      expect(l.board.h).not.toBe((VISIBLE_HEIGHT + HIDDEN_ROWS) * cell);
    }
  });

  it('places the board inside the canvas with padding on every side', () => {
    for (const cell of CELLS) {
      const l = createLayout({ cell });
      expect(l.board.x).toBe(l.pad);
      expect(l.board.y).toBe(l.pad);
      expect(l.height - (l.board.y + l.board.h)).toBe(l.pad);
      expect(l.width - (l.panel.x + l.panel.w)).toBe(l.pad);
    }
  });

  it('puts the panel to the right of the board with exactly one gap between', () => {
    const l = createLayout({ cell: 24 });
    expect(l.panel.x - (l.board.x + l.board.w)).toBe(l.gap);
    expect(l.panel.w).toBe(3 * l.cell);
    expect(l.panel.y).toBe(l.board.y);
    expect(l.panel.h).toBe(l.board.h);
  });

  it('keeps preview slots and the HUD inside the panel, in that order', () => {
    const l = createLayout({ cell: 24, previewCount: 2 });
    expect(l.next.y).toBeGreaterThan(l.panel.y); // room for the NEXT caption
    expect(l.next.h).toBe(2 * 2 * l.cell + l.gap);
    expect(l.hud.y).toBeGreaterThanOrEqual(l.next.y + l.next.h);
    expect(l.hud.y + l.hud.h).toBe(l.panel.y + l.panel.h);
  });

  it('handles a zero-slot preview without producing a negative rect', () => {
    const l = createLayout({ cell: 24, previewCount: 0 });
    expect(l.next.h).toBe(0);
    expect(l.hud.h).toBeGreaterThan(0);
  });

  it('rejects a non-integer or non-positive cell size', () => {
    expect(() => createLayout({ cell: 0 })).toThrow(RangeError);
    expect(() => createLayout({ cell: -4 })).toThrow(RangeError);
    expect(() => createLayout({ cell: 12.5 })).toThrow(RangeError);
    expect(() => createLayout({ cell: 20, previewCount: -1 })).toThrow(RangeError);
  });
});

describe('cellRect — the hidden-row offset', () => {
  it('maps the first VISIBLE row onto the top of the board rect', () => {
    for (const cell of CELLS) {
      const l = createLayout({ cell });
      expect(cellRect(l, 0, l.hiddenRows).y).toBe(l.board.y);
    }
  });

  it('maps the hidden row one cell ABOVE the board rect, not onto row 1', () => {
    for (const cell of CELLS) {
      const l = createLayout({ cell });
      const hidden = cellRect(l, 0, 0);
      const firstVisible = cellRect(l, 0, l.hiddenRows);
      expect(hidden.y).toBe(l.board.y - cell);
      expect(hidden.y).toBeLessThan(l.board.y);
      expect(hidden.y).not.toBe(firstVisible.y);
    }
  });

  it('maps the last visible row flush with the bottom of the board rect', () => {
    for (const cell of CELLS) {
      const l = createLayout({ cell });
      const last = cellRect(l, 0, l.hiddenRows + l.rows - 1);
      expect(last.y + last.h).toBe(l.board.y + l.board.h);
    }
  });

  it('maps columns left to right, flush with the board edges', () => {
    const l = createLayout({ cell: 20 });
    expect(cellRect(l, 0, 1).x).toBe(l.board.x);
    const last = cellRect(l, l.cols - 1, 1);
    expect(last.x + last.w).toBe(l.board.x + l.board.w);
  });

  it('tiles without gaps or overlap: row n+1 starts where row n ends', () => {
    const l = createLayout({ cell: 17 });
    for (let y = l.hiddenRows; y < l.hiddenRows + l.rows - 1; y++) {
      const a = cellRect(l, 3, y);
      const b = cellRect(l, 3, y + 1);
      expect(b.y).toBe(a.y + a.h);
    }
  });

  it('still offsets correctly when there is more than one hidden row', () => {
    const l = createLayout({ cell: 20, hiddenRows: 2, rows: 12 });
    expect(cellRect(l, 0, 0).y).toBe(l.board.y - 40);
    expect(cellRect(l, 0, 1).y).toBe(l.board.y - 20);
    expect(cellRect(l, 0, 2).y).toBe(l.board.y);
    expect(l.board.h).toBe(12 * 20);
  });

  it('treats zero hidden rows as no offset at all', () => {
    const l = createLayout({ cell: 20, hiddenRows: 0 });
    expect(cellRect(l, 0, 0).y).toBe(l.board.y);
  });
});

describe('isVisible', () => {
  it('excludes the hidden row and everything past the last visible row', () => {
    const l = createLayout({ cell: 20 });
    expect(isVisibleRow(l, 0)).toBe(false);
    expect(isVisibleRow(l, 1)).toBe(true);
    expect(isVisibleRow(l, 12)).toBe(true);
    expect(isVisibleRow(l, 13)).toBe(false);
    expect(isVisibleRow(l, -1)).toBe(false);
  });

  it('excludes columns outside the board', () => {
    const l = createLayout({ cell: 20 });
    expect(isVisible(l, -1, 5)).toBe(false);
    expect(isVisible(l, 0, 5)).toBe(true);
    expect(isVisible(l, 5, 5)).toBe(true);
    expect(isVisible(l, 6, 5)).toBe(false);
  });

  it('agrees with cellRect: every visible cell lies inside the board rect', () => {
    const l = createLayout({ cell: 22 });
    for (let y = 0; y < l.hiddenRows + l.rows + 1; y++) {
      for (let x = -1; x <= l.cols; x++) {
        const r = cellRect(l, x, y);
        const inside =
          r.x >= l.board.x &&
          r.y >= l.board.y &&
          r.x + r.w <= l.board.x + l.board.w &&
          r.y + r.h <= l.board.y + l.board.h;
        expect(inside).toBe(isVisible(l, x, y));
      }
    }
  });
});

describe('fitLayout', () => {
  it('never produces a canvas larger than the viewport it was given', () => {
    for (const [w, h] of [
      [360, 640],
      [390, 844],
      [1280, 800],
      [500, 500],
      [1024, 300],
    ] as const) {
      const l = fitLayout(w, h);
      if (l.cell > MIN_CELL) {
        expect(l.width).toBeLessThanOrEqual(w);
        expect(l.height).toBeLessThanOrEqual(h);
      }
    }
  });

  it('clamps the cell size at both ends', () => {
    expect(fitLayout(10, 10).cell).toBe(MIN_CELL);
    expect(fitLayout(10_000, 10_000).cell).toBe(MAX_CELL);
    expect(fitLayout(Number.NaN, Number.NaN).cell).toBe(MIN_CELL);
  });

  it('is limited by height on a tall narrow phone and by width on a short wide one', () => {
    const phone = fitLayout(390, 844);
    expect(phone.cell).toBe(Math.floor(390 / 10.5));
    const short = fitLayout(1280, 400);
    expect(short.cell).toBe(Math.floor(400 / 13));
  });

  it('carries its options through to createLayout', () => {
    const l = fitLayout(800, 600, { previewCount: 3, hiddenRows: 1 });
    expect(l.previewCount).toBe(3);
    expect(l.next.h).toBe(3 * 2 * l.cell + 2 * l.gap);
  });
});

describe('preview rects', () => {
  it('stacks slots downward inside the next rect', () => {
    const l = createLayout({ cell: 20, previewCount: 2 });
    const a = previewSlotRect(l, 0);
    const b = previewSlotRect(l, 1);
    expect(a.y).toBe(l.next.y);
    expect(b.y).toBe(a.y + a.h + l.gap);
    expect(b.y + b.h).toBe(l.next.y + l.next.h);
  });

  it('is one cell wide and two tall, centred in the panel', () => {
    const l = createLayout({ cell: 20 });
    const s = previewSlotRect(l, 0);
    expect(s.w).toBe(l.cell);
    expect(s.h).toBe(2 * l.cell);
    const leftGap = s.x - l.next.x;
    const rightGap = l.next.x + l.next.w - (s.x + s.w);
    expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(1);
  });

  it('puts the child above the axis, as the pair spawns', () => {
    const l = createLayout({ cell: 20 });
    const child = previewCellRect(l, 0, 0);
    const axis = previewCellRect(l, 0, 1);
    expect(axis.y).toBe(child.y + l.cell);
    expect(child.x).toBe(axis.x);
  });
});
