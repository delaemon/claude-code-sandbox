/**
 * Input tests run in Node with no jsdom, no browser and — the point of the
 * module — no timers. A bare `EventTarget` receives synthetic key events, time
 * moves only through `advance(ms)`, and every assertion is on `drain()`. Every
 * test here is deterministic: nothing sleeps, nothing polls, nothing is flaky.
 */

import { describe, expect, it } from 'vitest';
import type { PlayerActionType } from '../../src/game/index.js';
import {
  DEFAULT_ARR_MS,
  DEFAULT_DAS_MS,
  DEFAULT_KEY_MAP,
  DEFAULT_SOFT_DROP_ARR_MS,
  DEFAULT_SOFT_DROP_DAS_MS,
  createKeyboardInput,
  type InputSource,
  type KeyboardOptions,
} from '../../src/input/index.js';

/** A keydown carrying `key` and, optionally, the browser's `repeat` flag. */
const keydown = (target: EventTarget, key: string, repeat?: boolean): void => {
  const event = new Event('keydown', { cancelable: true });
  Object.assign(event, repeat === undefined ? { key } : { key, repeat });
  target.dispatchEvent(event);
};

const keyup = (target: EventTarget, key: string): void => {
  const event = new Event('keyup', { cancelable: true });
  Object.assign(event, { key });
  target.dispatchEvent(event);
};

/** `drain()` as a list of action types, which is all these tests care about. */
const types = (input: InputSource): PlayerActionType[] =>
  input.drain().map((action) => action.type);

/** An attached source plus the target its events go to. */
const setup = (options?: KeyboardOptions): { input: InputSource; target: EventTarget } => {
  const target = new EventTarget();
  const input = options === undefined ? createKeyboardInput() : createKeyboardInput(options);
  input.attach(target);
  return { input, target };
};

describe('createKeyboardInput — taps', () => {
  it('produces exactly one action for a single tap', () => {
    const { input, target } = setup();
    keydown(target, 'ArrowLeft');
    keyup(target, 'ArrowLeft');
    input.advance(10_000);
    expect(types(input)).toEqual(['moveLeft']);
  });

  it('drains in press order and clears the queue', () => {
    const { input, target } = setup();
    for (const key of ['ArrowLeft', 'z', 'ArrowRight', ' ']) {
      keydown(target, key);
      keyup(target, key);
    }
    expect(types(input)).toEqual(['moveLeft', 'rotateCCW', 'moveRight', 'hardDrop']);
    expect(input.drain()).toEqual([]);
  });

  it('maps every default key the contract names', () => {
    const { input, target } = setup();
    const expected: ReadonlyArray<readonly [string, PlayerActionType]> = [
      ['ArrowLeft', 'moveLeft'],
      ['ArrowRight', 'moveRight'],
      ['ArrowDown', 'softDrop'],
      ['z', 'rotateCCW'],
      ['x', 'rotateCW'],
      [' ', 'hardDrop'],
    ];
    for (const [key, action] of expected) {
      keydown(target, key);
      keyup(target, key);
      expect(types(input)).toEqual([action]);
    }
    expect(DEFAULT_KEY_MAP['ArrowLeft']).toBe('moveLeft');
  });

  it('is case-insensitive for letter keys, so Shift+Z still rotates', () => {
    const { input, target } = setup();
    keydown(target, 'Z');
    keyup(target, 'Z');
    keydown(target, 'X');
    expect(types(input)).toEqual(['rotateCCW', 'rotateCW']);
  });

  it('ignores unmapped keys entirely', () => {
    const { input, target } = setup();
    keydown(target, 'q');
    keydown(target, 'Enter');
    input.advance(10_000);
    expect(types(input)).toEqual([]);
  });
});

