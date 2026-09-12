/**
 * What a source of player input looks like, from the game loop's side.
 *
 * A source **produces a queue, not callbacks**. The reducer must see actions in
 * a defined order relative to each tick, and a callback fired in the middle of
 * a frame cannot promise that: `main.ts` drains once per frame and feeds the
 * drained actions to `step` in order.
 *
 * A source also **has no clock**. Auto-repeat advances only through
 * `advance(ms)`, given the same elapsed milliseconds as the game tick, exactly
 * as `src/game/` takes time as an input. Nothing in `src/input/` reads
 * `Date.now`, `performance.now`, `setTimeout`, `setInterval` or
 * `requestAnimationFrame`; that is what makes auto-repeat testable in Node with
 * no timers and no flake.
 */

import type { PlayerAction } from '../game/index.js';

export interface InputSource {
  /** Begin listening. */
  attach(target: EventTarget): void;
  detach(): void;
  /** Advance auto-repeat timing. Given the same ms as the game tick. */
  advance(ms: number): void;
  /** Take every action produced since the last call, in order, and clear them. */
  drain(): PlayerAction[];
}
