import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLORS,
  createQueue,
  mulberry32,
  nextPair,
  queueColors,
  queueTake,
  upcoming,
} from '../../src/game/index.js';

/** An rng that walks a fixed script, so a test can name the colours it wants. */
const scripted = (values: readonly number[]): (() => number) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe('piece queue', () => {
  it('draws pairs from the injected rng, not from Math.random', () => {
    // Four colours: 0 -> red, 0.25 -> green, 0.5 -> blue, 0.75 -> yellow.
    const queue = createQueue(scripted([0, 0.25, 0.5, 0.75]));
    expect(upcoming(queue, 2)).toEqual([
      { axis: 'red', child: 'green' },
      { axis: 'blue', child: 'yellow' },
    ]);
  });

  it('is reproducible from a seed', () => {
    const a = upcoming(createQueue(mulberry32(1234)), 5);
    const b = upcoming(createQueue(mulberry32(1234)), 5);
    expect(a).toEqual(b);
    expect(upcoming(createQueue(mulberry32(9999)), 5)).not.toEqual(a);
  });

  it('previews without consuming', () => {
    const queue = createQueue(mulberry32(7), { previewSize: 3 });
    const preview = upcoming(queue);
    expect(preview).toHaveLength(3);
    expect(nextPair(queue)).toEqual(preview[0]);
    expect(upcoming(queue)).toEqual(preview);
    expect(queue.index).toBe(0);
  });

  it('advances by one on take, and the preview shifts by one', () => {
    const queue = createQueue(mulberry32(7), { previewSize: 3 });
    const before = upcoming(queue, 4);
    const { pair, queue: after } = queueTake(queue);
    expect(pair).toEqual(before[0]);
    expect(after.index).toBe(1);
    expect(upcoming(after, 3)).toEqual(before.slice(1));
  });

  it('is referentially transparent: the same queue value always yields the same pair', () => {
    const queue = createQueue(mulberry32(3));
    const first = queueTake(queue);
    const again = queueTake(queue);
    expect(again.pair).toEqual(first.pair);
    // Replaying from an older queue value replays the same pieces.
    expect(queueTake(first.queue).pair).toEqual(queueTake(again.queue).pair);
  });

  it('uses four colours by default and honours a custom palette', () => {
    expect(DEFAULT_COLORS).toEqual(['red', 'green', 'blue', 'yellow']);
    const queue = createQueue(mulberry32(11), { colors: ['red', 'blue'] });
    expect(queueColors(queue)).toEqual(['red', 'blue']);
    for (const pair of upcoming(queue, 20)) {
      expect(['red', 'blue']).toContain(pair.axis);
      expect(['red', 'blue']).toContain(pair.child);
    }
  });

  it('rejects an rng that steps outside [0, 1) and an empty palette', () => {
    expect(() => nextPair(createQueue(() => 1))).toThrow(RangeError);
    expect(() => nextPair(createQueue(() => -0.1))).toThrow(RangeError);
    expect(() => createQueue(mulberry32(1), { colors: [] })).toThrow(RangeError);
  });
});
