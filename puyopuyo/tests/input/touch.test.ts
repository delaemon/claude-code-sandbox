import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLICK_MIN_PX,
  DEFAULT_STEP_PX,
  DEFAULT_TAP_MAX_MS,
  combineInputs,
  createKeyboardInput,
  createTouchInput,
  type InputSource,
} from '../../src/input/index.js';

/**
 * Node has `EventTarget` but no `TouchEvent`, so the events are plain objects
 * carrying only the fields the source reads. That is the same trick the
 * keyboard tests use, and it is what lets every case here be exact: time moves
 * only through `advance(ms)`, so there is no timer to wait on and nothing to
 * flake.
 */
type Pt = { clientX: number; clientY: number };

function fire(target: EventTarget, type: string, points: Pt[]): void {
  const event = Object.assign(new Event(type), {
    touches: points,
    changedTouches: points,
    preventDefault() {},
  });
  target.dispatchEvent(event);
}

const types = (source: InputSource): string[] => source.drain().map((a) => a.type);

function setup(options?: Parameters<typeof createTouchInput>[0]) {
  const target = new EventTarget();
  const input = createTouchInput(options);
  input.attach(target);
  return { target, input };
}

/** Start at the origin, hold for `ms`, release wherever `to` says. */
function gesture(
  target: EventTarget,
  input: InputSource,
  to: Pt[],
  ms: number,
  from: Pt = { clientX: 100, clientY: 100 },
): void {
  fire(target, 'touchstart', [from]);
  input.advance(ms);
  for (const p of to) fire(target, 'touchmove', [p]);
  fire(target, 'touchend', [to.at(-1) ?? from]);
}

