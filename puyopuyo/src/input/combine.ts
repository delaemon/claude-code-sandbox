/**
 * Several input sources behaving as one.
 *
 * A phone has a keyboard attached often enough, and a laptop has a touchscreen
 * often enough, that picking one at startup is the wrong call — the same
 * session should accept both. `main.ts` then still deals with a single
 * `InputSource`, which is the point: the loop does not learn about devices.
 *
 * Drain order is source order, and within a source its own order. Actions from
 * two devices in the same frame are rare enough that any total order will do;
 * what matters is that there is one, and that it is the same every run.
 */

import type { PlayerAction } from '../game/index.js';
import type { InputSource } from './source.js';

export function combineInputs(...sources: readonly InputSource[]): InputSource {
  return {
    attach(target: EventTarget): void {
      for (const source of sources) source.attach(target);
    },
    detach(): void {
      for (const source of sources) source.detach();
    },
    advance(ms: number): void {
      for (const source of sources) source.advance(ms);
    },
    drain(): PlayerAction[] {
      return sources.flatMap((source) => source.drain());
    },
  };
}
