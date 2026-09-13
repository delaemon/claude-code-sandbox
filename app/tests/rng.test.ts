import { describe, expect, it } from "vitest";
import { indexOf, neighbours } from "../src/pure/board";
import { mulberry32, parseSeed, pickMines } from "../src/pure/rng";

const dims = { width: 9, height: 9 };

describe("mulberry32", () => {
  it("gives the same stream for the same seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const first = Array.from({ length: 20 }, () => a());
    const second = Array.from({ length: 20 }, () => b());
    expect(first).toEqual(second);
  });

  it("gives a different stream for a different seed", () => {
    const a = Array.from({ length: 20 }, mulberry32(1));
    const b = Array.from({ length: 20 }, mulberry32(2));
    expect(a).not.toEqual(b);
  });

  it("stays inside [0, 1)", () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 5000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("does not collapse onto one value", () => {
    // A generator returning a constant satisfies "same seed, same stream" and
    // "inside [0,1)" perfectly well, and would place every mine in one spot.
    const rng = mulberry32(7);
    const seen = new Set(Array.from({ length: 200 }, () => rng()));
    expect(seen.size).toBeGreaterThan(150);
  });
});

describe("pickMines", () => {
  it("returns exactly the number asked for, all distinct and in range", () => {
    const mines = pickMines(dims, 10, mulberry32(42));
    expect(mines).toHaveLength(10);
    expect(new Set(mines).size).toBe(10);
    for (const m of mines) {
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThan(81);
    }
  });

  it("is a function of the seed alone", () => {
    expect(pickMines(dims, 10, mulberry32(42))).toEqual(pickMines(dims, 10, mulberry32(42)));
    expect(pickMines(dims, 10, mulberry32(42))).not.toEqual(pickMines(dims, 10, mulberry32(43)));
  });

  it("keeps the first click and all its neighbours clear", () => {
    const safe = indexOf(dims, 4, 4);
    const clear = new Set([safe, ...neighbours(dims, 4, 4).map(([x, y]) => indexOf(dims, x, y))]);
    // Across many seeds, not one: a single seed that happens to avoid the
    // opening proves nothing about the exclusion.
    for (let seed = 0; seed < 200; seed++) {
      for (const mine of pickMines(dims, 10, mulberry32(seed), safe)) {
        expect(clear.has(mine)).toBe(false);
      }
    }
  });

  it("falls back to keeping only the clicked cell clear when the board is full", () => {
    // 3x3, 8 mines: the opening cannot be kept clear, but the click itself can.
    const small = { width: 3, height: 3 };
    const safe = indexOf(small, 1, 1);
    const mines = pickMines(small, 8, mulberry32(5), safe);
    expect(mines).toHaveLength(8);
    expect(mines).not.toContain(safe);
  });

  it("spreads mines around rather than always choosing the same cells", () => {
    const counts = new Map<number, number>();
    for (let seed = 0; seed < 300; seed++) {
      for (const m of pickMines(dims, 10, mulberry32(seed))) {
        counts.set(m, (counts.get(m) ?? 0) + 1);
      }
    }
    expect(counts.size).toBeGreaterThan(60);
  });

  it("refuses a count that cannot fit", () => {
    expect(() => pickMines({ width: 3, height: 3 }, 9, mulberry32(1))).toThrow(RangeError);
    expect(() => pickMines(dims, -1, mulberry32(1))).toThrow(RangeError);
    expect(() => pickMines(dims, 1.5, mulberry32(1))).toThrow(RangeError);
  });

  it("returns nothing for a count of zero", () => {
    expect(pickMines(dims, 0, mulberry32(1))).toEqual([]);
  });
});

describe("parseSeed", () => {
  it("reads a seed out of a query string", () => {
    expect(parseSeed("?seed=12345")).toBe(12345);
    expect(parseSeed("?level=Expert&seed=7")).toBe(7);
    expect(parseSeed("?seed=0")).toBe(0);
    expect(parseSeed("?seed=4294967295")).toBe(4294967295);
  });

  it("says nothing is pinned when nothing is", () => {
    expect(parseSeed("")).toBeNull();
    expect(parseSeed("?level=Expert")).toBeNull();
    expect(parseSeed("?seed=")).toBeNull();
  });

  it("refuses a seed it cannot honour rather than coercing it", () => {
    // `?seed=abc` quietly becoming 0 would lay a different board from the one
    // the person who sent the link was looking at, which is the whole point of
    // having a seed at all.
    expect(parseSeed("?seed=abc")).toBeNull();
    expect(parseSeed("?seed=-1")).toBeNull();
    expect(parseSeed("?seed=1.5")).toBeNull();
    expect(parseSeed("?seed=4294967296")).toBeNull();
    expect(parseSeed("?seed=1e3")).toBeNull();
  });

  it("lays the identical board for a pinned seed", () => {
    const pinned = parseSeed("?seed=2024");
    expect(pinned).not.toBeNull();
    expect(pickMines(dims, 10, mulberry32(pinned!))).toEqual(
      pickMines(dims, 10, mulberry32(2024)),
    );
  });
});
