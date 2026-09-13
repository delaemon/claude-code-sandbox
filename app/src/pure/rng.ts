// Randomness as a value, so the rest of the core can stay pure.
//
// `Math.random` lives in main.ts and nowhere else -- scripts/clock-boundary.mjs
// enforces it. What main.ts passes in is a *seed*, and everything downstream is
// a deterministic function of it. So a game that went wrong can be replayed
// exactly by its seed, and the tests need no mocking to get a board they can
// make assertions about.

import type { Dimensions } from "./types";
import { indexOf, neighbours } from "./board";

/** A source of numbers in [0, 1). The signature `Math.random` happens to have. */
export type Rng = () => number;

/**
 * mulberry32: small, fast, and good enough for placing mines.
 *
 * Chosen because it is a pure function of a 32-bit seed with no global state --
 * two runs from the same seed are the same game, in this process or another.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Choose `count` distinct mine positions.
 *
 * When `safe` is given, that cell and its neighbours are kept clear, so the
 * first click always opens a region rather than ending the game on move one.
 * A board too crowded for that falls back to keeping only the clicked cell
 * clear, and throws only when even that is impossible -- degrading is right
 * here, but degrading silently past the point where the request cannot be met
 * is not.
 */
export function pickMines(
  dims: Dimensions,
  count: number,
  rng: Rng,
  safe?: number,
): number[] {
  const total = dims.width * dims.height;
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`mine count must be a non-negative integer, got ${count}`);
  }
  if (count > total - 1) {
    throw new RangeError(`${count} mines will not fit on a ${dims.width}x${dims.height} board`);
  }

  let forbidden = new Set<number>();
  if (safe !== undefined) {
    forbidden.add(safe);
    const x = safe % dims.width;
    const y = Math.floor(safe / dims.width);
    for (const [nx, ny] of neighbours(dims, x, y)) forbidden.add(indexOf(dims, nx, ny));
    // Too crowded to keep the whole opening clear: keep the clicked cell only.
    if (total - forbidden.size < count) forbidden = new Set([safe]);
  }

  const pool: number[] = [];
  for (let i = 0; i < total; i++) if (!forbidden.has(i)) pool.push(i);

  // Fisher-Yates, so every arrangement is equally likely. Drawing with retries
  // would also work and would take unbounded time on a nearly-full board.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = pool[i];
    pool[i] = pool[j];
    pool[j] = swap;
  }
  return pool.slice(0, count).sort((a, b) => a - b);
}

/**
 * A seed pinned in the query string, or null for "draw a fresh one".
 *
 * The footer has always claimed the same seed lays the same board. It was true
 * and unusable: the seed could be read and not supplied, so a board worth
 * complaining about could not actually be reproduced by anyone the complaint
 * reached. It also left the browser gate at the mercy of whatever board it got
 * -- it right-clicked a fixed cell, the opening fill sometimes reached that
 * cell first, and the gate failed at random on correct code.
 *
 * Anything that is not a whole number in range is refused rather than coerced.
 * `?seed=abc` becoming seed 0 would be a silently different board from the one
 * whoever pasted the link was looking at, which is the entire point of a seed.
 */
export function parseSeed(search: string): number | null {
  const raw = new URLSearchParams(search).get("seed");
  if (raw === null || raw.trim() === "") return null;
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) return null;
  return value;
}
