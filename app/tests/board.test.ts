import { describe, expect, it } from "vitest";
import { createBoard, inBounds, indexOf, neighbours } from "../src/pure/board";

const dims = { width: 4, height: 3 };

describe("indexOf", () => {
  it("is row-major", () => {
    expect(indexOf(dims, 0, 0)).toBe(0);
    expect(indexOf(dims, 3, 0)).toBe(3);
    expect(indexOf(dims, 0, 1)).toBe(4);
    expect(indexOf(dims, 2, 2)).toBe(10);
  });
});

describe("inBounds", () => {
  it("accepts the corners and rejects one step past each edge", () => {
    expect(inBounds(dims, 0, 0)).toBe(true);
    expect(inBounds(dims, 3, 2)).toBe(true);
    expect(inBounds(dims, -1, 0)).toBe(false);
    expect(inBounds(dims, 0, -1)).toBe(false);
    expect(inBounds(dims, 4, 0)).toBe(false);
    expect(inBounds(dims, 0, 3)).toBe(false);
  });
});

describe("neighbours", () => {
  // Counting them is not enough: a missing offset and a duplicated one both
  // give eight. The sets are compared.
  const asSet = (list: [number, number][]) => new Set(list.map(([x, y]) => `${x},${y}`));

  it("gives all eight around an interior cell", () => {
    expect(asSet(neighbours(dims, 1, 1))).toEqual(
      new Set(["0,0", "1,0", "2,0", "0,1", "2,1", "0,2", "1,2", "2,2"]),
    );
  });

  it("clips at a corner", () => {
    expect(asSet(neighbours(dims, 0, 0))).toEqual(new Set(["1,0", "0,1", "1,1"]));
    expect(asSet(neighbours(dims, 3, 2))).toEqual(new Set(["2,2", "3,1", "2,1"]));
  });

  it("clips along an edge", () => {
    expect(asSet(neighbours(dims, 2, 0))).toEqual(
      new Set(["1,0", "3,0", "1,1", "2,1", "3,1"]),
    );
  });

  it("never includes the cell itself", () => {
    for (let y = 0; y < dims.height; y++) {
      for (let x = 0; x < dims.width; x++) {
        expect(asSet(neighbours(dims, x, y)).has(`${x},${y}`)).toBe(false);
      }
    }
  });
});

describe("createBoard", () => {
  // . * .
  // . . .
  // . . *
  const board = createBoard(3, 3, [1, 8]);

  it("marks exactly the cells it was given", () => {
    expect(board.cells.map((c) => c.mine)).toEqual([
      false, true, false,
      false, false, false,
      false, false, true,
    ]);
  });

  it("counts adjacent mines for every cell, including mined ones", () => {
    expect(board.cells.map((c) => c.adjacent)).toEqual([
      1, 0, 1,
      1, 2, 2,
      0, 1, 0,
    ]);
  });

  it("starts every cell hidden", () => {
    expect(board.cells.every((c) => c.state === "hidden")).toBe(true);
  });

  it("counts a mine in every one of the eight directions", () => {
    // A board whose entire border is mined, with one clear centre. Any dropped
    // offset shows up as 7 rather than 8 -- and unlike a single-mine fixture,
    // this cannot be satisfied by an offset table that is merely the wrong
    // shape in a symmetric way.
    const ring = [0, 1, 2, 3, 5, 6, 7, 8];
    expect(createBoard(3, 3, ring).cells[4].adjacent).toBe(8);
  });

  it("refuses a mine index off the board", () => {
    expect(() => createBoard(3, 3, [9])).toThrow(RangeError);
    expect(() => createBoard(3, 3, [-1])).toThrow(RangeError);
  });

  it("refuses a board with no cells", () => {
    expect(() => createBoard(0, 5, [])).toThrow(RangeError);
    expect(() => createBoard(5, 0, [])).toThrow(RangeError);
  });

  it("ignores a repeated mine index rather than double-counting it", () => {
    const once = createBoard(3, 3, [4]);
    const twice = createBoard(3, 3, [4, 4]);
    expect(twice.cells.map((c) => c.adjacent)).toEqual(once.cells.map((c) => c.adjacent));
  });
});
