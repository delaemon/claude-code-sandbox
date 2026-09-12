/**
 * A seeded pseudo-random generator, so the queue has something to be injected
 * with that is reproducible. Deliberately *not* used by default anywhere:
 * callers pass whatever `() => number` they like. `Math.random` appears
 * nowhere under `src/game/`.
 */

/** mulberry32: small, fast, and identical across runs for the same seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
