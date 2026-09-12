/**
 * The browser entry point — and the only file in this project that knows what
 * time it is.
 *
 * `requestAnimationFrame` and `performance.now` appear here and nowhere else
 * (CONTRACT.md, "Where clocks are allowed"). Every layer below takes time as an
 * input: the reducer gets `tick(ms)`, the input source gets `advance(ms)`, and
 * the renderer gets neither. This file is also where the one permitted piece of
 * non-determinism lives — the seed handed to `mulberry32`.
 *
 * The frame, in order:
 *
 *   1. measure elapsed ms (clamped)
 *   2. `input.advance(ms)`  — auto-repeat catches up to now
 *   3. `input.drain()`      — actions the player made during the last frame
 *   4. `step(state, action)` for each, then `step(state, tick(ms))`
 *   5. `draw(ctx, state, layout)`
 *
 * Actions are applied *before* the tick because they were made before this
 * frame's time passed: pressing left and then letting a frame elapse should
 * move, then fall, not fall, then move.
 */

import { createGame, mulberry32, step, tick, type GameState } from './game/index.js';
import { createKeyboardInput } from './input/index.js';
import { draw, fitLayout, type Layout } from './render/index.js';

/**
 * The most time one frame may advance the game. A backgrounded tab hands back
 * a gap of seconds; feeding that in whole would drop the piece the player was
 * holding before the first frame is even drawn. Clamping loses time, which is
 * the right thing to lose.
 */
const MAX_FRAME_MS = 100;

/** Retina is worth it; 4x is not. */
const MAX_DPR = 3;

function required<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (el === null) throw new Error(`missing element: ${selector}`);
  return el;
}

/**
 * The seed. `?seed=123` makes a run reproducible — the whole stack below is
 * deterministic given the same seed and the same inputs, so a bug found in a
 * run can be replayed. Without it, the clock and `Math.random`: this is the
 * one place either is allowed.
 */
function startingSeed(): number {
  const param = new URLSearchParams(window.location.search).get('seed');
  if (param !== null && /^[0-9]+$/.test(param)) return Number(param) >>> 0;
  return (Date.now() ^ Math.floor(Math.random() * 0x1_0000_0000)) >>> 0;
}

const canvas = required<HTMLCanvasElement>('#game');
const seedLabel = document.querySelector<HTMLElement>('#seed');
const context = canvas.getContext('2d');
if (context === null) throw new Error('this browser has no 2d canvas context');
// Aliased through an annotated const: `frame` and `syncLayout` are hoisted, so
// the narrowing above does not reach into them on its own.
const ctx: CanvasRenderingContext2D = context;

const input = createKeyboardInput();
input.attach(window);

let seed = startingSeed();
let state: GameState = newGame(seed);

function newGame(withSeed: number): GameState {
  if (seedLabel !== null) seedLabel.textContent = String(withSeed);
  return createGame({ rng: mulberry32(withSeed) });
}

// ------------------------------------------------------------------ layout

let layout: Layout = fitLayout(1, 1);
let lastW = -1;
let lastH = -1;
let lastDpr = -1;

/**
 * Resize the canvas to its container, in CSS pixels, with the backing store
 * scaled for the display. `draw` is handed a layout in CSS pixels and the
 * transform does the rest, so nothing below this line knows about `devicePixelRatio`.
 */
function syncLayout(): void {
  const host = canvas.parentElement ?? document.body;
  const w = Math.max(1, host.clientWidth);
  const h = Math.max(1, host.clientHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  if (w === lastW && h === lastH && dpr === lastDpr) return;
  lastW = w;
  lastH = h;
  lastDpr = dpr;

  layout = fitLayout(w, h, { previewCount: state.queue.previewSize });
  canvas.width = Math.round(layout.width * dpr);
  canvas.height = Math.round(layout.height * dpr);
  canvas.style.width = `${layout.width}px`;
  canvas.style.height = `${layout.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// -------------------------------------------------------------------- loop

let previous = performance.now();

function frame(now: number): void {
  const elapsed = Math.min(Math.max(now - previous, 0), MAX_FRAME_MS);
  previous = now;

  input.advance(elapsed);
  for (const playerAction of input.drain()) state = step(state, playerAction);
  state = step(state, tick(elapsed));

  syncLayout();
  draw(ctx, state, layout);
  window.requestAnimationFrame(frame);
}

/**
 * Restart, but only from the game-over screen: a live game must not be
 * throwable away by a stray keypress. `r` is not in the input module's key map,
 * so this listener and the game's controls cannot collide.
 */
window.addEventListener('keydown', (event: KeyboardEvent) => {
  if (state.phase !== 'gameover') return;
  const key = event.key.toLowerCase();
  if (key !== 'r' && key !== 'enter') return;
  event.preventDefault();
  seed = (seed + 1) >>> 0;
  state = newGame(seed);
});

window.addEventListener('resize', syncLayout);

syncLayout();
window.requestAnimationFrame(frame);
