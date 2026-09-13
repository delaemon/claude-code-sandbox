// The one file allowed to read a clock. The check requires it to actually use
// one of the forbidden names: a pattern that matches nothing passes against any
// code at all.
import { advance } from "./pure";

export function loop(): void {
  requestAnimationFrame(() => advance(Date.now()));
}
