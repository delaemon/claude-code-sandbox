// What each cell should show. A pure function from state to face.
//
// This file exists because of docs/LEDGER.md row 3: a renderer that ignored its
// palette entirely, with colour tests that passed because they asserted against
// the same palette. The lesson taken from it was that presentation *logic* --
// which of several faces a cell shows, and when -- is behaviour and belongs
// somewhere it can be tested, while the palette itself is data and proving
// anything about it by permuting it is circular.
//
// So: which face, here, under test. What colour a `n3` is, in the stylesheet.

import type { Cell, Game, Status } from "./types";

export interface Face {
  /** The character in the cell. Empty for an unopened or empty one. */
  readonly text: string;
  /** The class the stylesheet keys off. Never carries a colour itself. */
  readonly kind: string;
}

const HIDDEN: Face = { text: "", kind: "hidden" };
const FLAG: Face = { text: "⚑", kind: "flagged" };
const MINE: Face = { text: "✹", kind: "mine" };
const BLOWN: Face = { text: "✹", kind: "mine blown" };
const WRONG: Face = { text: "✗", kind: "flagged wrong" };
const EMPTY: Face = { text: "", kind: "open" };

/**
 * The face for one cell.
 *
 * Order matters and is the part worth testing. While the game is on, a flag
 * hides whatever is under it -- including a mine, which is the entire point of
 * a flag. Once the game is over the board is opened up: unflagged mines show,
 * and flags on cells that held no mine are marked as the mistakes they were.
 */
export function cellFace(cell: Cell, status: Status): Face {
  if (status === "playing") {
    if (cell.state === "flagged") return FLAG;
    if (cell.state === "hidden") return HIDDEN;
    if (cell.mine) return BLOWN;
    return cell.adjacent === 0 ? EMPTY : { text: String(cell.adjacent), kind: `open n${cell.adjacent}` };
  }

  if (cell.state === "flagged") return cell.mine ? FLAG : WRONG;
  if (cell.mine) return cell.state === "revealed" ? BLOWN : MINE;
  if (cell.state !== "revealed") return HIDDEN;
  return cell.adjacent === 0 ? EMPTY : { text: String(cell.adjacent), kind: `open n${cell.adjacent}` };
}

/**
 * Elapsed time as m:ss.
 *
 * Takes milliseconds rather than reading a clock, so it is a pure function of
 * its argument and main.ts is left as the only file that knows what time it is.
 * Negative input is clamped: a clock that steps backwards is a real thing on a
 * laptop waking from sleep, and `-1:-3` on screen would be worse than `0:00`.
 */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** The line above the board. Pure, so what it says is a test rather than a look. */
export function statusText(game: Game): string {
  if (game.status === "won") return "Cleared";
  if (game.status === "lost") return "Boom";
  return "Playing";
}
