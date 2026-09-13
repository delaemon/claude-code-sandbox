// Board geometry and construction. No clocks, no randomness, no DOM.
//
// The mine positions arrive as indices from the caller. That is the whole
// reason this file is testable: choosing them needs a random source, and a
// random source is the thing `pure/` is not allowed to have. `pickMines` in
// rng.ts takes its randomness as an argument for the same reason.

import type { Board, Cell, Dimensions } from "./types";

/** Row-major index. The one place that knows the layout. */
export function indexOf(dims: Dimensions, x: number, y: number): number {
  return y * dims.width + x;
}

export function inBounds(dims: Dimensions, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < dims.width && y < dims.height;
}

const OFFSETS: readonly (readonly [number, number])[] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/** The up-to-eight neighbours of a cell, clipped to the board. */
export function neighbours(dims: Dimensions, x: number, y: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [dx, dy] of OFFSETS) {
    const nx = x + dx;
    const ny = y + dy;
    if (inBounds(dims, nx, ny)) out.push([nx, ny]);
  }
  return out;
}

/**
 * Build a board with mines at the given indices.
 *
 * Throws on anything it cannot build honestly -- a zero dimension, an index
 * outside the board. Returning a board that quietly dropped a mine would make
 * the mine count in the status bar disagree with the board underneath it, and
 * the game would become unwinnable in a way nothing reports.
 */
export function createBoard(width: number, height: number, mines: Iterable<number>): Board {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`board must be at least 1x1, got ${width}x${height}`);
  }
  const dims: Dimensions = { width, height };
  const total = width * height;
  const mineSet = new Set(mines);
  for (const index of mineSet) {
    if (!Number.isInteger(index) || index < 0 || index >= total) {
      throw new RangeError(`mine index ${index} is outside a ${width}x${height} board`);
    }
  }

  const cells: Cell[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let adjacent = 0;
      for (const [nx, ny] of neighbours(dims, x, y)) {
        if (mineSet.has(indexOf(dims, nx, ny))) adjacent++;
      }
      cells.push({ mine: mineSet.has(indexOf(dims, x, y)), adjacent, state: "hidden" });
    }
  }
  return { width, height, cells };
}