describe('touch input', () => {
  it('turns a tap into a rotation', () => {
    const { target, input } = setup();
    fire(target, 'touchstart', [{ clientX: 50, clientY: 50 }]);
    input.advance(80);
    fire(target, 'touchend', [{ clientX: 51, clientY: 52 }]);
    expect(types(input)).toEqual(['rotateCW']);
  });

  it('rotates the other way when a second finger joins the tap', () => {
    const { target, input } = setup();
    fire(target, 'touchstart', [{ clientX: 50, clientY: 50 }]);
    fire(target, 'touchstart', [{ clientX: 200, clientY: 60 }]);
    input.advance(80);
    fire(target, 'touchend', [{ clientX: 50, clientY: 50 }]);
    expect(types(input)).toEqual(['rotateCCW']);
  });

  it('does not rotate on a long press', () => {
    const { target, input } = setup();
    fire(target, 'touchstart', [{ clientX: 50, clientY: 50 }]);
    input.advance(DEFAULT_TAP_MAX_MS + 1);
    fire(target, 'touchend', [{ clientX: 50, clientY: 50 }]);
    expect(types(input)).toEqual([]);
  });

  it('moves one column per step of horizontal travel', () => {
    const { target, input } = setup();
    const x = (n: number): Pt => ({ clientX: 100 + n, clientY: 100 });
    gesture(target, input, [x(DEFAULT_STEP_PX), x(DEFAULT_STEP_PX * 2)], 300);
    expect(types(input)).toEqual(['moveRight', 'moveRight']);
  });

  it('moves left for leftward travel, and keeps the remainder', () => {
    const { target, input } = setup({ stepPx: 20 });
    const x = (n: number): Pt => ({ clientX: 100 + n, clientY: 100 });
    fire(target, 'touchstart', [x(0)]);
    fire(target, 'touchmove', [x(-15)]); // not a step yet
    expect(types(input)).toEqual([]);
    fire(target, 'touchmove', [x(-25)]); // 25 total: one step, 5 left over
    expect(types(input)).toEqual(['moveLeft']);
    fire(target, 'touchmove', [x(-40)]); // 40 total: the second step lands
    expect(types(input)).toEqual(['moveLeft']);
  });

  it('soft drops on downward travel but not upward', () => {
    const { target, input } = setup({ stepPx: 20 });
    const y = (n: number): Pt => ({ clientX: 100, clientY: 100 + n });
    fire(target, 'touchstart', [y(0)]);
    fire(target, 'touchmove', [y(40)]);
    expect(types(input)).toEqual(['softDrop', 'softDrop']);
    fire(target, 'touchmove', [y(-60)]); // dragging back up produces nothing
    expect(types(input)).toEqual([]);
  });

  it('hard drops on a fast downward flick', () => {
    const { target, input } = setup();
    const y = (n: number): Pt => ({ clientX: 100, clientY: 100 + n });
    fire(target, 'touchstart', [y(0)]);
    input.advance(40); // 120px in 40ms = 3 px/ms, well past the threshold
    fire(target, 'touchmove', [y(DEFAULT_FLICK_MIN_PX * 2)]);
    fire(target, 'touchend', [y(DEFAULT_FLICK_MIN_PX * 2)]);
    expect(types(input).at(-1)).toBe('hardDrop');
  });

  it('does not hard drop on a slow drag of the same distance', () => {
    const { target, input } = setup();
    const y = (n: number): Pt => ({ clientX: 100, clientY: 100 + n });
    fire(target, 'touchstart', [y(0)]);
    input.advance(2000); // same travel, far too slow to be a flick
    fire(target, 'touchmove', [y(DEFAULT_FLICK_MIN_PX * 2)]);
    fire(target, 'touchend', [y(DEFAULT_FLICK_MIN_PX * 2)]);
    expect(types(input)).not.toContain('hardDrop');
  });

  it('reads no clock: the same events with no advance never flick', () => {
    const { target, input } = setup();
    const y = (n: number): Pt => ({ clientX: 100, clientY: 100 + n });
    fire(target, 'touchstart', [y(0)]);
    fire(target, 'touchmove', [y(DEFAULT_FLICK_MIN_PX * 2)]);
    fire(target, 'touchend', [y(DEFAULT_FLICK_MIN_PX * 2)]);
    // Without advance(), no time has passed as far as this source knows, so
    // there is no velocity and nothing to call a flick.
    expect(types(input)).not.toContain('hardDrop');
  });

  it('forgets a cancelled gesture', () => {
    const { target, input } = setup();
    fire(target, 'touchstart', [{ clientX: 50, clientY: 50 }]);
    input.advance(50);
    target.dispatchEvent(new Event('touchcancel'));
    fire(target, 'touchend', [{ clientX: 50, clientY: 50 }]);
    expect(types(input)).toEqual([]);
  });

  it('detach leaves nothing listening and nothing queued', () => {
    const { target, input } = setup();
    fire(target, 'touchstart', [{ clientX: 50, clientY: 50 }]);
    input.advance(50);
    fire(target, 'touchend', [{ clientX: 50, clientY: 50 }]);
    input.detach();
    expect(types(input)).toEqual([]);

    fire(target, 'touchstart', [{ clientX: 50, clientY: 50 }]);
    input.advance(50);
    fire(target, 'touchend', [{ clientX: 50, clientY: 50 }]);
    expect(types(input)).toEqual([]);
  });

  it('rejects a step size that would loop forever', () => {
    expect(() => createTouchInput({ stepPx: 0 })).toThrow(RangeError);
  });
});

describe('combineInputs', () => {
  it('drains both sources, in source order', () => {
    const target = new EventTarget();
    const input = combineInputs(createKeyboardInput(), createTouchInput());
    input.attach(target);

    target.dispatchEvent(
      Object.assign(new Event('keydown'), { key: 'z', repeat: false, preventDefault() {} }),
    );
    fire(target, 'touchstart', [{ clientX: 50, clientY: 50 }]);
    input.advance(60);
    fire(target, 'touchend', [{ clientX: 50, clientY: 50 }]);

    // z is the counter-clockwise key; the tap is clockwise. Both appear, and
    // the keyboard's comes first because it is the first source given.
    expect(types(input)).toEqual(['rotateCCW', 'rotateCW']);
  });

  it('detaches every source', () => {
    const target = new EventTarget();
    const keyboard = createKeyboardInput();
    const touch = createTouchInput();
    const input = combineInputs(keyboard, touch);
    input.attach(target);
    input.detach();

    target.dispatchEvent(
      Object.assign(new Event('keydown'), { key: 'z', repeat: false, preventDefault() {} }),
    );
    fire(target, 'touchstart', [{ clientX: 50, clientY: 50 }]);
    input.advance(60);
    fire(target, 'touchend', [{ clientX: 50, clientY: 50 }]);

    expect(types(input)).toEqual([]);
  });
});