describe('createKeyboardInput — DAS and ARR', () => {
  it('waits the full DAS delay before the first repeat', () => {
    const { input, target } = setup();
    keydown(target, 'ArrowLeft');
    expect(types(input)).toEqual(['moveLeft']);

    input.advance(DEFAULT_DAS_MS - 1);
    expect(types(input)).toEqual([]);

    input.advance(1);
    expect(types(input)).toEqual(['moveLeft']);
  });

  it('then repeats once per ARR interval', () => {
    const { input, target } = setup();
    keydown(target, 'ArrowRight');
    input.advance(DEFAULT_DAS_MS);
    expect(types(input)).toEqual(['moveRight', 'moveRight']);

    input.advance(DEFAULT_ARR_MS - 1);
    expect(types(input)).toEqual([]);
    input.advance(1);
    expect(types(input)).toEqual(['moveRight']);

    input.advance(DEFAULT_ARR_MS * 3);
    expect(types(input)).toEqual(['moveRight', 'moveRight', 'moveRight']);
  });

  it('carries the overflow, so one big step equals many small ones', () => {
    const coarse = setup();
    const fine = setup();
    keydown(coarse.target, 'ArrowLeft');
    keydown(fine.target, 'ArrowLeft');

    coarse.input.advance(1000);
    for (let i = 0; i < 60; i += 1) fine.input.advance(1000 / 60);

    expect(types(coarse.input)).toEqual(types(fine.input));
    // 1 press + 1 at DAS + floor((1000 - 170) / 50) repeats.
    expect(1 + 1 + Math.floor((1000 - DEFAULT_DAS_MS) / DEFAULT_ARR_MS)).toBe(18);
  });

  it('releasing the key stops the repeat', () => {
    const { input, target } = setup();
    keydown(target, 'ArrowLeft');
    input.advance(DEFAULT_DAS_MS);
    expect(types(input)).toEqual(['moveLeft', 'moveLeft']);

    keyup(target, 'ArrowLeft');
    expect(types(input)).toEqual([]);
    input.advance(10_000);
    expect(types(input)).toEqual([]);
  });

  it('starts a fresh DAS charge on the next press', () => {
    const { input, target } = setup();
    keydown(target, 'ArrowLeft');
    input.advance(DEFAULT_DAS_MS - 1);
    keyup(target, 'ArrowLeft');
    keydown(target, 'ArrowLeft');
    expect(types(input)).toEqual(['moveLeft', 'moveLeft']);

    input.advance(DEFAULT_DAS_MS - 1);
    expect(types(input)).toEqual([]);
    input.advance(1);
    expect(types(input)).toEqual(['moveLeft']);
  });

  it('soft drop repeats on its own, faster timing', () => {
    const { input, target } = setup();
    keydown(target, 'ArrowDown');
    input.advance(DEFAULT_SOFT_DROP_DAS_MS - 1);
    expect(types(input)).toEqual(['softDrop']);
    input.advance(1);
    expect(types(input)).toEqual(['softDrop']);
    input.advance(DEFAULT_SOFT_DROP_ARR_MS * 2);
    expect(types(input)).toEqual(['softDrop', 'softDrop']);
  });

  it('repeats soft drop and a direction at the same time', () => {
    const { input, target } = setup();
    keydown(target, 'ArrowDown');
    keydown(target, 'ArrowLeft');
    expect(types(input)).toEqual(['softDrop', 'moveLeft']);

    input.advance(DEFAULT_DAS_MS);
    // Soft drop charges at 100 and repeats every 40: fires at 100 and 140.
    expect(types(input)).toEqual(['softDrop', 'softDrop', 'moveLeft']);
  });

  it('takes DAS and ARR from options', () => {
    const { input, target } = setup({ dasMs: 300, arrMs: 100 });
    keydown(target, 'ArrowLeft');
    input.advance(299);
    expect(types(input)).toEqual(['moveLeft']);
    input.advance(1);
    expect(types(input)).toEqual(['moveLeft']);
    input.advance(200);
    expect(types(input)).toEqual(['moveLeft', 'moveLeft']);
  });

  it('accepts a DAS of 0 as "repeat immediately"', () => {
    const { input, target } = setup({ dasMs: 0, arrMs: 50 });
    keydown(target, 'ArrowLeft');
    expect(types(input)).toEqual(['moveLeft']);
    input.advance(50);
    expect(types(input)).toEqual(['moveLeft', 'moveLeft']);
  });

  it('rejects a repeat interval that would never terminate', () => {
    expect(() => createKeyboardInput({ arrMs: 0 })).toThrow(RangeError);
    expect(() => createKeyboardInput({ softDropArrMs: -1 })).toThrow(RangeError);
    expect(() => createKeyboardInput({ dasMs: -1 })).toThrow(RangeError);
  });

  it('ignores zero, negative and non-finite time steps', () => {
    const { input, target } = setup();
    keydown(target, 'ArrowLeft');
    input.drain();
    input.advance(0);
    input.advance(-1000);
    input.advance(Number.NaN);
    expect(types(input)).toEqual([]);
    input.advance(DEFAULT_DAS_MS);
    expect(types(input)).toEqual(['moveLeft']);
  });
});

describe('createKeyboardInput — one action per press', () => {
  it('never repeats rotation or hard drop, however long they are held', () => {
    const { input, target } = setup();
    for (const key of ['z', 'x', ' ']) {
      keydown(target, key);
      input.advance(10_000);
      keyup(target, key);
    }
    expect(types(input)).toEqual(['rotateCCW', 'rotateCW', 'hardDrop']);
  });

  it("ignores the browser's own key-repeat storm", () => {
    const { input, target } = setup();
    keydown(target, 'ArrowLeft');
    for (let i = 0; i < 20; i += 1) keydown(target, 'ArrowLeft', true);
    expect(types(input)).toEqual(['moveLeft']);

    // The storm must not have disturbed our own charge either.
    input.advance(DEFAULT_DAS_MS - 1);
    expect(types(input)).toEqual([]);
    input.advance(1);
    expect(types(input)).toEqual(['moveLeft']);
  });

  it('ignores a repeated keydown even when the event omits the repeat flag', () => {
    const { input, target } = setup();
    keydown(target, ' ');
    for (let i = 0; i < 20; i += 1) keydown(target, ' ');
    expect(types(input)).toEqual(['hardDrop']);
  });

  it('ignores a keyup for a key that was never down', () => {
    const { input, target } = setup();
    keyup(target, 'ArrowLeft');
    input.advance(10_000);
    expect(types(input)).toEqual([]);
  });
});

