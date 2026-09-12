/**
 * The piece queue.
 *
 * Randomness is **injected**: `createQueue` takes an `rng: () => number`
 * returning values in [0, 1). There is no `Math.random` anywhere under
 * `src/game/` — tests pass a seeded generator (see `rng.ts`).
 *
 * A queue value is an index into a memoised stream of pairs, so `queueTake`
 * is referentially transparent: taking from the same queue value always yields
 * the same pair, however many times the reducer is replayed. The `rng` is
 * consumed once per pair drawn, ever.
 */

import { COLORS, type Color } from '../core/index.js';

/** The two colours of a falling pair: the pivot and the one orbiting it. */
export interface Pair {
  readonly axis: Color;
  readonly child: Color;
}

/** Standard Puyo uses four colours per match, not all five. */
export const DEFAULT_COLORS: readonly Color[] = COLORS.slice(0, 4);

/** How many upcoming pairs a UI can preview by default. */
export const DEFAULT_PREVIEW_SIZE = 2;

/** A lazily generated, memoised, infinite stream of pairs. */
interface PairStream {
  readonly colors: readonly Color[];
  at(index: number): Pair;
}

/** An immutable position in a stream of pairs. */
export interface PieceQueue {
  /** How many pairs have already been taken. */
  readonly index: number;
  /** How many upcoming pairs `upcoming()` returns by default. */
  readonly previewSize: number;
  /** The shared, memoised source. Opaque — compare queues by `index`. */
  readonly stream: PairStream;
}

export interface QueueOptions {
  readonly colors?: readonly Color[];
  readonly previewSize?: number;
}

function createStream(rng: () => number, colors: readonly Color[]): PairStream {
  const cache: Pair[] = [];
  const pick = (): Color => {
    const r = rng();
    if (!Number.isFinite(r) || r < 0 || r >= 1) {
      throw new RangeError(`rng must return a number in [0, 1), got ${r}`);
    }
    return colors[Math.floor(r * colors.length)]!;
  };
  return {
    colors,
    at(index: number): Pair {
      if (!Number.isInteger(index) || index < 0) throw new RangeError(`bad queue index: ${index}`);
      while (cache.length <= index) cache.push({ axis: pick(), child: pick() });
      return cache[index]!;
    },
  };
}

/** A fresh queue drawing from `rng`. */
export function createQueue(rng: () => number, options: QueueOptions = {}): PieceQueue {
  const colors = options.colors ?? DEFAULT_COLORS;
  const previewSize = options.previewSize ?? DEFAULT_PREVIEW_SIZE;
  if (colors.length === 0) throw new RangeError('a queue needs at least one colour');
  if (!Number.isInteger(previewSize) || previewSize < 0) {
    throw new RangeError(`bad previewSize: ${previewSize}`);
  }
  return { index: 0, previewSize, stream: createStream(rng, colors) };
}

/** The pair at the front of `queue`, without taking it. */
export function nextPair(queue: PieceQueue): Pair {
  return queue.stream.at(queue.index);
}

/** The next `count` pairs, front first. For a preview panel. */
export function upcoming(queue: PieceQueue, count: number = queue.previewSize): readonly Pair[] {
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`bad count: ${count}`);
  return Array.from({ length: count }, (_, i) => queue.stream.at(queue.index + i));
}

/** Take the front pair, returning it and the advanced queue. */
export function queueTake(queue: PieceQueue): { readonly pair: Pair; readonly queue: PieceQueue } {
  return { pair: nextPair(queue), queue: { ...queue, index: queue.index + 1 } };
}

/** The colours this queue draws from. */
export function queueColors(queue: PieceQueue): readonly Color[] {
  return queue.stream.colors;
}
