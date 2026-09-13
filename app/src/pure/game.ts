// The rules. Every function takes a game and returns a new one.
//
// Nothing here reads a clock, generates randomness or touches the DOM, which is
// what lets the whole rule set be tested without a browser and without a fake
// timer. scripts/clock-boundary.mjs is what keeps it that way.

import type { Board, Game } from "./types";
import { createBoard, inBounds, indexOf, neighbours } from "./board";

export function newGame(width: number, height: number, mines: Iterable<number>): Game {
  const board = createBoard(width, height, mines);
  return { board, status: "playing", mines: board.cells.filter((c) => c.mine).length };
}

/** Every non-mine cell revealed. The only way to win. */
function isWon(board: Board): boolean {
  return board.cells.every((c) => c.mine || c.state === "revealed");
}

/**
 * Reveal a cell, opening the surrounding region when it has no mines beside it.
 *
 * A flagged cell is left alone. That is a rule, not an oversight: flagging is
 * how a player records a belief, and a flood fill that stepped over flags would
 * silently overwrite it -- and could end the game on a cell the player had
 * explicitly marked as dangerous.
 */
export function reveal(game: Game, x: number, y: number): Game {
  if (game.status !== "playing") return game;
  const { board } = game;
  if (!inBounds(board, x, y)) return game;

  const start = indexOf(board, x, y);
  const clicked = board.cells[start];
  if (clicked.state !== "hidden") return game;

  const cells = board.cells.slice();

  if (clicked.mine) {
    cells[start] = { ...clicked, state: "revealed" };
    return { ...game, board: { ...board, cells }, status: "lost" };
  }

  // Iterative flood fill. Recursion reads better and overflows the stack on a
  // large board of zeroes, which is exactly the board this branch exists for.
  const stack: [number, number][] = [[x, y]];
  while (stack.length > 0) {
    const [cx, cy] = stack.pop()!;
    const i = indexOf(board, cx, cy);
    const cell = cells[i];
    if (cell.state !== "hidden") continue;
    if (cell.mine) continue;
    cells[i] = { ...cell, state: "revealed" };
    if (cell.adjacent === 0) {
      for (const [nx, ny] of neighbours(board, cx, cy)) stack.push([nx, ny]);
    }
  }

  const next: Board = { ...board, cells };
  return { ...game, board: next, status: isWon(next) ? "won" : "playing" };
}

/** Flag or unflag a hidden cell. A revealed cell cannot be flagged. */
export function toggleFlag(game: Game, x: number, y: number): Game {
  if (game.status !== "playing") return game;
  const { board } = game;
  if (!inBounds(board, x, y)) return game;

  const i = indexOf(board, x, y);
  const cell = board.cells[i];
  if (cell.state === "revealed") return game;

  const cells = board.cells.slice();
  cells[i] = { ...cell, state: cell.state === "flagged" ? "hidden" : "flagged" };
  return { ...game, board: { ...board, cells } };
}

export function flagsPlaced(game: Game): number {
  return game.board.cells.filter((c) => c.state === "flagged").length;
}

/**
 * Mines the player has yet to account for, against a declared total.
 *
 * The total is a parameter because the board does not always know it. Mines are
 * laid on the first click, so before that click the board genuinely holds none
 * -- and a readout taken from the board showed `0` on a fresh 10-mine game.
 * That was found by opening the app in a browser, not by this suite: the count
 * shown came from the shell, which is the one part the pure core cannot reach.
 * Taking the total as an argument moves the arithmetic back in here.
 *
 * Goes negative when the player over-flags, deliberately: clamping at zero
 * would hide the fact that there are more flags on the board than mines under
 * it, which is the moment the number becomes useful.
 */
export function remainingAgainst(total: number, game: Game): number {
  return total - flagsPlaced(game);
}

/** Remaining against the board's own mines, once they have been laid. */
export function minesRemaining(game: Game): number {
  return remainingAgainst(game.mines, game);
}
