/**
 * Public surface of browser input: the source interface and the keyboard
 * implementation of it. No clock lives here — `advance(ms)` is the only way
 * auto-repeat moves.
 */

export type { InputSource } from './source.js';
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
