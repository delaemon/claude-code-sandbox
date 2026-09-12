/**
 * Gravity: cells fall straight down within their own column until they rest on
 * the floor or on another cell. Column order and relative order within a column
 * are preserved; only the gaps are squeezed out.
 */

import { boardWidth, cloneMutable, type Board, type Cell } from './board.js';

/** True if any cell in `board` has empty space directly below it. */
export function hasFloatingCells(board: Board): boolean {
  const width = boardWidth(board);
  for (let y = 0; y < board.length - 1; y++) {
    for (let x = 0; x < width; x++) {
      if (board[y]![x] !== null && board[y + 1]![x] === null) return true;
    }
  }
  return false;
}

/** A copy of `board` with every floating cell settled downward. */
export function applyGravity(board: Board): Board {
  const width = boardWidth(board);
  const height = board.length;
  const next = cloneMutable(board);

  for (let x = 0; x < width; x++) {
    let write = height - 1;
    for (let y = height - 1; y >= 0; y--) {
      const cell: Cell = next[y]![x]!;
      if (cell !== null) {
        next[write]![x] = cell;
        if (write !== y) next[y]![x] = null;
        write--;
      }
    }
  }

  return next;
}
