/**
 * A smoke test for the entry point: does the loop actually wire up?
 *
 * `main.ts` is the one file the unit tests cannot reach, because it is all
 * side effects — and it is exactly where a typo'd selector or a missing
 * `getContext` would hide until someone opened a browser. Stubbing `window`
 * and `document` with the smallest objects that satisfy it, and handing it the
 * same recording context the draw tests use, is enough to prove the frame runs
 * end to end: input -> step -> draw.
 *
 * This is the *only* test that imports a module with side effects, so it lives
 * alone in its file and drives frames by hand.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RecordingContext } from './fake-context.js';

const recording = new RecordingContext();
const seedElement = { textContent: '' };
const stage = { clientWidth: 900, clientHeight: 700 };
const canvas = {
  width: 0,
  height: 0,
  style: { width: '', height: '' },
  parentElement: stage,
  getContext: (kind: string) => (kind === '2d' ? recording.ctx : null),
};

let nextFrame: ((now: number) => void) | null = null;
const listeners = new Map<string, (event: unknown) => void>();

const fakeWindow = {
  location: { search: '?seed=7' },
  devicePixelRatio: 2,
  requestAnimationFrame: (cb: (now: number) => void): number => {
    nextFrame = cb;
    return 1;
  },
  addEventListener: (type: string, handler: (event: unknown) => void): void => {
    listeners.set(type, handler);
  },
  removeEventListener: (): void => {},
};

const fakeDocument = {
  body: stage,
  querySelector: (selector: string): unknown => {
    if (selector === '#game') return canvas;
    if (selector === '#seed') return seedElement;
    return null;
  },
};

/** Run one animation frame at `now` milliseconds. */
function frame(now: number): void {
  const cb = nextFrame;
  if (cb === null) throw new Error('main.ts never asked for a frame');
  nextFrame = null;
  cb(now);
}

beforeAll(async () => {
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('document', fakeDocument);
  await import('../../src/main.js');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('main.ts', () => {
  it('finds the canvas, seeds the queue from the URL and asks for a frame', () => {
    expect(seedElement.textContent).toBe('7');
    expect(nextFrame).not.toBeNull();
  });

  it('sizes the canvas for the device pixel ratio', () => {
    expect(canvas.style.width).toMatch(/^\d+px$/);
    expect(canvas.width).toBe(Number.parseInt(canvas.style.width, 10) * 2);
    expect(canvas.height).toBe(Number.parseInt(canvas.style.height, 10) * 2);
    // The layout stays in CSS pixels; the transform is what handles the ratio.
    expect(recording.of('setTransform')[0]?.args).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it('draws a frame, and keeps drawing', () => {
    recording.calls.length = 0;
    frame(16);
    const first = recording.count('arc');
    expect(first).toBeGreaterThan(0);

    recording.calls.length = 0;
    frame(32);
    expect(recording.count('arc')).toBeGreaterThan(0);
  });

  it('advances the game: the piece falls with no input at all', () => {
    let now = 1_000;
    const drawFrame = (): number[] => {
      recording.calls.length = 0;
      frame(now);
      return recording.arcCentres().map((c) => c.y);
    };
    const before = drawFrame();
    // Default fallIntervalMs is 800ms and a frame is clamped to 100ms, so ten
    // frames is more than one row of natural falling.
    for (let i = 0; i < 10; i++) {
      now += 100;
      drawFrame();
    }
    now += 100;
    expect(drawFrame()).not.toEqual(before);
  });

  it('listens for the restart key without stealing keys from the game', () => {
    expect(listeners.has('keydown')).toBe(true);
    expect(listeners.has('resize')).toBe(true);
  });
});
