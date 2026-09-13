// Time arrives as an argument. Nothing here reads a clock -- which is the
// property evals/cases/clock-escapes-main.sh breaks.
export function advance(ms: number): number {
  return ms + 1;
}
