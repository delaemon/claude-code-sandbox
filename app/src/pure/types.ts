// The shapes the pure core works in.
//
// Everything here is readonly and every function in `pure/` returns a new
// value rather than editing one. That is not taste: the renderer compares the
// game it was last given against the one it is given now, and a mutated board
// is the same object, so an in-place update renders as no change at all.

export type CellState = "hidden" | "revealed" | "flagged";

export interface Cell {
  readonly mine: boolean;
  /** Mines among the up-to-eight neighbours. Counted for mined cells too. */
  readonly adjacent: number;
  readonly state: CellState;
}

/** Cells are row-major: index = y * width + x. Nothing may assume otherwise. */
export interface Board {
  readonly width: number;
  readonly height: number;
  readonly cells: readonly Cell[];
}

export type Status = "playing" | "won" | "lost";

export interface Game {
  readonly board: Board;
  readonly status: Status;
  /** How many mines the board was built with, independent of what is flagged. */
  readonly mines: number;
}

export interface Dimensions {
  readonly width: number;
  readonly height: number;
}
