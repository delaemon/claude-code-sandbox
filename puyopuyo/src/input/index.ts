/**
 * Public surface of browser input: the source interface and the keyboard
 * implementation of it. No clock lives here — `advance(ms)` is the only way
 * auto-repeat moves.
 */

export type { InputSource } from './source.js';
export { combineInputs } from './combine.js';
export {
  DEFAULT_FLICK_MIN_PX,
  DEFAULT_FLICK_MIN_PX_PER_MS,
  DEFAULT_STEP_PX,
  DEFAULT_TAP_MAX_MS,
  DEFAULT_TAP_MAX_PX,
  createTouchInput,
  type TouchOptions,
} from './touch.js';
export {
  DEFAULT_ARR_MS,
  DEFAULT_DAS_MS,
  DEFAULT_KEY_MAP,
  DEFAULT_SOFT_DROP_ARR_MS,
  DEFAULT_SOFT_DROP_DAS_MS,
  createKeyboardInput,
  type KeyMap,
  type KeyboardOptions,
} from './keyboard.js';
