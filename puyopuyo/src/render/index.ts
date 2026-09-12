/**
 * Public surface of the renderer: geometry as arithmetic, a palette, the HUD
 * model, and `draw`. Nothing here reads a clock or mutates the state it is
 * given — `main.ts` owns time.
 */

export * from './geometry.js';
export * from './palette.js';
export * from './hud.js';
export * from './draw.js';
