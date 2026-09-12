/**
 * Touch input: the same `InputSource` contract, driven by gestures.
 *
 * The page already fitted a phone; without this it could be watched and not
 * played. Nothing here reads a clock either — a flick needs a velocity, and the
 * time for it comes from `advance(ms)`, the same elapsed milliseconds the game
 * tick gets. That is what keeps these tests as deterministic as the keyboard's.
 *
 * The gestures, chosen so that none of them needs auto-repeat:
 *
 * | gesture                  | action        |
 * |--------------------------|---------------|
 * | tap                      | `rotateCW`    |
 * | tap with a second finger | `rotateCCW`   |
 * | drag left / right        | `moveLeft` / `moveRight`, one per `stepPx` |
 * | drag down                | `softDrop`, one per `stepPx`               |
 * | flick down               | `hardDrop`    |
 *
 * Dragging emits one action per `stepPx` of travel rather than repeating on a
 * timer, so the piece tracks the finger instead of the finger asking for a
 * repeat rate. There is no DAS or ARR here at all, by design.
 */

import type { PlayerAction } from '../game/index.js';
import type { InputSource } from './source.js';

/** Travel that produces one move or one soft drop. */
export const DEFAULT_STEP_PX = 28;
/** A press shorter than this, that barely moved, is a tap. */
export const DEFAULT_TAP_MAX_MS = 250;
/** How far a tap may drift and still be a tap. */
export const DEFAULT_TAP_MAX_PX = 14;
/** Downward travel a flick needs, on top of being fast. */
export const DEFAULT_FLICK_MIN_PX = 60;
/** Downward speed a flick needs. 0.6 px/ms is a brisk swipe, not a drag. */
export const DEFAULT_FLICK_MIN_PX_PER_MS = 0.6;

export interface TouchOptions {
  stepPx?: number;
  tapMaxMs?: number;
  tapMaxPx?: number;
  flickMinPx?: number;
  flickMinPxPerMs?: number;
  /**
   * Call `preventDefault` on the touch events handled here. On by default: a
   * drag that also scrolls the page makes the game unplayable on a phone.
   */
  preventDefault?: boolean;
}

/** The shape this reads off a touch event. Narrow on purpose, so tests can build one. */
interface TouchPoint {
  readonly identifier?: number;
  readonly clientX: number;
  readonly clientY: number;
}

interface TouchLikeEvent {
  readonly touches?: ArrayLike<TouchPoint>;
  readonly changedTouches?: ArrayLike<TouchPoint>;
  preventDefault?: () => void;
}

interface Gesture {
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  /** Travel not yet turned into an action, per axis. */
  restX: number;
  restY: number;
  elapsedMs: number;
  /** Set once the gesture has moved far enough to stop being a tap. */
  dragged: boolean;
  /** Set when a second finger lands, which turns the tap into a CCW rotation. */
  multi: boolean;
  /** A flick fires once; the rest of the gesture is ignored. */
  spent: boolean;
}

const point = (list: ArrayLike<TouchPoint> | undefined): TouchPoint | undefined =>
  list !== undefined && list.length > 0 ? list[0] : undefined;

export function createTouchInput(options: TouchOptions = {}): InputSource {
  const stepPx = options.stepPx ?? DEFAULT_STEP_PX;
  const tapMaxMs = options.tapMaxMs ?? DEFAULT_TAP_MAX_MS;
  const tapMaxPx = options.tapMaxPx ?? DEFAULT_TAP_MAX_PX;
  const flickMinPx = options.flickMinPx ?? DEFAULT_FLICK_MIN_PX;
  const flickMinPxPerMs = options.flickMinPxPerMs ?? DEFAULT_FLICK_MIN_PX_PER_MS;
  const prevent = options.preventDefault ?? true;

  if (stepPx <= 0) throw new RangeError(`stepPx must be positive, got ${stepPx}`);

  const queue: PlayerAction[] = [];
  let gesture: Gesture | null = null;
  let attached: EventTarget | null = null;

  const emit = (type: PlayerAction['type']): void => {
    queue.push({ type });
  };

  const onStart = (event: Event): void => {
    const e = event as unknown as TouchLikeEvent;
    if (prevent) e.preventDefault?.();
    if (gesture !== null) {
      // A second finger while one is down. Not a drag of its own — it turns the
      // first finger's tap into the other rotation.
      gesture.multi = true;
      return;
    }
    const p = point(e.changedTouches) ?? point(e.touches);
    if (p === undefined) return;
    gesture = {
      startX: p.clientX,
      startY: p.clientY,
      lastX: p.clientX,
      lastY: p.clientY,
      restX: 0,
      restY: 0,
      elapsedMs: 0,
      dragged: false,
      multi: false,
      spent: false,
    };
  };

  const onMove = (event: Event): void => {
    const e = event as unknown as TouchLikeEvent;
    if (prevent) e.preventDefault?.();
    const g = gesture;
    if (g === null || g.spent) return;
    const p = point(e.changedTouches) ?? point(e.touches);
    if (p === undefined) return;

    g.restX += p.clientX - g.lastX;
    g.restY += p.clientY - g.lastY;
    g.lastX = p.clientX;
    g.lastY = p.clientY;

    if (Math.abs(p.clientX - g.startX) > tapMaxPx || Math.abs(p.clientY - g.startY) > tapMaxPx) {
      g.dragged = true;
    }

    while (g.restX >= stepPx) {
      g.restX -= stepPx;
      emit('moveRight');
    }
    while (g.restX <= -stepPx) {
      g.restX += stepPx;
      emit('moveLeft');
    }
    // Downward only. Dragging up is not a gesture, so the leftover is dropped
    // rather than banked against a later downward drag.
    while (g.restY >= stepPx) {
      g.restY -= stepPx;
      emit('softDrop');
    }
    if (g.restY < 0) g.restY = 0;
  };

  const onEnd = (event: Event): void => {
    const e = event as unknown as TouchLikeEvent;
    if (prevent) e.preventDefault?.();
    const g = gesture;
    gesture = null;
    if (g === null || g.spent) return;

    const dy = g.lastY - g.startY;
    const fast = g.elapsedMs > 0 && dy / g.elapsedMs >= flickMinPxPerMs;
    if (dy >= flickMinPx && fast) {
      emit('hardDrop');
      return;
    }
    if (!g.dragged && g.elapsedMs <= tapMaxMs) {
      emit(g.multi ? 'rotateCCW' : 'rotateCW');
    }
  };

  const onCancel = (): void => {
    gesture = null;
  };

  const handlers: ReadonlyArray<readonly [string, (event: Event) => void]> = [
    ['touchstart', onStart],
    ['touchmove', onMove],
    ['touchend', onEnd],
    ['touchcancel', onCancel],
  ];

  return {
    attach(target: EventTarget): void {
      if (attached !== null) this.detach();
      for (const [name, handler] of handlers) {
        target.addEventListener(name, handler, { passive: !prevent });
      }
      attached = target;
    },

    detach(): void {
      if (attached === null) return;
      for (const [name, handler] of handlers) attached.removeEventListener(name, handler);
      attached = null;
      gesture = null;
      queue.length = 0;
    },

    advance(ms: number): void {
      if (gesture !== null) gesture.elapsedMs += ms;
    },

    drain(): PlayerAction[] {
      return queue.splice(0, queue.length);
    },
  };
}
