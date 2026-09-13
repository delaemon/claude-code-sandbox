import { describe, expect, it } from "vitest";
import { indexOf } from "../src/pure/board";
import { flagsPlaced, minesRemaining, newGame, remainingAgainst, reveal, toggleFlag } from "../src/pure/game";
import type { Game } from "../src/pure/types";

const stateAt = (g: Game, x: number, y: number) => g.board.cells[indexOf(g.board, x, y)].state;
const revealedCount = (g: Game) => g.board.cells.filter((c) => c.state === "revealed").length;

describe("reveal", () => {
  it("opens only the clicked cell when a mine is beside it", () => {
    // * . .   clicking (1,0) touches the mine at (0,0), so it shows a 1 and
    // . . .   nothing else opens.
    // . . .
    const after = reveal(newGame(3, 3, [0]), 1, 0);
    expect(stateAt(after, 1, 0)).toBe("revealed");
    expect(revealedCount(after)).toBe(1);
    expect(after.status).toBe("playing");
  });

  it("opens the whole empty region and the numbered cells bordering it", () => {
    // A 5x5 with one mine in the top-left corner. Clicking the far corner
    // should open everything except the mine.
    const after = reveal(newGame(5, 5, [0]), 4, 4);
    expect(revealedCount(after)).toBe(24);
    expect(stateAt(after, 0, 0)).toBe("hidden");
  });

  it("stops the flood fill at a flagged cell", () => {
    // The flag is a belief the player recorded. A fill that stepped over it
    // would erase that, and could open a cell they had marked as dangerous.
    let g = newGame(5, 5, [0]);
    g = toggleFlag(g, 3, 3);
    g = reveal(g, 4, 4);
    expect(stateAt(g, 3, 3)).toBe("flagged");
  });

  it("loses on a mine, revealing that one cell", () => {
    const after = reveal(newGame(3, 3, [4]), 1, 1);
    expect(after.status).toBe("lost");
    expect(stateAt(after, 1, 1)).toBe("revealed");
  });

  it("wins only once every cell without a mine is open", () => {
    // 2x2 with a single mine in the corner. Every other cell touches it, so
    // every cell has a count and nothing opens by flood fill -- which makes
    // the sequence below exactly three moves, with the win landing on the
    // third and not before.
    //
    // The 3x3 board this test first used was not that: clicking a zero opened
    // a region, the last safe cell came up early, and the test failed against
    // correct code. Choosing a fixture with no flood fill is the point.
    let g = newGame(2, 2, [0]);
    // The mine itself has nothing beside it; the other three each touch it.
    expect(g.board.cells.map((c) => c.adjacent)).toEqual([0, 1, 1, 1]);

    g = reveal(g, 1, 0);
    expect(g.status).toBe("playing");
    g = reveal(g, 0, 1);
    expect(g.status).toBe("playing");
    g = reveal(g, 1, 1);
    expect(g.status).toBe("won");
    expect(revealedCount(g)).toBe(3);
  });

  it("does not win while a safe cell is merely flagged", () => {
    // Flagging is not opening. A win test that counted unopened-and-unflagged
    // cells would pass this by mistake.
    let g = newGame(2, 2, [0]);
    g = reveal(g, 1, 0);
    g = reveal(g, 0, 1);
    g = toggleFlag(g, 1, 1);
    expect(g.status).toBe("playing");
  });

  it("does nothing to a flagged cell", () => {
    let g = newGame(3, 3, [4]);
    g = toggleFlag(g, 1, 1);
    const after = reveal(g, 1, 1);
    expect(after).toBe(g);
    expect(after.status).toBe("playing");
  });

  it("does nothing once the game is over", () => {
    const lost = reveal(newGame(3, 3, [4]), 1, 1);
    expect(reveal(lost, 0, 0)).toBe(lost);
  });

  it("does nothing outside the board", () => {
    const g = newGame(3, 3, [4]);
    expect(reveal(g, -1, 0)).toBe(g);
    expect(reveal(g, 3, 0)).toBe(g);
    expect(reveal(g, 0, 3)).toBe(g);
  });

  it("leaves the game it was given untouched", () => {
    // Every caller holds the previous game; an in-place update would make the
    // renderer's "has anything changed" comparison always say no.
    const before = newGame(5, 5, [0]);
    const snapshot = before.board.cells.map((c) => c.state);
    reveal(before, 4, 4);
    expect(before.board.cells.map((c) => c.state)).toEqual(snapshot);
  });
});

describe("toggleFlag", () => {
  it("flags a hidden cell and unflags it again", () => {
    let g = newGame(3, 3, [4]);
    g = toggleFlag(g, 0, 0);
    expect(stateAt(g, 0, 0)).toBe("flagged");
    g = toggleFlag(g, 0, 0);
    expect(stateAt(g, 0, 0)).toBe("hidden");
  });

  it("will not flag a revealed cell", () => {
    let g = reveal(newGame(3, 3, [0]), 1, 0);
    g = toggleFlag(g, 1, 0);
    expect(stateAt(g, 1, 0)).toBe("revealed");
  });

  it("does nothing once the game is over", () => {
    const lost = reveal(newGame(3, 3, [4]), 1, 1);
    expect(toggleFlag(lost, 0, 0)).toBe(lost);
  });
});

describe("counting", () => {
  it("reports mines yet to be flagged", () => {
    let g = newGame(5, 5, [0, 1, 2]);
    expect(minesRemaining(g)).toBe(3);
    g = toggleFlag(g, 0, 0);
    expect(flagsPlaced(g)).toBe(1);
    expect(minesRemaining(g)).toBe(2);
  });

  it("counts against a declared total on a board whose mines are not laid yet", () => {
    // The shell lays mines on the first click, so a fresh game's board really
    // does hold none. Reading the total off the board showed 0 mines remaining
    // on a 10-mine game -- found in a browser, not here, because the number
    // was computed in main.ts. It is computed in this file now.
    const fresh = newGame(9, 9, []);
    expect(remainingAgainst(10, fresh)).toBe(10);
    expect(minesRemaining(fresh)).toBe(0);

    const flagged = toggleFlag(fresh, 0, 0);
    expect(remainingAgainst(10, flagged)).toBe(9);
  });

  it("goes negative rather than clamping when over-flagged", () => {
    // Clamping would hide the moment the information becomes useful: more
    // flags on the board than there are mines under it.
    let g = newGame(5, 5, [0]);
    g = toggleFlag(g, 1, 1);
    g = toggleFlag(g, 2, 2);
    expect(minesRemaining(g)).toBe(-1);
  });
});
