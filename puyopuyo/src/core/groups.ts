/**
 * Connected-group detection.
 *
 * Cells connect orthogonally only (up/down/left/right). Diagonals never
 * connect. A group of `POP_THRESHOLD` or more same-coloured connected cells
 * pops.
 */

import {
  boardWidth,
  inBounds,
  type Board,
  type Color,
  type Pos,
} from './board.js';

/** Minimum group size that pops. */
export const POP_THRESHOLD = 4;

/** Orthogonal neighbour offsets. No diagonals — that is the whole point. */
const NEIGHBORS: readonly Pos[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
];

/** A maximal set of connected, same-coloured cells. */
export interface Group {
  readonly color: Color;
  /** Member positions, in row-major order. */
  readonly cells: readonly Pos[];
}

/** The size of a group. */
export function groupSize(group: Group): number {
  return group.cells.length;
}

/**
 * Every maximal same-colour connected group on the board, of any size.
 * Empty cells form no groups.
 */
export function findGroups(board: Board): Group[] {
  const width = boardWidth(board);
  const height = board.length;
  const seen: boolean[][] = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
  const groups: Group[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = board[y]![x];
      if (color === null || color === undefined || seen[y]![x]) continue;

      // Iterative flood fill; recursion would be fine at 6x13 but this keeps
      // the function safe if the board size is ever raised.
      const cells: Pos[] = [];
      const stack: Pos[] = [{ x, y }];
      seen[y]![x] = true;

      while (stack.length > 0) {
        const pos = stack.pop()!;
        cells.push(pos);
        for (const d of NEIGHBORS) {
          const nx = pos.x + d.x;
          const ny = pos.y + d.y;
          if (!inBounds(board, nx, ny) || seen[ny]![nx]) continue;
          if (board[ny]![nx] !== color) continue;
          seen[ny]![nx] = true;
          stack.push({ x: nx, y: ny });
        }
      }

      cells.sort((a, b) => (a.y - b.y) || (a.x - b.x));
      groups.push({ color, cells });
    }
  }

  return groups;
}

/** Groups large enough to pop, in row-major order of their topmost cell. */
export function findPoppableGroups(board: Board, threshold: number = POP_THRESHOLD): Group[] {
  return findGroups(board).filter((g) => g.cells.length >= threshold);
}
