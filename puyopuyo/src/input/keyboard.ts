/**
 * Keyboard → `PlayerAction`, with DAS/ARR auto-repeat and **no clock**.
 *
 * The module reads no time of its own: every repeat is driven by `advance(ms)`,
 * fed the same elapsed milliseconds as the game tick. `grep` for `Date.now`,
 * `performance.`, `setTimeout`, `setInterval` or `requestAnimationFrame` in
 * this directory and you will find them only in this comment. That is the point
 * — auto-repeat is the one part of input with interesting timing, and it is
 * tested in Node with no timers at all.
 *
 * Produced actions accumulate in a queue that `drain()` empties, so the reducer
 * sees them in press order relative to each tick.
 */

import type { PlayerAction, PlayerActionType } from '../game/index.js';
import type { InputSource } from './source.js';

/** `KeyboardEvent.key` → the action it produces. */
export type KeyMap = Readonly<Record<string, PlayerActionType>>;

/**
 * The contract's default map: arrows move, `z`/`x` rotate, down soft-drops,
 * space hard-drops. `z` is counter-clockwise and `x` clockwise because they sit
 * left-to-right under the hand in that order, so the left key turns left.
 *
 * Lookup falls back to `key.toLowerCase()`, so Shift+Z still rotates and only
 * the lowercase letters need an entry. `'Spacebar'` is legacy Edge/IE's name
 * for `' '`.
 */
export const DEFAULT_KEY_MAP: KeyMap = {
  ArrowLeft: 'moveLeft',
  ArrowRight: 'moveRight',
  ArrowDown: 'softDrop',
  z: 'rotateCCW',
  x: 'rotateCW',
  ' ': 'hardDrop',
  Spacebar: 'hardDrop',
};

/** Delay before horizontal auto-repeat starts. ~10 frames at 60 Hz. */
export const DEFAULT_DAS_MS = 170;
/** Horizontal repeat interval. ~3 frames at 60 Hz. */
export const DEFAULT_ARR_MS = 50;
/** Soft drop charges faster: holding down is never an exploratory nudge. */
export const DEFAULT_SOFT_DROP_DAS_MS = 100;
export const DEFAULT_SOFT_DROP_ARR_MS = 40;

export interface KeyboardOptions {
  /** Replaces the default map entirely; it is not merged into it. */
  readonly keyMap?: KeyMap;
  /** Delay before horizontal repeat begins. >= 0. */
  readonly dasMs?: number;
  /** Horizontal repeat interval. > 0. */
  readonly arrMs?: number;
  /** Delay before soft-drop repeat begins. >= 0. */
  readonly softDropDasMs?: number;
  /** Soft-drop repeat interval. > 0. */
  readonly softDropArrMs?: number;
  /**
   * Call `preventDefault()` on mapped keys, so arrows and space do not scroll
   * the page out from under the game. Default `true`.
   */
  readonly preventDefault?: boolean;
}

/**
 * The actions a held key repeats. Rotation and hard drop are deliberately
 * absent: each fires exactly once per key-down, because a repeating hard drop
 * would eat the next pair the instant it spawned.
 */
const REPEATING: ReadonlySet<PlayerActionType> = new Set<PlayerActionType>([
  'moveLeft',
  'moveRight',
  'softDrop',
]);

type Horizontal = 'moveLeft' | 'moveRight';

const isHorizontal = (action: PlayerActionType): action is Horizontal =>
  action === 'moveLeft' || action === 'moveRight';

const opposite = (action: Horizontal): Horizontal =>
  action === 'moveLeft' ? 'moveRight' : 'moveLeft';

interface Timing {
  readonly dasMs: number;
  readonly arrMs: number;
}

/** One held action's progress toward its next repeat. */
interface RepeatState {
  /** Milliseconds accumulated toward the next emission. */
  acc: number;
  /** `das` = still waiting for the first repeat; `arr` = repeating. */
  phase: 'das' | 'arr';
}

const positive = (name: string, value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number greater than 0, got ${String(value)}`);
  }
  return value;
};

const nonNegative = (name: string, value: number): number => {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite number >= 0, got ${String(value)}`);
  }
  return value;
};

/**
 * A keyboard `InputSource`.
 *
 * Opposing horizontal keys resolve **last press wins**: pressing right while
 * left is held moves right immediately and suspends left; releasing right hands
 * control back to left, silently, after a fresh DAS delay. A key going up never
 * produces a movement.
 */
