/**
 * `draw(ctx, state, layout)` — the whole picture, once.
 *
 * Pure in its arguments, as the contract requires: it reads `state`, never
 * writes it; it keeps nothing between calls; it reads no clock. Everything
 * time-dependent already lives in the state (`phase`, `stepIndex`), put there
 * by ticks that `main.ts` fed in. Every coordinate comes from `layout` — if a
 * number in this file is a pixel position, it is a bug.
 *
 * The hidden spawn row is never drawn in the playfield: every cell goes through
 * `isVisible`, which rejects rows above `layout.hiddenRows`.
 */

import type { Board, Cell, Color } from '../core/index.js';
import { activePiece, pieceCells, upcoming, type GameState, type Piece } from '../game/index.js';
import {
  cellRect,
  isVisible,
  previewCellRect,
  previewSlotRect,
  type Layout,
  type Rect,
} from './geometry.js';
import { hudModel } from './hud.js';
import { THEME, styleFor } from './palette.js';

const FONT_STACK = 'ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif';

/** Draw one frame of `state`. */
export function draw(ctx: CanvasRenderingContext2D, state: GameState, layout: Layout): void {
  ctx.save();

  ctx.fillStyle = THEME.bg;
  fill(ctx, { x: 0, y: 0, w: layout.width, h: layout.height });

  drawWell(ctx, layout);
  drawBoard(ctx, state.board, layout);
  drawActivePiece(ctx, state, layout);
  drawNext(ctx, state, layout);
  drawHud(ctx, state, layout);
  if (state.phase === 'gameover') drawGameOver(ctx, layout);

  ctx.restore();
}

// ------------------------------------------------------------------ board

function drawWell(ctx: CanvasRenderingContext2D, layout: Layout): void {
  const { board, cell, cols, rows } = layout;
  ctx.fillStyle = THEME.well;
  fill(ctx, board);

  ctx.strokeStyle = THEME.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 1; x < cols; x++) {
    const px = board.x + x * cell + 0.5;
    ctx.moveTo(px, board.y);
    ctx.lineTo(px, board.y + board.h);
  }
  for (let y = 1; y < rows; y++) {
    const py = board.y + y * cell + 0.5;
    ctx.moveTo(board.x, py);
    ctx.lineTo(board.x + board.w, py);
  }
  ctx.stroke();

  ctx.strokeStyle = THEME.edge;
  ctx.lineWidth = 2;
  ctx.strokeRect(board.x - 1, board.y - 1, board.w + 2, board.h + 2);
}

function cellAt(board: Board, x: number, y: number): Cell {
  return board[y]?.[x] ?? null;
}

function drawBoard(ctx: CanvasRenderingContext2D, board: Board, layout: Layout): void {
  for (let y = 0; y < board.length; y++) {
    const row = board[y];
    if (row === undefined) continue;
    for (let x = 0; x < row.length; x++) {
      const color = row[x];
      if (color === undefined || color === null) continue;
      if (!isVisible(layout, x, y)) continue;
      drawPuyo(ctx, cellRect(layout, x, y), color, {
        // Joins are drawn only toward cells that are themselves on screen, so
        // a puyo on the top visible row never sprouts a stub into the hidden row.
        linkRight: isVisible(layout, x + 1, y) && cellAt(board, x + 1, y) === color,
        linkDown: isVisible(layout, x, y + 1) && cellAt(board, x, y + 1) === color,
      });
    }
  }
}

/**
 * The piece the player is holding — or, once the game is over, the piece that
 * could not be placed, dimmed. The reducer keeps that piece in the state for
 * exactly this reason.
 */
function drawActivePiece(ctx: CanvasRenderingContext2D, state: GameState, layout: Layout): void {
  const piece: Piece | null =
    state.phase === 'gameover' ? state.blockedPiece : activePiece(state);
  if (piece === null) return;

  ctx.save();
  if (state.phase === 'gameover') ctx.globalAlpha = 0.45;
  for (const p of pieceCells(piece)) {
    // The spawn child sits in the hidden row; it must not appear in the well.
    if (!isVisible(layout, p.x, p.y)) continue;
    drawPuyo(ctx, cellRect(layout, p.x, p.y), p.color, {});
  }
  ctx.restore();
}

// ------------------------------------------------------------------- puyo

interface PuyoOptions {
  readonly linkRight?: boolean;
  readonly linkDown?: boolean;
}

/**
 * One puyo: a filled circle, an outline, a highlight and a colour-specific
 * glyph. Exactly one `arc` call per puyo — the glyphs are polylines — so a
 * fake context can count puyos by counting arcs.
 */
function drawPuyo(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  color: Color,
  options: PuyoOptions,
): void {
  const style = styleFor(color);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const r = rect.w * 0.4;

  // Joins, drawn under the bodies so groups read as one blob.
  ctx.fillStyle = style.fill;
  const t = r * 0.9;
  if (options.linkRight === true) fill(ctx, { x: cx, y: cy - t / 2, w: rect.w, h: t });
  if (options.linkDown === true) fill(ctx, { x: cx - t / 2, y: cy, w: t, h: rect.h });

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1, rect.w * 0.07);
  ctx.strokeStyle = style.stroke;
  ctx.stroke();

  // Highlight: a short arc-free stroke, so the arc count stays one per puyo.
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.45, cy - r * 0.5);
  ctx.lineTo(cx - r * 0.05, cy - r * 0.62);
  ctx.strokeStyle = style.shine;
  ctx.lineWidth = Math.max(1, rect.w * 0.1);
  ctx.stroke();

  drawGlyph(ctx, style.glyph, cx, cy, r * 0.42);
}

function drawGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: 'triangle' | 'square' | 'diamond' | 'cross' | 'chevron',
  cx: number,
  cy: number,
  s: number,
): void {
  ctx.beginPath();
  ctx.lineWidth = Math.max(1, s * 0.55);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (glyph) {
    case 'triangle':
      ctx.moveTo(cx, cy - s);
      ctx.lineTo(cx + s, cy + s * 0.8);
      ctx.lineTo(cx - s, cy + s * 0.8);
      ctx.closePath();
      ctx.fillStyle = THEME.ink;
      ctx.fill();
      return;
    case 'square':
      ctx.moveTo(cx - s * 0.8, cy - s * 0.8);
      ctx.lineTo(cx + s * 0.8, cy - s * 0.8);
      ctx.lineTo(cx + s * 0.8, cy + s * 0.8);
      ctx.lineTo(cx - s * 0.8, cy + s * 0.8);
      ctx.closePath();
      ctx.fillStyle = THEME.ink;
      ctx.fill();
      return;
    case 'diamond':
      ctx.moveTo(cx, cy - s);
      ctx.lineTo(cx + s, cy);
      ctx.lineTo(cx, cy + s);
      ctx.lineTo(cx - s, cy);
      ctx.closePath();
      ctx.fillStyle = THEME.ink;
      ctx.fill();
      return;
    case 'cross':
      ctx.moveTo(cx - s, cy - s);
      ctx.lineTo(cx + s, cy + s);
      ctx.moveTo(cx + s, cy - s);
      ctx.lineTo(cx - s, cy + s);
      ctx.strokeStyle = THEME.ink;
      ctx.stroke();
      return;
    case 'chevron':
      ctx.moveTo(cx - s, cy - s * 0.35);
      ctx.lineTo(cx, cy + s * 0.65);
      ctx.lineTo(cx + s, cy - s * 0.35);
      ctx.strokeStyle = THEME.ink;
      ctx.stroke();
      return;
  }
}

// ------------------------------------------------------------------- next

function drawNext(ctx: CanvasRenderingContext2D, state: GameState, layout: Layout): void {
  const { panel, next, cell } = layout;
  ctx.fillStyle = THEME.panel;
  fill(ctx, panel);

  text(ctx, 'NEXT', panel.x, panel.y + Math.round(cell * 0.55), {
    size: Math.max(8, Math.round(cell * 0.42)),
    color: THEME.dim,
  });
  if (layout.previewCount === 0) return;

  const pairs = upcoming(state.queue, layout.previewCount);
  for (let slot = 0; slot < layout.previewCount; slot++) {
    const box = previewSlotRect(layout, slot);
    ctx.fillStyle = THEME.well;
    fill(ctx, { x: next.x, y: box.y, w: next.w, h: box.h });

    const pair = pairs[slot];
    if (pair === undefined) continue;
    // Row 0 is the child, row 1 the axis: the pair as it will spawn.
    drawPuyo(ctx, previewCellRect(layout, slot, 0), pair.child, {});
    drawPuyo(ctx, previewCellRect(layout, slot, 1), pair.axis, {});
  }
}

// -------------------------------------------------------------------- hud

function drawHud(ctx: CanvasRenderingContext2D, state: GameState, layout: Layout): void {
  const { hud, cell } = layout;
  const model = hudModel(state);
  const small = Math.max(8, Math.round(cell * 0.4));
  const big = Math.max(11, Math.round(cell * 0.66));
  const line = Math.round(cell * 0.58);
  const right = hud.x + hud.w;
  let y = hud.y + small;

  text(ctx, 'LAST CHAIN', hud.x, y, { size: small, color: THEME.dim });
  y += big + 2;
  text(ctx, String(model.score), hud.x, y, { size: big, color: THEME.accent, weight: 700 });
  y += line;
  text(ctx, model.chain > 0 ? `${model.chain} chain` : '-', hud.x, y, {
    size: small,
    color: THEME.text,
  });

  y += line * 1.6;
  for (const [name, value] of [
    ['PIECES', model.pieces],
    ['CLEARED', model.cleared],
    ['BEST', model.best],
  ] as const) {
    text(ctx, name, hud.x, y, { size: small, color: THEME.dim });
    text(ctx, String(value), right, y, { size: small, color: THEME.text, align: 'right' });
    y += line;
  }
}

function drawGameOver(ctx: CanvasRenderingContext2D, layout: Layout): void {
  const { board, cell } = layout;
  ctx.fillStyle = THEME.overlay;
  fill(ctx, board);

  const cx = board.x + board.w / 2;
  const cy = board.y + board.h / 2;
  text(ctx, 'GAME OVER', cx, cy, {
    size: Math.max(14, Math.round(cell * 0.8)),
    color: THEME.danger,
    align: 'center',
    baseline: 'middle',
    weight: 800,
  });
  text(ctx, 'spawn blocked', cx, cy + cell, {
    size: Math.max(9, Math.round(cell * 0.42)),
    color: THEME.dim,
    align: 'center',
    baseline: 'middle',
  });
}

// ----------------------------------------------------------------- pixels

function fill(ctx: CanvasRenderingContext2D, rect: Rect): void {
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
}

interface TextOptions {
  readonly size: number;
  readonly color: string;
  readonly align?: CanvasTextAlign;
  readonly baseline?: CanvasTextBaseline;
  readonly weight?: number;
}

function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  options: TextOptions,
): void {
  ctx.font = `${options.weight ?? 600} ${options.size}px ${FONT_STACK}`;
  ctx.fillStyle = options.color;
  ctx.textAlign = options.align ?? 'left';
  ctx.textBaseline = options.baseline ?? 'alphabetic';
  ctx.fillText(value, x, y);
}
