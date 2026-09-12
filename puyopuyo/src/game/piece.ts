/**
 * The falling pair.
 *
 * A piece is two puyos: an **axis** (the pivot) and a **child** that sits in
 * one of four orientations around it. Rotation moves the child around the
 * axis; the axis only moves when a rotation has to kick.
 *
 *   rotation 0        1        2        3
 *      C            A C        A        C A
 *      A                       C
 *
 * Pure data + pure functions. No timers, no randomness, no DOM.
 */

import {
  getCell,
  inBounds,
  setCell,
  type Board,
  type Color,
  type Pos,
} from '../core/index.js';
import type { Pair } from './queue.js';

/** Orientation of the child relative to the axis. 0 = above, then clockwise. */
export type Rotation = 0 | 1 | 2 | 3;

/** All four orientations, in clockwise order. */
export const ROTATIONS: readonly Rotation[] = [0, 1, 2, 3];

/** Where the child sits relative to the axis, per rotation. `y` grows down. */
export const CHILD_OFFSETS: Readonly<Record<Rotation, Pos>> = {
  0: { x: 0, y: -1 },
  1: { x: 1, y: 0 },
  2: { x: 0, y: 1 },
  3: { x: -1, y: 0 },
};

/** Which way a rotation turns. */
export type RotationDirection = 'cw' | 'ccw';

/** A pair of puyos placed on the board at a rotation. */
export interface Piece {
  readonly pair: Pair;
  /** Column of the axis puyo. */
  readonly x: number;
  /** Row of the axis puyo. `y` grows downward. */
  readonly y: number;
  readonly rotation: Rotation;
}

/** One puyo of a piece, with its board position. */
export interface PlacedPuyo {
  readonly x: number;
  readonly y: number;
  readonly color: Color;
  readonly role: 'axis' | 'child';
}

/** Where the child of `piece` sits. May be off the board. */
export function childPos(piece: Piece): Pos {
  const d = CHILD_OFFSETS[piece.rotation];
  return { x: piece.x + d.x, y: piece.y + d.y };
}

/** Both puyos of `piece`, axis first. */
export function pieceCells(piece: Piece): readonly [PlacedPuyo, PlacedPuyo] {
  const child = childPos(piece);
  return [
    { x: piece.x, y: piece.y, color: piece.pair.axis, role: 'axis' },
    { x: child.x, y: child.y, color: piece.pair.child, role: 'child' },
  ];
}

/** Can `piece` occupy its cells: both on the board and both empty? */
export function fits(board: Board, piece: Piece): boolean {
  return pieceCells(piece).every(
    (p) => inBounds(board, p.x, p.y) && getCell(board, p.x, p.y) === null,
  );
}

/** `piece` shifted by (dx, dy), or `null` if that does not fit. */
export function translate(board: Board, piece: Piece, dx: number, dy: number): Piece | null {
  const moved: Piece = { ...piece, x: piece.x + dx, y: piece.y + dy };
  return fits(board, moved) ? moved : null;
}

/** `piece` one row lower, or `null` if it is resting. */
export function moveDown(board: Board, piece: Piece): Piece | null {
  return translate(board, piece, 0, 1);
}

/** Is `piece` resting on the floor or on another puyo? */
export function isGrounded(board: Board, piece: Piece): boolean {
  return moveDown(board, piece) === null;
}

/** The rotation one step `direction` from `rotation`. */
export function turn(rotation: Rotation, direction: RotationDirection): Rotation {
  const delta = direction === 'cw' ? 1 : 3;
  return (((rotation + delta) % 4) as Rotation);
}

/**
 * Rotate `piece`, kicking if the child's target cell is blocked.
 *
 * The kick is a single push of the axis in the direction *opposite* the new
 * child offset — i.e. the pair shoves itself away from whatever is in the way.
 * That one rule covers the wall case (rotating into a side wall walks the pair
 * inward), the floor case (rotating the child downward lifts the pair) and a
 * neighbouring stack. If the kicked position does not fit either, the rotation
 * is **refused** and `null` is returned: no double-kick, no 180° flip.
 */
export function rotate(board: Board, piece: Piece, direction: RotationDirection): Piece | null {
  const rotation = turn(piece.rotation, direction);
  const rotated: Piece = { ...piece, rotation };
  if (fits(board, rotated)) return rotated;

  const d = CHILD_OFFSETS[rotation];
  const kicked: Piece = { ...rotated, x: rotated.x - d.x, y: rotated.y - d.y };
  return fits(board, kicked) ? kicked : null;
}

/** `board` with both puyos of `piece` written into it. Throws if it does not fit. */
export function lockPiece(board: Board, piece: Piece): Board {
  if (!fits(board, piece)) {
    throw new RangeError(`cannot lock piece at (${piece.x}, ${piece.y}) rotation ${piece.rotation}`);
  }
  let next = board;
  for (const p of pieceCells(piece)) next = setCell(next, p.x, p.y, p.color);
  return next;
}

/** The piece a `pair` spawns as: axis in the spawn column, child above it. */
export function spawnPiece(pair: Pair, spawnX: number, spawnY: number): Piece {
  return { pair, x: spawnX, y: spawnY, rotation: 0 };
}