export function createKeyboardInput(options: KeyboardOptions = {}): InputSource {
  const keyMap = options.keyMap ?? DEFAULT_KEY_MAP;
  const preventDefault = options.preventDefault ?? true;

  const moveTiming: Timing = {
    dasMs: nonNegative('dasMs', options.dasMs ?? DEFAULT_DAS_MS),
    arrMs: positive('arrMs', options.arrMs ?? DEFAULT_ARR_MS),
  };
  const dropTiming: Timing = {
    dasMs: nonNegative('softDropDasMs', options.softDropDasMs ?? DEFAULT_SOFT_DROP_DAS_MS),
    arrMs: positive('softDropArrMs', options.softDropArrMs ?? DEFAULT_SOFT_DROP_ARR_MS),
  };

  const timingFor = (action: PlayerActionType): Timing =>
    action === 'softDrop' ? dropTiming : moveTiming;

  const queue: PlayerAction[] = [];
  /** Keys currently down → the action they produce. Also the "is held" index. */
  const held = new Map<string, PlayerActionType>();
  /** Actions currently repeating. A suspended direction is absent from here. */
  const repeating = new Map<PlayerActionType, RepeatState>();
  /** Which direction currently owns horizontal movement, if any. */
  let horizontalOwner: Horizontal | null = null;
  let attached: EventTarget | null = null;

  const emit = (type: PlayerActionType): void => {
    queue.push({ type });
  };

  const isHeldAction = (action: PlayerActionType): boolean => {
    for (const value of held.values()) {
      if (value === action) return true;
    }
    return false;
  };

  const lookup = (key: string): PlayerActionType | undefined =>
    keyMap[key] ?? keyMap[key.toLowerCase()];

  const startRepeat = (action: PlayerActionType): void => {
    repeating.set(action, { acc: 0, phase: 'das' });
  };

  const press = (action: PlayerActionType): void => {
    emit(action);
    if (!REPEATING.has(action)) return;
    if (isHorizontal(action)) {
      // Last press wins: the other direction stays held but stops repeating.
      horizontalOwner = action;
      repeating.delete(opposite(action));
    }
    startRepeat(action);
  };

  const release = (action: PlayerActionType): void => {
    // Another key bound to the same action may still be down.
    if (isHeldAction(action)) return;
    repeating.delete(action);
    if (!isHorizontal(action) || horizontalOwner !== action) return;
    const other = opposite(action);
    if (isHeldAction(other)) {
      // Fall back to the still-held direction: silently, and from a full DAS
      // delay, so releasing a key never moves the piece by itself.
      horizontalOwner = other;
      startRepeat(other);
    } else {
      horizontalOwner = null;
    }
  };

  const releaseAll = (): void => {
    held.clear();
    repeating.clear();
    horizontalOwner = null;
  };

  const onKeyDown = (event: Event): void => {
    const key = (event as Event & Partial<KeyboardEvent>).key;
    if (typeof key !== 'string') return;
    const action = lookup(key);
    if (action === undefined) return;
    if (preventDefault) event.preventDefault();

    // The browser's own key-repeat storm is not our auto-repeat: it fires at
    // the OS repeat rate, which the game does not control and cannot test.
    // `repeat` flags it; the `held` check catches a source that omits the flag.
    if ((event as Event & Partial<KeyboardEvent>).repeat === true) return;
    if (held.has(key)) return;

    held.set(key, action);
    press(action);
  };

  const onKeyUp = (event: Event): void => {
    const key = (event as Event & Partial<KeyboardEvent>).key;
    if (typeof key !== 'string') return;
    const action = held.get(key);
    if (action === undefined) return;
    if (preventDefault) event.preventDefault();
    held.delete(key);
    release(action);
  };

  /** Focus loss eats the matching keyup, which would leave a key stuck down. */
  const onBlur = (): void => {
    releaseAll();
  };

  const detach = (): void => {
    if (attached !== null) {
      attached.removeEventListener('keydown', onKeyDown);
      attached.removeEventListener('keyup', onKeyUp);
      attached.removeEventListener('blur', onBlur);
      attached = null;
    }
    releaseAll();
  };

  return {
    attach(target: EventTarget): void {
      // Re-attaching to a new target must not leave the old one listening.
      detach();
      attached = target;
      target.addEventListener('keydown', onKeyDown);
      target.addEventListener('keyup', onKeyUp);
      target.addEventListener('blur', onBlur);
    },

    detach,

    advance(ms: number): void {
      if (!Number.isFinite(ms) || ms <= 0) return;
      for (const [action, state] of repeating) {
        const { dasMs, arrMs } = timingFor(action);
        state.acc += ms;
        if (state.phase === 'das') {
          if (state.acc < dasMs) continue;
          state.acc -= dasMs;
          state.phase = 'arr';
          emit(action);
        }
        while (state.acc >= arrMs) {
          state.acc -= arrMs;
          emit(action);
        }
      }
    },

    /** Note: already-produced actions survive `detach()`; a final drain is not lossy. */
    drain(): PlayerAction[] {
      return queue.splice(0, queue.length);
    },
  };
}
