import { describe, expect, it } from 'vitest';
import { HEIGHT, WIDTH, createBoard, formatBoard, parseBoardBottom, setCell, type Board } from '../../src/core/index.js';
import {
  childPos,
  fits,
  isGrounded,
  lockPiece,
  moveDown,
  pieceCells,
  rotate,
  spawnPiece,
  translate,
  turn,
  type Piece,
  type Rotation,
} from '../../src/game/index.js';

const PAIR = { axis: 'red', child: 'green' } as const;
const empty = (): Board => createBoard(WIDTH, HEIGHT);
const at = (x: number, y: number, rotation: Rotation): Piece => ({ pair: PAIR, x, y, rotation });
const bottom = (text: string): Board => parseBoardBottom(text, WIDTH, HEIGHT);

describe('piece geometry', () => {
  it('spawns with the child directly above the axis', () => {
    const piece = spawnPiece(PAIR, 2, 1);
    expect(piece).toEqual({ pair: PAIR, x: 2, y: 1, rotation: 0 });
    expect(childPos(piece)).toEqual({ x: 2, y: 0 });
  });

  it('puts the child up / right / down / left for rotations 0..3', () => {
    const offsets = ([0, 1, 2, 3] as const).map((r) => childPos(at(2, 5, r)));
    expect(offsets).toEqual([
      { x: 2, y: 4 },
      { x: 3, y: 5 },
      { x: 2, y: 6 },
      { x: 1, y: 5 },
    ]);
  });

  it('reports both puyos, axis first, with their colours', () => {
    expect(pieceCells(at(2, 5, 1))).toEqual([
      { x: 2, y: 5, color: 'red', role: 'axis' },
      { x: 3, y: 5, color: 'green', role: 'child' },
    ]);
  });

  it('turns clockwise and counter-clockwise through all four rotations', () => {
    expect([0, 1, 2, 3].map((r) => turn(r as Rotation, 'cw'))).toEqual([1, 2, 3, 0]);
    expect([0, 1, 2, 3].map((r) => turn(r as Rotation, 'ccw'))).toEqual([3, 0, 1, 2]);
  });
});

describe('piece movement', () => {
  it('translates into free space and refuses occupied or off-board space', () => {
    const board = setCell(empty(), 3, 5, 'blue');
    expect(translate(board, at(2, 5, 0), 1, 0)).toBeNull();
    expect(translate(board, at(0, 5, 0), -1, 0)).toBeNull();
    expect(translate(board, at(2, 5, 0), -1, 0)).toEqual(at(1, 5, 0));
  });

  it('knows when a piece is resting on the floor or on a stack', () => {
    expect(isGrounded(empty(), at(2, HEIGHT - 1, 0))).toBe(true);
    expect(isGrounded(empty(), at(2, 5, 0))).toBe(false);
    const stacked = setCell(empty(), 2, 6, 'blue');
    expect(isGrounded(stacked, at(2, 5, 0))).toBe(true);
    // Rotation 1 rests only when *both* columns are blocked below.
    expect(isGrounded(stacked, at(2, 5, 1))).toBe(true);
    expect(moveDown(stacked, at(3, 5, 3))).toBeNull();
  });
});

describe('rotation', () => {
  it('rotates in place when there is room', () => {
    const board = empty();
    expect(rotate(board, at(2, 5, 0), 'cw')).toEqual(at(2, 5, 1));
    expect(rotate(board, at(2, 5, 1), 'cw')).toEqual(at(2, 5, 2));
    expect(rotate(board, at(2, 5, 2), 'cw')).toEqual(at(2, 5, 3));
    expect(rotate(board, at(2, 5, 3), 'cw')).toEqual(at(2, 5, 0));
    expect(rotate(board, at(2, 5, 0), 'ccw')).toEqual(at(2, 5, 3));
  });

  it('kicks off the left wall instead of refusing', () => {
    // Child would land at x = -1; the pair shoves itself right by one.
    expect(rotate(empty(), at(0, 5, 0), 'ccw')).toEqual(at(1, 5, 3));
  });

  it('kicks off the right wall instead of refusing', () => {
    expect(rotate(empty(), at(WIDTH - 1, 5, 0), 'cw')).toEqual(at(WIDTH - 2, 5, 1));
  });

  it('kicks up off the floor', () => {
    const piece = at(2, HEIGHT - 1, 1);
    expect(rotate(empty(), piece, 'cw')).toEqual(at(2, HEIGHT - 2, 2));
  });

  it('kicks away from a neighbouring puyo', () => {
    const board = setCell(empty(), 3, 5, 'blue');
    expect(rotate(board, at(2, 5, 0), 'cw')).toEqual(at(1, 5, 1));
  });

  it('refuses when the kick target is also blocked', () => {
    // Wedged between two puyos: one kick is all this implementation tries, so
    // this rotation is refused rather than flipped 180 degrees.
    const wedged = setCell(setCell(empty(), 3, 5, 'blue'), 1, 5, 'blue');
    expect(rotate(wedged, at(2, 5, 0), 'cw')).toBeNull();
    expect(rotate(wedged, at(2, 5, 0), 'ccw')).toBeNull();
  });

  it('refuses when the kick would leave the board', () => {
    const board = setCell(empty(), 1, 5, 'blue');
    expect(rotate(board, at(0, 5, 0), 'cw')).toBeNull();
  });
});

describe('locking a piece into the board', () => {
  it('writes both puyos', () => {
    const board = lockPiece(bottom('......'), at(2, HEIGHT - 1, 0));
    // Bottom two rows: the green child sits on top of the red axis.
    expect(formatBoard(board).split('\n').slice(-2)).toEqual(['..G...', '..R...']);
  });

  it('throws rather than overwriting an occupied cell', () => {
    const board = setCell(empty(), 2, 5, 'blue');
    expect(() => lockPiece(board, at(2, 5, 0))).toThrow(RangeError);
  });

  it('leaves the original board untouched', () => {
    const before = empty();
    lockPiece(before, at(2, HEIGHT - 1, 0));
    expect(fits(before, at(2, HEIGHT - 1, 0))).toBe(true);
  });
});