describe('createKeyboardInput — opposing directions', () => {
  it('gives the newest press control and suspends the older one', () => {
    const { input, target } = setup();
    keydown(target, 'ArrowLeft');
    keydown(target, 'ArrowRight');
    expect(types(input)).toEqual(['moveLeft', 'moveRight']);

    input.advance(DEFAULT_DAS_MS + DEFAULT_ARR_MS);
    expect(types(input)).toEqual(['moveRight', 'moveRight']);
  });

  it('falls back to the still-held key on release, silently and from a full DAS', () => {
    const { input, target } = setup();
    keydown(target, 'ArrowLeft');
    keydown(target, 'ArrowRight');
    input.drain();

    keyup(target, 'ArrowRight');
    expect(types(input)).toEqual([]); // a key going up never moves the piece

    input.advance(DEFAULT_DAS_MS - 1);
    expect(types(input)).toEqual([]);
    input.advance(1);
    expect(types(input)).toEqual(['moveLeft']);
  });

  it('stops entirely when both directions are released', () => {
    const { input, target } = setup();
    keydown(target, 'ArrowLeft');
    keydown(target, 'ArrowRight');
    keyup(target, 'ArrowLeft');
    keyup(target, 'ArrowRight');
    input.drain();
    input.advance(10_000);
    expect(types(input)).toEqual([]);
  });

  it('releasing the suspended key leaves the owner repeating', () => {
    const { input, target } = setup();
    keydown(target, 'ArrowLeft');
    keydown(target, 'ArrowRight');
    keyup(target, 'ArrowLeft');
    input.drain();
    input.advance(DEFAULT_DAS_MS);
    expect(types(input)).toEqual(['moveRight']);
  });
});

describe('createKeyboardInput — attach and detach', () => {
  it('removes every listener and every running repeat', () => {
    const { input, target } = setup();
    keydown(target, 'ArrowLeft');
    expect(types(input)).toEqual(['moveLeft']);

    input.detach();
    input.advance(10_000);
    expect(types(input)).toEqual([]);

    keydown(target, 'ArrowLeft');
    keyup(target, 'ArrowLeft');
    keydown(target, ' ');
    input.advance(10_000);
    expect(types(input)).toEqual([]);
  });

  it('keeps actions produced before the detach', () => {
    const { input, target } = setup();
    keydown(target, ' ');
    input.detach();
    expect(types(input)).toEqual(['hardDrop']);
  });

  it('is idempotent, and works again after re-attaching', () => {
    const { input, target } = setup();
    input.detach();
    input.detach();

    const next = new EventTarget();
    input.attach(next);
    keydown(target, 'ArrowLeft'); // old target is no longer listened to
    keydown(next, 'ArrowRight');
    expect(types(input)).toEqual(['moveRight']);
  });

  it('re-attaching to a new target detaches the old one exactly once', () => {
    const input = createKeyboardInput();
    const first = new EventTarget();
    const second = new EventTarget();
    input.attach(first);
    input.attach(second);

    keydown(first, ' ');
    expect(types(input)).toEqual([]);
    keydown(second, ' ');
    expect(types(input)).toEqual(['hardDrop']);
  });

  it('does nothing before attach', () => {
    const input = createKeyboardInput();
    const target = new EventTarget();
    keydown(target, 'ArrowLeft');
    input.advance(10_000);
    expect(types(input)).toEqual([]);
  });

  it('forgets held keys on blur, so nothing is left sliding', () => {
    const { input, target } = setup();
    keydown(target, 'ArrowLeft');
    input.drain();
    target.dispatchEvent(new Event('blur'));
    input.advance(10_000);
    expect(types(input)).toEqual([]);

    // And the key is genuinely released: a fresh press still works.
    keydown(target, 'ArrowLeft');
    expect(types(input)).toEqual(['moveLeft']);
  });
});

describe('createKeyboardInput — options', () => {
  it('replaces the key map wholesale', () => {
    const { input, target } = setup({ keyMap: { a: 'moveLeft', d: 'moveRight' } });
    keydown(target, 'a');
    keydown(target, 'ArrowLeft'); // no longer mapped
    keydown(target, 'd');
    expect(types(input)).toEqual(['moveLeft', 'moveRight']);
  });

  it('calls preventDefault on mapped keys only, and can be told not to', () => {
    const target = new EventTarget();
    const input = createKeyboardInput();
    input.attach(target);

    const mapped = new Event('keydown', { cancelable: true });
    Object.assign(mapped, { key: ' ' });
    target.dispatchEvent(mapped);
    expect(mapped.defaultPrevented).toBe(true);

    const unmapped = new Event('keydown', { cancelable: true });
    Object.assign(unmapped, { key: 'q' });
    target.dispatchEvent(unmapped);
    expect(unmapped.defaultPrevented).toBe(false);

    const quiet = createKeyboardInput({ preventDefault: false });
    const quietTarget = new EventTarget();
    quiet.attach(quietTarget);
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { key: ' ' });
    quietTarget.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(types(quiet)).toEqual(['hardDrop']);
  });
});
