/**
 * Public surface of the game loop: piece, queue, state and the pure reducer.
 *
 * No clock and no randomness of its own — time arrives as tick inputs and the
 * queue's `rng` is injected by the caller.
 */

export * from './piece.js';
export * from './queue.js';
export * from './rng.js';
export * from './state.js';
export * from './step.js';
